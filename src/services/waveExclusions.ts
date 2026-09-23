import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

export type ExclusionKind = 'track' | 'artist';
export interface ExclusionEntry {
    id: number;
    /** Название трека или имя артиста для списка в F1 */
    title: string;
    /** Артист трека; у записи артиста пусто */
    artist: string;
    /** Ссылка на soundcloud.com: по ней меню узнаёт исключённое без запроса к API */
    url: string;
    at: number;
}
export interface WaveExclusionList {
    tracks: ExclusionEntry[];
    artists: ExclusionEntry[];
}

const LIMIT = 5000;
const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isKind = (value: unknown): value is ExclusionKind => value === 'track' || value === 'artist';

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
    const text = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 200) : '');
    const at = typeof source.at === 'number' && Number.isFinite(source.at) && source.at > 0 ? source.at : now;
    return { id: source.id, title: text(source.title), artist: text(source.artist), url: cleanExclusionUrl(source.url), at };
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

// «Не нравится» и скрытые артисты «Моей волны»: файл на каждого пользователя SoundCloud,
// новые записи сверху. Пишется сразу: отметки редкие, а терять их при падении нельзя
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
        let list: WaveExclusionList = { tracks: [], artists: [] };
        try {
            const parsed: unknown = JSON.parse(readFileSync(this.file(userId), 'utf8'));
            if (parsed && typeof parsed === 'object') {
                const source = parsed as { tracks?: unknown; artists?: unknown };
                list = { tracks: cleanList(source.tracks), artists: cleanList(source.artists) };
            }
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
            writeFileSync(target + '.tmp', JSON.stringify(this.read(userId)), 'utf8');
            renameSync(target + '.tmp', target);
            return true;
        } catch (error) {
            console.warn('Исключения волны не записаны:', error);
            return false;
        }
    }
    public load(userId: unknown): WaveExclusionList {
        if (!isId(userId)) return { tracks: [], artists: [] };
        this.lastUser = userId;
        const list = this.read(userId);
        return { tracks: list.tracks.slice(), artists: list.artists.slice() };
    }
    /** Ставит или снимает отметку. false, если ввод неверный или файл не записан */
    public set(userId: unknown, kind: unknown, input: unknown, excluded: unknown): boolean {
        if (!isId(userId) || !isKind(kind) || typeof excluded !== 'boolean') return false;
        const entry = cleanEntry(input, Date.now());
        if (!entry) return false;
        this.lastUser = userId;
        const list = this.read(userId);
        const key = kind === 'track' ? 'tracks' : 'artists';
        const rest = list[key].filter((item) => item.id !== entry.id);
        if (!excluded && rest.length === list[key].length) return true;
        list[key] = excluded ? [{ ...entry, at: Date.now() }, ...rest].slice(0, LIMIT) : rest;
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
