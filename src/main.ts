import { DiagnosticJournal } from './services/diagnosticJournal';
import { monitorEventLoopDelay } from 'perf_hooks';
import { installRendererRecovery } from './services/rendererRecovery';
import { mediaControlsScript } from './services/mediaControls';
import { protectContent, sitePagePath } from './contentPolicy';
import { DISCORD_TEXT_KEYS, validateSettingChange, type SettingChange } from './settings/validateSetting';
import { applyPreferenceMigrations } from './settings/preferenceMigrations';
import { isTrustedLocalSender, trustLocalFile } from './trustedViews';
import { PlaybackController } from './services/playbackController';
import { AdblockService } from './services/adblockService';
import { ViewStyles } from './services/viewStyles';
import { ARTIST_TOOLS_CSS, pageFeaturesScript } from './services/pageFeatures';
import { fullShuffleScript } from './services/fullShuffle';
import { homeBlockDefaults, homeBlocksCss, homePageScript, isHomeBlockKey } from './services/homeBlocks';
import { waveScript } from './services/wave';
import { pageMotionScript } from './services/pageMotion';
import { playerAreaScript } from './services/playerArea';
import { WaveJournal } from './services/waveJournal';
import { WaveExclusions } from './services/waveExclusions';
import { WaveShelf } from './services/waveShelf';
import { WaveSignals } from './services/waveSignals';
import { LibraryService } from './services/libraryService';
import type { BackupRestoreOutcome, BackupSaveOutcome } from './services/backup';
import {
    AUTO_BACKUP_DELAY, AUTO_BACKUP_KEEP, BACKUP_EXTENSION, BACKUP_MIGRATION_MARKS, BACKUP_REASONS, BACKUP_SETTING_KEYS, autoBackupDue, backupFileName, isInside,
    type BackupReason,
} from './services/backupPolicy';
import { DEFAULT_RADAR_SCHEDULE, RadarScheduler, cleanCollectResult, cleanSchedule, radarPeriod } from './services/radarSchedule';
import { HistoryManager } from './history/historyManager';
import { AwayTracker } from './services/awayTracker';
import { OPEN_PROTOCOL, parseOpenLink } from './services/openLink';
import { getSiteDictionary } from './services/siteDictionary';
import { isGpuCompatibilityMode, shouldRunGpuInProcess, type GpuRuntimeState } from './services/gpuProcessMode';
import { detectNvidiaAdapter } from './services/gpuDetection';
import { tintIcon } from './services/devIcon';
import { revealWindow } from './services/revealWindow';
import { watchHiddenPage } from './services/hiddenPageWatchdog';
import {
    app,
    BrowserWindow,
    Menu,
    ipcMain,
    BrowserView,
    Tray,
    nativeImage,
    shell,
    components,
    dialog,
    powerMonitor,
    net,
    type IpcMainEvent,
    type NativeImage,
} from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { setupDarwinMenu } from './macos/menu';
import { NotificationManager } from './notifications/notificationManager';
import { SettingsManager } from './settings/settingsManager';
import { ProxyService } from './services/proxyService';
import { PresenceService, TEMPLATE_DEFAULTS } from './services/presenceService';
import { TranslationService, type AppLanguage, type TranslationKeys } from './services/translationService';
import { ThumbarService } from './services/thumbarService';
import { WebhookService } from './services/webhookService';
import { UpdateService, type UpdateMode, type UpdateStatus } from './services/updateService';
import { UpdateScreen } from './update/updateScreen';
import { autoUpdater } from 'electron-updater';
import { ShortcutService } from './services/shortcutService';
import { audioMonitorScript } from './services/audioMonitorService';
import type { SiteDictionary, TrackInfo } from './types';
import { validateTrackMeta, validateTrackUpdatePayload } from './validation';
import path from 'path';
import { randomUUID } from 'crypto';
import { platform, release } from 'os';

import Store from 'electron-store';
import windowStateManager from 'electron-window-state';

let buildInfo: Record<string, unknown> = { build: 'development', dirty: true };
const buildInfoPath = path.join(__dirname, 'build-info.json');
try {
    if (existsSync(buildInfoPath)) {
        const parsed: unknown = JSON.parse(readFileSync(buildInfoPath, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) buildInfo = parsed as Record<string, unknown>;
    }
} catch (error) { console.warn('Не удалось прочитать версию сборки:', error); }

// Dev-запуск и тестовая сборка отличаются от установленного клиента названием, иконкой и кнопкой на панели задач
const buildLabel = !app.isPackaged ? 'Dev' : buildInfo.channel === 'test' ? 'Test' : '';
const appTitle = buildLabel ? `SoundCloud ${buildLabel}` : 'SoundCloud';

app.setName('SoundCloud');
const portableDirectory = app.isPackaged && process.platform === 'win32' ? process.env.PORTABLE_EXECUTABLE_DIR : undefined;
const profilePath = portableDirectory
    ? path.join(portableDirectory, 'soundcloud-desktop-data')
    : path.join(app.getPath('appData'), app.isPackaged ? 'soundcloud-desktop' : 'soundcloud-desktop-dev');
mkdirSync(profilePath, { recursive: true });
app.setPath('userData', profilePath);
if (process.platform === 'win32') {
    app.setAppUserModelId('io.github.zxczxczxczxczxczxc1111.soundcloud-desktop' + (buildLabel ? '.' + buildLabel.toLowerCase() : ''));
}

export const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../assets');
console.log(`Resources path: ${RESOURCES_PATH}`);

function loadAppIcon(file: string): NativeImage {
    const image = nativeImage.createFromPath(path.join(RESOURCES_PATH, 'icons', file));
    return buildLabel && !image.isEmpty() ? tintIcon(image) : image;
}

// Store configuration
const store = new Store<Record<string, unknown>>({
    name: 'preferences',
    defaults: {
        adBlocker: true,
        proxyEnabled: false,
        proxyHost: '',
        proxyPort: '',
        proxyUsername: '',
        proxyPasswordEncrypted: '',
        webhookEnabled: false,
        webhookUrl: '',
        webhookTriggerPercentage: 50,
        displaySCSmallIcon: false,
        displayGithubLink: true,
        discordRichPresence: true,
        displayButtons: false,
        statusDisplayType: 1,
        discordIncognito: false,
        discordHiddenArtists: '',
        discordHiddenGenres: '',
        ...TEMPLATE_DEFAULTS,
        theme: 'dark',
        minimizeToTray: false,
        navigationControlsEnabled: false,
        trackParserEnabled: true,
        richPresencePreviewEnabled: false,
        autoUpdateEnabled: true,
        hidePromotions: true,
        hideEventsNearYou: true,
        hideArtistUpsells: true,
        hideHeaderExtras: true,
        fullShuffle: true,
        reduceMotion: false,
        siteLanguage: 'ru',
        ...homeBlockDefaults,
        radarDay: DEFAULT_RADAR_SCHEDULE.day,
        radarTime: DEFAULT_RADAR_SCHEDULE.time,
        accounts: [{ id: 'default', name: 'Основной аккаунт' }],
        currentAccountId: 'default',
    },
    clearInvalidConfig: true,
});
applyPreferenceMigrations(store);

interface Account { id: string; name: string }
function getAccounts(): Account[] {
    const value = store.get('accounts');
    if (!Array.isArray(value)) return [{ id: 'default', name: 'Основной аккаунт' }];
    const accounts = value.filter((item): item is Account =>
        item !== null && typeof item === 'object' &&
        typeof item.id === 'string' && /^(default|acc_[0-9]+)$/.test(item.id) &&
        typeof item.name === 'string');
    if (!accounts.some((item) => item.id === 'default')) accounts.unshift({ id: 'default', name: 'Основной аккаунт' });
    return accounts;
}

// Global variables
let mainWindow: BrowserWindow;
let notificationManager: NotificationManager;
let settingsManager: SettingsManager;
let proxyService: ProxyService;
let adblockService: AdblockService;
let networkSettingsDirty = false;
// Язык сайта встаёт только при загрузке страницы
let pageReloadNeeded = false;
let waveJournal: WaveJournal | null = null;
let waveExclusions: WaveExclusions | null = null;
let waveSignals: WaveSignals | null = null;
let historyManager: HistoryManager | null = null;
let listeningLibrary: LibraryService | null = null;
let radarScheduler: RadarScheduler | null = null;
let presenceService: PresenceService;
let webhookService: WebhookService;
let updateService: UpdateService | null = null;
// Версия, найденная в первые секунды после запуска, ставится с перезапуском через экран обновления
const UPDATE_SCREEN_WINDOW_MS = 20_000;
const launchedAt = Date.now();
let updateScreen: UpdateScreen | null = null;
let updateScreenDismissed = false;
// Язык всего приложения это настройка «Язык» в F1; трей строится раньше остальных служб
const appLanguage = (): AppLanguage => (store.get('siteLanguage', 'ru') === 'en' ? 'en' : 'ru');
const translationService = new TranslationService(appLanguage);
let thumbarService: ThumbarService;
let playbackController: PlaybackController;
let shortcutService: ShortcutService;
let tray: Tray | null = null;
let trayMenu: Menu | null = null;
let isQuitting = false;
const devMode = process.argv.includes('--dev');
const isMac = process.platform === 'darwin';
const globalUserAgent = isMac
    ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + process.versions.chrome + ' Safari/537.36'
    : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + process.versions.chrome + ' Safari/537.36';

app.userAgentFallback = globalUserAgent;

function applyMacMemoryOptimizations(): void {
    if (!isMac) return;

    const existingDisableFeatures = app.commandLine.getSwitchValue('disable-features');
    const features = new Set(
        existingDisableFeatures
            .split(',')
            .map((feature) => feature.trim())
            .filter(Boolean),
    );
    features.add('BackForwardCache');

    app.commandLine.appendSwitch('disable-features', Array.from(features).join(','));
    app.commandLine.appendSwitch('renderer-process-limit', '1');
    app.commandLine.appendSwitch('disk-cache-size', '1');
    app.commandLine.appendSwitch('media-cache-size', '1');
    app.commandLine.appendSwitch('enable-low-end-device-mode');
}

applyMacMemoryOptimizations();
const gpuInterrupted = store.get('gpuCompatibilityRunning', false) === true;
const savedGpuMode = store.get('gpuCompatibilityMode');
const gpuMode = isGpuCompatibilityMode(savedGpuMode) ? savedGpuMode : 'auto';
const gpuDetection = detectNvidiaAdapter(process.platform);
const gpuInProcess = shouldRunGpuInProcess(process.platform, gpuMode, gpuDetection, process.argv, gpuInterrupted);
const gpuRuntime: GpuRuntimeState = { mode: gpuMode, detection: gpuDetection, active: gpuInProcess, interrupted: gpuInterrupted };

if (gpuInProcess) {
    app.commandLine.appendSwitch('in-process-gpu');
    // С DirectComposition GPU в главном процессе показывает пустое окно
    app.commandLine.appendSwitch('disable-direct-composition');
} else if (gpuInterrupted || process.argv.includes('--separate-gpu-process')) {
    app.commandLine.removeSwitch('in-process-gpu');
}
// header height for header BrowserView
const HEADER_HEIGHT = 32;
// macOS check
const isMas = process.mas === true;


// multiple startup check
if (!isMas) {
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
        app.quit();
        process.exit(0);
    }
}

