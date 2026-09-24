import { appendFileSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, expect, it, vi } from 'vitest';
import { WaveSignals, validateSignal } from './waveSignals';
import type { PlaySignal } from '../types';

const dirs: string[] = [];
const dir = (): string => {
    const created = mkdtempSync(join(tmpdir(), 'wave-signals-'));
    dirs.push(created);
    return created;
};
afterEach(() => {
    for (const created of dirs.splice(0)) rmSync(created, { recursive: true, force: true });
    vi.restoreAllMocks();
});

const signal = (patch: Partial<PlaySignal> = {}): PlaySignal => ({
    at: Date.UTC(2026, 7, 20, 10),
    id: 11,
    artist: 7,
    dur: 200000,
    pos: 190000,
    heard: 185000,
    end: 'done',
    source: 'wave:similar',
    why: 'similar',
    liked: true,
    likedNow: true,
    disliked: false,
    hiddenArtist: false,
    genre: 'techno',
    tags: 'dark',
    ...patch,
});

it('дописывает события в файл месяца и читает их после перезапуска', () => {
    const directory = dir();
    const journal = new WaveSignals(directory);
    expect(journal.add(42, [signal(), signal({ id: 12, at: Date.UTC(2026, 8, 1, 12), end: 'skip', source: 'site:playlist' })])).toBe(2);
    journal.flush();
    expect(readdirSync(directory).sort()).toEqual(['signals-42-2026-08.jsonl', 'signals-42-2026-09.jsonl']);
    const reopened = new WaveSignals(directory);
    expect(reopened.load(42).map((item) => item.id)).toEqual([11, 12]);
    expect(reopened.load(42, Date.UTC(2026, 8, 1)).map((item) => item.id)).toEqual([12]);
    expect(reopened.load(43)).toEqual([]);
});

it('отбрасывает чужой ввод и переживает оборванную строку', () => {
    const directory = dir();
    const journal = new WaveSignals(directory);
    const bad = [
        null, 'x', signal({ id: -1 }), signal({ end: 'boom' as PlaySignal['end'] }), signal({ source: 'evil' }),
        signal({ dur: Infinity }), signal({ at: Date.UTC(2010, 0, 1) }), { ...signal(), liked: 'yes' },
    ];
    expect(journal.add(42, bad)).toBe(0);
    expect(journal.add('42', [signal()])).toBe(0);
    journal.add(42, [signal({ genre: 'a\u0000b\nc'.padEnd(200, 'x') })]);
    journal.flush();
    appendFileSync(join(directory, 'signals-42-2026-08.jsonl'), '{"at":17', 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const loaded = new WaveSignals(directory).load(42);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].genre).toMatch(/^a b c/);
    expect(loaded[0].genre.length).toBe(80);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('битых строк'));
});

it('проверка события: тип очереди сайта и причина волны', () => {
    expect(validateSignal(signal({ source: 'site' }))?.source).toBe('site');
    expect(validateSignal(signal({ source: 'site:single' }))?.source).toBe('site:single');
    expect(validateSignal(signal({ source: 'wave:artist' }))?.source).toBe('wave:artist');
    expect(validateSignal(signal({ why: 'drop table' }))?.why).toBe('');
});
