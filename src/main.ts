import { DiagnosticJournal, LOOP_RESOLUTION_MS, loopDelayStats, metricsDue } from './services/diagnosticJournal';
import { monitorEventLoopDelay } from 'perf_hooks';
import { installRendererRecovery } from './services/rendererRecovery';
import { protectContent, sitePagePath } from './contentPolicy';
import { DISCORD_TEXT_KEYS, type SettingChange } from './settings/validateSetting';
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
import { AUTO_BACKUP_DELAY } from './services/backupPolicy';
import { DEFAULT_RADAR_SCHEDULE, type RadarScheduler } from './services/radarSchedule';
import { HistoryManager } from './history/historyManager';
import { AwayTracker } from './services/awayTracker';
import { OPEN_PROTOCOL, parseOpenLink } from './services/openLink';
import { getSiteDictionary } from './services/siteDictionary';
import { guardGpuStartup, isGpuCompatibilityMode, shouldRunGpuInProcess, type GpuRuntimeState } from './services/gpuProcessMode';
import { detectNvidiaAdapter } from './services/gpuDetection';
import { TimeoutError, withTimeout } from './utils/withTimeout';
import { tintIcon } from './services/devIcon';
import { revealWindow } from './services/revealWindow';
import { watchHiddenPage } from './services/hiddenPageWatchdog';
import { registerWindowIpc } from './ipc/windowIpc';
import { registerUpdateIpc } from './ipc/updateIpc';
import { registerPageIpc, type PlaybackState } from './ipc/pageIpc';
import { registerWaveIpc } from './ipc/waveIpc';
import { createRadarScheduler, registerRadarIpc } from './ipc/radarIpc';
import { registerLibraryIpc } from './ipc/libraryIpc';
import { registerBackupIpc } from './ipc/backupIpc';
import { registerSettingsIpc } from './ipc/settingsIpc';
import { registerAccountsIpc, type PendingChanges } from './ipc/accountsIpc';
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
    Notification,
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
import path from 'path';
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

