import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { COUNTED_MS, localDayStart, type HistoryIndex, type TastePlay } from './historyIndex';
import { normalizeTag, tagKeys } from './wave';

// Модель вкуса «Моей волны» по журналу прослушиваний. Числа стартовые (план этапа 5), подбираются по доле
// ранних пропусков в волне, она видна на странице истории
const DAY = 86400000;
const HALF_LIFE_DAYS = 60;
const REPLAY_DAYS = 14;
/** Меньше засчитанных прослушиваний: модель ещё не уверена, веса вполсилы */
const CONFIDENT_PLAYS = 200;
const HORIZON_DAYS = 365;
const CACHE_MS = 30 * 60000;
const LIMITS = { artists: 500, tags: 300, tracks: 1000 };
const VIEW_LIMIT = 25;
const EARLY_DAYS = 30;

type Weights = [track: number, artist: number, tag: number];
const EARLY_SKIP: Weights = [-1, -0.3, -0.1];
const PARTIAL: Weights = [-0.2, 0, 0];
const MOST: Weights = [0.5, 0.2, 0.1];
const FULL: Weights = [1, 0.4, 0.2];
const LIKE: Weights = [2, 0.8, 0.3];

/** «Больше такого»: локальный лайк, трек со своим артистом и метками */
export interface TasteMark {
    id: number;
    artist: number;
    genre: string;
    tags: string;
    at: number;
}
export interface TasteOverrides {
    artists: number[];
    tags: string[];
}
/** Что уходит странице волны: [id или ключ тега, вес] по убыванию модуля веса */
export interface TasteProfile {
    artists: Array<[number, number]>;
    tags: Array<[string, number]>;
    tracks: Array<[number, number]>;
    counted: number;
}
export interface TasteView {
    artists: Array<{ id: number; name: string; artwork: string; path: string; weight: number }>;
    tags: Array<{ key: string; label: string; weight: number }>;
    removed: { artists: Array<{ id: number; name: string }>; tags: Array<{ key: string; label: string }> };
    /** Доля ранних пропусков среди треков волны по местным суткам, старые слева */
    early: Array<{ start: number; total: number; early: number }>;
    counted: number;
}

/** Исход прослушивания: [трек, артист, теги] или null, если это не сигнал */
export function playWeights(play: Pick<TastePlay, 'heard' | 'dur' | 'end' | 'likedNow'>): Weights | null {
    if (play.end !== 'done' && play.end !== 'skip') return null;
    let base: Weights | null;
    if (play.heard < COUNTED_MS) base = play.end === 'skip' ? EARLY_SKIP : null;
    else if (play.end === 'done' && (play.dur <= 0 || play.heard >= play.dur * 0.8)) base = FULL;
    else if (play.dur <= 0 || play.heard >= play.dur / 2) base = MOST;
    else base = PARTIAL;
    if (!play.likedNow) return base;
    const sum = base ?? [0, 0, 0];
    return [sum[0] + LIKE[0], sum[1] + LIKE[1], sum[2] + LIKE[2]];
}

