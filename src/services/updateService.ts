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
    /** Скачанную версию можно поставить сейчас, с перезапуском */
    canInstall: boolean;
}
type Updater = Pick<AppUpdater, 'autoDownload' | 'autoInstallOnAppQuit' | 'checkForUpdates' | 'on' | 'quitAndInstall'>;
interface Settings {
    get(key: string, fallback?: unknown): unknown;
}
export type UpdateLanguage = 'ru' | 'en';
export interface UpdateServiceOptions {
    mode: UpdateMode;
    version: string;
    store: Settings;
    notify(message: string): void;
    onState(state: UpdateState): void;
    loadUpdater(): Updater;
    fetch?: typeof fetch;
    /** Язык подписей в F1 и уведомлениях; по умолчанию русский */
    language?: () => UpdateLanguage;
    /** Каждая смена статуса ключом: по нему main решает, показывать ли экран обновления */
    onStatus?(status: UpdateStatus): void;
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

export type StatusKey = 'checking' | 'latest' | 'downloading' | 'progress' | 'downloaded' | 'failedCheck' | 'failedUpdate' | 'failedDownload' | 'released';
export interface UpdateStatus {
    key: StatusKey;
    version?: string;
    percent?: number;
}
type TextKey = UpdateMode | StatusKey | 'disabled' | 'notifyDownloaded' | 'notifyReleased';
// Статус хранится ключом, а не строкой: при смене языка F1 получает его заново уже на новом языке
const TEXTS: Record<UpdateLanguage, Record<TextKey, string>> = {
    ru: {
        installer: 'Новая версия ставится сама: при запуске с перезапуском или при закрытии приложения.',
        portable: 'Портативная версия сама не обновляется: приложение проверит новую версию и сообщит о ней.',
        dev: 'В режиме разработки обновления не проверяются.',
        disabled: 'Автообновление выключено.',
        checking: 'Идёт проверка обновлений...',
        latest: 'Установлена последняя версия.',
        downloading: 'Скачивается версия {v}...',
        progress: 'Скачивается версия {v}: {p}%',
        downloaded: 'Версия {v} скачана и установится при выходе из приложения.',
        failedCheck: 'Не удалось проверить обновления. Приложение попробует ещё раз позже.',
        failedUpdate: 'Не удалось обновиться. Приложение попробует ещё раз позже.',
        failedDownload: 'Не удалось скачать обновление. Приложение попробует ещё раз позже.',
        released: 'Вышла версия {v}. Скачать её можно на странице релиза.',
        notifyDownloaded: 'Обновление {v} скачано. Оно установится, когда вы закроете приложение.',
        notifyReleased: 'Вышла версия {v}. Ссылка на неё в настройках, клавиша F1.',
    },
    en: {
        installer: 'New versions install on their own: at launch with a restart, or when you quit the app.',
        portable: 'The portable version doesn’t update itself: the app checks for a new version and tells you about it.',
        dev: 'Updates aren’t checked in development mode.',
        disabled: 'Auto-update is off.',
        checking: 'Checking for updates...',
        latest: 'You have the latest version.',
        downloading: 'Downloading version {v}...',
        progress: 'Downloading version {v}: {p}%',
        downloaded: 'Version {v} is downloaded and will install when you quit the app.',
        failedCheck: 'Couldn’t check for updates. The app will try again later.',
        failedUpdate: 'Couldn’t update. The app will try again later.',
        failedDownload: 'Couldn’t download the update. The app will try again later.',
        released: 'Version {v} is out. You can download it from the release page.',
        notifyDownloaded: 'Update {v} is downloaded. It will install when you close the app.',
        notifyReleased: 'Version {v} is out. The link is in Settings, press F1.',
    },
};

export class UpdateService {
    private updater: Updater | null = null;
    private firstTimer: ReturnType<typeof setTimeout> | null = null;
    private interval: ReturnType<typeof setInterval> | null = null;
    private checking = false;
    private disposed = false;
    private status: UpdateStatus | null = null;
    private releaseUrl = RELEASES_URL;
    private notifiedVersion = '';
    private downloading = '';
    private installing = false;
    private readonly fetchRelease: typeof fetch;

