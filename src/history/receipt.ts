// Чек недели: редкость вкуса по ответу сайта и проверка картинки, которую рисует страница истории
const PNG_PREFIX = 'data:image/png;base64,';
// Чек в два раза крупнее экрана весит сотни килобайт; предел с запасом, но не даёт странице прислать что угодно
const MAX_BYTES = 8 * 1024 * 1024;

/** Медиана прослушиваний треков на сайте; меньше пяти известных чисел значит судить не по чему */
export function medianPlays(tracks: unknown): number | null {
    if (!Array.isArray(tracks)) return null;
    const plays = tracks
        .map((track: unknown) => (track && typeof track === 'object' ? (track as { plays?: unknown }).plays : null))
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
        .sort((a, b) => a - b);
    if (plays.length < 5) return null;
    const middle = plays.length >> 1;
    return plays.length % 2 ? plays[middle] : Math.round((plays[middle - 1] + plays[middle]) / 2);
}

/** PNG от страницы: только data:image/png с подписью PNG внутри и не больше 8 МБ */
export function receiptImage(value: unknown): Buffer | null {
    if (typeof value !== 'string' || !value.startsWith(PNG_PREFIX)) return null;
    const body = value.slice(PNG_PREFIX.length);
    if (!body || body.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return null;
    const buffer = Buffer.from(body, 'base64');
    return buffer.length > 8 && buffer.readUInt32BE(0) === 0x89504e47 && buffer.readUInt32BE(4) === 0x0d0a1a0a ? buffer : null;
}

/** Имя файла по сегодняшней дате: soundcloud-week-2026-10-02.png */
export function receiptName(at: Date): string {
    const pad = (n: number): string => String(n).padStart(2, '0');
    return 'soundcloud-week-' + at.getFullYear() + '-' + pad(at.getMonth() + 1) + '-' + pad(at.getDate()) + '.png';
}
