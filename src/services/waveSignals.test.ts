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

it('запись v2: название, артист, адрес, обложка и пояс; мусор в них отбрасывается, запись остаётся', () => {
    const v2 = validateSignal(signal({
        v: 2, tz: 180, title: 'кровью', artistName: 'mightymason', path: '/mighty_mason/krovyu-1',
        artwork: 'https://i1.sndcdn.com/artworks-abc-large.jpg',
    }));
    expect(v2).toEqual(expect.objectContaining({ v: 2, tz: 180, title: 'кровью', artistName: 'mightymason', path: '/mighty_mason/krovyu-1', artwork: 'https://i1.sndcdn.com/artworks-abc-large.jpg' }));
    const junk = validateSignal(signal({ v: 2, tz: 5000, path: '/user/track/s-SECRET', artwork: 'https://evil.test/x.jpg', title: 'x'.repeat(400) }));
    expect(junk).not.toBeNull();
    expect(junk?.tz).toBeUndefined();
    expect(junk?.path).toBe('');
    expect(junk?.artwork).toBe('');
    expect(junk?.title?.length).toBe(300);
    // Запись до v2 читается как раньше
    expect(validateSignal(signal())).toEqual(expect.objectContaining({ v: 1, title: '', path: '' }));
});

it('«не у компьютера» решает main, признак со страницы не принимается', () => {
    const directory = dir();
    const away = vi.fn((from: number) => from === Date.UTC(2026, 7, 20, 10));
    const journal = new WaveSignals(directory, 3000, away);
    journal.add(42, [signal({ away: false }), signal({ id: 12, at: Date.UTC(2026, 7, 20, 12), away: true })]);
    journal.flush();
    const loaded = new WaveSignals(directory).load(42);
    expect(loaded.map((item) => [item.id, item.away])).toEqual([[11, true], [12, false]]);
    expect(away).toHaveBeenCalledWith(Date.UTC(2026, 7, 20, 10), Date.UTC(2026, 7, 20, 10) + 185000);
});