const diagnostics = new DiagnosticJournal(path.join(profilePath, 'diagnostics'), {
    build: buildInfo.build, dirty: buildInfo.dirty, version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
    node: process.versions.node, os: release(), arch: process.arch,
});
diagnostics.captureConsole();
store.set('gpuCompatibilityRunning', gpuInProcess);
diagnostics.record('gpu.status', { gpuInProcess, gpuAuto: gpuMode === 'auto', gpuNvidiaDetected: gpuDetection === 'nvidia', gpuFallback: gpuInterrupted });
app.on('gpu-info-update', () => {
    if (!app.isReady()) return;
    const status = app.getGPUFeatureStatus();
    diagnostics.record('gpu.status', { gpuCompositing: status.gpu_compositing, gpuRasterization: status.rasterization });
});
app.on('child-process-gone', (_event, details) => {
    diagnostics.record('process.gone', {
        component: details.type === 'GPU' ? 'gpu' : details.type === 'Utility' ? 'utility' : 'process',
        reason: details.reason, exitCode: details.exitCode,
    });
});
process.on('uncaughtExceptionMonitor', (error) => {
    diagnostics.record('runtime.error', { errorType: error.name });
    diagnostics.flush();
});
let diagnosticTimer: ReturnType<typeof setInterval> | undefined;
// Пользователь не у компьютера (экран заблокирован, простой дольше 10 минут): журнал сигналов помечает такие прослушивания
const awayTracker = new AwayTracker(() => powerMonitor.getSystemIdleTime());
let awayTimer: ReturnType<typeof setInterval> | undefined;
let autoBackupTimer: ReturnType<typeof setTimeout> | undefined;
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
let trackUpdates = 0;
let trackChanges = 0;
let lastUpdateAt = Date.now();
let lastProgressAt = Date.now();

// extend app w custom property
Object.defineProperty(app, 'isQuitting', {
    value: false,
    writable: true,
    configurable: true,
});

// display settings
let displaySCSmallIcon = store.get('displaySCSmallIcon') as boolean;



// appimages don't install a desktop file, so wayland compositors can't match the window
// to an icon and you get the generic cog. write one to ~/.local/share on first run
function installDesktopFile() {
    if (process.platform !== 'linux' || !process.env.APPIMAGE) return;

    try {
        const dataHome = process.env.XDG_DATA_HOME || path.join(app.getPath('home'), '.local', 'share');
        const desktopFilePath = path.join(dataHome, 'applications', 'soundcloud-rpc.desktop');
        const iconFilePath = path.join(dataHome, 'icons', 'hicolor', '1024x1024', 'apps', 'soundcloud-rpc.png');

        if (!existsSync(iconFilePath)) {
            mkdirSync(path.dirname(iconFilePath), { recursive: true });
            copyFileSync(path.join(RESOURCES_PATH, 'icons', 'soundcloud.png'), iconFilePath);
        }

        const entry = [
            '[Desktop Entry]',
            'Name=SoundCloud',
            'Comment=SoundCloud client with Discord Rich Presence',
            `Exec="${process.env.APPIMAGE}" %U`,
            'Icon=soundcloud-rpc',
            'Type=Application',
            'Categories=AudioVideo;Audio;Music;',
            'StartupWMClass=soundcloud-rpc',
            'Terminal=false',
            '',
        ].join('\n');

        // rewrite if missing or the appimage moved
        const existing = existsSync(desktopFilePath) ? readFileSync(desktopFilePath, 'utf8') : '';
        if (existing !== entry) {
            mkdirSync(path.dirname(desktopFilePath), { recursive: true });
            writeFileSync(desktopFilePath, entry);
            console.log(`Desktop file written to ${desktopFilePath}`);
        }
    } catch (error) {
        console.error('Failed to write desktop file:', error);
    }
}

// Два кадра анимации страницы после показа окна: к этому времени окно нарисовано и его можно проявлять
function pagePainted(): Promise<unknown> {
    if (!contentView || contentView.webContents.isDestroyed()) return Promise.resolve();
    return contentView.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
}

// Клавиши клиента (F1, Ctrl+H) ловят только страницы окна. Окно показывается раньше, чем в нём появляется сайт,
// а уведомление при загрузке забирает фокус и, исчезнув, никому его не отдаёт. Без этого клавиши молчали
// до первого щелчка по сайту. Фокус уходит в верхний слой: настройки, история или сайт
function focusTopView(): void {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isFocused()) return;
    const settings = settingsManager?.getView()?.webContents;
    const pages = [settings, headerView?.webContents, contentView?.webContents];
    if (historyManager?.focused() || pages.some((contents) => contents && !contents.isDestroyed() && contents.isFocused())) return;
    if (settings && !settings.isDestroyed()) settings.focus();
    else if (!historyManager?.focus() && contentView && !contentView.webContents.isDestroyed()) contentView.webContents.focus();
}

// История под открытыми настройками не видна: оттуда Ctrl+H и кнопка показывают её, а не прячут
function toggleHistory(): void {
    if (!historyManager) return;
    if (settingsManager?.getView()) {
        settingsManager.toggle();
        if (!historyManager.isOpen()) historyManager.show();
        return;
    }
    historyManager.toggle();
}
function closeQueueDialog(): void {
    if (contentView && !contentView.webContents.isDestroyed()) {
        void contentView.webContents.executeJavaScript('document.getElementById("sc-desktop-queue")?.close()').catch((error: unknown) => console.warn('Очередь не закрыта', error));
    }
}

function showMainWindow(): void {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    revealWindow(mainWindow, pagePainted);
    adjustContentViews();
}

function setupTray() {
    if (tray) {
        tray.destroy();
        tray = null;
    }

    // create tray icon
    const icon = loadAppIcon(process.platform === 'win32' ? 'soundcloud-win.ico' : 'soundcloud.png');

    // resize icon
    const trayIcon = icon.resize({ width: 16, height: 16 });

    tray = new Tray(trayIcon);
    tray.setToolTip(appTitle);
    trayMenu = buildTrayMenu();
    tray.setContextMenu(trayMenu);

    tray.on('click', () => showMainWindow());
}

function headerTexts(): Record<string, string> {
    const keys = ['headerBack', 'headerForward', 'headerRefresh', 'headerStop', 'headerTitleBar', 'headerMinimize', 'headerMaximize', 'headerRestore', 'headerClose', 'headerHistory', 'headerQueue'] as const;
    return Object.fromEntries(keys.map((key) => [key, translationService.translate(key)]));
}

// Смена языка в F1: всё, что main рисует сам, переводится сразу; сайт и его врезки ждут перезагрузки
function applyAppLanguage(): void {
    if (tray) {
        trayMenu = buildTrayMenu();
        tray.setContextMenu(trayMenu);
    }
    if (headerView && !headerView.webContents.isDestroyed()) headerView.webContents.send('header-texts', headerTexts());
    historyManager?.setLanguage(appLanguage());
    if (mainWindow && !mainWindow.isDestroyed()) thumbarService?.restore(mainWindow);
    presenceService?.refresh();
}

// Меню трея пересобирается при смене языка, сам значок остаётся
function buildTrayMenu(): Menu {
    const t = (key: TranslationKeys): string => translationService.translate(key);
    return Menu.buildFromTemplate([
        {
            label: 'SoundCloud',
            click: () => showMainWindow(),
        },
        {
            label: t('traySettings'),
            // Из трея настройки только открываются: окно могло быть спрятано, а панель уже открыта
            click: () => {
                showMainWindow();
                if (settingsManager && !settingsManager.getView()) settingsManager.toggle();
            },
        },
        {
            id: 'discordIncognito',
            label: t('trayDiscordIncognito'),
            type: 'checkbox',
            checked: store.get('discordIncognito', false) === true,
            click: (item) => setDiscordIncognito(item.checked, false),
        },
        { type: 'separator' },
        {
            label: t('trayQuit'),
            click: () => {
                app.quit();
            },
        },
    ]);
}

// Карточка Discord для предпросмотра в F1: трек и то, что из него собрала presenceService
function sendPresencePreview(): void {
    if (!presenceService) return;
    settingsManager?.getView()?.webContents.send('presence-preview-update', { track: lastTrackInfo, ...presenceService.preview() });
}

// Инкогнито прячет только карточку Discord: журнал и обучение волны работают как обычно
function setDiscordIncognito(value: boolean, announce: boolean): void {
    store.set('discordIncognito', value);
    const item = trayMenu?.getMenuItemById('discordIncognito');
    if (item) item.checked = value;
    presenceService?.refresh();
    sendPresencePreview();
    settingsManager?.getView()?.webContents.send('discord-incognito-changed', value);
    if (announce) notificationManager?.show(translationService.translate(value ? 'incognitoOn' : 'incognitoOff'));
}

// browser window config
function createBrowserWindow(windowState: ReturnType<typeof windowStateManager>): BrowserWindow {
    const window = new BrowserWindow({
        width: windowState.width,
        height: windowState.height,
        x: windowState.x,
        y: windowState.y,
        title: appTitle,
        icon: loadAppIcon('soundcloud.png'),
        frame: process.platform === 'darwin',
        titleBarStyle: process.platform === 'darwin' ? 'hidden' : undefined,
        trafficLightPosition: process.platform === 'darwin' ? { x: 10, y: 10 } : undefined,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            javascript: true,
            images: true,
            plugins: true,
            experimentalFeatures: false,
            devTools: devMode,
            backgroundThrottling: true,
            ...(isMac ? { spellcheck: false } : {}),
        },
        backgroundColor: '#121212',
    });

    window.webContents.setUserAgent(globalUserAgent);



    return window;
}

// Track info polling
let lastTrackInfo: TrackInfo = {
    title: '',
    author: '',
    artwork: '',
    elapsed: '',
    duration: '',
    isPlaying: false,
    isLiked: false,
    url: '',
    artistUrl: '',
};

function isTrustedSoundCloudSender(event: Pick<IpcMainEvent, 'sender' | 'senderFrame'>): boolean {
    if (!contentView || event.sender.id !== contentView.webContents.id || event.senderFrame !== event.sender.mainFrame) return false;

    const frameUrl = event.senderFrame?.url || event.sender.getURL();
    try {
        const url = new URL(frameUrl);
        return (
            url.protocol === 'https:' && (url.hostname === 'soundcloud.com' || url.hostname.endsWith('.soundcloud.com'))
        );
    } catch {
        return false;
    }
}

// defer bounds adjustments if window frame cannot process rendering dimensions
function adjustContentViews() {
    if (!mainWindow || !contentView || !headerView) return;
    if (!mainWindow.isVisible() || mainWindow.isMinimized()) return;

    const { width, height } = mainWindow.getContentBounds();

    headerView.setBounds({
        x: 0,
        y: 0,
        width,
        height: HEADER_HEIGHT,
    });

    contentView.setBounds({
        x: 0,
        y: HEADER_HEIGHT,
        width,
        height: height - HEADER_HEIGHT,
    });

    updateScreen?.layout();
}

