// Ссылка «открыть трек в клиенте»: кнопка Discord ведёт на страницу-переходник, та открывает soundcloud-desktop://track/<user>/<track>.
// Кнопки Discord принимают только http и https, поэтому напрямую на протокол сослаться нельзя
export const OPEN_PROTOCOL = 'soundcloud-desktop';
export const OPEN_PAGE_URL = 'https://zxczxczxczxczxczxc1111.github.io/soundcloud-desktop/open/';

const USER = /^[a-z0-9_-]{1,100}$/i;
const SLUG = /^[a-z0-9_-]{1,255}$/i;

function pathOf(user: string, slug: string): string {
    return USER.test(user) && SLUG.test(slug) ? '/' + user.toLowerCase() + '/' + slug.toLowerCase() : '';
}

/** Путь /user/track публичного трека SoundCloud; у приватного (секретная ссылка третьим сегментом) и у чужих адресов пусто */
export function publicTrackPath(value: string): string {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.hostname !== 'soundcloud.com' || url.username || url.password) return '';
        const parts = url.pathname.replace(/\/+$/, '').split('/').slice(1);
        return parts.length === 2 ? pathOf(parts[0], parts[1]) : '';
    } catch {
        return '';
    }
}

/** Адрес кнопки Discord: переходник с путём трека; у приватного трека кнопки нет */
export function openPageUrl(trackUrl: string): string | undefined {
    const path = publicTrackPath(trackUrl);
    // В пути только латиница, цифры, - и _: экранировать нечего
    return path ? OPEN_PAGE_URL + '?t=' + path.slice(1) : undefined;
}

/** Путь трека из ссылки протокола в командной строке: soundcloud-desktop://track/<user>/<track>; всё остальное пропускается */
export function parseOpenLink(argv: readonly string[]): string | null {
    for (const arg of argv) {
        if (typeof arg !== 'string' || arg.length > 600 || !arg.toLowerCase().startsWith(OPEN_PROTOCOL + ':')) continue;
        try {
            const url = new URL(arg);
            if (url.protocol !== OPEN_PROTOCOL + ':' || url.hostname !== 'track' || url.username || url.password || url.port) continue;
            const parts = url.pathname.replace(/\/+$/, '').split('/').slice(1);
            const path = parts.length === 2 ? pathOf(parts[0], parts[1]) : '';
            if (path) return path;
        } catch {
            // Кривая ссылка: не наша забота, клиент просто выходит вперёд
        }
    }
    return null;
}
