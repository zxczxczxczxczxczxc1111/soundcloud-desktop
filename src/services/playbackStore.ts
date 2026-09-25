import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WaveReason, WaveTrack } from './wave';
import { artworkOf, text, trackPathOf } from './waveSignals';

export interface SavedQueueItem { track: WaveTrack; explicit: boolean; wave: boolean; reason?: WaveReason }
export interface SavedSeed { kind: 'track' | 'artist' | 'playlist' | 'daily' | 'forgotten' | 'group' | 'tracks'; title: string; tracks: WaveTrack[]; own: WaveTrack[]; order?: 'fixed' | 'blend'; mode?: 'similar' | 'fresh' }
export interface PlaybackSnapshot {
    version: 1; at: number; items: SavedQueueItem[]; index: number; position: number; paused: boolean;
    active: boolean; mode: 'similar' | 'fresh'; genre: string | null; seed: SavedSeed | null; fallback: boolean;
}
export interface LocalMix { id: string; title: string; at: number; tracks: WaveTrack[] }
export interface LibraryCatalog { at: number; tracks: WaveTrack[] }
const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function cleanStoredTrack(input: unknown): WaveTrack | null {
    const value = object(input);
    if (!isId(value.id)) return null;
    const user = object(value.user);
    const duration = typeof value.duration === 'number' && Number.isFinite(value.duration) ? Math.max(0, Math.min(value.duration, 86400000)) : 0;
    const full = typeof value.full_duration === 'number' && Number.isFinite(value.full_duration) ? Math.max(0, Math.min(value.full_duration, 86400000)) : duration;
    const path = trackPathOf(typeof value.permalink_url === 'string' ? value.permalink_url.replace(/^https:\/\/soundcloud\.com/, '') : '');
    return {
        id: value.id, kind: 'track', title: text(value.title, 300), duration, full_duration: full,
        user_id: isId(value.user_id) ? value.user_id : isId(user.id) ? user.id : undefined,
        user: { id: isId(user.id) ? user.id : undefined, username: text(user.username, 200), avatar_url: artworkOf(user.avatar_url) },
        permalink_url: path ? 'https://soundcloud.com' + path : '', artwork_url: artworkOf(value.artwork_url),
        genre: text(value.genre, 80), tag_list: text(value.tag_list, 300),
        policy: ['ALLOW', 'SNIP', 'BLOCK'].includes(String(value.policy)) ? String(value.policy) : undefined,
        streamable: typeof value.streamable === 'boolean' ? value.streamable : undefined,
    };
}
const tracks = (value: unknown, limit: number): WaveTrack[] => Array.isArray(value) ? value.slice(0, limit).map(cleanStoredTrack).filter((track): track is WaveTrack => track !== null) : [];
function cleanReason(input: unknown): WaveReason | undefined {
    const value = object(input);
    const seed = text(value.seed, 300); const genre = text(value.genre, 300); const artist = text(value.artist, 200);
    switch (value.kind) {
        case 'similar': case 'fresh': return { kind: value.kind, seed };
        case 'genreFresh': case 'genrePopular': case 'tasteTag': return { kind: value.kind, genre };
        case 'genreSimilar': case 'mood': return { kind: value.kind, seed, genre };
        case 'artistTrack': case 'tasteArtist': return { kind: value.kind, artist };
        case 'group': return { kind: value.kind, name: text(value.name, 200) };
        case 'newArtist': case 'seedTrack': case 'restored': case 'daily': case 'forgotten': return { kind: value.kind };
        default: return undefined;
    }
}
export function cleanPlaybackSnapshot(input: unknown): PlaybackSnapshot | null {
    const value = object(input);
    if (value.version !== 1 || !Array.isArray(value.items) || value.items.length > 5000 || !Number.isInteger(value.index) || typeof value.paused !== 'boolean') return null;
    const items: SavedQueueItem[] = [];
    for (const raw of value.items) {
        const item = object(raw);
        const track = cleanStoredTrack(item.track);
        if (!track) return null;
        items.push({ track, explicit: item.explicit === true, wave: item.wave === true, reason: cleanReason(item.reason) });
    }
    const index = Number(value.index);
    if (!items.length || index < 0 || index >= items.length) return null;
    const rawSeed = object(value.seed);
    const kind = String(rawSeed.kind);
    const seed: SavedSeed | null = ['track', 'artist', 'playlist', 'daily', 'forgotten', 'group', 'tracks'].includes(kind) ? {
        kind: kind as SavedSeed['kind'], title: text(rawSeed.title, 200), tracks: tracks(rawSeed.tracks, 5000), own: tracks(rawSeed.own, 5000),
        order: rawSeed.order === 'fixed' || rawSeed.order === 'blend' ? rawSeed.order : undefined,
        mode: rawSeed.mode === 'fresh' ? 'fresh' : 'similar',
    } : null;
    return { version: 1, at: Date.now(), items, index, position: typeof value.position === 'number' && Number.isFinite(value.position) ? Math.max(0, Math.min(value.position, 86400000)) : 0,
        paused: value.paused, active: value.active === true, mode: value.mode === 'fresh' ? 'fresh' : 'similar', genre: text(value.genre, 300) || null, seed, fallback: value.fallback === true };
}