function setupWindowControls() {
    if (!mainWindow) return;

    ipcMain.on('minimize-window', (event) => {
            if (!isTrustedLocalSender(event)) return;

        if (!mainWindow) return;
        const minimizeToTray = store.get('minimizeToTray', true);
        if (minimizeToTray) {
            mainWindow.hide();
        } else {
            mainWindow.minimize();
        }
    });

    ipcMain.on('maximize-window', (event) => {
            if (!isTrustedLocalSender(event)) return;

        if (mainWindow) {
            if (mainWindow.isMaximized()) {
                mainWindow.unmaximize();
            } else {
                mainWindow.maximize();
            }
        }
    });

    ipcMain.on('title-bar-double-click', (event) => {
            if (!isTrustedLocalSender(event)) return;

        if (mainWindow) {
            if (mainWindow.isMaximized()) {
                mainWindow.unmaximize();
            } else {
                mainWindow.maximize();
            }
        }
    });

    const sendMaximizedState = (): void => {
        if (headerView && !headerView.webContents.isDestroyed()) headerView.webContents.send('window-maximized-changed', mainWindow.isMaximized());
    };

    mainWindow.on('maximize', () => {
        adjustContentViews();
        sendMaximizedState();
    });

    mainWindow.on('unmaximize', () => {
        adjustContentViews();
        sendMaximizedState();
    });

    mainWindow.on('restore', sendMaximizedState);

    mainWindow.on('resize', () => {
        adjustContentViews();
    });

    ipcMain.on('close-window', (event) => {
            if (!isTrustedLocalSender(event)) return;

        if (mainWindow) {
            const minimizeToTray = store.get('minimizeToTray', true);
            if (minimizeToTray) {
                mainWindow.hide();
            } else {
                mainWindow.close();
            }
        }
    });

    // nav handlers
    ipcMain.on('navigate-back', (event) => {
            if (!isTrustedLocalSender(event)) return;

        if (contentView && contentView.webContents.navigationHistory.canGoBack()) {
            contentView.webContents.navigationHistory.goBack();
        }
    });

    ipcMain.on('navigate-forward', (event) => {
            if (!isTrustedLocalSender(event)) return;

        if (contentView && contentView.webContents.navigationHistory.canGoForward()) {
            contentView.webContents.navigationHistory.goForward();
        }
    });

    ipcMain.on('refresh-page', (event) => {
            if (!isTrustedLocalSender(event)) return;

        if (contentView) {
            if (headerView && headerView.webContents) {
                headerView.webContents.send('refresh-state-changed', true);
            }
            console.log('Manual refresh triggered - reloading page');
            contentView.webContents.reload();
        }
    });

    ipcMain.on('cancel-refresh', (event) => {
            if (!isTrustedLocalSender(event)) return;

        if (contentView) {
            contentView.webContents.stop();
            if (headerView && headerView.webContents) {
                headerView.webContents.send('refresh-state-changed', false);
            }
        }
    });

    // Подсказки кнопок шапки на языке приложения
    ipcMain.handle('get-header-texts', (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        return headerTexts();
    });

    // Handle is-maximized requests
    ipcMain.handle('is-maximized', (event) => {
            if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');

        return mainWindow ? mainWindow.isMaximized() : false;
    });

    // Handle minimize to tray setting
    ipcMain.handle('get-minimize-to-tray', (event) => {
            if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');

        return store.get('minimizeToTray', true);
    });

    // handle nav controls enabled setting
    ipcMain.handle('get-navigation-controls-enabled', (event) => {
            if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');

        return store.get('navigationControlsEnabled', false);
    });

    adjustContentViews();
}

let headerView: BrowserView | null;
let contentView: BrowserView;

function closeUpdateScreen(): void {
    updateScreen?.close();
    updateScreen = null;
}

function handleUpdateStatus(status: UpdateStatus): void {
    if (status.key === 'failedCheck' || status.key === 'failedUpdate' || status.key === 'failedDownload') {
        closeUpdateScreen();
        return;
    }
    if (status.key !== 'downloading' && status.key !== 'progress' && status.key !== 'downloaded') return;
    if (!updateScreen) {
        // Позже первых секунд или под играющую музыку экран не открывается: версия поставится при выходе
        if (updateScreenDismissed || Date.now() - launchedAt > UPDATE_SCREEN_WINDOW_MS || lastTrackInfo.isPlaying) return;
        if (!mainWindow || mainWindow.isDestroyed()) return;
        updateScreen = new UpdateScreen(mainWindow, HEADER_HEIGHT);
    }
    const installing = status.key === 'downloaded';
    const percent = installing ? 100 : (status.percent ?? 0);
    updateScreen.show({
        title: translationService.translate('updateScreenTitle').replace('{v}', status.version ?? ''),
        status: installing
            ? translationService.translate('updateScreenInstalling')
            : translationService.translate('updateScreenDownloading').replace('{p}', String(percent)),
        percent,
        later: translationService.translate('updateScreenLater'),
        installing,
    });
    if (installing && !updateService?.installNow()) closeUpdateScreen();
}

