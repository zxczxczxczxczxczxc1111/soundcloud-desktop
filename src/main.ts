import { DiagnosticJournal } from './services/diagnosticJournal';
import { monitorEventLoopDelay } from 'perf_hooks';
import { installRendererRecovery } from './services/rendererRecovery';
import { mediaControlsScript } from './services/mediaControls';
import { protectContent } from './contentPolicy';
import { validateSettingChange } from './settings/validateSetting';
import { applyPreferenceMigrations } from './settings/preferenceMigrations';
import { isTrustedLocalSender, trustLocalFile } from './trustedViews';
import { PlaybackController } from './services/playbackController';
import { AdblockService } from './services/adblockService';
import { ViewStyles, splitThemeCSS } from './services/viewStyles';
import { pageFeaturesScript } from './services/pageFeatures';
import { fullShuffleScript } from './services/fullShuffle';
import { shouldRunGpuInProcess } from './services/gpuProcessMode';
import { tintIcon } from './services/devIcon';
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
    type IpcMainEvent,
    type NativeImage,
} from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { setupDarwinMenu } from './macos/menu';
import { NotificationManager } from './notifications/notificationManager';
import { SettingsManager } from './settings/settingsManager';
import { ProxyService } from './services/proxyService';
import { PresenceService } from './services/presenceService';
import { TranslationService } from './services/translationService';
import { ThumbarService } from './services/thumbarService';
import { WebhookService } from './services/webhookService';
import { UpdateService, type UpdateMode } from './services/updateService';
import { autoUpdater } from 'electron-updater';
import { ThemeService } from './services/themeService';
import { ShortcutService } from './services/shortcutService';
import { PluginService } from './services/pluginService';
import { audioMonitorScript } from './services/audioMonitorService';
import { showHomepageConfirmDialog, updateDialogBounds } from './settings/confirmPopup';
import type { TrackInfo } from './types';
import { validateTrackUpdatePayload } from './validation';
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
        theme: 'dark',
        minimizeToTray: false,
        navigationControlsEnabled: false,
        trackParserEnabled: true,
        richPresencePreviewEnabled: false,
        autoUpdateEnabled: true,
        hidePromotions: true,
        hideEventsNearYou: true,
        hideArtistUpsells: true,
        fullShuffle: true,
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

let isDarkTheme = store.get('theme') !== 'light';

// Global variables
let mainWindow: BrowserWindow;
let notificationManager: NotificationManager;
let settingsManager: SettingsManager;
let proxyService: ProxyService;
let adblockService: AdblockService;
let networkSettingsDirty = false;
let presenceService: PresenceService;
let webhookService: WebhookService;
let updateService: UpdateService | null = null;
let translationService: TranslationService;
let thumbarService: ThumbarService;
let playbackController: PlaybackController;
let themeService: ThemeService;
let shortcutService: ShortcutService;
let pluginService: PluginService;
let tray: Tray | null = null;
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
if (shouldRunGpuInProcess(process.platform, process.env, process.argv)) {
    app.commandLine.appendSwitch('in-process-gpu');
    // С DirectComposition GPU в главном процессе показывает пустое окно
    app.commandLine.appendSwitch('disable-direct-composition');
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

// tray setup
// Запасной выход из трея: тема с @target all или settings может спрятать саму панель настроек
function resetThemeAndPlugins(): void {
    if (!themeService || !pluginService) return;
    themeService.removeCustomTheme();
    for (const plugin of pluginService.getPlugins()) if (plugin.enabled) pluginService.setPluginEnabled(plugin.id, false);
    if (settingsManager?.getView()) settingsManager.toggle();
    showMainWindow();
    notificationManager?.show('Тема и плагины отключены');
}

// prevent rendering engine deadlocks when waking hidden/minimized windows from tray
function showMainWindow(): void {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
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

    // create tray menu
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'SoundCloud',
            click: () => showMainWindow(),
        },
        {
            label: 'Настройки',
            // Из трея настройки только открываются: окно могло быть спрятано, а панель уже открыта
            click: () => {
                showMainWindow();
                if (settingsManager && !settingsManager.getView()) settingsManager.toggle();
            },
        },
        {
            label: 'Сбросить тему и плагины',
            click: () => resetThemeAndPlugins(),
        },
        { type: 'separator' },
        {
            label: 'Выход',
            click: () => {
                app.quit();
            },
        },
    ]);

    tray.setContextMenu(contextMenu);

    tray.on('click', () => showMainWindow());
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
        backgroundColor: isDarkTheme ? '#121212' : '#ffffff',
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