// Global variables
let mainWindow: BrowserWindow;
let notificationManager: NotificationManager;
let settingsManager: SettingsManager;
let proxyService: ProxyService;
let adblockService: AdblockService;
// Ждёт «Применить»: сеть и перезагрузка страницы (язык сайта встаёт только при загрузке)
const pending: PendingChanges = { network: false, reload: false };
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
guardGpuStartup(gpuInProcess, running => store.set('gpuCompatibilityRunning', running));
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
// Шаг 100 мс: при 20 мс замер будил главный процесс 50 раз в секунду всю жизнь клиента
const loopDelay = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
let lastMetricsAt = 0;

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
// История лежит поверх сайта как ещё одна страница: «Назад» сначала закрывает её, а сайт остаётся где был
function navigateBack(): void {
    if (historyManager?.isOpen()) {
        historyManager.hide();
        return;
    }
    if (contentView && contentView.webContents.navigationHistory.canGoBack()) contentView.webContents.navigationHistory.goBack();
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
    settingsManager?.getView()?.webContents.send('presence-preview-update', { track: playback.info, ...presenceService.preview() });
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

// Последний трек со страницы, «музыка в этом запуске уже звучала» и счётчики журнала: пишет обработчик страницы
const playback: PlaybackState = {
    info: {
        title: '',
        author: '',
        artwork: '',
        elapsed: '',
        duration: '',
        isPlaying: false,
        isLiked: false,
        url: '',
        artistUrl: '',
    },
    playedThisRun: false,
    updates: 0,
    changes: 0,
    lastUpdateAt: Date.now(),
    lastProgressAt: Date.now(),
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

    registerWindowIpc(ipcMain, {
        trustedLocal: isTrustedLocalSender,
        store,
        window: () => mainWindow ?? null,
        page: () => contentView?.webContents ?? null,
        header: () => headerView?.webContents ?? null,
        navigateBack,
        headerTexts,
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
        if (updateScreenDismissed || Date.now() - launchedAt > UPDATE_SCREEN_WINDOW_MS || playback.info.isPlaying) return;
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
        const shown = !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized();
        if (!metricsDue(Date.now(), lastMetricsAt, !playback.info.isPlaying && !shown)) return;
        lastMetricsAt = Date.now();
        const metrics = app.getAppMetrics();
        diagnostics.record('performance', {
            uptimeSeconds: process.uptime(), processes: metrics.length,
            cpuPercent: metrics.reduce((sum, item) => sum + item.cpu.percentCPUUsage, 0),
            workingSetMiB: metrics.reduce((sum, item) => sum + item.memory.workingSetSize, 0) / 1024,
            privateMiB: metrics.reduce((sum, item) => sum + (item.memory.privateBytes ?? 0), 0) / 1024,
            ...loopDelayStats(loopDelay),
            updates: playback.updates, trackChanges: playback.changes, sinceUpdateMs: Date.now() - playback.lastUpdateAt,
            sinceProgressMs: Date.now() - playback.lastProgressAt, playing: playback.info.isPlaying,
            hasTrack: !!playback.info.title, windowVisible: !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible(),
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
        diagnostics.record('page.soft-navigation', { playing: playback.info.isPlaying });
        const fullLoad = (): void => {
            if (!contents.isDestroyed()) contents.loadURL(url).catch((error: unknown) => console.warn('Страница сайта не открыта:', error));
        };
        // Зависшая страница не ответит никогда: без предела клик по ссылке ничего бы не делал
        withTimeout(contents.executeJavaScript('window.__scNavigate ? window.__scNavigate(' + JSON.stringify(pagePath) + ') : false') as Promise<unknown>, 3000, 'переход внутри сайта')
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
    registerUpdateIpc(ipcMain, {
        trustedLocal: isTrustedLocalSender,
        updates: () => updateService,
        screenOwns: (sender) => updateScreen?.owns(sender) === true,
        later: () => {
            updateScreenDismissed = true;
            closeUpdateScreen();
        },
        openExternal: (url) => shell.openExternal(url),
        openPath: (folder) => shell.openPath(folder),
        dataFolder: () => app.getPath('userData'),
    });
    updateService.start();
    shortcutService = new ShortcutService(mainWindow);
    shortcutService.attachToWebContents(contentView.webContents);
    shortcutService.attachToWebContents(headerView.webContents);
    playbackController = new PlaybackController(contentView.webContents);
    registerPageIpc(ipcMain, {
        trustedSite: isTrustedSoundCloudSender,
        store,
        diagnostics,
        playback,
        devMode,
        page: () => contentView.webContents,
        controller: () => playbackController,
        siteDictionary: getSiteDictionary,
        hiddenBlocksCss: hiddenBlocksCSS,
        settings: () => settingsManager,
        history: () => historyManager,
        presence: () => presenceService,
        webhooks: () => webhookService,
        previewPresence: sendPresencePreview,
        updateThumbar: (playing, liked) => {
            if (thumbarService) thumbarService.updateThumbarButtons(mainWindow, playing, liked);
        },
    });
    waveJournal?.flush();
    waveJournal = new WaveJournal(path.join(app.getPath('userData'), 'wave'));
    // Журнал сигналов: как слушается каждый трек, из него потом учится подбор
    waveSignals?.flush();
    waveSignals = new WaveSignals(path.join(app.getPath('userData'), 'wave'), 3000, (from, to) => awayTracker.away(from, to));
    // Отметки волны («Не нравится», скрытые артисты, «Не сейчас», «Больше такого»): ставит страница, снимает и F1
    const exclusions = new WaveExclusions(path.join(app.getPath('userData'), 'wave'));
    waveExclusions = exclusions;
    // История прослушиваний: индекс поверх журнала сигналов, страница поверх сайта до его плеера
    historyManager?.dispose();
    // Перед чтением журнала и копией профиля буферы главного процесса ложатся на диск
    const library = new LibraryService(path.join(app.getPath('userData'), 'wave'), () => {
        waveSignals?.flush();
        waveJournal?.flush();
    });
    listeningLibrary = library;
    // Подборки дня: снимок собирает страница, main хранит его до полуночи и подсказывает, что звучало за 30 дней
    const shelf = new WaveShelf(path.join(app.getPath('userData'), 'wave'));
    registerWaveIpc(ipcMain, {
        trustedSite: isTrustedSoundCloudSender,
        trustedLocal: isTrustedLocalSender,
        store,
        diagnostics,
        journal: () => waveJournal,
        signals: () => waveSignals,
        exclusions,
        library,
        shelf,
        settingsView: () => settingsManager?.getView()?.webContents,
        page: () => contentView.webContents,
        applySettingChange,
    });
    // Пятничный радар: расписание здесь, сбор каталога на странице сайта, выпуск считает и пишет worker
    radarScheduler?.stop();
    const radarPage = async (script: string): Promise<unknown> =>
        contentView && !contentView.webContents.isDestroyed() ? contentView.webContents.executeJavaScript(script) as Promise<unknown> : null;
    radarScheduler = createRadarScheduler({ store, library, online: () => net.isOnline(), page: radarPage });
    radarScheduler.start();
    registerRadarIpc(ipcMain, { trustedSite: isTrustedSoundCloudSender, store, library, scheduler: () => radarScheduler });
    registerLibraryIpc(ipcMain, { trustedSite: isTrustedSoundCloudSender, library });
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


    registerSettingsIpc(ipcMain, {
        trustedLocal: isTrustedLocalSender,
        settings: () => settingsManager,
        history: () => historyManager,
        page: () => contentView.webContents,
        toggleHistory,
        openExternal: (url) => shell.openExternal(url),
        saveDialog: (options) => dialog.showSaveDialog(mainWindow, options),
        downloadsFolder: () => app.getPath('downloads'),
        diagnostics,
        translate: (key) => translationService.translate(key),
        applySettingChange,
        playback,
        presence: () => presenceService,
    });

    setupWindowControls();

    initializeShortcuts();

    applyThemeToContent();

    // Резервная копия профиля: файл пишет и читает worker, диалоги и отметки ведёт backupIpc
    const backup = registerBackupIpc(ipcMain, {
        trustedLocal: isTrustedLocalSender,
        store,
        diagnostics,
        library,
        exclusions,
        journal: () => waveJournal,
        signals: () => waveSignals,
        history: () => historyManager,
        settingsView: () => settingsManager?.getView()?.webContents,
        page: () => contentView?.webContents ?? null,
        ask: radarPage,
        translate: (key) => translationService.translate(key),
        dialogs: {
            save: (options) => dialog.showSaveDialog(mainWindow, options),
            open: (options) => dialog.showOpenDialog(mainWindow, options),
        },
        documentsFolder: () => app.getPath('documents'),
        profilePath,
        about: { version: app.getVersion(), build: String(buildInfo.build ?? '') },
        applySettingChange,
        reloadNeeded: () => pending.reload || pending.network,
    });
    clearTimeout(autoBackupTimer);
    autoBackupTimer = setTimeout(() => void backup.runAutoBackup().catch((error: unknown) => console.warn('Автокопия не выполнена', error)), AUTO_BACKUP_DELAY);
    autoBackupTimer.unref();


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
            playback.info = { title: '', author: '', artwork: '', elapsed: '', duration: '', isPlaying: false, isLiked: false, url: '', artistUrl: '' };
        },
        onRepeatedCrash: () => queueToastNotification(translationService.translate('playerCrashed')),
        online: () => net.isOnline(),
        // Окно в трее: сообщение внутри окна никто не увидит, поэтому одно системное уведомление
        onGaveUp: () => {
            const text = translationService.translate('pageGaveUp');
            queueToastNotification(text);
            const hidden = !mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || mainWindow.isMinimized();
            if (hidden && Notification.isSupported()) new Notification({ title: appTitle, body: text }).show();
        },
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
        // Новая страница проверит сайт заново через минуту: прежняя отметка в F1 могла устареть
        settingsManager?.setSiteState(null);

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
            await contentView.webContents.executeJavaScript(waveScript(playback.playedThisRun));
            await contentView.webContents.executeJavaScript(playerAreaScript());

            if (presenceService) {
                await presenceService.updatePresence(playback.info);
            }
        } catch (error) {
            console.error('Failed to reinitialize after page load:', error);
        }
    }

    // Смена из F1 и восстановление копии: запись в настройки и то, что должно поменяться сразу
    function applySettingChange(data: SettingChange): void {
        const key = data.key;
        if (key === 'proxyPassword') {
            try { proxyService.setPassword(data.value); pending.network = true; } catch (error) { queueToastNotification(String(error)); }
            return;
        }
        store.set(key, data.value);
        if (key.startsWith('proxy') || key === 'adBlocker') pending.network = true;
        // Новое расписание может сделать выпуск уже наступившим; повтор недели отсекает хранилище
        if (key === 'radarDay' || key === 'radarTime' || key === 'radarZone') radarScheduler?.wake(5000);
        if (key === 'siteLanguage') {
            pending.reload = true;
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
            if (data.value === true) void presenceService.updatePresence(playback.info).catch(console.error);
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

    registerAccountsIpc(ipcMain, {
        trustedLocal: isTrustedLocalSender,
        trustedSite: isTrustedSoundCloudSender,
        store,
        app,
        page: () => contentView?.webContents ?? null,
        proxy: () => proxyService,
        adblock: () => adblockService,
        presence: () => presenceService,
        playback,
        pending,
        toast: queueToastNotification,
        settingsView: () => settingsManager?.getView()?.webContents,
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

    shortcutService.register('goBack', 'CommandOrControl+B', 'Go Back', navigateBack);

    shortcutService.register('goBackAlt', 'CommandOrControl+P', 'Go Back (Alternative)', navigateBack);

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
    // Страница ищет трек у сайта сама, с пределом 15 с на запрос; зависшая страница без предела держала бы ссылку вечно.
    // Истёкший предел не повторяется: трек мог уже начать играть
    withTimeout(view.webContents.executeJavaScript(script, true) as Promise<unknown>, 30000, 'ссылка на трек').then(
        (done) => { if (done === 'not-ready') retry(); else if (done === 'failed' || done === 'unavailable') queueToastNotification(translationService.translate('pageLoadFailed')); },
        (error: unknown) => {
            console.warn('Ссылка на трек не открыта:', error);
            if (!(error instanceof TimeoutError)) retry();
        },
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