// Main initialization
async function init() {
    loopDelay.enable();
    // Протокол ссылок «открыть в клиенте» регистрирует только установленная версия: dev, тестовая и portable не перехватывают его у неё.
    // -- перед адресом: остаток командной строки Chromium не разбирает как ключи
    if (process.platform === 'win32' && app.isPackaged && buildInfo.channel === 'release' && !portableDirectory) {
        if (!app.setAsDefaultProtocolClient(OPEN_PROTOCOL, process.execPath, ['--'])) console.warn('Протокол ссылок на треки не зарегистрирован');
    }
    diagnosticTimer = setInterval(() => {
        const metrics = app.getAppMetrics();
        diagnostics.record('performance', {
            uptimeSeconds: process.uptime(), processes: metrics.length,
            cpuPercent: metrics.reduce((sum, item) => sum + item.cpu.percentCPUUsage, 0),
            workingSetMiB: metrics.reduce((sum, item) => sum + item.memory.workingSetSize, 0) / 1024,
            privateMiB: metrics.reduce((sum, item) => sum + (item.memory.privateBytes ?? 0), 0) / 1024,
            loopP95Ms: loopDelay.percentile(95) / 1e6, loopMaxMs: loopDelay.max / 1e6,
            updates: trackUpdates, trackChanges, sinceUpdateMs: Date.now() - lastUpdateAt,
            sinceProgressMs: Date.now() - lastProgressAt, playing: lastTrackInfo.isPlaying,
            hasTrack: !!lastTrackInfo.title, windowVisible: !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible(),
            windowMinimized: !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isMinimized(), settingsOpen: !!settingsManager?.getView(),
            adblock: store.get('adBlocker') === true, proxy: store.get('proxyEnabled') === true,
            discord: store.get('discordRichPresence') === true, githubBadge: store.get('displayGithubLink', true) === true,
            droppedEvents: diagnostics.droppedEvents,
        });
        loopDelay.reset();
    }, 30000);
    diagnosticTimer.unref();
    powerMonitor.on('suspend', () => { diagnostics.record('system.suspend'); diagnostics.flush(); });
    powerMonitor.on('resume', () => {
        diagnostics.record('system.resume');
        if (contentView && !contentView.webContents.isDestroyed()) void contentView.webContents.executeJavaScript('window.__scResume?.()').catch(console.error);
        radarScheduler?.wake();
    });
    powerMonitor.on('lock-screen', () => awayTracker.lock());
    powerMonitor.on('unlock-screen', () => awayTracker.unlock());
    clearInterval(awayTimer);
    awayTimer = setInterval(() => awayTracker.poll(), 60000);
    awayTimer.unref();

    // Wait for Widevine CDM to be ready
    try {
        await components.whenReady();
        console.log('Components ready:', components.status());
    } catch (error) {
        console.error('Failed to initialize components:', error);
    }

    installDesktopFile();
    setupTray();

    if (process.platform === 'darwin') setupDarwinMenu();
    else Menu.setApplicationMenu(null);

    const windowState = windowStateManager({ defaultWidth: 800, defaultHeight: 800 });
    mainWindow = createBrowserWindow(windowState);

    windowState.manage(mainWindow);
    mainWindow.on('focus', focusTopView);

    // handle window close event for minimize to tray
    mainWindow.on('close', (event) => {
        const minimizeToTray = store.get('minimizeToTray', true);
        if (minimizeToTray && !isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    // Handle window minimize event
    mainWindow.on('minimize', () => {
        const minimizeToTray = store.get('minimizeToTray', true);
        if (minimizeToTray) {
            mainWindow.hide();
        }
    });

    headerView = new BrowserView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            nodeIntegrationInSubFrames: false,
            nodeIntegrationInWorker: false,
            preload: path.join(__dirname, 'header', 'headerPreload.js'),
            devTools: devMode,
            ...(isMac ? { spellcheck: false } : {}),
        },
    });

    trustLocalFile(headerView.webContents, path.join(__dirname, 'header', 'header.html'));
    mainWindow.addBrowserView(headerView);
    headerView.setBounds({ x: 0, y: 0, width: mainWindow.getBounds().width, height: 32 });
    headerView.setAutoResize({ width: true, height: false });
    headerView.webContents.loadFile(path.join(__dirname, 'header', 'header.html'));

    // get selected account and define partition
    const currentAccountId = store.get('currentAccountId', 'default');
    const sessionPartition = currentAccountId === 'default' ? undefined : `persist:sc_${currentAccountId}`;

    contentView = new BrowserView({
        webPreferences: {
            ...(sessionPartition ? { partition: sessionPartition } : {}),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            nodeIntegrationInSubFrames: false,
            nodeIntegrationInWorker: false,
            devTools: devMode,
            preload: path.join(__dirname, 'preload.js'),
            ...(isMac ? { spellcheck: false } : {}),
        },
    });

    mainWindow.addBrowserView(contentView);
    // Каждый вызов executeJavaScript, пока сайт грузится, Electron держит одноразовым ожиданием did-stop-loading.
    // При запуске их набирается 10-11 (блокировщик рекламы на каждый фрейм, тема, скрипты страницы), это не утечка:
    // все снимаются с окончанием загрузки. Запас до 30, чтобы предупреждение осталось сигналом настоящей утечки
    contentView.webContents.setMaxListeners(30);
    watchHiddenPage(mainWindow, () =>
        contentView.webContents.isDestroyed() ? Promise.resolve('gone') : contentView.webContents.executeJavaScript('document.visibilityState'),
    );
    contentView.setBounds({
        x: 0,
        y: 32,
        width: mainWindow.getBounds().width,
        height: mainWindow.getBounds().height - 32,
    });
    contentView.setAutoResize({ width: true, height: true });

    protectContent(contentView.webContents, (url) => shell.openExternal(url));
    // Ссылку из встроенных страниц новой вёрстки сайт иногда открывает полной загрузкой (window.location): музыка обрывается,
    // волна сбрасывается. Такой переход ведёт роутер сайта; если сайт тут же снова просит полную загрузку того же адреса, она проходит
    let softNavigation: { url: string; at: number } | null = null;
    contentView.webContents.on('will-navigate', (event, url) => {
        const contents = contentView.webContents;
        const pagePath = sitePagePath(url, contents.getURL());
        if (!pagePath) return;
        if (softNavigation?.url === url && Date.now() - softNavigation.at < 5000) {
            softNavigation = null;
            return;
        }
        event.preventDefault();
        softNavigation = { url, at: Date.now() };
        diagnostics.record('page.soft-navigation', { playing: lastTrackInfo.isPlaying });
        const fullLoad = (): void => {
            if (!contents.isDestroyed()) contents.loadURL(url).catch((error: unknown) => console.warn('Страница сайта не открыта:', error));
        };
        (contents.executeJavaScript('window.__scNavigate ? window.__scNavigate(' + JSON.stringify(pagePath) + ') : false') as Promise<unknown>)
            .then((done) => { if (done !== true) fullLoad(); })
            .catch((error: unknown) => {
                console.warn('Переход внутри сайта не удался:', error);
                fullLoad();
            });
    });
    contentView.webContents.setUserAgent(globalUserAgent);

    // Initialize services
    notificationManager = new NotificationManager(mainWindow, focusTopView);
    settingsManager = new SettingsManager(
        mainWindow,
        store,
        () => {
            // Настройки открывались поверх истории: фокус возвращается в неё
            if (historyManager?.focus()) return;
            if (!contentView.webContents.isDestroyed()) contentView.webContents.focus();
        },
        (contents) => shortcutService.attachToWebContents(contents),
        closeQueueDialog,
        gpuRuntime,
    );
    proxyService = new ProxyService(contentView.webContents, store, queueToastNotification, (key) => translationService.translate(key));
    adblockService = new AdblockService(contentView.webContents.session, path.join(app.getPath('userData'), 'adblock-engine.bin'));
    presenceService = new PresenceService(store, translationService);
    webhookService = new WebhookService(store);
    const updateMode: UpdateMode = !app.isPackaged ? 'dev' : process.platform === 'win32' && !portableDirectory ? 'installer' : 'portable';
    updateService = new UpdateService({
        mode: updateMode,
        version: app.getVersion(),
        store,
        notify: queueToastNotification,
        onState: (state) => settingsManager.getView()?.webContents.send('update-state', state),
        loadUpdater: () => autoUpdater,
        language: appLanguage,
        onStatus: handleUpdateStatus,
    });
    ipcMain.on('update-screen-later', (event) => {
        if (!updateScreen?.owns(event.sender) || !isTrustedLocalSender(event)) return;
        updateScreenDismissed = true;
        closeUpdateScreen();
    });
    ipcMain.handle('install-update-now', (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        return updateService?.installNow() ?? false;
    });
    updateService.start();
    ipcMain.handle('get-update-state', (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        return updateService?.getState() ?? null;
    });
    ipcMain.handle('open-release-page', async (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        const url = updateService?.getState().releaseUrl;
        if (url) await shell.openExternal(url);
    });
    ipcMain.handle('check-updates', async (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        await updateService?.check();
    });
    ipcMain.handle('open-data-folder', async (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        const error = await shell.openPath(app.getPath('userData'));
        if (error) throw new Error(error);
    });
    shortcutService = new ShortcutService(mainWindow);
    shortcutService.attachToWebContents(contentView.webContents);
    shortcutService.attachToWebContents(headerView.webContents);
    playbackController = new PlaybackController(contentView.webContents);
    ipcMain.on('soundcloud:playback', (event, command: unknown) => {
        if (!isTrustedSoundCloudSender(event)) return;
        if (command !== 'play' && command !== 'pause' && command !== 'next' && command !== 'previous') return;
        void playbackController.execute(command).catch(console.error);
    });
    // Словарь перевода сайта для preload. Запрос синхронный: ответ уходит при первом же присваивании
    // returnValue, поэтому оно одно и стоит на любом пути, иначе страница встанет
    ipcMain.on('soundcloud:site-translation', (event) => {
        let dictionary: SiteDictionary | null = null;
        try {
            if (isTrustedSoundCloudSender(event) && store.get('siteLanguage', 'ru') === 'ru') dictionary = getSiteDictionary();
        } catch (error) {
            console.error('Словарь перевода сайта не загружен:', error);
        }
        event.returnValue = dictionary;
    });
    ipcMain.removeAllListeners('soundcloud:early-blocks');
    ipcMain.on('soundcloud:early-blocks', (event) => {
        let css = '';
        try { if (isTrustedSoundCloudSender(event)) css = hiddenBlocksCSS(); }
        catch (error) { console.warn('Правила скрытия не прочитаны', error); }
        event.returnValue = css;
    });
    waveJournal?.flush();
    waveJournal = new WaveJournal(path.join(app.getPath('userData'), 'wave'));
    ipcMain.removeHandler('soundcloud:wave-journal:load');
    ipcMain.removeAllListeners('soundcloud:wave-journal:add');
    ipcMain.handle('soundcloud:wave-journal:load', (event, userId: unknown) => (isTrustedSoundCloudSender(event) ? waveJournal?.load(userId) ?? [] : []));
    ipcMain.on('soundcloud:wave-journal:add', (event, userId: unknown, ids: unknown) => {
        if (isTrustedSoundCloudSender(event)) waveJournal?.add(userId, ids);
    });
    // Журнал сигналов: как слушается каждый трек, из него потом учится подбор
    waveSignals?.flush();
    waveSignals = new WaveSignals(path.join(app.getPath('userData'), 'wave'), 3000, (from, to) => awayTracker.away(from, to));
    ipcMain.removeAllListeners('soundcloud:wave-signals:add');
    ipcMain.on('soundcloud:wave-signals:add', (event, userId: unknown, signals: unknown) => {
        if (isTrustedSoundCloudSender(event)) waveSignals?.add(userId, signals);
    });
    ipcMain.removeAllListeners('soundcloud:wave-empty');
    ipcMain.on('soundcloud:wave-empty', (event, counts: unknown) => {
        if (!isTrustedSoundCloudSender(event) || !counts || typeof counts !== 'object') return;
        const value = counts as Record<string, unknown>;
        const count = (input: unknown): number => (typeof input === 'number' && Number.isSafeInteger(input) && input >= 0 ? Math.min(input, 10000) : 0);
        diagnostics.record('wave.empty', { waveSeen: count(value.seen), waveArtistTracks: count(value.artistTracks), waveMoodTags: count(value.moodTags) });
    });
    // Место плеера сайта: окно истории не накрывает громкость и очередь
    ipcMain.removeAllListeners('soundcloud:player-area');
    ipcMain.on('soundcloud:player-area', (event, height: unknown, viewport: unknown) => {
        if (isTrustedSoundCloudSender(event)) historyManager?.setPlayerArea(height, viewport);
    });
    ipcMain.removeAllListeners('soundcloud:open-history');
    ipcMain.on('soundcloud:open-history', (event) => {
        if (isTrustedSoundCloudSender(event)) historyManager?.show();
    });
    // Жанр, счётчики и волна текущего трека для карточки Discord
    ipcMain.removeAllListeners('soundcloud:track-meta');
    ipcMain.on('soundcloud:track-meta', (event, payload: unknown) => {
        if (!isTrustedSoundCloudSender(event)) return;
        const meta = validateTrackMeta(payload);
        if (!meta) return;
        presenceService.updateMeta(meta);
        sendPresencePreview();
    });
    // Отметки волны («Не нравится», скрытые артисты, «Не сейчас», «Больше такого»): ставит страница, снимает и F1
    const exclusions = new WaveExclusions(path.join(app.getPath('userData'), 'wave'));
    waveExclusions = exclusions;
    for (const channel of ['soundcloud:wave-exclusions:load', 'soundcloud:wave-exclusions:set', 'get-wave-exclusions', 'remove-wave-exclusion', 'soundcloud:wave-taste', 'soundcloud:wave-shelf:load', 'soundcloud:wave-shelf:save']) ipcMain.removeHandler(channel);
    ipcMain.handle('soundcloud:wave-exclusions:load', (event, userId: unknown) =>
        isTrustedSoundCloudSender(event) ? exclusions.load(userId) : null,
    );
    ipcMain.handle('soundcloud:wave-exclusions:set', (event, userId: unknown, kind: unknown, entry: unknown, excluded: unknown) => {
        if (!isTrustedSoundCloudSender(event)) return false;
        const saved = exclusions.set(userId, kind, entry, excluded);
        if (saved) {
            settingsManager.getView()?.webContents.send('wave-exclusions-changed');
            // «Больше такого» учит модель вкуса, «Не нравится» снимает его с трека
            listeningLibrary?.invalidate(userId, exclusions.load(userId).more.map((entry) => ({ id: entry.id, artist: entry.artistId ?? 0, genre: entry.genre ?? '', tags: entry.tags ?? '', at: entry.at })));
        }
        return saved;
    });
    ipcMain.handle('get-wave-exclusions', (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        return exclusions.load(exclusions.currentUser());
    });
    ipcMain.handle('remove-wave-exclusion', (event, kind: unknown, id: unknown) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        const userId = exclusions.currentUser();
        if (!exclusions.set(userId, kind, { id }, false)) throw new Error('Отметка не снята');
        listeningLibrary?.invalidate(userId, exclusions.load(userId).more.map((entry) => ({ id: entry.id, artist: entry.artistId ?? 0, genre: entry.genre ?? '', tags: entry.tags ?? '', at: entry.at })));
        // Страница держит отметки у себя, поэтому перечитывает их по сигналу
        if (!contentView.webContents.isDestroyed())
            contentView.webContents.executeJavaScript('window.__scWaveExclusionsChanged && window.__scWaveExclusionsChanged()').catch((error: unknown) => {
                console.warn('Волна не перечитала исключения:', error);
            });
    });
    // История прослушиваний: индекс поверх журнала сигналов, страница поверх сайта до его плеера
    historyManager?.dispose();
    // Перед чтением журнала и копией профиля буферы главного процесса ложатся на диск
    const library = new LibraryService(path.join(app.getPath('userData'), 'wave'), () => {
        waveSignals?.flush();
        waveJournal?.flush();
    });
    listeningLibrary = library;
    // Пятничный радар: расписание здесь, сбор каталога на странице сайта, выпуск считает и пишет worker
    radarScheduler?.stop();
    const radarPage = async (script: string): Promise<unknown> =>
        contentView && !contentView.webContents.isDestroyed() ? contentView.webContents.executeJavaScript(script) as Promise<unknown> : null;
    radarScheduler = new RadarScheduler({
        now: () => Date.now(),
        schedule: () => cleanSchedule(store.get('radarDay'), store.get('radarTime'), store.get('radarZone')),
        online: () => net.isOnline(),
        user: async () => {
            const id = await radarPage('window.__scWhoAmI ? window.__scWhoAmI() : 0');
            return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : 0;
        },
        status: (user, period, at) => library.request('radarStatus', user, period, at),
        task: async (user, period, at, zone) => {
            const task = await library.request('radarTask', user, period, at, zone);
            if (!task) throw new Error('Задача радара не создана');
            return task;
        },
        collect: async (_user, budgetMs, staleBefore) =>
            cleanCollectResult(await radarPage('window.__scRadarCollect ? window.__scRadarCollect(' + Math.round(budgetMs) + ', ' + Math.round(staleBefore) + ') : null')),
        build: async (user, period, at, force) => {
            const outcome = await library.request('radarBuild', user, period, at, force, false);
            return { published: outcome.published, waiting: outcome.waiting };
        },
        changed: (state) => {
            if (state.error) console.warn('Радар: ' + state.phase + ' ' + state.period + ' ' + state.error);
            // Страница сама решает, перечитывать ли выпуск: по смене периода или публикации
            void radarPage('window.__scRadarChanged?.(' + JSON.stringify(state) + ')').catch((error: unknown) => console.warn('Радар: страница не узнала о выпуске', error));
        },
    });
    radarScheduler.start();
    // Радар для страницы: выпуск с архивом, «Все найденные», пересборка и состояние сбора
    const radarUser = (event: Pick<IpcMainEvent, 'sender' | 'senderFrame'>, userId: unknown): number => {
        if (!isTrustedSoundCloudSender(event)) throw new Error('Недопустимый отправитель радара');
        if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) throw new Error('Пользователь не определён');
        return userId;
    };
    for (const channel of ['soundcloud:radar:view', 'soundcloud:radar:found', 'soundcloud:radar:rebuild', 'soundcloud:radar:state']) ipcMain.removeHandler(channel);
    ipcMain.handle('soundcloud:radar:view', (event, userId: unknown, period: unknown, revision: unknown) => library.request('radarView', radarUser(event, userId), period, revision));
    ipcMain.handle('soundcloud:radar:found', (event, userId: unknown, period: unknown, revision: unknown) => library.request('radarFound', radarUser(event, userId), period, revision));
    ipcMain.handle('soundcloud:radar:rebuild', async (event, userId: unknown) => {
        const user = radarUser(event, userId);
        const period = radarPeriod(Date.now(), cleanSchedule(store.get('radarDay'), store.get('radarTime'), store.get('radarZone')));
        // Недели ещё нет: это просто сборка сейчас, а не ревизия; иначе новая ревизия, прежняя остаётся в архиве
        const manual = (await library.request('radarStatus', user, period.key, period.at)).published;
        return library.request('radarBuild', user, period.key, period.at, true, manual);
    });
    ipcMain.handle('soundcloud:radar:state', (event) => {
        if (!isTrustedSoundCloudSender(event)) throw new Error('Недопустимый отправитель радара');
        return radarScheduler?.getState() ?? null;
    });
    const playbackChannels = ['loadSession', 'saveSession', 'loadCatalog', 'saveCatalog', 'listMixes', 'saveMix', 'removeMix'] as const;
    for (const method of playbackChannels) {
        const channel = 'soundcloud:library:' + method;
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, (event, userId: unknown, value: unknown, tracks: unknown) => {
            if (!isTrustedSoundCloudSender(event)) throw new Error('Недопустимый отправитель библиотеки');
            if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) throw new Error('Пользователь не определён');
            switch (method) {
                case 'loadSession': return library.request(method, userId);
                case 'saveSession': return library.request(method, userId, value);
                case 'loadCatalog': return library.request(method, userId);
                case 'saveCatalog': return library.request(method, userId, value);
                case 'listMixes': return library.request(method, userId);
                case 'saveMix': return library.request(method, userId, value, tracks);
                case 'removeMix': return library.request(method, userId, value);
            }
        });
    }
    // Хранилище рекомендаций: загрузки с версиями, связи записей и обход источников. Ввод проверяет worker,
    // аккаунт задаёт файл, ответ прошлого прогона обхода отклоняется по номеру прогона
    const recommendChannels = [
        'recordUploads', 'uploads', 'recordingLinks', 'setRecordingLink', 'syncStart', 'syncPage', 'syncFinish', 'syncState', 'libraryMembers', 'radarPlan', 'catalogChecked',
    ] as const;
    for (const method of recommendChannels) {
        const channel = 'soundcloud:recommend:' + method;
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, (event, userId: unknown, ...args: unknown[]) => {
            if (!isTrustedSoundCloudSender(event)) throw new Error('Недопустимый отправитель рекомендаций');
            if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) throw new Error('Пользователь не определён');
            // Время операций ставит worker: страница передаёт только данные
            const [a, b, c, d, e] = args;
            switch (method) {
                case 'recordUploads': return library.request(method, userId, a);
                case 'uploads': return library.request(method, userId, a);
                case 'recordingLinks': return library.request(method, userId);
                case 'setRecordingLink': return library.request(method, userId, a, b, c);
                case 'syncStart': return library.request(method, userId, a, b);
                case 'syncPage': return library.request(method, userId, a, b, c, d);
                case 'syncFinish': return library.request(method, userId, a, b, c, d);
                case 'syncState': return library.request(method, userId);
                case 'libraryMembers': return library.request(method, userId, a);
                case 'radarPlan': return library.request(method, userId);
                case 'catalogChecked': return library.request(method, userId, a, b, c, d, e);
            }
        });
    }
    ipcMain.handle('soundcloud:wave-taste', async (event, userId: unknown) => {
        if (!isTrustedSoundCloudSender(event)) return null;
        try {
            return await library.request('profile', userId);
        } catch (error) {
            console.warn('Вкус волны не посчитан:', error);
            return null;
        }
    });
    // Подборки дня: снимок собирает страница, main хранит его до полуночи и подсказывает, что звучало за 30 дней
    const shelf = new WaveShelf(path.join(app.getPath('userData'), 'wave'));
    ipcMain.handle('soundcloud:wave-shelf:load', async (event, userId: unknown) => {
        if (!isTrustedSoundCloudSender(event)) return null;
        let recent: number[] = [];
        try {
            if (typeof userId === 'number' && Number.isSafeInteger(userId) && userId > 0)
                recent = [...new Set((await library.request('tastePlays', userId, Date.now() - 30 * 86400000)).map((play) => play.id))].slice(-5000);
        } catch (error) {
            console.warn('Недавние прослушивания для подборок не прочитаны:', error);
        }
        return { snapshot: shelf.load(userId), recent };
    });
    ipcMain.handle('soundcloud:wave-shelf:save', (event, userId: unknown, snapshot: unknown) =>
        isTrustedSoundCloudSender(event) ? shelf.save(userId, snapshot) : false,
    );
    historyManager = new HistoryManager(mainWindow, library, {
        site: () => (contentView.webContents.isDestroyed() ? null : contentView.webContents),
        fallbackUser: () => waveExclusions?.currentUser() ?? 0,
        language: appLanguage,
        reduceMotion: () => store.get('reduceMotion', false) === true,
        beforeOpen: () => {
            closeQueueDialog();
            if (settingsManager.getView()) settingsManager.toggle();
        },
        onState: (open) => {
            if (headerView && !headerView.webContents.isDestroyed()) headerView.webContents.send('history-state', open);
        },
        restoreFocus: () => {
            if (!contentView.webContents.isDestroyed()) contentView.webContents.focus();
        },
        attach: (contents) => shortcutService.attachToWebContents(contents),
    });
    if (platform() === 'win32') {
        thumbarService = new ThumbarService(translationService, RESOURCES_PATH, playbackController);
        mainWindow.on('show', () => thumbarService.restore(mainWindow));
    }


    // Add settings toggle handler
    ipcMain.on('toggle-settings', (event) => {
            if (!isTrustedLocalSender(event)) return;

        settingsManager.toggle();
    });
    ipcMain.removeAllListeners('toggle-history');
    ipcMain.removeAllListeners('toggle-queue');
    ipcMain.on('toggle-queue', (event) => {
        if (!isTrustedLocalSender(event)) return;
        historyManager?.hide();
        if (settingsManager.getView()) settingsManager.toggle();
        void contentView.webContents.executeJavaScript('window.__scQueue?.()').catch(console.error);
    });
    ipcMain.on('toggle-history', (event) => {
        if (isTrustedLocalSender(event)) toggleHistory();
    });

    ipcMain.handle('open-external-url', async (_event, url: string) => {
            if (!isTrustedLocalSender(_event)) throw new Error('Недопустимый отправитель IPC');

        if (!url || typeof url !== 'string') return '';
        const normalizedUrl = url.trim();

        try {
            const parsed = new URL(normalizedUrl);
            if (parsed.protocol !== 'https:') return '';
            await shell.openExternal(parsed.toString());
            return '';
        } catch {
            return '';
        }
    });

    setupWindowControls();

    initializeShortcuts();

    applyThemeToContent();
    ipcMain.handle('export-diagnostics', async (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        const result = await dialog.showSaveDialog(mainWindow, {
            title: translationService.translate('saveJournalTitle'),
            defaultPath: path.join(app.getPath('downloads'), 'soundcloud-diagnostics-' + new Date().toISOString().slice(0, 10) + '.log'),
            filters: [{ name: translationService.translate('journalFileType'), extensions: ['log'] }],
        });
        if (result.canceled || !result.filePath) return false;
        try { diagnostics.exportTo(result.filePath); return true; }
        catch (error) { console.error('Не удалось сохранить журнал:', error); throw new Error('Не удалось сохранить журнал', { cause: error }); }
    });

    // Резервная копия профиля: файл пишет и читает worker. Главный процесс держит диалоги, путь к выбранному файлу,
    // отметки волны, журнал «Нового» и настройки: у них здесь кэш и запись
    let backupBusy = false;
    let backupPending: { token: string; file: string; hash: string } | null = null;
    const backupState = () => {
        const folder = store.get('backupFolder');
        const lastAt = store.get('backupLastAt');
        const lastError = store.get('backupLastError');
        return {
            folder: typeof folder === 'string' ? folder : '',
            auto: store.get('backupAuto') === true && typeof folder === 'string' && !!folder,
            lastAt: typeof lastAt === 'number' && Number.isFinite(lastAt) ? lastAt : 0,
            lastError: BACKUP_REASONS.find((reason) => reason === lastError) ?? '',
            busy: backupBusy,
        };
    };
    const tasteMarks = (userId: number) => exclusions.load(userId).more.map((entry) => ({ id: entry.id, artist: entry.artistId ?? 0, genre: entry.genre ?? '', tags: entry.tags ?? '', at: entry.at }));
    const backupSettings = (): Record<string, unknown> => {
        const values: Record<string, unknown> = {};
        for (const key of [...BACKUP_SETTING_KEYS, ...BACKUP_MIGRATION_MARKS]) {
            const value = store.get(key);
            if (value !== undefined) values[key] = value;
        }
        return values;
    };
    async function saveBackup(target: string, auto: boolean): Promise<BackupSaveOutcome> {
        if (backupBusy) return { ok: false, reason: 'busy' };
        // Копия внутри папки данных погибла бы вместе с ними
        if (isInside(target, profilePath)) return { ok: false, reason: 'inside-profile' };
        backupBusy = true;
        const started = Date.now();
        try {
            const outcome = await library.request('backupSave', target, backupSettings(), { version: app.getVersion(), build: String(buildInfo.build ?? '') }, auto ? AUTO_BACKUP_KEEP : 0);
            if (outcome.ok) diagnostics.record('backup.saved', { auto, backupMs: Date.now() - started, backupKiB: outcome.size / 1024 });
            else diagnostics.record('backup.failed', { auto, reason: outcome.reason });
            return outcome;
        } catch (error) {
            console.warn('Резервная копия не сохранена', error);
            diagnostics.record('backup.failed', { auto, reason: 'io-error' });
            return { ok: false, reason: 'io-error' };
        } finally {
            backupBusy = false;
        }
    }
    // Автокопия: раз в неделю при запуске, если включена и папка выбрана. Сбой виден в F1, повтор при следующем запуске
    async function runAutoBackup(): Promise<void> {
        const state = backupState();
        if (!autoBackupDue(state.auto, state.folder, store.get('backupLastAt'), Date.now())) return;
        const outcome = await saveBackup(path.join(state.folder, backupFileName(Date.now())), true);
        if (outcome.ok) {
            store.set('backupLastAt', Date.now());
            store.delete('backupLastError');
        } else if (outcome.reason !== 'busy') store.set('backupLastError', outcome.reason);
        settingsManager.getView()?.webContents.send('backup-state-changed', backupState());
    }
    clearTimeout(autoBackupTimer);
    autoBackupTimer = setTimeout(() => void runAutoBackup().catch((error: unknown) => console.warn('Автокопия не выполнена', error)), AUTO_BACKUP_DELAY);
    autoBackupTimer.unref();
    // Настройки из копии: только прошедшие проверку ключи, отметки переноса напрямую. previous собирает прежние значения для отката
    function applyBackupSettings(values: Record<string, unknown>, previous: Record<string, unknown>): void {
        for (const [key, value] of Object.entries(values)) {
            const before = store.get(key);
            if (before === value) continue;
            if (BACKUP_MIGRATION_MARKS.includes(key)) {
                previous[key] = before;
                if (value === undefined) store.delete(key);
                else store.set(key, value === true);
                continue;
            }
            const change = { key, value };
            if (!validateSettingChange(change)) continue;
            previous[key] = before;
            applySettingChange(change);
        }
    }
    async function restoreBackup(file: string, hash: string): Promise<{ ok: true; plays: number; mixes: number; editions: number; reload: boolean } | { ok: false; reason: BackupReason }> {
        if (backupBusy) return { ok: false, reason: 'busy' };
        backupBusy = true;
        const started = Date.now();
        const failed = (reason: BackupReason): { ok: false; reason: BackupReason } => {
            diagnostics.record('backup.restore-failed', { reason });
            return { ok: false, reason };
        };
        const rollback = (): Promise<void> => library.request('backupRollback').then((clean) => {
            if (!clean) console.warn('Резервная копия: откат прошёл не полностью');
        }, (error: unknown) => console.warn('Резервная копия: откат не выполнен', error));
        // Журнал сигналов пишет только его владелец: на время слияния запись ждёт, события копятся в памяти
        waveSignals?.flush();
        waveJournal?.flush();
        waveSignals?.pause();
        try {
            let outcome: BackupRestoreOutcome;
            try {
                outcome = await library.request('backupRestore', file, hash);
            } catch (error) {
                console.warn('Резервная копия: worker не восстановил данные', error);
                await rollback();
                return failed('io-error');
            }
            if (!outcome.ok) return failed(outcome.reason);
            const undo: Array<() => boolean> = [];
            const previous: Record<string, unknown> = {};
            try {
                for (const account of outcome.accounts) {
                    if (account.exclusions) {
                        const before = exclusions.merge(account.id, account.exclusions);
                        if (!before) throw new Error('Отметки волны не записаны');
                        undo.push(() => exclusions.restore(account.id, before));
                    }
                    const journal = waveJournal;
                    if (account.journal?.length && journal) {
                        const before = journal.merge(account.id, account.journal);
                        if (!before) throw new Error('Журнал «Нового» не записан');
                        undo.push(() => journal.restore(account.id, before));
                    }
                }
                undo.push(() => {
                    applyBackupSettings(previous, {});
                    return true;
                });
                if (outcome.settings) applyBackupSettings(outcome.settings, previous);
            } catch (error) {
                // Сбой посередине: всё возвращается к состоянию до восстановления
                console.warn('Резервная копия: восстановление отменено, данные возвращаются', error);
                for (const step of undo.reverse()) {
                    try {
                        if (!step()) console.warn('Резервная копия: часть отката не записана');
                    } catch (cause) {
                        console.warn('Резервная копия: часть отката не выполнена', cause);
                    }
                }
                await rollback();
                return failed('io-error');
            }
            const ids = outcome.accounts.map((account) => account.id);
            await library.request('backupFinish', ids).catch((error: unknown) => console.warn('Резервная копия: индекс истории не пересобран', error));
            // Волна, история и F1 перечитывают данные; играющий трек не трогается
            for (const id of ids) listeningLibrary?.invalidate(id, tasteMarks(id));
            settingsManager.getView()?.webContents.send('wave-exclusions-changed');
            if (contentView && !contentView.webContents.isDestroyed())
                void contentView.webContents.executeJavaScript('window.__scWaveExclusionsChanged?.();window.__scRadarReload?.()').catch((error: unknown) => {
                    console.warn('Волна не перечитала восстановленные данные', error);
                });
            historyManager?.changed();
            diagnostics.record('backup.restored', { backupMs: Date.now() - started });
            const restored = outcome.accounts;
            const sum = (pick: (account: (typeof restored)[number]) => number): number => restored.reduce((total, account) => total + pick(account), 0);
            return { ok: true, plays: sum((account) => account.plays), mixes: sum((account) => account.mixes), editions: sum((account) => account.editions), reload: pageReloadNeeded || networkSettingsDirty };
        } finally {
            waveSignals?.resume();
            backupBusy = false;
        }
    }
    const backupFilter = (): Electron.FileFilter[] => [{ name: translationService.translate('backupFileType'), extensions: [BACKUP_EXTENSION] }];
    ipcMain.handle('backup-state', (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        return backupState();
    });
    ipcMain.handle('backup-save', async (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        const result = await dialog.showSaveDialog(mainWindow, {
            title: translationService.translate('backupSaveTitle'),
            defaultPath: path.join(backupState().folder || app.getPath('documents'), backupFileName(Date.now())),
            filters: backupFilter(),
        });
        if (result.canceled || !result.filePath) return null;
        const target = path.extname(result.filePath).toLowerCase() === '.' + BACKUP_EXTENSION ? result.filePath : result.filePath + '.' + BACKUP_EXTENSION;
        return saveBackup(target, false);
    });
    // Выбор файла: worker проверяет его и считает, что нового; путь остаётся здесь за одноразовым ключом
    ipcMain.handle('backup-pick', async (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        const result = await dialog.showOpenDialog(mainWindow, {
            title: translationService.translate('backupOpenTitle'),
            defaultPath: backupState().folder || app.getPath('documents'),
            properties: ['openFile'],
            filters: backupFilter(),
        });
        const file = result.canceled ? undefined : result.filePaths[0];
        if (!file) return null;
        if (backupBusy) return { ok: false, reason: 'busy' };
        backupBusy = true;
        backupPending = null;
        try {
            const outcome = await library.request('backupInspect', file);
            if (!outcome.ok) return outcome;
            const token = randomUUID();
            backupPending = { token, file, hash: outcome.hash };
            let current = 0;
            try {
                const id = await radarPage('window.__scWhoAmI ? window.__scWhoAmI() : 0');
                current = typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : exclusions.currentUser();
            } catch (error) {
                console.warn('Резервная копия: вошедший аккаунт не определён', error);
                current = exclusions.currentUser();
            }
            const settingsChanged = Object.entries(outcome.settings).filter(([key, value]) => !BACKUP_MIGRATION_MARKS.includes(key) && store.get(key) !== value).length;
            return { ok: true, token, summary: outcome.summary, current, settingsChanged };
        } catch (error) {
            console.warn('Резервная копия не проверена', error);
            return { ok: false, reason: 'io-error' };
        } finally {
            backupBusy = false;
        }
    });
    ipcMain.handle('backup-restore', async (event, token: unknown) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        const pending = backupPending;
        if (!pending || typeof token !== 'string' || token !== pending.token) return { ok: false, reason: 'changed' };
        backupPending = null;
        return restoreBackup(pending.file, pending.hash);
    });
    ipcMain.handle('backup-folder', async (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        const result = await dialog.showOpenDialog(mainWindow, {
            title: translationService.translate('backupFolderTitle'),
            defaultPath: backupState().folder || app.getPath('documents'),
            properties: ['openDirectory', 'createDirectory'],
        });
        const folder = result.canceled ? undefined : result.filePaths[0];
        if (!folder) return backupState();
        if (isInside(folder, profilePath)) return { ...backupState(), rejected: 'inside-profile' };
        store.set('backupFolder', folder);
        store.delete('backupLastError');
        return backupState();
    });
    ipcMain.handle('backup-auto', (event, value: unknown) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        if (typeof value !== 'boolean') throw new Error('Неверное значение автокопии');
        if (value && !backupState().folder) return backupState();
        store.set('backupAuto', value);
        // Включили впервые или давно не было копии: первая делается сразу, а не при следующем запуске
        if (value) void runAutoBackup().catch((error: unknown) => console.warn('Автокопия не выполнена', error));
        return backupState();
    });
    setupTranslationHandlers();
    setupAudioHandler();

    // Provide current track info to settings preview on demand
    ipcMain.handle('get-current-track', (event) => {
            if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');

        return { track: lastTrackInfo, ...presenceService.preview() };
    });

    // Configure session


    // Apply initial settings


    // Function to update navigation state in header
    function updateNavigationState() {
        if (headerView && headerView.webContents && contentView) {
            const state = {
                canGoBack: contentView.webContents.navigationHistory.canGoBack(),
                canGoForward: contentView.webContents.navigationHistory.canGoForward(),
            };
            headerView.webContents.send('navigation-state-changed', state);
        }
    }

    // Listen for navigation events to update button states
    contentView.webContents.on('did-navigate', () => {
        updateNavigationState();
    });

    contentView.webContents.on('did-navigate-in-page', () => {
        updateNavigationState();
    });

    // Listen for page load events to manage refresh state
    contentView.webContents.on('did-start-loading', () => {
        if (headerView && headerView.webContents) {
            headerView.webContents.send('refresh-state-changed', true);
        }
    });

    contentView.webContents.on('did-stop-loading', () => {
        if (headerView && headerView.webContents) {
            headerView.webContents.send('refresh-state-changed', false);
        }
        updateNavigationState();
    });

    contentView.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
        if (isMainFrame && code !== -3) diagnostics.record('page.load-failed', { errorCode: code });
        if (isMainFrame && code !== -3) queueToastNotification(translationService.translate('pageLoadFailed'));
        if (headerView && headerView.webContents) {
            headerView.webContents.send('refresh-state-changed', false);
        }
        updateNavigationState();
    });

    installRendererRecovery(contentView.webContents, {
        isQuitting: () => isQuitting,
        onCrash: () => {
            presenceService.clearActivity();
            lastTrackInfo = { title: '', author: '', artwork: '', elapsed: '', duration: '', isPlaying: false, isLiked: false, url: '', artistUrl: '' };
        },
        onRepeatedCrash: () => queueToastNotification(translationService.translate('playerCrashed')),
    });

    // Track if this is initial load
    contentView.webContents.on('render-process-gone', (_event, details) => {
        diagnostics.record('renderer.gone', { reason: details.reason, exitCode: details.exitCode });
        diagnostics.flush();
    });
    contentView.webContents.on('unresponsive', () => diagnostics.record('renderer.unresponsive'));
    contentView.webContents.on('responsive', () => diagnostics.record('renderer.responsive'));
    let isInitialLoad = true;

    // Setup event handlers
    contentView.webContents.on('did-finish-load', async () => {

        diagnostics.record('page.loaded');

        // Show notification only on first load
        if (isInitialLoad) {
            notificationManager.show(translationService.translate('pressF1ToOpenSettings'));
            isInitialLoad = false;
        }

        // Update navigation state after page load
        updateNavigationState();

        // Initialize navigation controls visibility
        const navigationEnabled = store.get('navigationControlsEnabled', false);
        if (headerView && headerView.webContents) {
            headerView.webContents.send('navigation-controls-toggle', navigationEnabled);
        }

        // Reinitialize after page load/refresh
        await reinitializeAfterPageLoad();
    });

    // Reinitialize everything after page load/refresh
    async function reinitializeAfterPageLoad() {
        try {
            // Reapply theme to content after page reload
            applyThemeToContent();

            // Inject audio monitoring script
            await contentView.webContents.executeJavaScript(audioMonitorScript);
            await contentView.webContents.executeJavaScript(fullShuffleScript(store.get('fullShuffle', true) === true));
            // Плавность раньше волны: волна берёт у неё цвета обложек
            await contentView.webContents.executeJavaScript(pageMotionScript(store.get('reduceMotion', false) === true));
            await contentView.webContents.executeJavaScript(homePageScript());
            await contentView.webContents.executeJavaScript(waveScript());
            await contentView.webContents.executeJavaScript(playerAreaScript());

            if (presenceService) {
                await presenceService.updatePresence(lastTrackInfo);
            }
        } catch (error) {
            console.error('Failed to reinitialize after page load:', error);
        }
    }

    // Register settings related events
    ipcMain.on('setting-changed', (_event, data) => {
            if (!isTrustedLocalSender(_event)) return;
            if (!validateSettingChange(data)) return;
        applySettingChange(data);
    });
    // Смена из F1 и восстановление копии: запись в настройки и то, что должно поменяться сразу
    function applySettingChange(data: SettingChange): void {
        const key = data.key;
        if (key === 'proxyPassword') {
            try { proxyService.setPassword(data.value); networkSettingsDirty = true; } catch (error) { queueToastNotification(String(error)); }
            return;
        }
        store.set(key, data.value);
        if (key.startsWith('proxy') || key === 'adBlocker') networkSettingsDirty = true;
        // Новое расписание может сделать выпуск уже наступившим; повтор недели отсекает хранилище
        if (key === 'radarDay' || key === 'radarTime' || key === 'radarZone') radarScheduler?.wake(5000);
        if (key === 'siteLanguage') {
            pageReloadNeeded = true;
            applyAppLanguage();
            // F1 переключается сразу, статус обновлений тоже приходит на новом языке
            if (updateService) settingsManager.getView()?.webContents.send('update-state', updateService.getState());
        }

        console.log(key);

        if (key === 'displaySCSmallIcon') {
            displaySCSmallIcon = data.value;
            presenceService.updateDisplaySettings(displaySCSmallIcon);
        } else if (key === 'displayGithubLink') {
            presenceService.updateDisplaySettings(displaySCSmallIcon);
        } else if (key === 'displayButtons') {
            presenceService.updateDisplaySettings(displaySCSmallIcon, data.value);
        } else if (key === 'discordRichPresence') {
            // Статус включается и гаснет сразу, без кнопки применения
            if (data.value === true) void presenceService.updatePresence(lastTrackInfo).catch(console.error);
            else presenceService.clearActivity();
        } else if (key === 'autoUpdateEnabled') {
            updateService?.setEnabled(data.value);
        } else if (key === 'statusDisplayType') {
            presenceService.setStatusDisplayType(data.value as number);
        } else if (key === 'discordIncognito') {
            setDiscordIncognito(data.value === true, false);
        } else if (DISCORD_TEXT_KEYS.has(key)) {
            presenceService.refresh();
        } else if (key === 'minimizeToTray') {
            // Update tray behavior when setting changes
            if (data.value === false && tray) {
                // If minimize to tray is disabled, destroy the tray
                tray.destroy();
                tray = null;
                trayMenu = null;
            } else if (data.value === true && !tray) {
                // If minimize to tray is enabled, create the tray
                setupTray();
            }
        } else if (key === 'webhookEnabled') {
            webhookService.setEnabled(data.value);
        } else if (key === 'webhookUrl') {
            webhookService.setWebhookUrl(data.value);
        } else if (key === 'webhookTriggerPercentage') {
            webhookService.setTriggerPercentage(data.value);
        } else if (key === 'navigationControlsEnabled') {
            if (headerView && headerView.webContents) {
                headerView.webContents.send('navigation-controls-toggle', data.value);
            }
        } else if (key === 'hidePromotions' || key === 'hideEventsNearYou' || key === 'hideArtistUpsells' || key === 'hideHeaderExtras' || isHomeBlockKey(key)) {
            applyThemeToContent();
        } else if (key === 'fullShuffle') {
            void contentView.webContents.executeJavaScript(fullShuffleScript(data.value === true)).catch(console.error);
        } else if (key === 'reduceMotion') {
            void contentView.webContents.executeJavaScript(pageMotionScript(data.value === true)).catch(console.error);
        }
        // Предпросмотр карточки в F1 собирает main: шаблоны, стоп-листы, строка под ником, язык чисел
        if (key.startsWith('discord') || key.startsWith('display') || key === 'statusDisplayType' || key === 'trackParserEnabled' || key === 'siteLanguage') sendPresencePreview();
    }

    // handle account switching
    ipcMain.handle('get-accounts', (event) => {
            if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');

        return {
            accounts: getAccounts(),
            currentAccountId: store.get('currentAccountId', 'default'),
        };
    });

    ipcMain.on('switch-account', (_, accountId) => {
            if (!isTrustedLocalSender(_)) return;

        const accounts = getAccounts();
        if (typeof accountId !== 'string' || !accounts.some((account) => account.id === accountId)) return;
        store.set('currentAccountId', accountId);
        app.relaunch();
        app.quit();
    });

    ipcMain.on('add-account', (event) => {
            if (!isTrustedLocalSender(event)) return;

        const newId = `acc_${Date.now()}`;
        const accounts = getAccounts();
        accounts.push({ id: newId, name: 'Новый аккаунт' });
        store.set('accounts', accounts);
        store.set('currentAccountId', newId);
        app.relaunch();
        app.quit();
    });

    ipcMain.on('logout-account', async (event) => {
            if (!isTrustedLocalSender(event)) return;

        const currentId = store.get('currentAccountId', 'default');

        if (contentView) {
            // log out of session
            await contentView.webContents.session.clearStorageData();
        }

        // if not default account, remove from list
        if (currentId !== 'default') {
            const accounts = getAccounts();
            const filteredAccounts = accounts.filter((a: { id: string }) => a.id !== currentId);

            store.set('accounts', filteredAccounts);
            store.set('currentAccountId', 'default'); // Switch back to main

            app.relaunch();
            app.quit();
        } else {
            // if default account, reload page logged out
            if (contentView) contentView.webContents.reload();
        }
    });

    // handle applying all changes
    ipcMain.on('apply-changes', async (event) => {
            if (!isTrustedLocalSender(event)) return;

        try {
            if (networkSettingsDirty) {
                await proxyService.apply();
                await adblockService.setEnabled(store.get('adBlocker') === true);
                networkSettingsDirty = false;
                pageReloadNeeded = true;
            }
            if (pageReloadNeeded) {
                pageReloadNeeded = false;
                contentView.webContents.reload();
            }
            if (store.get('discordRichPresence')) await presenceService.updatePresence(lastTrackInfo);
            else presenceService.clearActivity();
        } catch (error) { queueToastNotification(String(error)); }
    });

    ipcMain.on('soundcloud:profile-update', (event, username: unknown) => {
        if (!isTrustedSoundCloudSender(event) || typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(username)) return;
        const accounts = getAccounts();
        const currentId = store.get('currentAccountId', 'default');
        const account = accounts.find((item) => item.id === currentId);
        if (account && account.name !== username) {
            account.name = username;
            store.set('accounts', accounts);
            settingsManager.getView()?.webContents.send('accounts-updated');
        }
    });
    try { await proxyService.apply(); } catch (error) {
        queueToastNotification(String(error));
        settingsManager.toggle();
        return;
    }
    await adblockService.setEnabled(store.get('adBlocker') === true).catch((error: unknown) => queueToastNotification(String(error)));
    await contentView.webContents.loadURL('https://soundcloud.com/discover').catch((error: unknown) => console.error('Не удалось загрузить SoundCloud:', error));
    focusTopView();
    // Клиент запущен ссылкой из Discord: трек откроется, когда сайт будет готов
    const startLink = parseOpenLink(process.argv);
    if (startLink) openTrackLink(startLink);
}



