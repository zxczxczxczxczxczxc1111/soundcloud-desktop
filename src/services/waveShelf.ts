import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

/** Карточка полки «Подборки»: находки дня, давно не слушал или один из вкусов */
export interface ShelfCard {
    kind: 'daily' | 'forgotten' | 'group';
    /** Название вкуса; у находок и «давно не слушал» пусто, подпись берёт страница */
    title: string;
    /** Строка под названием вкуса: главные артисты */
    sub: string;
    /** Треки подборки по порядку */
    ids: number[];
    /** Зёрна, от которых волна идёт дальше, когда треки подборки кончились */
    seeds: number[];
    /** Ключи тегов вкуса */
    keys: string[];
    /** До четырёх обложек для коллажа */
    art: string[];
}
/** Подборки на местные сутки: собираются один раз, до полуночи одни и те же */
export interface ShelfSnapshot {
    day: string;
    /** Формат сборки: снимок другого формата страница собирает заново сразу, не дожидаясь полуночи */
    v: number;
    cards: ShelfCard[];
}
/** Находки дня, «Давно не слушал» и до восьми жанров (решение владельца 26.09.2026) */
export const SHELF_CARDS = 10;

const KINDS = new Set<ShelfCard['kind']>(['daily', 'forgotten', 'group']);
const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
function ids(value: unknown, limit: number): number[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(isId))].slice(0, limit);
}
// Обложки только с CDN SoundCloud: адрес уходит в style страницы
function artUrl(value: unknown): string {
    if (typeof value !== 'string' || value.length > 400) return '';
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && /(^|\.)sndcdn\.com$/.test(url.hostname) && !/["'\\()\s]/.test(value) ? url.href : '';
    } catch {
        return '';
    }
}
function cleanCard(value: unknown): ShelfCard | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as Partial<Record<keyof ShelfCard, unknown>>;
    if (typeof source.kind !== 'string' || !KINDS.has(source.kind as ShelfCard['kind'])) return null;
    const card: ShelfCard = {
        kind: source.kind as ShelfCard['kind'],
        title: text(source.title, 80),
        sub: text(source.sub, 200),
        ids: ids(source.ids, 60),
        seeds: ids(source.seeds, 20),
        keys: Array.isArray(source.keys) ? source.keys.map((key) => text(key, 80)).filter(Boolean).slice(0, 6) : [],
        art: Array.isArray(source.art) ? source.art.map(artUrl).filter(Boolean).slice(0, 4) : [],
    };
    if (!card.ids.length || (card.kind === 'group' && !card.title)) return null;
    return card;
}
/** Снимок со страницы или из файла; всё, что не проходит проверку, отбрасывается */
export function cleanShelf(value: unknown): ShelfSnapshot | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as { day?: unknown; v?: unknown; cards?: unknown };
    if (typeof source.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(source.day)) return null;
    const cards = Array.isArray(source.cards) ? source.cards.map(cleanCard).filter((card): card is ShelfCard => !!card).slice(0, SHELF_CARDS) : [];
    // Снимок до номера формата это формат 1
    const v = typeof source.v === 'number' && Number.isSafeInteger(source.v) && source.v > 0 ? source.v : 1;
    return { day: source.day, v, cards };
}

// Подборки дня «Моей волны»: файл на пользователя SoundCloud рядом с отметками
export class WaveShelf {
    constructor(private directory: string) {}

    private file(userId: number): string {
        return join(this.directory, 'shelf-' + userId + '.json');
    }
    public load(userId: unknown): ShelfSnapshot | null {
        if (!isId(userId)) return null;
        try {
            return cleanShelf(JSON.parse(readFileSync(this.file(userId), 'utf8')));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Подборки волны не прочитаны:', error);
            return null;
        }
    }
    /** false, если ввод неверный или файл не записан */
    public save(userId: unknown, input: unknown): boolean {
        if (!isId(userId)) return false;
        const snapshot = cleanShelf(input);
        if (!snapshot) return false;
        const target = this.file(userId);
        try {
            mkdirSync(this.directory, { recursive: true });
            writeFileSync(target + '.tmp', JSON.stringify(snapshot), 'utf8');
            renameSync(target + '.tmp', target);
            return true;
        } catch (error) {
            console.warn('Подборки волны не записаны:', error);
            return false;
        }
    }
}
