import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * track: «Не нравится», запрет этой загрузки (и её подтверждённых копий); artist: скрытый аккаунт загрузчика, навсегда;
 * later-*: «Не сейчас», на 7 дней; more: «Больше такого», локальный лайк для модели вкуса и зерно волны;
 * family: скрыть другие версии композиции этой загрузки, семья считается разбором названия (title, artist, artistId)
 */
export type ExclusionKind = 'track' | 'artist' | 'later-track' | 'later-artist' | 'more' | 'family';
export interface ExclusionEntry {
    id: number;
    /** Название трека или имя артиста для списка в F1 */
    title: string;
    /** Артист трека; у записи артиста пусто */
    artist: string;
    /** Ссылка на soundcloud.com: по ней меню узнаёт отмеченное без запроса к API */
    url: string;
    at: number;
    /** До какого момента действует «Не сейчас» */
    until?: number;
    /** Для «Больше такого»: артист, жанр и теги трека, по ним учится модель вкуса и строится зерно */
    artistId?: number;
    genre?: string;
    tags?: string;
}
export interface WaveExclusionList {
    tracks: ExclusionEntry[];
    artists: ExclusionEntry[];
    laterTracks: ExclusionEntry[];
    laterArtists: ExclusionEntry[];
    more: ExclusionEntry[];
    families: ExclusionEntry[];
}

const LIMIT = 5000;
export const LATER_MS = 7 * 86400000;
const LISTS: Record<ExclusionKind, keyof WaveExclusionList> = {
    track: 'tracks',
    artist: 'artists',
    'later-track': 'laterTracks',
    'later-artist': 'laterArtists',
    more: 'more',
    family: 'families',
};
// Отметка трека снимает противоречащие: «Больше такого» и «Не нравится» или «Не сейчас» вместе не живут
const OPPOSITE: Partial<Record<ExclusionKind, ExclusionKind[]>> = {
    track: ['more', 'later-track'],
    'later-track': ['more'],
    more: ['track', 'later-track'],
};
const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isKind = (value: unknown): value is ExclusionKind => typeof value === 'string' && Object.prototype.hasOwnProperty.call(LISTS, value);
const emptyList = (): WaveExclusionList => ({ tracks: [], artists: [], laterTracks: [], laterArtists: [], more: [], families: [] });

export function cleanExclusionUrl(value: unknown): string {
    if (typeof value !== 'string') return '';
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === 'soundcloud.com' ? (url.origin + url.pathname).replace(/\/+$/, '').toLowerCase() : '';
    } catch {
        return '';
    }
}
function cleanEntry(value: unknown, now: number): ExclusionEntry | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as Partial<Record<keyof ExclusionEntry, unknown>>;
    if (!isId(source.id)) return null;
    const text = (value: unknown, max = 200): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
    const time = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined);
    const entry: ExclusionEntry = { id: source.id, title: text(source.title), artist: text(source.artist), url: cleanExclusionUrl(source.url), at: time(source.at) ?? now };
    const until = time(source.until);
    if (until) entry.until = until;
    if (isId(source.artistId)) entry.artistId = source.artistId;
    const genre = text(source.genre, 80);
    const tags = text(source.tags, 300);
    if (genre) entry.genre = genre;
    if (tags) entry.tags = tags;
    return entry;
}
function cleanList(value: unknown): ExclusionEntry[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<number>();
    const list: ExclusionEntry[] = [];
    for (const item of value) {
        const entry = cleanEntry(item, 0);
        if (!entry || seen.has(entry.id)) continue;
        seen.add(entry.id);
        list.push(entry);
    }
    return list.slice(0, LIMIT);
}
/** Содержимое файла отметок: каждая запись проверяется, чужие поля и повторы отбрасываются */
export function cleanExclusionList(value: unknown): WaveExclusionList {
    const list = emptyList();
    if (value && typeof value === 'object') {
        const source = value as Record<string, unknown>;
        for (const key of Object.values(LISTS)) list[key] = cleanList(source[key]);
    }
    return list;
}
const copyList = (list: WaveExclusionList): WaveExclusionList => ({
    tracks: list.tracks.slice(), artists: list.artists.slice(), laterTracks: list.laterTracks.slice(),
    laterArtists: list.laterArtists.slice(), more: list.more.slice(), families: list.families.slice(),
});

// Отметки «Моей волны»: файл на каждого пользователя SoundCloud, новые записи сверху.
// Пишется сразу: отметки редкие, а терять их при падении нельзя
export class WaveExclusions {
    private cache = new Map<number, WaveExclusionList>();
    private lastUser = 0;

    constructor(private directory: string) {}