function isTrustedSoundCloudSender(event: IpcMainEvent): boolean {
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

    updateDialogBounds(mainWindow);
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

    ipcMain.on('toggle-theme', (event) => {
            if (!isTrustedLocalSender(event)) return;

        isDarkTheme = !isDarkTheme;
        if (headerView && headerView.webContents) {
            headerView.webContents.send('theme-changed', isDarkTheme);
        }
        applyThemeToContent(isDarkTheme);
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

// Main initialization
async function init() {
    loopDelay.enable();
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
    powerMonitor.on('resume', () => diagnostics.record('system.resume'));

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
    contentView.setBounds({
        x: 0,
        y: 32,
        width: mainWindow.getBounds().width,
        height: mainWindow.getBounds().height - 32,
    });
    contentView.setAutoResize({ width: true, height: true });

    protectContent(contentView.webContents, (url) => shell.openExternal(url));
    contentView.webContents.setUserAgent(globalUserAgent);

    // Initialize services
    translationService = new TranslationService();
    themeService = new ThemeService(store);
    pluginService = new PluginService(store);
    pluginService.setContentView(contentView);
    // hot reload custom theme CSS when files change
    themeService.onCustomThemeUpdated(() => {
        applyThemeToContent(isDarkTheme);
    });
    notificationManager = new NotificationManager(mainWindow);
    settingsManager = new SettingsManager(mainWindow, store, () => {
        if (!contentView.webContents.isDestroyed()) contentView.webContents.focus();
    });
    pluginService.onPluginsChanged(() => settingsManager.getView()?.webContents.send('plugins-changed'));
    proxyService = new ProxyService(contentView.webContents, store, queueToastNotification);
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
    if (platform() === 'win32') {
        thumbarService = new ThumbarService(translationService, RESOURCES_PATH, playbackController);
        mainWindow.on('show', () => thumbarService.restore(mainWindow));
    }


    // Add settings toggle handler
    ipcMain.on('toggle-settings', (event) => {
            if (!isTrustedLocalSender(event)) return;

        settingsManager.toggle();
        applyThemeToContent(isDarkTheme);
    });

    ipcMain.handle('confirm-open-homepage', async (_event, url: string) => {
            if (!isTrustedLocalSender(_event)) throw new Error('Недопустимый отправитель IPC');

        if (!url || typeof url !== 'string') return false;
        const normalizedUrl = url.trim();
        if (!/^https?:\/\//i.test(normalizedUrl)) return false;

        const confirmed = await showHomepageConfirmDialog(mainWindow, normalizedUrl);
        if (confirmed) {
            await shell.openExternal(normalizedUrl);
        }

        return confirmed;
    });

    ipcMain.on('show-plugin-homepage-dialog', async (_event, url: string) => {
            if (!isTrustedLocalSender(_event)) return;

        if (!url || typeof url !== 'string') return;
        const normalizedUrl = url.trim();
        if (!/^https?:\/\//i.test(normalizedUrl)) return;

        const confirmed = await showHomepageConfirmDialog(mainWindow, normalizedUrl);
        if (confirmed) {
            await shell.openExternal(normalizedUrl);
        }
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

    ipcMain.handle('open-path', async (_event, targetPath: string) => {
            if (!isTrustedLocalSender(_event)) throw new Error('Недопустимый отправитель IPC');

        if (!targetPath || typeof targetPath !== 'string') return 'Invalid path';
        const allowedPaths = [themeService.getThemesPath(), pluginService.getPluginsPath()].map((allowedPath) =>
            path.resolve(allowedPath),
        );
        const normalizedPath = path.resolve(targetPath);
        if (!allowedPaths.includes(normalizedPath)) return 'Blocked path';

        return shell.openPath(targetPath);
    });

    setupWindowControls();

    initializeShortcuts();

    setupThemeHandlers();
    ipcMain.handle('export-diagnostics', async (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        const result = await dialog.showSaveDialog(mainWindow, {
            title: 'Сохранить диагностический журнал',
            defaultPath: path.join(app.getPath('downloads'), 'soundcloud-diagnostics-' + new Date().toISOString().slice(0, 10) + '.log'),
            filters: [{ name: 'Журнал', extensions: ['log'] }],
        });
        if (result.canceled || !result.filePath) return false;
        try { diagnostics.exportTo(result.filePath); return true; }
        catch (error) { console.error('Не удалось сохранить журнал:', error); throw new Error('Не удалось сохранить журнал'); }
    });
    setupTranslationHandlers();
    setupAudioHandler();

    // Provide current track info to settings preview on demand
    ipcMain.handle('get-current-track', (event) => {
            if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');

        return lastTrackInfo;
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
        if (isMainFrame && code !== -3) queueToastNotification('Не удалось загрузить SoundCloud. Проверьте подключение и нажмите Ctrl+R.');
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
        onRepeatedCrash: () => queueToastNotification('Плеер завершился с ошибкой. Нажмите Ctrl+R для повторной загрузки.'),
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
            applyThemeToContent(isDarkTheme);

            // Inject audio monitoring script
            await contentView.webContents.executeJavaScript(audioMonitorScript);
            await contentView.webContents.executeJavaScript(fullShuffleScript(store.get('fullShuffle', true) === true));

            // Re-inject all enabled plugin content scripts
            if (pluginService) {
                pluginService.injectAllContentScripts();
            }

            if (presenceService) {
                await presenceService.updatePresence(lastTrackInfo);
            }
        } catch (error) {
            console.error('Failed to reinitialize after page load:', error);
        }
    }

    // Register settings related events
    ipcMain.on('setting-changed', async (_event, data) => {
            if (!isTrustedLocalSender(_event)) return;
            if (!validateSettingChange(data)) return;

        const key = data.key;
        if (key === 'proxyPassword') {
            try { proxyService.setPassword(data.value); networkSettingsDirty = true; } catch (error) { queueToastNotification(String(error)); }
            return;
        }
        store.set(key, data.value);
        if (key.startsWith('proxy') || key === 'adBlocker') networkSettingsDirty = true;

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
        } else if (key === 'minimizeToTray') {
            // Update tray behavior when setting changes
            if (data.value === false && tray) {
                // If minimize to tray is disabled, destroy the tray
                tray.destroy();
                tray = null;
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
        } else if (key === 'customTheme') {
            if (data.value === 'none') {
                themeService.removeCustomTheme();
            } else {
                themeService.applyCustomTheme(data.value);
            }
            // Re-apply the theme to all content
            applyThemeToContent(isDarkTheme);
        } else if (key === 'hidePromotions' || key === 'hideEventsNearYou' || key === 'hideArtistUpsells') {
            applyThemeToContent(isDarkTheme);
        } else if (key === 'fullShuffle') {
            void contentView.webContents.executeJavaScript(fullShuffleScript(data.value === true)).catch(console.error);
        }
    });

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

}



function setupThemeHandlers() {
    // load initial theme from store
    isDarkTheme = store.get('theme', 'dark') === 'dark';

    // send initial theme to all views
    if (headerView && headerView.webContents) {
        headerView.webContents.send('theme-changed', isDarkTheme);
    }
    if (settingsManager) {
        settingsManager.getView()?.webContents.send('theme-changed', isDarkTheme);
    }
    applyThemeToContent(isDarkTheme);

    // Listen for theme changes from settings or header
    ipcMain.on('setting-changed', (_, data) => {
            if (!isTrustedLocalSender(_)) return;
            if (!validateSettingChange(data)) return;

        if (data.key === 'theme') {
            isDarkTheme = data.value === 'dark';
            store.set('theme', data.value);

            if (pluginService) {
                pluginService.notifyThemeChange(isDarkTheme);
            }

            // Update all views
            if (headerView && headerView.webContents) {
                headerView.webContents.send('theme-changed', isDarkTheme);
            }
            if (settingsManager) {
                settingsManager.getView()?.webContents.send('theme-changed', isDarkTheme);
            }
            applyThemeToContent(isDarkTheme);
        }
    });
}

const viewStyles = new ViewStyles();
function applyThemeToContent(isDark: boolean) {
    if (!contentView || contentView.webContents.isDestroyed()) return;
    const sections = splitThemeCSS(themeService.getCurrentCustomThemeCSS());
    const themeColors = themeService.getCurrentThemeColors();
    notificationManager?.setThemeColors(themeColors);
    settingsManager?.setThemeColors(themeColors);
    headerView?.webContents.send('theme-colors-changed', themeColors);
    const css = [
        ':root{--background-base:' + (isDark ? '#121212' : '#ffffff') + ';--background-surface:' + (isDark ? '#212121' : '#f2f2f2') + ';--text-base:' + (isDark ? '#ffffff' : '#333333') + ';}',
        // Стандартные свойства: ::-webkit-scrollbar рисуется главным потоком и отстаёт от прокрутки.
        'html{scrollbar-width:thin;scrollbar-color:' + (isDark ? 'rgba(255,255,255,.2) rgba(255,255,255,.05)' : 'rgba(0,0,0,.2) rgba(0,0,0,.05)') + '}',
        store.get('hidePromotions', true) ? '.banner.m-promotion{display:none!important}' : '',
        store.get('hideEventsNearYou', true) ? '.velvetCakeModule{display:none!important}' : '',
        store.get('hideArtistUpsells', true) ? '.creatorSubscriptionsButton.header__creatorUpsell,.artistConnectItem.m-upsellNextPro,.dropdownMenu [href*="checkout.soundcloud.com"],.spotlight:has(.spotlight__upsellBanner),.spotlight__upsellBanner,.spotlight__upsellCTA,.sidebarContent:has(.velvetCakeIframe),.artistConnectContainer .tileGallery__sliderPeekForward,.artistConnectContainer .tileGallery__sliderPeekBackward,.MuiBox-root:has(a[href*="getstarted/fan-support"]){display:none!important}' : '',
        sections.all, sections.content,
    ].join('\n');
    void viewStyles.apply(contentView.webContents, css).catch(console.error);
    void contentView.webContents.executeJavaScript('document.documentElement.classList.toggle("theme-light",' + JSON.stringify(!isDark) + ');document.documentElement.classList.toggle("theme-dark",' + JSON.stringify(isDark) + ');document.body.classList.toggle("theme-light",' + JSON.stringify(!isDark) + ');document.body.classList.toggle("theme-dark",' + JSON.stringify(isDark) + ');').catch(console.error);
    void contentView.webContents.executeJavaScript(pageFeaturesScript(store.get('hideArtistUpsells', true) === true)).catch(console.error);
    if (headerView) void viewStyles.apply(headerView.webContents, sections.all + '\n' + sections.header).catch(console.error);
    settingsManager?.setCustomCSS(sections.all + '\n' + sections.settings);
}

function initializeShortcuts() {
    if (!mainWindow || !contentView || !settingsManager) return;

    shortcutService.register('openSettings', 'F1', 'Open Settings', () => settingsManager.toggle());

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

app.on('before-quit', () => {
    clearInterval(diagnosticTimer);
    isQuitting = true;
    if (presenceService) void presenceService.dispose();
    proxyService?.dispose();
    adblockService?.dispose();
    webhookService?.dispose();
    updateService?.dispose();
    pluginService?.dispose();
    themeService?.dispose();
    settingsManager?.dispose();
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
    clearInterval(diagnosticTimer);
    loopDelay.disable();
    diagnostics.close();
    if (tray) {
        tray.destroy();
        tray = null;
    }
});

// focus window when second instance opened
app.on('second-instance', () => {
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
            darkMode: translationService.translate('darkMode'),
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
            customThemes: translationService.translate('customThemes'),
            selectCustomTheme: translationService.translate('selectCustomTheme'),
            noTheme: translationService.translate('noTheme'),
            openThemesFolder: translationService.translate('openThemesFolder'),
            refreshThemes: translationService.translate('refreshThemes'),
            customThemeDescription: translationService.translate('customThemeDescription'),
            plugins: translationService.translate('plugins'),
            openPluginsFolder: translationService.translate('openPluginsFolder'),
            refreshPlugins: translationService.translate('refreshPlugins'),
            pluginsDescription: translationService.translate('pluginsDescription'),
            noPluginsFound: translationService.translate('noPluginsFound'),
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

        if (pluginService) {
            pluginService.notifyTrackChange(result as unknown as Record<string, unknown>);
        }

        void webhookService.updateTrackInfo(result, result.isPlaying, reason).catch(console.error);
        void presenceService.updatePresence(result).catch(console.error);

        // update rich presence preview in settings
        if (settingsManager) {
            settingsManager.getView()?.webContents.send('presence-preview-update', result);
        }

        if (thumbarService) {
            thumbarService.updateThumbarButtons(mainWindow, result.isPlaying, result.isLiked);
        }
    });
}
