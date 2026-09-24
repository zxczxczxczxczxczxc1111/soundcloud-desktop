import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { COUNTED_MS, HistoryIndex, ftsQuery, genreKey, localClock, waveBinHours } from './historyIndex';
import type { SignalSource } from './historyIndex';
import type { PlaySignal } from '../types';

const dirs: string[] = [];
const indexes: HistoryIndex[] = [];
const dir = (): string => {
    const created = mkdtempSync(join(tmpdir(), 'history-index-'));
    dirs.push(created);
    return created;
};
afterEach(() => {
    for (const index of indexes.splice(0)) index.close();
    for (const created of dirs.splice(0)) rmSync(created, { recursive: true, force: true });
    vi.restoreAllMocks();
});

const USER = 1071356185;
const HOUR = 3600000;
const DAY = 86400000;
const T0 = Date.UTC(2026, 8, 21, 9);

const signal = (patch: Partial<PlaySignal> = {}): PlaySignal => ({
    at: T0,
    id: 11,
    artist: 7,
    dur: 200000,
    pos: 190000,
    heard: 185000,
    end: 'done',
    source: 'wave:similar',
    why: 'similar',
    liked: false,
    likedNow: false,
    disliked: false,
    hiddenArtist: false,
    genre: '',
    tags: '',
    ...patch,
});
class Journal implements SignalSource {
    public list: PlaySignal[] = [];
    public calls: number[] = [];
    load(userId: unknown, since = 0): PlaySignal[] {
        this.calls.push(since);
        return userId === USER ? this.list.filter((item) => item.at >= since) : [];
    }
}
const open = (journal: Journal, directory = dir()): HistoryIndex => {
    const index = new HistoryIndex(directory, journal);
    indexes.push(index);
    return index;
};

it('sync переносит журнал один раз и дальше читает только хвост', () => {
    const journal = new Journal();
    journal.list = [signal(), signal({ at: T0 + HOUR, id: 12 })];
    const index = open(journal);
    expect(index.sync(USER)).toBe(2);
    expect(index.sync(USER)).toBe(0);
    expect(journal.calls).toEqual([0, T0 + HOUR - 2 * DAY]);
    journal.list.push(signal({ at: T0 + 2 * HOUR, id: 13 }));
    expect(index.sync(USER)).toBe(1);
    expect(index.day(USER, T0, T0 + 3 * HOUR).map((row) => row.id)).toEqual([13, 12, 11]);
});

it('чужой или кривой userId не открывает базу', () => {
    const index = open(new Journal());
    expect(index.sync(0)).toBe(0);
    expect(index.sync('1')).toBe(0);
    expect(index.overview(-5, null, T0)).toBeNull();
    expect(index.search(1.5, 'x')).toEqual([]);
});

it('новое название не затирается пустым из старой записи того же трека', () => {
    const journal = new Journal();
    journal.list = [signal({ v: 2, title: 'кровью', artistName: 'mightymason', path: '/mightymason/krovyu' }), signal({ at: T0 + HOUR })];
    const index = open(journal);
    index.sync(USER);
    const rows = index.day(USER, T0, T0 + 2 * HOUR);
    expect(rows.map((row) => [row.title, row.artistName, row.path])).toEqual([
        ['кровью', 'mightymason', '/mightymason/krovyu'],
        ['кровью', 'mightymason', '/mightymason/krovyu'],
    ]);
    expect(index.missing(USER)).toEqual([]);
});

it('resolve берёт только запрошенные треки с проверенными полями, ненайденные больше не просит', () => {
    const journal = new Journal();
    journal.list = [signal({ id: 21 }), signal({ id: 22, at: T0 + HOUR }), signal({ id: 23, at: T0 + 2 * HOUR })];
    const index = open(journal);
    index.sync(USER);
    expect(index.missing(USER)).toEqual([21, 22, 23]);
    const saved = index.resolve(USER, [21, 22], [
        { id: 21, artist: 7, title: 'Первый\u0007', artistName: 'Автор', path: 'javascript:alert(1)', artwork: 'https://evil.test/a.jpg', genre: '  Drum  &  Bass ', dur: 200000 },
        { id: 23, title: 'не просили' },
        { id: 99, title: 'чужой' },
        'мусор',
    ]);
    expect(saved).toBe(1);
    const rows = index.day(USER, T0, T0 + 3 * HOUR);
    const first = rows.find((row) => row.id === 21);
    expect(first).toMatchObject({ title: 'Первый', artistName: 'Автор', path: '', artwork: '' });
    expect(rows.find((row) => row.id === 23)?.title).toBe('');
    expect(index.missing(USER)).toEqual([23]);
    expect(index.overview(USER, null, T0 + 3 * HOUR)?.genres.map((genre) => genre.name)).toEqual(['drum & bass']);
});

