import type { TrackInfo, TrackMeta, TrackUpdateMessage } from './types';

export const TRACK_UPDATE_REASONS = new Set([
    'playback-state-change',
    'track-change',
    'seek-change',
    'initial-state',
    'waveform-seek',
    'timeline-seek',
    'progress',
    'loop',
]);

export function cleanTrackString(value: unknown, maxLength: number): string {
    if (typeof value !== 'string') return '';
    return Array.from(value)
        .filter((char) => {
            const code = char.charCodeAt(0);
            return code >= 32 && code !== 127;
        })
        .join('')
        .trim()
        .slice(0, maxLength);
}

export function cleanTrackUrl(value: unknown): string {
    const raw = cleanTrackString(value, 2048);
    if (!raw) return '';

    try {
        const url = new URL(raw);
        return url.protocol === 'https:' ? url.toString() : '';
    } catch {
        return '';
    }
}

export function validateTrackInfo(data: unknown): TrackInfo | null {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const input = data as Partial<Record<keyof TrackInfo, unknown>>;

    return {
        title: cleanTrackString(input.title, 300),
        author: cleanTrackString(input.author, 200),
        artwork: cleanTrackUrl(input.artwork),
        elapsed: cleanTrackString(input.elapsed, 32),
        duration: cleanTrackString(input.duration, 32),
        isPlaying: typeof input.isPlaying === 'boolean' ? input.isPlaying : false,
        isLiked: typeof input.isLiked === 'boolean' ? input.isLiked : false,
        url: cleanTrackUrl(input.url),
        artistUrl: cleanTrackUrl(input.artistUrl),
    };
}

// Картинки SoundCloud лежат на sndcdn.com: чужой адрес в карточку Discord не попадает
function cleanImageUrl(value: unknown): string {
    const url = cleanTrackUrl(value);
    if (!url) return '';
    const host = new URL(url).hostname;
    return host === 'sndcdn.com' || host.endsWith('.sndcdn.com') ? url : '';
}
function cleanCount(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(Math.min(value, 1e12)) : 0;
}

export function validateTrackMeta(input: unknown): TrackMeta | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const value = input as Partial<Record<keyof TrackMeta, unknown>>;
    if (typeof value.id !== 'number' || !Number.isSafeInteger(value.id) || value.id <= 0) return null;
    return {
        id: value.id,
        url: cleanTrackUrl(value.url),
        genre: cleanTrackString(value.genre, 80),
        tags: cleanTrackString(value.tags, 500),
        plays: cleanCount(value.plays),
        likes: cleanCount(value.likes),
        artist: cleanTrackString(value.artist, 200),
        avatar: cleanImageUrl(value.avatar),
        artwork: cleanImageUrl(value.artwork),
        wave: cleanTrackString(value.wave, 200),
    };
}

export function validateTrackUpdatePayload(payload: unknown): TrackUpdateMessage | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const input = payload as Partial<TrackUpdateMessage>;
    const data = validateTrackInfo(input.data);
    if (!data) return null;
    const reason =
        typeof input.reason === 'string' && TRACK_UPDATE_REASONS.has(input.reason) ? input.reason : 'track-change';

    return { data, reason };
}