const viewStyles = new ViewStyles();
function hiddenBlocksCSS(): string {
    return [
        homeBlocksCss((key) => store.get(key, homeBlockDefaults[key]) === true),
        store.get('hideArtistUpsells', true) ? ARTIST_TOOLS_CSS : '',
        store.get('hideHeaderExtras', true) ? '.header .header__fanUpsell,.header .header__forArtistsButton,.header .header__soundInput{display:none!important}' : '',
        store.get('hidePromotions', true) ? '.banner.m-promotion{display:none!important}' : '',
        store.get('hideEventsNearYou', true) ? '.velvetCakeModule{display:none!important}' : '',
        store.get('hideArtistUpsells', true) ? '.creatorSubscriptionsButton.header__creatorUpsell,.artistConnectItem.m-upsellNextPro,.dropdownMenu [href*="checkout.soundcloud.com"],.spotlight:has(.spotlight__upsellBanner),.spotlight__upsellBanner,.spotlight__upsellCTA,.sidebarContent:has(.velvetCakeIframe),.artistConnectContainer .tileGallery__sliderPeekForward,.artistConnectContainer .tileGallery__sliderPeekBackward,.MuiBox-root:has(a[href*="getstarted/fan-support"]){display:none!important}' : '',
    ].join('\n');
}
function applyThemeToContent() {
    if (!contentView || contentView.webContents.isDestroyed()) return;
    const css = [
        ':root{--background-base:#121212;--background-surface:#212121;--text-base:#ffffff;}',
        // Стандартные свойства: ::-webkit-scrollbar рисуется главным потоком и отстаёт от прокрутки.
        'html{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) rgba(255,255,255,.05)}',
        hiddenBlocksCSS(),
    ].join('\n');
    // До первой загрузки сайта страницы нет: стили и скрипты всё равно пропали бы, их ставит did-finish-load
    if (contentView.webContents.getURL()) {
        contentView.webContents.send('soundcloud:early-blocks', hiddenBlocksCSS());
        void viewStyles.apply(contentView.webContents, css).catch(console.error);
        void contentView.webContents.executeJavaScript('for(const n of [document.documentElement,document.body]){n.classList.remove("theme-light");n.classList.add("theme-dark")}').catch(console.error);
        void contentView.webContents.executeJavaScript(pageFeaturesScript(store.get('hideArtistUpsells', true) === true)).catch(console.error);
    }
}

