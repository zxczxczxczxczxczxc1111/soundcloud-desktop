import { WebContentsView, type BrowserWindow } from 'electron';
import { join } from 'path';
import { trustLocalFile } from '../trustedViews';

export interface UpdateScreenState {
    title: string;
    status: string;
    /** 0-100 */
    percent: number;
    later: string;
    installing: boolean;
    dark: boolean;
}

// Экран «Загружаю обновление» поверх страницы, под шапкой: кнопки окна остаются доступны
export class UpdateScreen {
    private view: WebContentsView | null;
    private state: UpdateScreenState | null = null;
    private loaded = false;
    private resize = (): void => this.layout();

    constructor(private window: BrowserWindow, private top: number) {
        const view = new WebContentsView({
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                webSecurity: true,
                preload: join(__dirname, 'updatePreload.js'),
                devTools: process.argv.includes('--dev'),
                spellcheck: false,
            },
        });
        view.setBackgroundColor('#00000000');
        const file = join(__dirname, 'update.html');
        trustLocalFile(view.webContents, file);
        view.webContents.on('did-finish-load', () => {
            this.loaded = true;
            this.push();
            // Клавиши больше не уходят странице под экраном
            view.webContents.focus();
        });
        window.contentView.addChildView(view);
        window.on('resize', this.resize);
        this.view = view;
        this.layout();
        void view.webContents.loadFile(file).catch((error: unknown) => console.error('Не удалось открыть экран обновления:', error));
    }
    public owns(sender: Electron.WebContents): boolean {
        return this.view !== null && this.view.webContents === sender;
    }
    public show(state: UpdateScreenState): void {
        this.state = state;
        this.push();
    }
    public layout(): void {
        if (!this.view || this.window.isDestroyed()) return;
        const { width, height } = this.window.getContentBounds();
        this.view.setBounds({ x: 0, y: this.top, width, height: Math.max(0, height - this.top) });
    }
    public close(): void {
        const view = this.view;
        this.view = null;
        if (!view) return;
        if (!this.window.isDestroyed()) {
            this.window.removeListener('resize', this.resize);
            this.window.contentView.removeChildView(view);
        }
        if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    private push(): void {
        if (!this.loaded || !this.state || !this.view || this.view.webContents.isDestroyed()) return;
        this.view.webContents.send('update-screen-state', this.state);
    }
}