    private file(userId: number): string {
        return join(this.directory, 'exclusions-' + userId + '.json');
    }
    private read(userId: number): WaveExclusionList {
        const cached = this.cache.get(userId);
        if (cached) return cached;
        let list = emptyList();
        try {
            list = cleanExclusionList(JSON.parse(readFileSync(this.file(userId), 'utf8')));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Исключения волны не прочитаны:', error);
        }
        this.cache.set(userId, list);
        return list;
    }
    private write(userId: number): boolean {
        const target = this.file(userId);
        try {
            mkdirSync(this.directory, { recursive: true });
            const list = this.read(userId);
            // Прежняя сборка клиента перезаписала бы файл без списка families: перед первой такой записью
            // прежний файл сохраняется рядом один раз, откат сборки его не теряет
            const backup = join(this.directory, 'exclusions-' + userId + '.v1.json');
            if (list.families.length && existsSync(target) && !existsSync(backup)) copyFileSync(target, backup);
            writeFileSync(target + '.tmp', JSON.stringify(list), 'utf8');
            renameSync(target + '.tmp', target);
            return true;
        } catch (error) {
            console.warn('Исключения волны не записаны:', error);
            return false;
        }
    }
    /** Копия отметок; истёкшие «Не сейчас» не отдаются */
    public load(userId: unknown, now = Date.now()): WaveExclusionList {
        if (!isId(userId)) return emptyList();
        this.lastUser = userId;
        const list = this.read(userId);
        const alive = (entry: ExclusionEntry): boolean => !entry.until || entry.until > now;
        return {
            tracks: list.tracks.slice(),
            artists: list.artists.slice(),
            laterTracks: list.laterTracks.filter(alive),
            laterArtists: list.laterArtists.filter(alive),
            more: list.more.slice(),
            families: list.families.slice(),
        };
    }
    /** Ставит или снимает отметку. false, если ввод неверный или файл не записан */
    public set(userId: unknown, kind: unknown, input: unknown, excluded: unknown, now = Date.now()): boolean {
        if (!isId(userId) || !isKind(kind) || typeof excluded !== 'boolean') return false;
        const entry = cleanEntry(input, now);
        if (!entry) return false;
        this.lastUser = userId;
        const list = this.read(userId);
        const key = LISTS[kind];
        const rest = list[key].filter((item) => item.id !== entry.id);
        if (!excluded && rest.length === list[key].length) return true;
        if (excluded) {
            const stored: ExclusionEntry = { ...entry, at: now };
            if (kind === 'later-track' || kind === 'later-artist') stored.until = now + LATER_MS;
            else delete stored.until;
            list[key] = [stored, ...rest].slice(0, LIMIT);
            for (const other of OPPOSITE[kind] ?? []) list[LISTS[other]] = list[LISTS[other]].filter((item) => item.id !== entry.id);
        } else list[key] = rest;
        return this.write(userId);
    }
    /**
     * Слить отметки из резервной копии. Все записи проигрываются по времени, как если бы ставились заново:
     * при повторе и противоречии побеждает более поздняя, истёкшие «Не сейчас» не возвращаются.
     * Возвращает прежние списки для отката или null, если файл не записан
     */
    public merge(userId: unknown, input: WaveExclusionList, now = Date.now()): WaveExclusionList | null {
        if (!isId(userId)) return null;
        const current = this.read(userId);
        const previous = copyList(current);
        const events: Array<{ kind: ExclusionKind; entry: ExclusionEntry }> = [];
        // Списки хранятся новыми сверху: проход с конца сохраняет их порядок и при равном времени
        for (const source of [current, input])
            for (const kind of Object.keys(LISTS) as ExclusionKind[])
                for (const entry of source[LISTS[kind]].slice().reverse()) {
                    if (source === input && entry.until !== undefined && entry.until <= now) continue;
                    events.push({ kind, entry });
                }
        events.sort((a, b) => a.entry.at - b.entry.at);
        const next = emptyList();
        for (const { kind, entry } of events) {
            const key = LISTS[kind];
            next[key] = [entry, ...next[key].filter((item) => item.id !== entry.id)];
            for (const other of OPPOSITE[kind] ?? []) next[LISTS[other]] = next[LISTS[other]].filter((item) => item.id !== entry.id);
        }
        for (const key of Object.values(LISTS)) next[key] = next[key].slice(0, LIMIT);
        // Ничего нового: файл не переписывается
        if (JSON.stringify(next) === JSON.stringify(current)) return previous;
        this.cache.set(userId, next);
        if (this.write(userId)) return previous;
        this.cache.set(userId, current);
        return null;
    }
    /** Вернуть списки, снятые merge, если восстановление копии откатывается */
    public restore(userId: unknown, list: WaveExclusionList): boolean {
        if (!isId(userId)) return false;
        this.cache.set(userId, copyList(list));
        return this.write(userId);
    }
    /** Пользователь, с которым страница работала последней; до первого обращения страницы берётся самый свежий файл */
    public currentUser(): number {
        if (this.lastUser) return this.lastUser;
        try {
            let best = 0;
            let bestTime = 0;
            for (const name of readdirSync(this.directory)) {
                const match = /^exclusions-(\d+)\.json$/.exec(name);
                const id = match ? Number(match[1]) : 0;
                if (!isId(id)) continue;
                const time = statSync(join(this.directory, name)).mtimeMs;
                if (time > bestTime) { best = id; bestTime = time; }
            }
            return best;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Папка исключений волны не прочитана:', error);
            return 0;
        }
    }
}
