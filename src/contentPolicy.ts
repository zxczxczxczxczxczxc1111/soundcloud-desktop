import type { WebContents } from 'electron';

export function isSoundCloudUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password &&
            (url.hostname === 'soundcloud.com' || url.hostname.endsWith('.soundcloud.com'));
    } catch { return false; }
}
export function isWebUrl(value: string): boolean {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
    catch { return false; }
}

export function protectContent(contents: WebContents, openExternal: (url: string) => Promise<void>): void {
    contents.session.setPermissionCheckHandler((_contents, permission, origin) =>
        permission === 'mediaKeySystem' && isSoundCloudUrl(origin));
    contents.session.setPermissionRequestHandler((_contents, permission, callback, details) =>
        callback(permission === 'mediaKeySystem' && isSoundCloudUrl(details.requestingUrl)));
    contents.on('will-navigate', (event, url) => {
        if (isSoundCloudUrl(url)) return;
        event.preventDefault();
        if (isWebUrl(url)) void openExternal(url).catch(console.error);
    });
    contents.on('will-redirect', (event, url) => {
        if (!isSoundCloudUrl(url)) event.preventDefault();
    });
    // Вход через внешнего провайдера сохраняет opener и сессию, но не получает preload клиента.
    contents.setWindowOpenHandler(({ url }) => isWebUrl(url) ? {
        action: 'allow',
        overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, preload: '', webSecurity: true },
        },
    } : { action: 'deny' });
    contents.on('did-create-window', (window) => {
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        window.webContents.on('will-navigate', (event, url) => { if (!isWebUrl(url)) event.preventDefault(); });
        window.webContents.on('will-redirect', (event, url) => { if (!isWebUrl(url)) event.preventDefault(); });
    });
}
