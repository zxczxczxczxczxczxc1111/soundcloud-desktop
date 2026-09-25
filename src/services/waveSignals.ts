import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { PlaySignal } from '../types';

const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 24 * 3600000;
const ENDS = new Set(['done', 'skip', 'stop']);

export function text(value: unknown, max: number): string {
    if (typeof value !== 'string') return '';
    // Управляющие символы журналу не нужны: он читается построчно
    return Array.from(value, (char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char)).join('').trim().slice(0, max);
}
/** Путь публичного трека /user/track */
export const TRACK_PATH = /^\/[a-z0-9_-]{1,100}\/[a-z0-9_-]{1,255}$/i;
/** Обложка только с CDN SoundCloud */
export const ARTWORK_URL = /^https:\/\/[a-z0-9-]+\.sndcdn\.com\/[\w./-]+$/i;
export const trackPathOf = (value: unknown): string => (typeof value === 'string' && TRACK_PATH.test(value) ? value : '');
export const artworkOf = (value: unknown): string => (typeof value === 'string' && value.length <= 400 && ARTWORK_URL.test(value) ? value : '');
export const MAX_SPANS = 64;

/** Сыгранные участки: пары [с, по] в пределах суток, слитые и по порядку; кривая пара отбрасывается, кривой список даёт undefined */
export function cleanSpans(value: unknown): Array<[number, number]> | undefined {
    if (!Array.isArray(value)) return undefined;
    const spans: Array<[number, number]> = [];
    for (const item of value.slice(0, MAX_SPANS)) {
        if (!Array.isArray(item) || item.length !== 2 || !isTime(item[0]) || !isTime(item[1])) continue;
        const from = Math.round(item[0]);
        const to = Math.round(item[1]);
        if (to > from) spans.push([from, to]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const span of spans) {
        const last = merged[merged.length - 1];
        if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
        else merged.push([span[0], span[1]]);
    }
    return merged;
}
/** Уникальное покрытие трека участками, мс */
export const spanCoverage = (spans: ReadonlyArray<readonly [number, number]>): number => spans.reduce((sum, [from, to]) => sum + Math.max(0, to - from), 0);

// Событие со страницы недоверенное: всё, что не проходит проверку, отбрасывается целиком
export function validateSignal(input: unknown, now = Date.now()): PlaySignal | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const value = input as Partial<Record<keyof PlaySignal, unknown>>;
    if (!isId(value.id) || typeof value.at !== 'number' || !Number.isFinite(value.at)) return null;
    // Время страницы: не раньше 2020 года и не из будущего дальше суток
    if (value.at < Date.UTC(2020, 0, 1) || value.at > now + 86400000) return null;
    if (!isTime(value.dur) || !isTime(value.pos) || !isTime(value.heard)) return null;
    if (typeof value.end !== 'string' || !ENDS.has(value.end)) return null;
    const source = text(value.source, 40);
    if (!/^(wave:(similar|fresh|track|artist|playlist|daily|forgotten|group|tracks)|site(:[a-z][a-z_-]{0,23})?)$/.test(source)) return null;
    const flags = ['liked', 'likedNow', 'disliked', 'hiddenArtist'] as const;
    if (flags.some((flag) => typeof value[flag] !== 'boolean')) return null;
    // Поля v3 проверяются по одному: без них запись остаётся v2, а не выдумывает причину смены
    const spans = value.v === 3 ? cleanSpans(value.spans) : undefined;
    const endedBy = value.v === 3 && (value.endedBy === 'user' || value.endedBy === 'auto') ? value.endedBy : undefined;
    const signal: PlaySignal = {
        at: Math.round(value.at),
        id: value.id,
        artist: isId(value.artist) ? value.artist : 0,
        dur: Math.round(value.dur),
        pos: Math.round(value.pos),
        heard: Math.round(value.heard),
        end: value.end as PlaySignal['end'],
        source,
        why: /^[a-zA-Z]{0,20}$/.test(text(value.why, 20)) ? text(value.why, 20) : '',
        liked: value.liked === true,
        likedNow: value.likedNow === true,
        disliked: value.disliked === true,
        hiddenArtist: value.hiddenArtist === true,
        genre: text(value.genre, 80),
        tags: text(value.tags, 300),
        // Поля v2 необязательные: запись без них остаётся записью v1, кривое поле пустеет, а не губит строку
        v: value.v === 3 ? 3 : value.v === 2 ? 2 : 1,
        tz: typeof value.tz === 'number' && Number.isInteger(value.tz) && Math.abs(value.tz) <= 840 ? value.tz : undefined,
        title: text(value.title, 300),
        artistName: text(value.artistName, 200),
        path: trackPathOf(value.path),
        artwork: artworkOf(value.artwork),
        away: value.away === true,
    };
    if (spans) signal.spans = spans;
    if (endedBy) signal.endedBy = endedBy;
    if (value.v === 3 && typeof value.picked === 'boolean') signal.picked = value.picked;
    return signal;
}

