// Сводка недели: проверка картинки, которую рисует страница истории, и данных о людях от страницы сайта
const PNG_PREFIX = 'data:image/png;base64,';
// Карточка в два раза крупнее экрана с обложками весит единицы мегабайт; предел с запасом, но не даёт странице прислать что угодно
const MAX_BYTES = 12 * 1024 * 1024;
const PERMALINK = /^[a-z0-9_-]{1,100}$/i;
const ARTIST_PATH = /^\/[a-z0-9_-]{1,100}$/;
// Картинки только с сервера картинок SoundCloud: окно истории другие и не загрузит
const PICTURE = /^https:\/\/[a-z0-9-]{1,40}\.sndcdn\.com\/[^\s"'<>\\]{1,300}$/i;

/** PNG от страницы: только data:image/png с подписью PNG внутри и не больше 12 МБ */
export function recapImage(value: unknown): Buffer | null {
    if (typeof value !== 'string' || !value.startsWith(PNG_PREFIX)) return null;
    const body = value.slice(PNG_PREFIX.length);
    if (!body || body.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return null;
    const buffer = Buffer.from(body, 'base64');
    return buffer.length > 8 && buffer.readUInt32BE(0) === 0x89504e47 && buffer.readUInt32BE(4) === 0x0d0a1a0a ? buffer : null;
}

/** Имя файла по неделе ISO: soundcloud-week-2026-40.png; неделя не пришла, значит по сегодняшней дате */
export function recapName(year: unknown, week: unknown, at: Date): string {
    const pad = (n: number): string => String(n).padStart(2, '0');
    const valid = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
    if (valid(year, 2020, 2100) && valid(week, 1, 53)) return 'soundcloud-week-' + year + '-' + pad(week) + '.png';
    return 'soundcloud-week-' + at.getFullYear() + '-' + pad(at.getMonth() + 1) + '-' + pad(at.getDate()) + '.png';
}

/** Прошлая неделя по местному времени: с понедельника до понедельника, номер по ISO (год по четвергу недели) */
export function lastWeek(now: Date): { from: number; to: number; id: string } {
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7);
    const year = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 3).getFullYear();
    const january = new Date(year, 0, 4);
    const first = new Date(year, 0, 4 - ((january.getDay() + 6) % 7));
    // Через переход на летнее время неделя короче или длиннее на час: округление это съедает
    const week = 1 + Math.round((start.getTime() - first.getTime()) / (7 * 86400000));
    return { from: start.getTime(), to: monday.getTime(), id: year + '-' + String(week).padStart(2, '0') };
}

export interface RecapPeople {
    me: { username: string; permalink: string; avatar: string } | null;
    avatars: Record<string, string>;
}
const picture = (value: unknown): string => (typeof value === 'string' && PICTURE.test(value) ? value : '');

/** Ответ страницы сайта о людях: ник, ссылка и аватарка человека, аватарки артистов по путям их страниц. Всё лишнее отбрасывается */
export function recapPeople(value: unknown, asked: readonly string[]): RecapPeople | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as { me?: unknown; avatars?: unknown };
    let me: RecapPeople['me'] = null;
    if (raw.me && typeof raw.me === 'object') {
        const person = raw.me as { username?: unknown; permalink?: unknown; avatar?: unknown };
        const username = typeof person.username === 'string' ? person.username.trim().slice(0, 100) : '';
        if (username) me = { username, permalink: typeof person.permalink === 'string' && PERMALINK.test(person.permalink) ? person.permalink : '', avatar: picture(person.avatar) };
    }
    const avatars: Record<string, string> = {};
    if (raw.avatars && typeof raw.avatars === 'object') {
        const given = raw.avatars as Record<string, unknown>;
        for (const path of asked) {
            if (!ARTIST_PATH.test(path) || !Object.prototype.hasOwnProperty.call(given, path)) continue;
            const url = picture(given[path]);
            if (url) avatars[path] = url;
        }
    }
    return { me, avatars };
}
