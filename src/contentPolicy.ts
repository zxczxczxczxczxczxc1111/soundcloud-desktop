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

// Где сайт сам просит полную загрузку: вход, выход, привязка аккаунтов
const FULL_LOAD_ROUTES = new Set(['logout', 'signin', 'signup', 'login', 'connect', 'oauth', 'oauth2', 'email-preferences']);
const PAGE_PATH = /^\/([a-z0-9_-]{1,100})(?:\/(?:sets\/)?[a-z0-9_-]{1,255})?$/;
const PAGE_QUERY = /^(?:\?[A-Za-z0-9_.~%&=+/-]{1,500})?$/;

// Путь страницы пользователя, трека или плейлиста, если полную загрузку этой страницы можно заменить переходом
// внутри сайта. null значит «пусть грузится как просили»: другой адрес, служебный маршрут или повтор текущей страницы
export function sitePagePath(target: string, current: string): string | null {
    let to: URL;
    let from: URL;
    try {
        to = new URL(target);
        from = new URL(current);
    } catch {
        return null;
    }
    if (to.protocol !== 'https:' || to.hostname !== 'soundcloud.com' || to.username || to.password || to.port) return null;
    if (from.protocol !== 'https:' || from.hostname !== 'soundcloud.com') return null;
    if (to.pathname === from.pathname && to.search === from.search) return null;
    const page = PAGE_PATH.exec(to.pathname);
    if (!page || FULL_LOAD_ROUTES.has(page[1]) || !PAGE_QUERY.test(to.search)) return null;
    return to.pathname + to.search;
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
