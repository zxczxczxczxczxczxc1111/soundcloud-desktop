import { isTrustedLocalSender, trustLocalView } from '../trustedViews';
import { randomBytes } from 'crypto';
import { WebContentsView, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';

const isMac = process.platform === 'darwin';

export class NotificationManager {
    private view: WebContentsView | null = null;
    private queue: string[] = [];
    private isDisplaying = false;
    private parentWindow: BrowserWindow;
    private devMode = process.argv.includes('--dev');
    private disposed = false;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private done = (event: Electron.IpcMainEvent): void => {
        if (event.sender !== this.view?.webContents || !isTrustedLocalSender(event)) return;
        this.finish();
    };
    private finish(): void {
        if (this.disposed) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.teardownView();
        this.displayNext();
    }
    public dispose(): void {
        this.disposed = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.queue = [];
        this.teardownView();
        ipcMain.removeListener('notification-done', this.done);
    }

    constructor(parentWindow: BrowserWindow, private returnFocus: () => void = () => undefined) {
        this.parentWindow = parentWindow;
        ipcMain.on('notification-done', this.done);
        parentWindow.once('closed', () => this.dispose());
    }

    private ensureView(): WebContentsView {
        if (this.view) return this.view;
        this.view = new WebContentsView({
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                webSecurity: true,
                allowRunningInsecureContent: false,
                nodeIntegrationInSubFrames: false,
                nodeIntegrationInWorker: false,
                preload: join(__dirname, 'notificationPreload.js'),
                devTools: this.devMode,
                ...(isMac ? { spellcheck: false } : {}),
            },
        });
        this.view.setBackgroundColor('#00000000');
        // Уведомление только показывается: фокус, который оно получает при загрузке, сразу уходит обратно
        this.view.webContents.on('focus', () => {
            setTimeout(() => {
                if (!this.disposed) this.returnFocus();
            }, 0);
        });
        return this.view;
    }

    private teardownView(): void {
        const view = this.view;
        this.view = null;
        if (!view) return;
        if (!this.parentWindow.isDestroyed()) this.parentWindow.contentView.removeChildView(view);
        if (!view.webContents.isDestroyed()) view.webContents.close();
    }

    public show(message: string): void {
        if (this.disposed) return;
        this.queue.push(message);
        if (!this.isDisplaying) {
            this.displayNext();
        }
    }

    private displayNext(): void {
        if (this.disposed || this.parentWindow.isDestroyed()) return;
        if (this.queue.length === 0) {
            this.isDisplaying = false;
            this.teardownView();
            return;
        }

        this.isDisplaying = true;
        const message = this.queue.shift();
        const bounds = this.parentWindow.getBounds();
        const width = 400; // increased from 300
        const height = 70; // increased from 50

        const view = this.ensureView();
        this.parentWindow.contentView.addChildView(view);
        view.setBounds({
            x: Math.floor((bounds.width - width) / 2),
            y: bounds.height - height - 100, // increased from 20 to move it up
            width,
            height,
        });

        const backgroundColor = '#303030';
        const textColor = '#ffffff';

        const safeMessage = String(message ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
        const nonce = randomBytes(16).toString('base64');
        const html = `
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
        <style>
            body {
                margin: 0;
                display: flex;
                justify-content: center;
                align-items: center;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background-color: transparent;
                color: ${textColor};
                height: 100vh;
                opacity: 0;
                transition: opacity 0.3s ease-in-out;
                overflow: hidden;
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
            }
            .notification {
                padding: 15px 25px;
                border-radius: 12px;
                font-size: 18px;
                font-weight: 600;
                text-align: center;
                transform: translateY(0);
                transition: transform 0.3s ease-in-out;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 90%;
                user-select: none;
                -webkit-user-select: none;
                background: ${backgroundColor};
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            }
            body.fade-out .notification {
                transform: translateY(10px);
            }
        </style>
        <body>
            <div class="notification">${safeMessage}</div>
            <script nonce="${nonce}">
                setTimeout(() => document.body.style.opacity = '1', 100);
                setTimeout(() => {
                    document.body.classList.add('fade-out');
                    document.body.style.opacity = '0';
                    setTimeout(() => {
                        window.notificationAPI.done();
                    }, 300);
                }, 4500);
            </script>
        </body>`;

        const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
        trustLocalView(view.webContents, url);
        this.timer = setTimeout(() => this.finish(), 7000);
        void view.webContents.loadURL(url).catch((error: unknown) => { if (this.view === view) { console.error('Ошибка уведомления:', error); this.finish(); } });
    }
}