function initializeShortcuts() {
    if (!mainWindow || !contentView || !settingsManager) return;

    shortcutService.register('openSettings', 'F1', 'Open Settings', () => settingsManager.toggle());
    shortcutService.register('openHistory', 'CommandOrControl+H', 'Listening History', () => toggleHistory());
    // Как окно инкогнито в Chrome
    shortcutService.register('discordIncognito', 'CommandOrControl+Shift+N', 'Discord Incognito', () =>
        setDiscordIncognito(store.get('discordIncognito', false) !== true, true),
    );

    if (devMode) {
        shortcutService.register('devTools', 'F12', 'Open Developer Tools', () => {
            if (contentView) contentView.webContents.openDevTools();
        });
    }

    shortcutService.register('zoomIn', 'CommandOrControl+=', 'Zoom In', () => {
        if (!contentView) return;
        const zoomLevel = contentView.webContents.getZoomLevel();
        contentView.webContents.setZoomLevel(Math.min(zoomLevel + 1, 9));
    });

    shortcutService.register('zoomOut', 'CommandOrControl+-', 'Zoom Out', () => {
        if (!contentView) return;
        const zoomLevel = contentView.webContents.getZoomLevel();
        contentView.webContents.setZoomLevel(Math.max(zoomLevel - 1, -9));
    });

    shortcutService.register('zoomReset', 'CommandOrControl+0', 'Reset Zoom', () => {
        if (contentView) contentView.webContents.setZoomLevel(0);
    });

    shortcutService.register('goBack', 'CommandOrControl+B', 'Go Back', () => {
        if (contentView && contentView.webContents.navigationHistory.canGoBack()) {
            contentView.webContents.navigationHistory.goBack();
        }
    });

    shortcutService.register('goBackAlt', 'CommandOrControl+P', 'Go Back (Alternative)', () => {
        if (contentView && contentView.webContents.navigationHistory.canGoBack()) {
            contentView.webContents.navigationHistory.goBack();
        }
    });

    shortcutService.register('goForward', 'CommandOrControl+F', 'Go Forward', () => {
        if (contentView && contentView.webContents.navigationHistory.canGoForward()) {
            contentView.webContents.navigationHistory.goForward();
        }
    });

    shortcutService.register('goForwardAlt', 'CommandOrControl+N', 'Go Forward (Alternative)', () => {
        if (contentView && contentView.webContents.navigationHistory.canGoForward()) {
            contentView.webContents.navigationHistory.goForward();
        }
    });

    shortcutService.register('refresh', 'CommandOrControl+R', 'Refresh Page', () => {
        if (contentView) {
            if (headerView && headerView.webContents) {
                headerView.webContents.send('refresh-state-changed', true);
            }
            contentView.webContents.reload();
        }
    });

    console.log(`Initialized ${shortcutService.count} keyboard shortcuts`);
}

