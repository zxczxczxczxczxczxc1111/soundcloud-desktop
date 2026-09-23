import type { AppUpdater } from 'electron-updater';

export const RELEASES_URL = 'https://github.com/zxczxczxczxczxczxc1111/soundcloud-desktop/releases/latest';
const LATEST_RELEASE_API = 'https://api.github.com/repos/zxczxczxczxczxczxc1111/soundcloud-desktop/releases/latest';
const RELEASE_PAGE_PREFIX = 'https://github.com/zxczxczxczxczxczxc1111/soundcloud-desktop/releases/';
export const FIRST_CHECK_DELAY_MS = 30_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

// installer: скачать в фоне и поставить при выходе; portable: только сообщить о новой версии.
export type UpdateMode = 'installer' | 'portable' | 'dev';
export interface UpdateState {
    mode: UpdateMode;
    version: string;
    enabled: boolean;
    hint: string;
    status: string;
    releaseUrl: string;
}
type Updater = Pick<AppUpdater, 'autoDownload' | 'autoInstallOnAppQuit' | 'checkForUpdates' | 'on'>;
interface Settings {
    get(key: string, fallback?: unknown): unknown;
}
export interface UpdateServiceOptions {
    mode: UpdateMode;
    version: string;
    store: Settings;
    notify(message: string): void;
    onState(state: UpdateState): void;
    loadUpdater(): Updater;
    fetch?: typeof fetch;
}

// Сравнение x.y.z без предрелизных суффиксов: GitHub releases/latest их и так не отдаёт.
export function isNewerVersion(candidate: string, current: string): boolean {
    const parse = (value: string): number[] | null => {
        const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
        return match ? match.slice(1, 4).map(Number) : null;
    };
    const next = parse(candidate);
    const now = parse(current);
    if (!next || !now) return false;
    for (let i = 0; i < 3; i++) if (next[i] !== now[i]) return next[i] > now[i];
    return false;
}

const HINTS: Record<UpdateMode, string> = {
    installer: 'Новая версия скачивается в фоне и ставится, когда вы закрываете приложение.',
    portable: 'Портативная версия сама не обновляется: приложение проверит новую версию и сообщит о ней.',
    dev: 'В режиме разработки обновления не проверяются.',
};

export class UpdateService {
    private updater: Updater | null = null;
    private firstTimer: ReturnType<typeof setTimeout> | null = null;
    private interval: ReturnType<typeof setInterval> | null = null;
    private checking = false;
    private disposed = false;
    private status = '';
    private releaseUrl = RELEASES_URL;
    private notifiedVersion = '';
    private downloading = '';
    private readonly fetchRelease: typeof fetch;

    constructor(private options: UpdateServiceOptions) {
        this.fetchRelease = options.fetch ?? fetch;
    }
    private get enabled(): boolean {
        return this.options.store.get('autoUpdateEnabled', true) === true;
    }
    public getState(): UpdateState {
        const { mode, version } = this.options;
        let status = this.status;
        if (mode === 'dev') status = HINTS.dev;
        else if (!this.enabled) status = 'Автообновление выключено.';
        return { mode, version, enabled: this.enabled, hint: HINTS[mode], status, releaseUrl: this.releaseUrl };
    }
    private setStatus(status: string): void {
        this.status = status;
        if (!this.disposed) this.options.onState(this.getState());
    }
    public start(): void {
        if (this.options.mode === 'dev' || this.disposed) return;
        this.stopTimers();
        if (!this.enabled) return;
        this.firstTimer = setTimeout(() => {
            this.firstTimer = null;
            void this.check();
        }, FIRST_CHECK_DELAY_MS);
        this.firstTimer.unref?.();
        this.interval = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
        this.interval.unref?.();
    }
    public setEnabled(enabled: boolean): void {
        if (this.updater) this.updater.autoInstallOnAppQuit = enabled;
        if (enabled) this.start();
        else this.stopTimers();
        if (!this.disposed) this.options.onState(this.getState());
    }
    public async check(): Promise<void> {
        if (this.disposed || this.checking || this.options.mode === 'dev' || !this.enabled) return;
        this.checking = true;
        try {
            if (this.options.mode === 'installer') await this.checkInstaller();
            else await this.checkPortable();
        } catch (error) {
            console.error('Обновления: проверка не удалась:', error);
            this.setStatus('Не удалось проверить обновления. Приложение попробует ещё раз позже.');
        } finally {
            this.checking = false;
        }
    }
    private installer(): Updater {
        if (this.updater) return this.updater;
        const updater = this.options.loadUpdater();
        updater.autoDownload = true;
        updater.autoInstallOnAppQuit = this.enabled;
        updater.on('checking-for-update', () => this.setStatus('Идёт проверка обновлений...'));
        updater.on('update-not-available', () => this.setStatus('Установлена последняя версия.'));
        updater.on('update-available', (info) => {
            this.downloading = info.version;
            this.setStatus('Скачивается версия ' + info.version + '...');
        });
        updater.on('download-progress', (info) => {
            this.setStatus('Скачивается версия ' + this.downloading + ': ' + Math.floor(info.percent) + '%');
        });
        updater.on('update-downloaded', (info) => {
            this.setStatus('Версия ' + info.version + ' скачана и установится при выходе из приложения.');
            if (this.notifiedVersion === info.version) return;
            this.notifiedVersion = info.version;
            this.options.notify('Обновление ' + info.version + ' скачано. Оно установится, когда вы закроете приложение.');
        });
        // Саму ошибку пишут в журнал check() и обработчик загрузки, здесь только статус.
        updater.on('error', () => this.setStatus('Не удалось обновиться. Приложение попробует ещё раз позже.'));
        this.updater = updater;
        return updater;
    }
    private async checkInstaller(): Promise<void> {
        const result = await this.installer().checkForUpdates();
        result?.downloadPromise?.catch((error: unknown) => {
            console.error('Обновления: не удалось скачать:', error);
            this.setStatus('Не удалось скачать обновление. Приложение попробует ещё раз позже.');
        });
    }
    private async checkPortable(): Promise<void> {
        this.setStatus('Идёт проверка обновлений...');
        const response = await this.fetchRelease(LATEST_RELEASE_API, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'soundcloud-desktop/' + this.options.version },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error('GitHub ответил HTTP ' + response.status);
        const body: unknown = await response.json();
        const release = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
        const tag = typeof release.tag_name === 'string' ? release.tag_name : '';
        if (!tag) throw new Error('В ответе GitHub нет номера версии');
        const page = typeof release.html_url === 'string' && release.html_url.startsWith(RELEASE_PAGE_PREFIX) ? release.html_url : RELEASES_URL;
        if (!isNewerVersion(tag, this.options.version)) {
            this.releaseUrl = RELEASES_URL;
            this.setStatus('Установлена последняя версия.');
            return;
        }
        const version = tag.replace(/^v/, '');
        this.releaseUrl = page;
        this.setStatus('Вышла версия ' + version + '. Скачать её можно на странице релиза.');
        if (this.notifiedVersion === version) return;
        this.notifiedVersion = version;
        this.options.notify('Вышла версия ' + version + '. Ссылка на неё в настройках, клавиша F1.');
    }
    private stopTimers(): void {
        if (this.firstTimer) clearTimeout(this.firstTimer);
        if (this.interval) clearInterval(this.interval);
        this.firstTimer = null;
        this.interval = null;
    }
    public dispose(): void {
        this.disposed = true;
        this.stopTimers();
    }
}