    constructor(private options: UpdateServiceOptions) {
        this.fetchRelease = options.fetch ?? fetch;
    }
    private get enabled(): boolean {
        return this.options.store.get('autoUpdateEnabled', true) === true;
    }
    private text(key: TextKey, version = '', percent = 0): string {
        const language = this.options.language?.() === 'en' ? 'en' : 'ru';
        return TEXTS[language][key].replace('{v}', version).replace('{p}', String(percent));
    }
    public getState(): UpdateState {
        const { mode, version } = this.options;
        let status = this.status ? this.text(this.status.key, this.status.version, this.status.percent) : '';
        if (mode === 'dev') status = this.text('dev');
        else if (!this.enabled) status = this.text('disabled');
        const canInstall = mode === 'installer' && this.enabled && this.status?.key === 'downloaded';
        return { mode, version, enabled: this.enabled, hint: this.text(mode), status, releaseUrl: this.releaseUrl, canInstall };
    }
    private setStatus(key: StatusKey, version?: string, percent?: number): void {
        this.status = { key, version, percent };
        if (this.disposed) return;
        this.options.onState(this.getState());
        this.options.onStatus?.({ ...this.status });
    }
    public start(): void {
        if (this.options.mode === 'dev' || this.disposed) return;
        this.stopTimers();
        if (!this.enabled) return;
        // Установщик проверяет сразу: новая версия, найденная при запуске, ставится с перезапуском
        this.firstTimer = setTimeout(() => {
            this.firstTimer = null;
            void this.check();
        }, this.options.mode === 'installer' ? 0 : FIRST_CHECK_DELAY_MS);
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
            this.setStatus('failedCheck');
        } finally {
            this.checking = false;
        }
    }
    private installer(): Updater {
        if (this.updater) return this.updater;
        const updater = this.options.loadUpdater();
        updater.autoDownload = true;
        updater.autoInstallOnAppQuit = this.enabled;
        updater.on('checking-for-update', () => this.setStatus('checking'));
        updater.on('update-not-available', () => this.setStatus('latest'));
        updater.on('update-available', (info) => {
            this.downloading = info.version;
            this.setStatus('downloading', info.version);
        });
        updater.on('download-progress', (info) => {
            this.setStatus('progress', this.downloading, Math.floor(info.percent));
        });
        updater.on('update-downloaded', (info) => {
            this.setStatus('downloaded', info.version);
            // Версию уже ставят с перезапуском: «установится при закрытии» было бы неправдой
            if (this.installing || this.notifiedVersion === info.version) return;
            this.notifiedVersion = info.version;
            this.options.notify(this.text('notifyDownloaded', info.version));
        });
        // Саму ошибку пишут в журнал check() и обработчик загрузки, здесь только статус.
        updater.on('error', () => this.setStatus('failedUpdate'));
        this.updater = updater;
        return updater;
    }
    private async checkInstaller(): Promise<void> {
        const result = await this.installer().checkForUpdates();
        result?.downloadPromise?.catch((error: unknown) => {
            console.error('Обновления: не удалось скачать:', error);
            this.setStatus('failedDownload');
        });
    }
    private async checkPortable(): Promise<void> {
        this.setStatus('checking');
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
            this.setStatus('latest');
            return;
        }
        const version = tag.replace(/^v/, '');
        this.releaseUrl = page;
        this.setStatus('released', version);
        if (this.notifiedVersion === version) return;
        this.notifiedVersion = version;
        this.options.notify(this.text('notifyReleased', version));
    }
    private stopTimers(): void {
        if (this.firstTimer) clearTimeout(this.firstTimer);
        if (this.interval) clearInterval(this.interval);
        this.firstTimer = null;
        this.interval = null;
    }
    /** Поставить скачанную версию сейчас: установщик закрывает приложение и запускает новую версию */
    public installNow(): boolean {
        if (this.disposed || this.installing || !this.updater || !this.getState().canInstall) return false;
        this.installing = true;
        // Не тихо: между закрытием клиента и запуском новой версии проходит 10-25 с, окно установщика показывает, что идёт работа
        this.updater.quitAndInstall(false, true);
        return true;
    }
    public dispose(): void {
        this.disposed = true;
        this.stopTimers();
    }
}
