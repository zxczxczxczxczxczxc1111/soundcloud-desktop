// Окно и шапка: свернуть, развернуть, закрыть, «Назад», «Вперёд», обновление страницы, подсказки и настройки шапки
import type { BrowserWindow } from 'electron';
import type { IpcRegistry, MessageTarget, SenderCheck, Settings } from './ipcTypes';

export interface WindowIpcDeps {
    trustedLocal: SenderCheck;
    store: Settings;
    window(): Pick<BrowserWindow, 'hide' | 'minimize' | 'maximize' | 'unmaximize' | 'isMaximized' | 'close'> | null;
    /** Страница сайта; до создания окна её нет */
    page(): { reload(): void; stop(): void; navigationHistory: { canGoForward(): boolean; goForward(): void } } | null;
    header(): MessageTarget | null;
    navigateBack(): void;
    headerTexts(): Record<string, string>;
}

export function registerWindowIpc(ipc: IpcRegistry, deps: WindowIpcDeps): void {
    const { trustedLocal: isTrustedLocalSender, store } = deps;
    ipc.on('minimize-window', (event) => {
        if (!isTrustedLocalSender(event)) return;
        const mainWindow = deps.window();
        if (!mainWindow) return;
        const minimizeToTray = store.get('minimizeToTray', true);
        if (minimizeToTray) {
            mainWindow.hide();
        } else {
            mainWindow.minimize();
        }
    });

    ipc.on('maximize-window', (event) => {
        if (!isTrustedLocalSender(event)) return;
        const mainWindow = deps.window();
        if (mainWindow) {
            if (mainWindow.isMaximized()) {
                mainWindow.unmaximize();
            } else {
                mainWindow.maximize();
            }
        }
    });

    ipc.on('title-bar-double-click', (event) => {
        if (!isTrustedLocalSender(event)) return;
        const mainWindow = deps.window();
        if (mainWindow) {
            if (mainWindow.isMaximized()) {
                mainWindow.unmaximize();
            } else {
                mainWindow.maximize();
            }
        }
    });

    ipc.on('close-window', (event) => {
        if (!isTrustedLocalSender(event)) return;
        const mainWindow = deps.window();
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
    ipc.on('navigate-back', (event) => {
        if (!isTrustedLocalSender(event)) return;
        deps.navigateBack();
    });

    ipc.on('navigate-forward', (event) => {
        if (!isTrustedLocalSender(event)) return;
        const page = deps.page();
        if (page && page.navigationHistory.canGoForward()) {
            page.navigationHistory.goForward();
        }
    });

    ipc.on('refresh-page', (event) => {
        if (!isTrustedLocalSender(event)) return;
        const page = deps.page();
        if (page) {
            deps.header()?.send('refresh-state-changed', true);
            console.log('Manual refresh triggered - reloading page');
            page.reload();
        }
    });

    ipc.on('cancel-refresh', (event) => {
        if (!isTrustedLocalSender(event)) return;
        const page = deps.page();
        if (page) {
            page.stop();
            deps.header()?.send('refresh-state-changed', false);
        }
    });

    // Подсказки кнопок шапки на языке приложения
    ipc.handle('get-header-texts', (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        return deps.headerTexts();
    });

    // Handle is-maximized requests
    ipc.handle('is-maximized', (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        const mainWindow = deps.window();
        return mainWindow ? mainWindow.isMaximized() : false;
    });

    // Handle minimize to tray setting
    ipc.handle('get-minimize-to-tray', (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        return store.get('minimizeToTray', true);
    });

    // handle nav controls enabled setting
    ipc.handle('get-navigation-controls-enabled', (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        return store.get('navigationControlsEnabled', false);
    });
}