const round = (value: number): number => Math.round(value * 1000) / 1000;
function top<K>(map: Map<K, number>, limit: number, floor: number): Array<[K, number]> {
    return [...map].filter(([, weight]) => Math.abs(weight) >= floor).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, limit).map(([key, weight]) => [key, round(weight)]);
}
// Написание тега для людей: как в первом встреченном жанре или теге трека
function tagLabels(genre: string, tags: string, into: Map<string, string>): void {
    const labels = [genre, ...Array.from(tags.matchAll(/"([^"]+)"|(\S+)/g), (match) => match[1] ?? match[2] ?? '')];
    for (const label of labels) {
        const key = normalizeTag(label);
        if (key.length >= 2 && !into.has(key)) into.set(key, label.trim().toLowerCase().slice(0, 60));
    }
}

export function buildTaste(plays: readonly TastePlay[], marks: readonly TasteMark[], overrides: TasteOverrides, now: number): { profile: TasteProfile; view: TasteView } {
    const tracks = new Map<number, number>();
    const artists = new Map<number, number>();
    const tags = new Map<string, number>();
    const labels = new Map<string, string>();
    const names = new Map<number, { name: string; artwork: string; path: string }>();
    const lastCounted = new Map<number, number>();
    const counted = plays.filter((play) => play.heard >= COUNTED_MS).length;
    const confidence = counted < CONFIDENT_PLAYS ? 0.5 : 1;
    const add = (weights: Weights, id: number, artist: number, keys: string[], factor: number, positive: number): void => {
        // Плюсы ослабляются поправками, минусы действуют полностью
        const scale = (value: number): number => value * factor * (value > 0 ? positive : 1);
        tracks.set(id, (tracks.get(id) ?? 0) + scale(weights[0]));
        if (artist > 0 && weights[1]) artists.set(artist, (artists.get(artist) ?? 0) + scale(weights[1]));
        if (weights[2]) for (const key of keys) tags.set(key, (tags.get(key) ?? 0) + scale(weights[2]));
    };
    const decay = (at: number): number => Math.pow(0.5, Math.max(0, now - at) / DAY / HALF_LIFE_DAYS) * confidence;

    for (const play of plays) {
        if (play.artist > 0 && play.artistName) names.set(play.artist, { name: play.artistName, artwork: play.artwork, path: play.path });
        tagLabels(play.genre, play.tags, labels);
        const keys = tagKeys(play.genre, play.tags);
        // Трек, поданный волной, весит в плюс меньше выбранного руками; фоновое прослушивание вполсилы
        const positive = (play.source.startsWith('wave:') ? 0.7 : 1) * (play.away ? 0.5 : 1);
        const factor = decay(play.at);
        const weights = playWeights(play);
        if (weights) add(weights, play.id, play.artist, keys, factor, positive);
        if (play.heard < COUNTED_MS) continue;
        const previous = lastCounted.get(play.id);
        if (previous !== undefined && play.at - previous <= REPLAY_DAYS * DAY) add([1, 0, 0], play.id, play.artist, keys, factor, positive);
        lastCounted.set(play.id, play.at);
    }
    for (const mark of marks) {
        tagLabels(mark.genre, mark.tags, labels);
        add(LIKE, mark.id, mark.artist, tagKeys(mark.genre, mark.tags), decay(mark.at), 1);
    }

    const droppedArtists = new Set(overrides.artists);
    const droppedTags = new Set(overrides.tags);
    for (const id of droppedArtists) artists.delete(id);
    for (const key of droppedTags) tags.delete(key);
    const profile: TasteProfile = {
        artists: top(artists, LIMITS.artists, 0.01),
        tags: top(tags, LIMITS.tags, 0.01),
        tracks: top(tracks, LIMITS.tracks, 0.1),
        counted,
    };

    const artistPath = (path: string): string => /^\/[^/]+/.exec(path)?.[0] ?? '';
    const liked = <K>(map: Map<K, number>): Array<[K, number]> => [...map].filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).slice(0, VIEW_LIMIT);
    const today = localDayStart(now);
    const early: TasteView['early'] = [];
    for (let i = EARLY_DAYS - 1; i >= 0; i--) {
        // Сутки по местному времени: переход на летнее время даёт 23 или 25 часов
        const start = localDayStart(today - i * DAY + 12 * 3600000);
        early.push({ start, total: 0, early: 0 });
    }
    for (const play of plays) {
        if (!play.source.startsWith('wave:') || play.at < early[0].start) continue;
        const day = early.find((entry, index) => play.at >= entry.start && (index === early.length - 1 || play.at < early[index + 1].start));
        if (!day) continue;
        day.total++;
        if (play.end === 'skip' && play.heard < COUNTED_MS) day.early++;
    }
    const view: TasteView = {
        artists: liked(artists).map(([id, weight]) => {
            const known = names.get(id);
            return { id, name: known?.name ?? '', artwork: known?.artwork ?? '', path: artistPath(known?.path ?? ''), weight: round(weight) };
        }).filter((entry) => entry.name),
        tags: liked(tags).map(([key, weight]) => ({ key, label: labels.get(key) ?? key, weight: round(weight) })),
        removed: {
            artists: [...droppedArtists].map((id) => ({ id, name: names.get(id)?.name ?? '' })).filter((entry) => entry.name),
            tags: [...droppedTags].map((key) => ({ key, label: labels.get(key) ?? key })),
        },
        early,
        counted,
    };
    return { profile, view };
}

