import { WebContentsView, BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { join } from 'path';
import { trustLocalFile } from '../trustedViews';
import type { HistoryIndex } from '../services/historyIndex';
import type { TasteService } from '../services/tasteModel';
import { trackPathOf } from '../services/waveSignals';

const HEADER = 32;
const DAY = 86400000;
const ARTIST_PATH = /^\/[a-z0-9_-]{1,100}$/;
const INVOKE = ['history:init', 'history:overview', 'history:day', 'history:search', 'history:play', 'history:taste', 'history:taste-remove'] as const;
const SEND = ['history:ready', 'history:close', 'history:artist'] as const;

export interface HistoryHost {
    /** Страница сайта: через неё идут воспроизведение, переход и добор названий */
    site(): WebContents | null;
    /** Пользователь, если страница сайта его не назвала */
    fallbackUser(): number;
    language(): 'ru' | 'en';
    dark(): boolean;
    /** Перед открытием: закрыть то, что история перекроет */
    beforeOpen(): void;
    onState(open: boolean): void;
    restoreFocus(): void;
    /** Горячие клавиши клиента внутри окна истории */
    attach(contents: WebContents): void;
}

const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
// Границы от страницы: не раньше 2020 года и не дальше двух суток вперёд
const isBound = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= Date.UTC(2020, 0, 1) && value <= Date.now() + 2 * DAY;

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Тайм-аут: ' + label)), ms);
    });
    return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

// Страница истории поверх сайта: от шапки до плеера сайта, плеер остаётся виден и управляем
export class HistoryManager {
    private view: WebContentsView | null = null;
    private userId = 0;
    // Место плеера сайта в точках страницы и высота страницы в тех же точках: так масштаб сайта учитывается сам
    private player = { height: 0, viewport: 0 };
    private filling = false;
    private disposed = false;
    private resize = (): void => this.updateBounds();
    private ready = (event: IpcMainEvent): void => {
        if (!this.owns(event)) return;
        const view = this.view!;
        view.setVisible(true);
        view.webContents.focus();
    };
    private close = (event: IpcMainEvent): void => {
        if (this.owns(event)) this.hide();
    };
    private artist = (event: IpcMainEvent, path: unknown): void => {
        if (!this.owns(event) || typeof path !== 'string' || !ARTIST_PATH.test(path)) return;
        this.hide();
        const site = this.site();
        if (!site) return;
        (site.executeJavaScript('window.__scNavigate ? window.__scNavigate(' + JSON.stringify(path) + ') : false') as Promise<unknown>)
            .then((done) => (done === true ? undefined : site.loadURL('https://soundcloud.com' + path)))
            .catch((error: unknown) => console.warn('История: страница артиста не открыта', error));
    };

    constructor(private parentWindow: BrowserWindow, private index: HistoryIndex, private taste: TasteService, private host: HistoryHost) {
        this.parentWindow.on('resize', this.resize);
        this.parentWindow.once('closed', () => this.dispose());
        ipcMain.handle('history:init', async (event) => {
            this.guard(event);
            this.userId = await this.user();
            if (this.userId) {
                try {
                    this.index.sync(this.userId);
                } catch (error) {
                    console.warn('История: журнал не перенесён в индекс', error);
                }
                void this.fill(this.userId);
            }
            return { language: this.host.language(), dark: this.host.dark(), signedIn: this.userId > 0 };
        });
        ipcMain.handle('history:overview', (event, from: unknown, to: unknown) => {
            this.guard(event);
            if ((from !== null && !isBound(from)) || !isBound(to)) return null;
            return this.index.overview(this.userId, from, to);
        });
        ipcMain.handle('history:day', (event, from: unknown, to: unknown) => {
            this.guard(event);
            if (!isBound(from) || !isBound(to) || to <= from) return null;
            return { rows: this.index.day(this.userId, from, to), ...this.index.neighbors(this.userId, from, to) };
        });
        ipcMain.handle('history:search', (event, query: unknown) => {
            this.guard(event);
            return this.index.search(this.userId, query);
        });
        ipcMain.handle('history:play', async (event, path: unknown) => {
            this.guard(event);
            const track = trackPathOf(path);
            const site = this.site();
            if (!track || !site) return false;
            // userGesture: трек включает пользователь, политика автовоспроизведения его не держит
            const done = await (site.executeJavaScript('window.__scOpenTrack ? window.__scOpenTrack(' + JSON.stringify(track) + ', false) : false', true) as Promise<unknown>);
            return done === true;
        });
        // Вкус глазами волны: любимые артисты и теги модели, доля ранних пропусков
        ipcMain.handle('history:taste', (event) => {
            this.guard(event);
            return this.taste.view(this.userId);
        });
        ipcMain.handle('history:taste-remove', (event, kind: unknown, key: unknown, removed: unknown) => {
            this.guard(event);
            if (!this.taste.setRemoved(this.userId, kind, key, removed)) return null;
            return this.taste.view(this.userId);
        });
        ipcMain.on('history:ready', this.ready);
        ipcMain.on('history:close', this.close);
        ipcMain.on('history:artist', this.artist);
    }
    private owns(event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>): boolean {
        return this.view !== null && event.sender === this.view.webContents && event.senderFrame === event.sender.mainFrame;
    }
    private guard(event: IpcMainInvokeEvent): void {
        if (!this.owns(event)) throw new Error('Недопустимый отправитель истории');
    }
    private site(): WebContents | null {
        const site = this.host.site();
        return site && !site.isDestroyed() ? site : null;
    }
    private async user(): Promise<number> {
        const site = this.site();
        if (site) {
            try {
                const id = await withTimeout(site.executeJavaScript('window.__scWhoAmI ? window.__scWhoAmI() : 0') as Promise<unknown>, 4000, 'пользователь сайта');
                if (isId(id)) return id;
            } catch (error) {
                console.warn('История: пользователь сайта не получен', error);
            }
        }
        return this.host.fallbackUser();
    }
    // Старые записи журнала без названий: сайт отдаёт их пачками, пока есть что добирать
    private async fill(userId: number): Promise<void> {
        if (this.filling) return;
        this.filling = true;
        try {
            for (let round = 0; round < 10; round++) {
                const ids = this.index.missing(userId);
                const site = this.site();
                if (!ids.length || !site) return;
                const script = 'window.__scResolveTracks ? window.__scResolveTracks(' + JSON.stringify(ids) + ') : null';
                const result = (await withTimeout(site.executeJavaScript(script) as Promise<unknown>, 60000, 'названия треков')) as { asked?: unknown; tracks?: unknown } | null;
                const wanted = new Set(ids);
                const asked = Array.isArray(result?.asked) ? result.asked.filter((id): id is number => isId(id) && wanted.has(id)) : [];
                if (!asked.length) return;
                if (this.index.resolve(userId, asked, result?.tracks)) this.view?.webContents.send('history:changed');
                // Часть пачек сайт не отдал: остаток спросим при следующем открытии
                if (asked.length < ids.length) return;
            }
        } catch (error) {
            console.warn('История: названия треков не добраны', error);
        } finally {
            this.filling = false;
        }
    }
    private updateBounds(): void {
        if (!this.view || this.parentWindow.isDestroyed()) return;
        const bounds = this.parentWindow.getContentBounds();
        const page = Math.max(0, bounds.height - HEADER);
        // Страница сайта занимает всё под шапкой: точки страницы переводятся в точки окна через её высоту
        const player = this.player.viewport > 0 ? Math.round((this.player.height * page) / this.player.viewport) : 0;
        this.view.setBounds({ x: 0, y: HEADER, width: bounds.width, height: Math.max(0, page - player) });
    }

