import { appendFileSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, expect, it, vi } from 'vitest';
import { WaveSignals, cleanSpans, spanCoverage, validateSignal } from './waveSignals';
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

it('на время восстановления копии запись ждёт: события копятся в памяти и ложатся после возобновления', () => {
    const directory = dir();
    const journal = new WaveSignals(directory, 0);
    journal.pause();
    expect(journal.add(42, [signal()])).toBe(1);
    journal.flush();
    expect(readdirSync(directory)).toEqual([]);
    journal.resume();
    expect(new WaveSignals(directory).load(42).map((item) => item.id)).toEqual([11]);
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
    for (const kind of ['daily', 'forgotten', 'liked', 'group', 'tracks', 'radar', 'library']) expect(validateSignal(signal({ source: 'wave:' + kind }))?.source).toBe('wave:' + kind);
    expect(validateSignal(signal({ source: 'wave:other' }))).toBeNull();
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

it('запись v3: участки сливаются и проверяются, причина смены и выбор кликом только из допустимых значений', () => {
    const v3 = validateSignal(signal({ v: 3, spans: [[60000, 90000], [0, 30000], [20000, 40000]], endedBy: 'user', picked: true }));
    expect(v3).toEqual(expect.objectContaining({ v: 3, spans: [[0, 40000], [60000, 90000]], endedBy: 'user', picked: true }));
    expect(spanCoverage(v3?.spans ?? [])).toBe(70000);
    // Кривые пары отбрасываются, кривой список пропадает, чужая причина не принимается
    const junk = validateSignal({ ...signal({ v: 3 }), spans: [[5, 1], [0, 'x'], [0, 1e12], [1000, 2000]], endedBy: 'site', picked: 'yes' });
    expect(junk).toEqual(expect.objectContaining({ v: 3, spans: [[1000, 2000]] }));
    expect(junk?.endedBy).toBeUndefined();
    expect(junk?.picked).toBeUndefined();
    expect(validateSignal({ ...signal({ v: 3 }), spans: 'bad' })?.spans).toBeUndefined();
    expect(cleanSpans(Array.from({ length: 100 }, (_, i) => [i * 1000, i * 1000 + 500]))).toHaveLength(64);
    // Поля v3 у записи v2 не принимаются
    const old = validateSignal(signal({ v: 2, spans: [[0, 1000]], endedBy: 'auto' }));
    expect(old?.spans).toBeUndefined();
    expect(old?.endedBy).toBeUndefined();
});

it('запись v4: разбор выдачи волны принимается по полю, кривое поле пропадает, строка остаётся', () => {
    const now = Date.UTC(2026, 8, 26, 12);
    const trace = {
        gen: now - 60000, slot: 7, origin: 'similar', seed: 42, score: 1.23456, known: false, mode: 'fresh', waveGenre: 'phonk, drift phonk',
        libMode: 'smart', laterNow: true, moreNow: false, looped: true, tv: 5, preset: 'calm',
    } as const;
    const v4 = validateSignal(signal({ at: now, v: 4, endedBy: 'user', ...trace }), now);
    expect(v4).toEqual(expect.objectContaining({ v: 4, endedBy: 'user', ...trace, score: 1.23 }));
    const junk = validateSignal({
        ...signal({ at: now, v: 4 }), gen: now + 3 * 86400000, slot: -1, origin: 'drop table', seed: 1.5, score: Infinity, known: 'yes', mode: 'wild',
        waveGenre: '\u0000', libMode: 'random', laterNow: 1, moreNow: 'no', looped: 'yes', tv: 1.5, preset: 'Calm; drop',
    }, now);
    expect(junk).toEqual(expect.objectContaining({ v: 4, id: 11 }));
    for (const field of Object.keys(trace)) expect(junk).not.toHaveProperty(field);
    // Зерно 0 значит «без зерна», место 0 значит «неизвестно»: оба допустимы
    expect(validateSignal(signal({ at: now, v: 4, seed: 0, slot: 0 }), now)).toEqual(expect.objectContaining({ seed: 0, slot: 0 }));
    // Поля v4 у записи v3 не принимаются
    const v3 = validateSignal(signal({ at: now, v: 3, ...trace }), now);
    for (const field of Object.keys(trace)) expect(v3).not.toHaveProperty(field);
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