const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isTagKey = (value: unknown): value is string => typeof value === 'string' && value.length >= 2 && value.length <= 80 && normalizeTag(value) === value;

// Профиль считается по индексу истории и живёт 30 минут; «убрать из вкуса» хранится отдельным файлом на пользователя
export class TasteService {
    private cache = new Map<number, { at: number; profile: TasteProfile }>();
    private overrides = new Map<number, TasteOverrides>();

    constructor(private directory: string, private index: HistoryIndex, private marks: (userId: number) => TasteMark[]) {}

    private file(userId: number): string {
        return join(this.directory, 'taste-overrides-' + userId + '.json');
    }
    private readOverrides(userId: number): TasteOverrides {
        const cached = this.overrides.get(userId);
        if (cached) return cached;
        let result: TasteOverrides = { artists: [], tags: [] };
        try {
            if (existsSync(this.file(userId))) {
                const parsed = JSON.parse(readFileSync(this.file(userId), 'utf8')) as { artists?: unknown; tags?: unknown } | null;
                result = {
                    artists: Array.isArray(parsed?.artists) ? [...new Set(parsed.artists.filter(isId))].slice(0, 1000) : [],
                    tags: Array.isArray(parsed?.tags) ? [...new Set(parsed.tags.filter(isTagKey))].slice(0, 1000) : [],
                };
            }
        } catch (error) {
            console.warn('Вкус волны: убранное из вкуса не прочитано', error);
        }
        this.overrides.set(userId, result);
        return result;
    }
    private compute(userId: number): { profile: TasteProfile; view: TasteView } {
        const now = Date.now();
        try {
            this.index.sync(userId);
        } catch (error) {
            console.warn('Вкус волны: журнал не перенесён в индекс', error);
        }
        const result = buildTaste(this.index.tastePlays(userId, now - HORIZON_DAYS * DAY), this.marks(userId), this.readOverrides(userId), now);
        this.cache.set(userId, { at: now, profile: result.profile });
        return result;
    }
    /** Профиль для страницы волны; null, если пользователь неизвестен */
    public profile(userId: unknown): TasteProfile | null {
        if (!isId(userId)) return null;
        const cached = this.cache.get(userId);
        if (cached && Date.now() - cached.at < CACHE_MS) return cached.profile;
        return this.compute(userId).profile;
    }
    /** Вкус для страницы истории: считается заново при каждом открытии */
    public view(userId: unknown): TasteView | null {
        return isId(userId) ? this.compute(userId).view : null;
    }
    /** Убрать артиста или тег из вкуса или вернуть; false, если ввод неверный или файл не записан */
    public setRemoved(userId: unknown, kind: unknown, key: unknown, removed: unknown): boolean {
        if (!isId(userId) || typeof removed !== 'boolean') return false;
        const current = this.readOverrides(userId);
        let next: TasteOverrides;
        if (kind === 'artist' && isId(key)) next = { ...current, artists: removed ? [...new Set([key, ...current.artists])] : current.artists.filter((id) => id !== key) };
        else if (kind === 'tag' && isTagKey(key)) next = { ...current, tags: removed ? [...new Set([key, ...current.tags])] : current.tags.filter((tag) => tag !== key) };
        else return false;
        try {
            mkdirSync(this.directory, { recursive: true });
            writeFileSync(this.file(userId) + '.tmp', JSON.stringify(next), 'utf8');
            renameSync(this.file(userId) + '.tmp', this.file(userId));
        } catch (error) {
            console.warn('Вкус волны: убранное из вкуса не записано', error);
            return false;
        }
        this.overrides.set(userId, next);
        this.cache.delete(userId);
        return true;
    }
    /** Отметки «Больше такого» поменялись: профиль пересчитается при следующем запросе */
    public invalidate(userId: unknown): void {
        if (isId(userId)) this.cache.delete(userId);
    }
}