// app lifecycle handlers
app.on('ready', init);

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', function () {
    if (mainWindow === null) {
        init();
    }
});

let waveSignalsTaken = false;
let libraryStopped = false;
app.on('before-quit', (event) => {
    radarScheduler?.stop();
    clearTimeout(autoBackupTimer);
    // Последнее прослушивание страница отдаёт до закрытия окон: её pagehide приходит уже после записи журнала
    if (!waveSignalsTaken && waveSignals && contentView && !contentView.webContents.isDestroyed()) {
        waveSignalsTaken = true;
        event.preventDefault();
        const taken = contentView.webContents.executeJavaScript('(async()=>{await window.__scSaveSession?.();return window.__scWaveTakeSignals?.() ?? null})()') as Promise<unknown>;
        const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000));
        void Promise.race([taken, late])
            .then((result) => {
                const out = result as { userId?: unknown; signals?: unknown } | null;
                if (out) waveSignals?.add(out.userId, out.signals);
            }, (error: unknown) => console.warn('Журнал сигналов: последнее прослушивание не получено', error))
            .finally(() => app.quit());
        return;
    }
    if (!libraryStopped && listeningLibrary) {
        libraryStopped = true;
        event.preventDefault();
        waveSignals?.flush();
        void listeningLibrary.close()
            .catch((error: unknown) => console.warn('Библиотека не закрыта перед выходом', error))
            .finally(() => app.quit());
        return;
    }
    clearInterval(diagnosticTimer);
    clearInterval(awayTimer);
    isQuitting = true;
    if (presenceService) void presenceService.dispose();
    proxyService?.dispose();
    adblockService?.dispose();
    webhookService?.dispose();
    waveJournal?.flush();
    waveSignals?.flush();
    updateService?.dispose();
    settingsManager?.dispose();
    historyManager?.dispose();
    notificationManager?.dispose();
    if (shortcutService) {
        shortcutService.destroy();
    }
    if (tray) {
        tray.destroy();
        tray = null;
    }
});