it('overview считает засчитанное с 30 секунд, новых артистов и топы', () => {
    const journal = new Journal();
    journal.list = [
        // Артист 7 слушался раньше периода, артист 8 впервые в периоде, артист 9 только пропуском
        signal({ at: T0 - 3 * DAY, id: 11, artist: 7, v: 2, title: 'старый', artistName: 'Семь', artwork: 'https://i1.sndcdn.com/a-large.jpg', genre: 'Techno' }),
        signal({ at: T0, id: 11, artist: 7, genre: 'Techno' }),
        signal({ at: T0 + HOUR, id: 12, artist: 8, v: 2, title: 'новый', artistName: 'Восемь', genre: 'house' }),
        signal({ at: T0 + 2 * HOUR, id: 12, artist: 8, genre: 'house' }),
        signal({ at: T0 + 3 * HOUR, id: 12, artist: 8, genre: 'house' }),
        signal({ at: T0 + 4 * HOUR, id: 13, artist: 9, heard: COUNTED_MS - 1, end: 'skip' }),
    ];
    const index = open(journal);
    index.sync(USER);
    const view = index.overview(USER, T0 - HOUR, T0 + 23 * HOUR);
    expect(view).not.toBeNull();
    if (!view) return;
    expect(view.counted).toBe(4);
    expect(view.heard).toBe(4 * 185000 + COUNTED_MS - 1);
    expect(view.artistCount).toBe(2);
    expect(view.fresh).toBe(1);
    expect(view.artists.map((artist) => [artist.key, artist.name, artist.plays])).toEqual([
        [8, 'Восемь', 3],
        [7, 'Семь', 1],
    ]);
    expect(view.artists[1].artwork).toBe('https://i1.sndcdn.com/a-large.jpg');
    expect(view.tracks.map((track) => [track.key, track.plays])).toEqual([
        [12, 3],
        [11, 1],
    ]);
    expect(view.genres.map((genre) => [genre.name, genre.plays])).toEqual([
        ['house', 3],
        ['techno', 1],
    ]);
    expect(view.total).toBe(6);
    expect(view.firstAt).toBe(T0 - 3 * DAY);
    expect(view.wave.binHours).toBe(1);
    expect(view.wave.bins.length).toBe(24);
    expect(view.wave.bins.slice(0, 3)).toEqual([0, 3, 3]);
});

it('тепловая карта раскладывает звук по местному времени записи, неделя с понедельника', () => {
    const journal = new Journal();
    // 21.09.2026 это понедельник; 09:00 UTC при поясе +180 это 12:00
    journal.list = [signal({ tz: 180, heard: 120000 }), signal({ at: T0 + HOUR, id: 12, tz: -600, heard: 60000 })];
    const index = open(journal);
    index.sync(USER);
    const view = index.overview(USER, T0 - DAY, T0 + DAY);
    expect(view?.heat[12]).toBe(2);
    // 10:00 UTC при поясе -600 это 00:00 того же понедельника
    expect(view?.heat[0]).toBe(1);
    expect(view?.heat.reduce((sum, value) => sum + value, 0)).toBe(3);
});
it('neighbors находит ближайшие прослушивания вне окна', () => {
    const journal = new Journal();
    journal.list = [signal({ at: T0 - 5 * HOUR }), signal({ at: T0, id: 12 }), signal({ at: T0 + 30 * HOUR, id: 13 })];
    const index = open(journal);
    index.sync(USER);
    expect(index.neighbors(USER, T0 - HOUR, T0 + HOUR)).toEqual({ before: T0 - 5 * HOUR, after: T0 + 30 * HOUR });
    expect(index.neighbors(USER, T0 - 10 * HOUR, T0 + 40 * HOUR)).toEqual({ before: null, after: null });
});

it('search находит по началу слова без учёта регистра и диакритики, спецсимволы не ломают запрос', () => {
    const journal = new Journal();
    journal.list = [
        signal({ v: 2, title: 'кровью', artistName: 'mightymason' }),
        signal({ at: T0 + HOUR, id: 12, v: 2, title: 'Café Del Mar', artistName: 'Energy 52' }),
    ];
    const index = open(journal);
    index.sync(USER);
    expect(index.search(USER, 'КРОВ').map((row) => row.id)).toEqual([11]);
    expect(index.search(USER, 'cafe').map((row) => row.id)).toEqual([12]);
    expect(index.search(USER, 'might').map((row) => row.id)).toEqual([11]);
    expect(index.search(USER, '"* OR NEAR(')).toEqual([]);
    expect(index.search(USER, '')).toEqual([]);
});

it('битый файл индекса пересобирается из журнала', () => {
    const directory = dir();
    writeFileSync(join(directory, 'history-' + USER + '.sqlite'), 'это не база');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const journal = new Journal();
    journal.list = [signal()];
    const index = open(journal, directory);
    index.sync(USER);
    expect(index.day(USER, T0, T0 + HOUR)).toHaveLength(1);
});

it('индекс старой схемы пересобирается', () => {
    const directory = dir();
    const journal = new Journal();
    journal.list = [signal()];
    const first = open(journal, directory);
    first.sync(USER);
    first.close();
    const db = new DatabaseSync(join(directory, 'history-' + USER + '.sqlite'));
    db.exec('pragma user_version = 999');
    db.close();
    const second = open(journal, directory);
    expect(second.sync(USER)).toBe(1);
});

it('помощники: шаг волны, запрос поиска, жанр, местное время', () => {
    expect(waveBinHours(0, 24 * HOUR)).toBe(1);
    expect(waveBinHours(0, 30 * DAY)).toBe(6);
    expect(waveBinHours(0, 400 * DAY)).toBe(48);
    expect(waveBinHours(0, 2000 * DAY)).toBe(168);
    expect(ftsQuery('Кровью  "x" OR')).toBe('"кровью"* "x"* "or"*');
    expect(ftsQuery('*()')).toBe('');
    expect(genreKey('  Deep   House ')).toBe('deep house');
    expect(localClock(T0, 180).getUTCHours()).toBe(12);
});
