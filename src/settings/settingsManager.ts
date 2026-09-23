import { trustLocalFile } from '../trustedViews';
import { ViewStyles } from '../services/viewStyles';
import { WebContentsView, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type ElectronStore from 'electron-store';
import type { ThemeColors } from '../utils/colorExtractor';
import { join } from 'path';

const defaults: Record<string, string | number | boolean> = {
    theme: 'dark',
    minimizeToTray: false,
    navigationControlsEnabled: false,
    trackParserEnabled: true,
    hidePromotions: true,
    hideEventsNearYou: true,
    hideArtistUpsells: true,
    adBlocker: false,
    proxyEnabled: false,
    proxyHost: '',
    proxyPort: '',
    proxyUsername: '',
    webhookEnabled: false,
    webhookUrl: '',
    webhookTriggerPercentage: 50,
    discordRichPresence: true,
    displayWhenIdling: false,
    displaySCSmallIcon: false,
    displayButtons: false,
    statusDisplayType: 1,
    richPresencePreviewEnabled: false,
};

export class SettingsManager {
    private view: WebContentsView | null = null;
    private colors: ThemeColors | null = null;
    private customCSS = '';
    private styles = new ViewStyles();
    private disposed = false;
    private resize = (): void => this.updateBounds();
    private ready = (event: IpcMainInvokeEvent): void => {
        if (!this.owns(event)) return;
        void this.applyStyles();
        this.view?.webContents.send('update-translations');
        void this.view?.webContents.executeJavaScript("document.body.classList.add('visible')").catch(console.error);
    };

    constructor(
        private parentWindow: BrowserWindow,
        private store: ElectronStore,
    ) {
        this.parentWindow.on('resize', this.resize);
        this.parentWindow.once('closed', () => this.dispose());
        ipcMain.handle('get-settings-state', (event) => {
            if (!this.owns(event)) throw new Error('Недопустимый отправитель настроек');
            return Object.fromEntries(
                Object.entries(defaults).map(([key, fallback]) => [key, this.store.get(key, fallback)]),
            );
        });
        ipcMain.on('settings-ready', this.ready);
    }
    private owns(event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>): boolean {
        return (
            this.view !== null && event.sender === this.view.webContents && event.senderFrame === event.sender.mainFrame
        );
    }
    public toggle(): void {
        if (this.disposed) return;
        if (this.view) {
            this.teardownView();
            return;
        }
        this.view = new WebContentsView({
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                webSecurity: true,
                preload: join(__dirname, 'settingsPreload.js'),
                devTools: process.argv.includes('--dev'),
                spellcheck: false,
            },
        });
        this.view.setBackgroundColor('#00000000');
        trustLocalFile(this.view.webContents, join(__dirname, 'settings.html'));
        this.parentWindow.contentView.addChildView(this.view);
        this.updateBounds();
        void this.view.webContents
            .loadFile(join(__dirname, 'settings.html'))
            .catch((error: unknown) => console.error('Не удалось открыть настройки:', error));
    }
    private teardownView(): void {
        const view = this.view;
        this.view = null;
        if (!view) return;
        if (!this.parentWindow.isDestroyed()) this.parentWindow.contentView.removeChildView(view);
        if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    private updateBounds(): void {
        if (!this.view || this.parentWindow.isDestroyed()) return;
        const bounds = this.parentWindow.getContentBounds();
        const width = Math.min(500, Math.floor(bounds.width * 0.4));
        this.view.setBounds({ x: bounds.width - width, y: 32, width, height: Math.max(0, bounds.height - 32) });
    }
    private async applyStyles(): Promise<void> {
        const contents = this.view?.webContents;
        if (!contents || contents.isDestroyed()) return;
        const colors = this.colors;
        const variables = colors
            ? ':root{--bg-primary:' +
              (colors.surface || colors.background) +
              ';--bg-secondary:' +
              colors.background +
              ';--text-primary:' +
              colors.text +
              ';--accent:' +
              (colors.accent || colors.primary) +
              ';}'
            : '';
        await this.styles.apply(contents, variables + '\n' + this.customCSS).catch((error: unknown) => {
            if (!contents.isDestroyed()) console.error('Не удалось применить тему настроек:', error);
        });
    }
    public setThemeColors(colors: ThemeColors | null): void {
        this.colors = colors;
        void this.applyStyles();
    }
    public setCustomCSS(css: string): void {
        this.customCSS = css;
        void this.applyStyles();
    }
    public getView(): WebContentsView | null {
        return this.view;
    }
    public updateTranslations(): void {
        this.view?.webContents.send('update-translations');
    }
    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.teardownView();
        this.parentWindow.removeListener('resize', this.resize);
        ipcMain.removeHandler('get-settings-state');
        ipcMain.removeListener('settings-ready', this.ready);
    }
}