app.on('will-quit', () => {
    store.set('gpuCompatibilityRunning', false);
    clearInterval(diagnosticTimer);
    loopDelay.disable();
    diagnostics.close();
    // Сигналы, которые страница успела дослать после before-quit
    waveSignals?.flush();
    if (tray) {
        tray.destroy();
        tray = null;
    }
});

// Ссылка «открыть в клиенте» из карточки Discord: страница сайта включает трек, когда её модули найдены.
// До этого __scOpenTrack отвечает false или его ещё нет, тогда повтор раз в секунду, не дольше 30 секунд
let openLinkTimer: ReturnType<typeof setTimeout> | undefined;
let openLinkRequest = 0;
function openTrackLink(trackPath: string, attempt = 0, request = ++openLinkRequest): void {
    if (request !== openLinkRequest) return;
    clearTimeout(openLinkTimer);
    const retry = (): void => {
        if (request !== openLinkRequest) return;
        if (attempt < 30) openLinkTimer = setTimeout(() => openTrackLink(trackPath, attempt + 1, request), 1000);
        else console.warn('Ссылка на трек: сайт не готов за 30 секунд');
    };
    const view = contentView as BrowserView | undefined;
    if (!view || view.webContents.isDestroyed() || view.webContents.isLoading()) {
        retry();
        return;
    }
    // userGesture: воспроизведение по ссылке запускает пользователь, политика автовоспроизведения его не держит
    const script = 'window.__scOpenTrack ? window.__scOpenTrack(' + JSON.stringify(trackPath) + ') : "not-ready"';
    (view.webContents.executeJavaScript(script, true) as Promise<unknown>).then(
        (done) => { if (done === 'not-ready') retry(); else if (done === 'failed' || done === 'unavailable') queueToastNotification(translationService.translate('pageLoadFailed')); },
        (error: unknown) => { console.warn('Ссылка на трек не открыта:', error); retry(); },
    );
}

// focus window when second instance opened
app.on('second-instance', (_event, argv) => {
    const trackPath = parseOpenLink(argv);
    if (trackPath) openTrackLink(trackPath);
    if (!mainWindow) {
        return;
    }

    // when minimize to tray active, window is hidden
    if (!mainWindow.isVisible()) {
        mainWindow.show();
    }
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }

    mainWindow.focus();
});

export function queueToastNotification(message: string) {
    if (mainWindow && notificationManager) {
        notificationManager.show(message);
    }
}

function setupTranslationHandlers() {
    ipcMain.handle('get-translations', (event) => {
            if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');

        return {
            client: translationService.translate('client'),
            adBlocker: translationService.translate('adBlocker'),
            enableAdBlocker: translationService.translate('enableAdBlocker'),
            changesAppRestart: translationService.translate('changesAppRestart'),
            proxy: translationService.translate('proxy'),
            proxyHost: translationService.translate('proxyHost'),
            proxyPort: translationService.translate('proxyPort'),
            enableProxy: translationService.translate('enableProxy'),
            webhooks: translationService.translate('webhooks'),
            discord: translationService.translate('discord'),
            enableWebhooks: translationService.translate('enableWebhooks'),
            webhookUrl: translationService.translate('webhookUrl'),
            webhookTrigger: translationService.translate('webhookTrigger'),
            webhookDescription: translationService.translate('webhookDescription'),
            showWebhookExample: translationService.translate('showWebhookExample'),
            enableRichPresence: translationService.translate('enableRichPresence'),
            displaySmallIcon: translationService.translate('displaySmallIcon'),
            displayButtons: translationService.translate('displayButtons'),
            useArtistInStatusLine: translationService.translate('useArtistInStatusLine'),
            enableRichPresencePreview: translationService.translate('enableRichPresencePreview'),
            richPresencePreview: translationService.translate('richPresencePreview'),
            richPresencePreviewDescription: translationService.translate('richPresencePreviewDescription'),
            applyChanges: translationService.translate('applyChanges'),
            minimizeToTray: translationService.translate('minimizeToTray'),
            enableNavigationControls: translationService.translate('enableNavigationControls'),
            enableTrackParser: translationService.translate('enableTrackParser'),
            trackParserDescription: translationService.translate('trackParserDescription'),
            pressF1ToOpenSettings: translationService.translate('pressF1ToOpenSettings'),
            closeSettings: translationService.translate('closeSettings'),
            noActivityToShow: translationService.translate('noActivityToShow'),
            richPresencePreviewTitle: translationService.translate('richPresencePreviewTitle'),
            hidePromotions: translationService.translate('hidePromotions'),
            hideEventsNearYou: translationService.translate('hideEventsNearYou'),
            hideArtistUpsells: translationService.translate('hideArtistUpsells'),
        };
    });
}

// setup audio event handler for track updates
function setupAudioHandler() {
    ipcMain.on('soundcloud:track-update', async (event, payload: unknown) => {
        if (!isTrustedSoundCloudSender(event)) {
            console.warn('Rejected track update from untrusted sender');
            return;
        }

        const update = validateTrackUpdatePayload(payload);
        if (!update) {
            console.warn('Rejected invalid track update payload');
            return;
        }

        const { data: result, reason } = update;
        trackUpdates++;
        lastUpdateAt = Date.now();
        if (reason === 'track-change') trackChanges++;
        if (result.elapsed !== lastTrackInfo.elapsed || reason === 'track-change') lastProgressAt = Date.now();

        if (devMode) {
            console.debug(`Track update received: ${reason}`);
        }

        if (result.title && (reason === 'track-change' || !lastTrackInfo.title)) {
            void contentView.webContents.executeJavaScript(mediaControlsScript).catch(console.error);
        }
        lastTrackInfo = result;

        void webhookService.updateTrackInfo(result, result.isPlaying, reason).catch(console.error);
        void presenceService.updatePresence(result).catch(console.error);

        // update rich presence preview in settings
        sendPresencePreview();

        if (thumbarService) {
            thumbarService.updateThumbarButtons(mainWindow, result.isPlaying, result.isLiked);
        }
    });
}