    /** Сайт сообщил, сколько места снизу занимает плеер с тем, что из него выехало: громкость, очередь */
    public setPlayerArea(height: unknown, viewport: unknown): void {
        const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 20000;
        if (!valid(height) || !valid(viewport) || height > viewport) return;
        this.player = { height, viewport };
        this.updateBounds();
    }
    public isOpen(): boolean {
        return this.view !== null;
    }
    public toggle(): void {
        if (this.view) this.hide();
        else this.show();
    }
    public show(): void {
        if (this.disposed || this.view) return;
        this.host.beforeOpen();
        this.view = new WebContentsView({
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                webSecurity: true,
                preload: join(__dirname, 'historyPreload.js'),
                devTools: process.argv.includes('--dev'),
                spellcheck: false,
            },
        });
        this.view.setVisible(false);
        this.view.setBackgroundColor(this.host.dark() ? '#121212' : '#ffffff');
        trustLocalFile(this.view.webContents, join(__dirname, 'history.html'));
        this.host.attach(this.view.webContents);
        this.parentWindow.contentView.addChildView(this.view);
        this.updateBounds();
        void this.view.webContents.loadFile(join(__dirname, 'history.html')).catch((error: unknown) => console.error('Не удалось открыть историю:', error));
        this.host.onState(true);
    }
    public hide(): void {
        const view = this.view;
        this.view = null;
        if (!view) return;
        if (!this.parentWindow.isDestroyed()) this.parentWindow.contentView.removeChildView(view);
        if (!view.webContents.isDestroyed()) {
            view.webContents.once('destroyed', () => {
                if (!this.disposed && !this.view && !this.parentWindow.isDestroyed()) this.host.restoreFocus();
            });
            view.webContents.close();
        }
        if (!this.disposed) this.host.onState(false);
    }
    public focused(): boolean {
        return !!this.view && !this.view.webContents.isDestroyed() && this.view.webContents.isFocused();
    }
    public focus(): boolean {
        if (!this.view || this.view.webContents.isDestroyed()) return false;
        this.view.webContents.focus();
        return true;
    }
    public setTheme(dark: boolean): void {
        if (!this.view) return;
        this.view.setBackgroundColor(dark ? '#121212' : '#ffffff');
        this.view.webContents.send('theme-changed', dark);
    }
    public setLanguage(language: 'ru' | 'en'): void {
        this.view?.webContents.send('history:language', language);
    }
    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.hide();
        this.parentWindow.removeListener('resize', this.resize);
        for (const channel of INVOKE) ipcMain.removeHandler(channel);
        ipcMain.removeListener(SEND[0], this.ready);
        ipcMain.removeListener(SEND[1], this.close);
        ipcMain.removeListener(SEND[2], this.artist);
        this.index.close();
    }
}