// Вызывается только в worker. Снимки отделены по аккаунтам, запись заменяет файл атомарно.
export class PlaybackStore {
    constructor(private directory: string) {}
    private file(user: unknown, kind: string): string {
        if (!isId(user)) throw new Error('Пользователь не определён');
        return join(this.directory, kind + '-' + user + '.json');
    }
    private read(user: unknown, kind: string): unknown {
        try { return JSON.parse(readFileSync(this.file(user, kind), 'utf8')); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Сохранённые данные не прочитаны: ' + kind, error); return null; }
    }
    private write(user: unknown, kind: string, value: unknown): void {
        const file = this.file(user, kind);
        mkdirSync(this.directory, { recursive: true });
        writeFileSync(file + '.tmp', JSON.stringify(value), 'utf8');
        renameSync(file + '.tmp', file);
    }
    public loadSession(user: unknown): PlaybackSnapshot | null { return cleanPlaybackSnapshot(this.read(user, 'session')); }
    public saveSession(user: unknown, input: unknown): boolean {
        const snapshot = cleanPlaybackSnapshot(input);
        if (!snapshot) return false;
        this.write(user, 'session', snapshot); return true;
    }
    public loadCatalog(user: unknown): LibraryCatalog | null {
        const input = object(this.read(user, 'catalog'));
        return typeof input.at === 'number' ? { at: input.at, tracks: tracks(input.tracks, 100000) } : null;
    }
    public saveCatalog(user: unknown, input: unknown): boolean {
        if (!Array.isArray(input) || input.length > 100000) return false;
        this.write(user, 'catalog', { at: Date.now(), tracks: tracks(input, 100000) }); return true;
    }
    public listMixes(user: unknown): LocalMix[] {
        const input = this.read(user, 'mixes');
        if (!Array.isArray(input)) return [];
        return input.slice(0, 100).flatMap((raw) => {
            const item = object(raw);
            return typeof item.id === 'string' && typeof item.at === 'number' ? [{ id: item.id, at: item.at, title: text(item.title, 100), tracks: tracks(item.tracks, 5000) }] : [];
        });
    }
    public saveMix(user: unknown, title: unknown, input: unknown): LocalMix {
        const name = text(title, 100);
        if (!name || !Array.isArray(input) || !input.length || input.length > 5000) throw new Error('Нужны название и от 1 до 5000 треков');
        const list = this.listMixes(user);
        if (list.length >= 100) throw new Error('Сохранено 100 подборок. Удали ненужную перед сохранением новой.');
        const mix = { id: randomUUID(), title: name, at: Date.now(), tracks: tracks(input, 5000) };
        if (mix.tracks.length !== input.length) throw new Error('Некорректные треки подборки');
        this.write(user, 'mixes', [mix, ...list]); return mix;
    }
    public removeMix(user: unknown, id: unknown): boolean {
        const list = this.listMixes(user);
        const next = list.filter((item) => item.id !== id);
        if (next.length === list.length) return false;
        this.write(user, 'mixes', next); return true;
    }
}