// Журнал сигналов волны: строка JSON на прослушивание, файл на пользователя и месяц.
// Только дописывается, поэтому сбой посреди записи портит одну строку, а не весь журнал
export class WaveSignals {
    private pending = new Map<number, PlaySignal[]>();
    private timer: ReturnType<typeof setTimeout> | undefined;

    /** isAway: был ли пользователь не у компьютера большую часть окна [from, to]; страница этого не знает */
    constructor(private directory: string, private delay = 3000, private isAway?: (from: number, to: number) => boolean) {}

    private file(userId: number, at: number): string {
        const date = new Date(at);
        return join(this.directory, 'signals-' + userId + '-' + date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '.jsonl');
    }
    public add(userId: unknown, input: unknown): number {
        if (!isId(userId) || !Array.isArray(input)) return 0;
        const list = this.pending.get(userId) ?? [];
        let added = 0;
        for (const item of input.slice(0, 1000)) {
            const signal = validateSignal(item);
            if (!signal) continue;
            signal.away = this.isAway?.(signal.at, signal.at + Math.max(signal.heard, 1000)) ?? false;
            list.push(signal);
            added++;
        }
        if (!added) return 0;
        this.pending.set(userId, list);
        if (this.timer === undefined) {
            this.timer = setTimeout(() => this.flush(), this.delay);
            this.timer.unref?.();
        }
        return added;
    }
    public flush(): void {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
        if (!this.pending.size) return;
        try {
            mkdirSync(this.directory, { recursive: true });
        } catch (error) {
            console.warn('Папка журнала сигналов не создана:', error);
            return;
        }
        for (const [userId, list] of [...this.pending]) {
            const byFile = new Map<string, string[]>();
            for (const signal of list) {
                const target = this.file(userId, signal.at);
                const lines = byFile.get(target) ?? [];
                lines.push(JSON.stringify(signal));
                byFile.set(target, lines);
            }
            let failed = false;
            for (const [target, lines] of byFile) {
                try {
                    appendFileSync(target, lines.join('\n') + '\n', 'utf8');
                } catch (error) {
                    failed = true;
                    console.warn('Журнал сигналов не записан:', error);
                }
            }
            // Не записалось: события остаются до следующей попытки, но не копятся без предела
            if (failed) this.pending.set(userId, list.slice(-5000));
            else this.pending.delete(userId);
        }
    }
    /** События пользователя не старше since, по порядку записи; битые строки пропускаются */
    public load(userId: unknown, since = 0): PlaySignal[] {
        if (!isId(userId)) return [];
        this.flush();
        let names: string[];
        try {
            names = readdirSync(this.directory).filter((name) => name.startsWith('signals-' + userId + '-') && name.endsWith('.jsonl')).sort();
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Журнал сигналов не прочитан:', error);
            return [];
        }
        const sinceMonth = since ? new Date(since).getFullYear() * 12 + new Date(since).getMonth() : 0;
        const result: PlaySignal[] = [];
        for (const name of names) {
            const match = /-(\d{4})-(\d{2})\.jsonl$/.exec(name);
            if (!match || Number(match[1]) * 12 + Number(match[2]) - 1 < sinceMonth) continue;
            let content: string;
            try {
                content = readFileSync(join(this.directory, name), 'utf8');
            } catch (error) {
                console.warn('Журнал сигналов не прочитан:', error);
                continue;
            }
            let broken = 0;
            for (const line of content.split('\n')) {
                if (!line.trim()) continue;
                try {
                    const signal = validateSignal(JSON.parse(line), Infinity);
                    if (signal && signal.at >= since) result.push(signal);
                } catch {
                    // Строка, оборванная сбоем при записи
                    broken++;
                }
            }
            if (broken) console.warn('Журнал сигналов: пропущено битых строк в ' + name + ': ' + broken);
        }
        return result;
    }
}
