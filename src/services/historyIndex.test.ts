import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { COUNTED_MS, HistoryIndex, ftsQuery, genreKey, localClock, localDayStart, loopedPlays, waveBinHours } from './historyIndex';
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
/** Колонки схем 5 и 6: индекс прошлой схемы изображается их удалением */
const V5 = ['why', 'origin', 'seed', 'gen', 'slot', 'score', 'known', 'mode', 'wave_genre', 'lib_mode', 'disliked', 'hidden', 'later_now', 'more_now'];
const V6 = ['looped', 'tv', 'preset'];
const downgrade = (directory: string, version: number, columns: string[]): void => {
    const old = new DatabaseSync(join(directory, 'history-' + USER + '.sqlite'));
    for (const column of columns) old.exec('alter table plays drop column ' + column);
    old.exec('pragma user_version = ' + version);
    old.close();
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

it('модели вкуса уходят теги, лайк во время прослушивания, исход и закрытия клиента', () => {
    const journal = new Journal();
    journal.list = [
        signal({ genre: 'Techno', tags: '"dark techno" berlin', likedNow: true, liked: true }),
        signal({ at: T0 + HOUR, id: 12, end: 'stop', heard: 20000 }),
        signal({ at: T0 + 2 * HOUR, id: 13, end: 'skip', heard: 5000, source: 'site:single', away: true }),
    ];
    const index = open(journal);
    index.sync(USER);
    const plays = index.tastePlays(USER, 0);
    expect(plays.map((item) => item.id)).toEqual([11, 12, 13]);
    expect(plays[0]).toMatchObject({ likedNow: true, genre: 'techno', tags: '"dark techno" berlin', end: 'done', source: 'wave:similar' });
    expect(plays[1]).toMatchObject({ end: 'stop', heard: 20000 });
    // До v3 покрытия и причины смены нет: модель читает такие события по-старому
    expect(plays[2]).toMatchObject({ likedNow: false, away: true, end: 'skip', heard: 5000, covered: null, endedBy: '', picked: false });
    expect(index.tastePlays(USER, T0 + HOUR).map((item) => item.id)).toEqual([12, 13]);
});

it('события v3: покрытие из участков, кто сменил трек и выбран ли он кликом; название для разбора версий', () => {
    const journal = new Journal();
    journal.list = [
        signal({ v: 3, title: 'Artist - Song (slowed)', heard: 90000, spans: [[0, 30000], [60000, 90000]], endedBy: 'user', picked: true }),
        signal({ at: T0 + HOUR, id: 12, v: 3, end: 'skip', heard: 4000, spans: [[0, 4000]], endedBy: 'auto' }),
    ];
    const index = open(journal);
    index.sync(USER);
    expect(index.tastePlays(USER, 0)).toEqual([
        expect.objectContaining({ id: 11, title: 'Artist - Song (slowed)', covered: 60000, endedBy: 'user', picked: true }),
        expect.objectContaining({ id: 12, covered: 4000, endedBy: 'auto', picked: false }),
    ]);
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

it('топ артистов по исполнителю, а не по сборному каналу; перезалив одной песни в топе треков одной строкой', () => {
    const journal = new Journal();
    journal.list = [
        // Сборный канал 50 выкладывает песни Alpha и Bravo; у Alpha есть свой аккаунт 60
        signal({ at: T0, id: 21, artist: 50, v: 2, title: 'Alpha - Night', artistName: 'Hub', dur: 200000 }),
        signal({ at: T0 + HOUR, id: 21, artist: 50 }),
        signal({ at: T0 + 2 * HOUR, id: 22, artist: 50, v: 2, title: 'Bravo - Day', artistName: 'Hub', dur: 180000 }),
        signal({ at: T0 + 3 * HOUR, id: 23, artist: 60, v: 2, title: 'Night', artistName: 'Alpha', path: '/alpha/night', dur: 200000 }),
    ];
    const index = open(journal);
    index.sync(USER);
    const view = index.overview(USER, T0 - HOUR, T0 + 23 * HOUR);
    expect(view).not.toBeNull();
    if (!view) return;
    expect(view.artists.map((artist) => [artist.key, artist.name, artist.plays, artist.path])).toEqual([
        [60, 'Alpha', 3, '/alpha/night'],
        ['a:bravo', 'Bravo', 1, ''],
    ]);
    expect(view.artistCount).toBe(2);
    expect(view.fresh).toBe(2);
    // Night на канале и у самого Alpha: одна песня с тремя прослушиваниями
    expect(view.tracks.map((track) => [track.name, track.plays])).toEqual([['Alpha - Night', 3], ['Bravo - Day', 1]]);
});

it('артисты идут по времени прослушивания, которое у них подписано', () => {
    const journal = new Journal();
    journal.list = [
        // У Короткого два прослушивания по минуте, у Длинного одно на пять минут
        signal({ at: T0, id: 31, artist: 70, v: 2, title: 'раз', artistName: 'Короткий', heard: 60000 }),
        signal({ at: T0 + HOUR, id: 31, artist: 70, heard: 60000 }),
        signal({ at: T0 + 2 * HOUR, id: 32, artist: 71, v: 2, title: 'два', artistName: 'Длинный', heard: 300000 }),
    ];
    const index = open(journal);
    index.sync(USER);
    expect(index.overview(USER, T0 - HOUR, T0 + 23 * HOUR)?.artists.map((artist) => [artist.name, artist.plays, artist.ms])).toEqual([
        ['Длинный', 1, 300000],
        ['Короткий', 2, 120000],
    ]);
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

it('индекс второй схемы получает колонки v3 на месте: добранные у сайта названия не теряются', () => {
    const directory = dir();
    // Индекс схемы 2, как его оставила версия 0.7.0: название трека пришло от сайта, в журнале его нет
    const journal = new Journal();
    journal.list = [signal()];
    const first = open(journal, directory);
    first.sync(USER);
    expect(first.resolve(USER, [11], [{ id: 11, title: 'С сайта' }])).toBe(1);
    first.close();
    downgrade(directory, 2, ['covered', 'ended_by', 'picked', 'pos', ...V5, ...V6]);
    journal.list.push(signal({ at: T0 + HOUR, id: 12, v: 3, spans: [[0, 50000]], endedBy: 'auto' }));
    const index = open(journal, directory);
    const warn = vi.spyOn(console, 'warn');
    expect(index.sync(USER)).toBe(1);
    expect(warn).not.toHaveBeenCalled();
    expect(index.tastePlays(USER, 0)).toEqual([
        expect.objectContaining({ id: 11, title: 'С сайта', covered: null, endedBy: '' }),
        expect.objectContaining({ id: 12, covered: 50000, endedBy: 'auto' }),
    ]);
    // Трек 11 не просится у сайта заново, трек 12 без названия в журнале просится
    expect(index.missing(USER)).toEqual([12]);
    // Журнал перечитан целиком: старая запись получила место остановки
    expect(index.day(USER, T0, T0 + 2 * HOUR).map((row) => [row.id, row.pos])).toEqual([[12, 190000], [11, 190000]]);
});

it('индекс третьей схемы получает место остановки на месте: названия остаются, старые записи дозаполняются из журнала', () => {
    const directory = dir();
    const journal = new Journal();
    journal.list = [signal({ end: 'skip', heard: 40000, pos: 150000 })];
    const first = open(journal, directory);
    first.sync(USER);
    expect(first.resolve(USER, [11], [{ id: 11, title: 'С сайта' }])).toBe(1);
    first.close();
    downgrade(directory, 3, ['pos', ...V5, ...V6]);
    const index = open(journal, directory);
    expect(index.sync(USER)).toBe(0);
    expect(journal.calls[journal.calls.length - 1]).toBe(0);
    expect(index.day(USER, T0, T0 + HOUR)).toEqual([expect.objectContaining({ id: 11, title: 'С сайта', pos: 150000, heard: 40000 })]);
});

it('индекс четвёртой схемы получает разбор выдачи волны на месте: названия остаются, записи v4 дозаполняются из журнала', () => {
    const directory = dir();
    const journal = new Journal();
    journal.list = [
        signal({ v: 3, why: 'tasteTag', disliked: true }),
        signal({
            at: T0 + HOUR, id: 12, v: 4, why: 'tasteArtist', origin: 'similar', seed: 3, gen: T0 + HOUR - 5000, slot: 4, score: 1.25, known: true,
            mode: 'fresh', waveGenre: 'phonk', laterNow: true, moreNow: false,
        }),
        signal({ at: T0 + 2 * HOUR, id: 13, v: 4, source: 'wave:library', why: 'library', origin: 'library', seed: 0, gen: T0, slot: 0, mode: 'similar', libMode: 'smart' }),
    ];
    const first = open(journal, directory);
    first.sync(USER);
    expect(first.resolve(USER, [11], [{ id: 11, title: 'С сайта' }])).toBe(1);
    first.close();
    downgrade(directory, 4, [...V5, ...V6]);
    const index = open(journal, directory);
    const warn = vi.spyOn(console, 'warn');
    expect(index.sync(USER)).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    expect(index.day(USER, T0, T0 + HOUR)).toEqual([expect.objectContaining({ id: 11, title: 'С сайта' })]);
    index.close();
    const db = new DatabaseSync(join(directory, 'history-' + USER + '.sqlite'));
    const rows = db.prepare('select id, ' + V5.join(', ') + ' from plays order by at').all();
    db.close();
    expect(rows).toEqual([
        // Запись до v4: причина и «Не нравится» есть, разбора выдачи нет
        expect.objectContaining({ id: 11, why: 'tasteTag', origin: null, gen: null, slot: null, score: null, known: null, disliked: 1, later_now: null }),
        expect.objectContaining({
            id: 12, why: 'tasteArtist', origin: 'similar', seed: 3, gen: T0 + HOUR - 5000, slot: 4, score: 1.25, known: 1, mode: 'fresh', wave_genre: 'phonk',
            lib_mode: null, disliked: 0, hidden: 0, later_now: 1, more_now: 0,
        }),
        expect.objectContaining({ id: 13, origin: 'library', seed: 0, slot: 0, score: null, lib_mode: 'smart' }),
    ]);
});

it('индекс пятой схемы получает круги повтора, версию модели и пресет на месте: названия остаются', () => {
    const directory = dir();
    const journal = new Journal();
    journal.list = [
        signal({ v: 4, endedBy: 'auto' }),
        // Круг повтора до пометки в сигнале: тот же трек сразу после дослушивания
        signal({ at: T0 + 200000, v: 4, endedBy: 'auto' }),
        signal({ at: T0 + HOUR, id: 12, v: 4, end: 'skip', heard: 20000, endedBy: 'user', tv: 5, preset: 'calm' }),
        signal({ at: T0 + HOUR + 20000, id: 12, v: 4, endedBy: 'auto', looped: true }),
    ];
    const first = open(journal, directory);
    first.sync(USER);
    expect(first.resolve(USER, [11], [{ id: 11, title: 'С сайта' }])).toBe(1);
    first.close();
    downgrade(directory, 5, V6);
    const index = open(journal, directory);
    const warn = vi.spyOn(console, 'warn');
    expect(index.sync(USER)).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    expect(index.day(USER, T0, T0 + HOUR).map((row) => row.title)).toEqual(['С сайта', 'С сайта']);
    expect(index.tastePlays(USER, 0).map((play) => [play.id, play.looped])).toEqual([[11, false], [11, true], [12, false], [12, true]]);
    index.close();
    const db = new DatabaseSync(join(directory, 'history-' + USER + '.sqlite'));
    const rows = db.prepare('select id, ' + V6.join(', ') + ' from plays order by at').all();
    const version = db.prepare('pragma user_version').get();
    db.close();
    expect(rows).toEqual([
        expect.objectContaining({ id: 11, looped: 0, tv: null, preset: null }),
        expect.objectContaining({ id: 11, looped: 1, tv: null, preset: null }),
        expect.objectContaining({ id: 12, looped: 0, tv: 5, preset: 'calm' }),
        expect.objectContaining({ id: 12, looped: 1, tv: null, preset: null }),
    ]);
    expect(version).toEqual(expect.objectContaining({ user_version: 6 }));
});

it('круг повтора: пометка сигнала или тот же трек сразу после своего дослушивания', () => {
    const list = [
        signal(),
        signal({ at: T0 + 210000 }),
        // Через два часа это новое прослушивание, после пропуска тоже
        signal({ at: T0 + 2 * HOUR }),
        signal({ at: T0 + 3 * HOUR, end: 'skip', heard: 5000, endedBy: 'user' }),
        signal({ at: T0 + 3 * HOUR + 6000 }),
        signal({ at: T0 + 4 * HOUR, id: 12, looped: true }),
    ];
    const loops = loopedPlays(list);
    expect(list.map((item) => loops.has(item))).toEqual([false, true, false, false, false, true]);
    // Порядок журнала не важен: круги ищутся по времени начала
    expect(loopedPlays([list[1], list[0]]).has(list[1])).toBe(true);
});

it('В3: разрез по пресету только по трекам, поставленным с пресетом', () => {
    const wave = (patch: Partial<PlaySignal>): PlaySignal => signal({ v: 4, endedBy: 'auto', why: 'similar', origin: 'similar', ...patch });
    const journal = new Journal();
    journal.list = [
        wave({ at: T0, id: 31, preset: 'sad' }),
        wave({ at: T0 + HOUR, id: 32, preset: 'sad', end: 'skip', heard: 5000, pos: 5000, endedBy: 'user' }),
        wave({ at: T0 + 2 * HOUR, id: 33, preset: 'calm' }),
        wave({ at: T0 + 3 * HOUR, id: 34 }),
    ];
    const index = open(journal);
    index.sync(USER);
    const q = index.waveQuality(USER, T0, T0 + DAY);
    expect(q?.wave.plays).toBe(4);
    expect(q?.presets.map((slice) => [slice.key, slice.plays, slice.early])).toEqual([['sad', 2, 1], ['calm', 1, 0]]);
});

it('П11: любовь к трекам: дослушано по покрытию, ранние пропуски человеком, круги повтора; простой и перемотка в конец не в счёт', () => {
    const journal = new Journal();
    journal.list = [
        signal({ at: T0, id: 31, title: 'Любимая' }),
        signal({ at: T0 + 300000, id: 31, looped: true }),
        signal({ at: T0 + 600000, id: 31, looped: true }),
        signal({ at: T0 + HOUR, id: 31 }),
        // Перемотка в конец: done, но покрыто мало
        signal({ at: T0 + 2 * HOUR, id: 32, heard: 30000, spans: [[0, 30000]], pos: 199000 }),
        signal({ at: T0 + 3 * HOUR, id: 33, end: 'skip', heard: 5000, pos: 5000, endedBy: 'user' }),
        // Простой системы и смена самим сайтом не любовь и не пропуск
        signal({ at: T0 + 4 * HOUR, id: 34, away: true }),
        signal({ at: T0 + 5 * HOUR, id: 35, end: 'skip', heard: 5000, pos: 5000, endedBy: 'auto' }),
    ];
    const index = open(journal);
    index.sync(USER);
    const love = index.trackLove(USER, T0 - DAY);
    expect(love.map((entry) => [entry.id, entry.done, entry.early, entry.loops])).toEqual([[31, 2, 0, 2], [33, 0, 1, 0]]);
    expect(love[0]).toMatchObject({ artist: 7, title: 'Любимая', dur: 200000 });
    expect(index.trackLove(USER, T0 + 2 * HOUR).map((entry) => entry.id)).toEqual([33]);
    expect(index.trackLove(USER, T0 - DAY, 1)).toHaveLength(1);
    expect(index.trackLove('x', T0)).toEqual([]);
});

it('круги повтора в замер не идут, смена с порога идёт ранним пропуском, но история и счётчики её не показывают', () => {
    const wave = (patch: Partial<PlaySignal>): PlaySignal => signal({ v: 4, endedBy: 'auto', title: 'Круг', why: 'tasteArtist', origin: 'similar', ...patch });
    const journal = new Journal();
    journal.list = [
        wave({ at: T0, id: 21 }),
        wave({ at: T0 + 200000, id: 21, looped: true }),
        wave({ at: T0 + 400000, id: 21, looped: true }),
        wave({ at: T0 + HOUR, id: 22, title: 'Порог', why: 'genreFresh', origin: 'genreFresh', end: 'skip', heard: 400, pos: 400, endedBy: 'user' }),
        // Запись до v4: неподменённая причина и есть исходная, подменённая неизвестна
        signal({ at: T0 + 2 * HOUR, id: 23, v: 3, endedBy: 'auto', why: 'tasteTag' }),
        signal({ at: T0 + 3 * HOUR, id: 24, v: 3, endedBy: 'auto', why: 'similar' }),
    ];
    const index = open(journal);
    index.sync(USER);
    const q = index.waveQuality(USER, T0, T0 + DAY);
    expect(q?.wave).toMatchObject({ plays: 4, early: 1, done: 3 });
    expect(q?.reasons.map((slice) => [slice.key, slice.plays])).toEqual([['genreFresh', 1], ['similar', 1], ['tasteArtist', 1], ['tasteTag', 1]]);
    expect(q?.origins.map((slice) => [slice.key, slice.plays])).toEqual([['similar', 2], ['', 1], ['genreFresh', 1]]);
    // П9: тот же разрез отдельным лёгким запросом для вкуса
    expect(index.waveOrigins(USER, T0, T0 + DAY).map((slice) => [slice.key, slice.plays, slice.done, slice.early])).toEqual([['similar', 2, 2, 0], ['', 1, 1, 0], ['genreFresh', 1, 0, 1]]);
    expect(index.waveOrigins(USER, T0 + DAY, T0 + 2 * DAY)).toEqual([]);
    expect(index.waveOrigins('x', T0, T0 + DAY)).toEqual([]);
    expect(q?.presets).toEqual([]);
    expect(index.day(USER, T0, T0 + DAY).map((row) => row.id)).toEqual([24, 23, 21, 21, 21]);
    expect(index.search(USER, 'порог')).toEqual([]);
    expect(index.search(USER, 'круг')).toHaveLength(3);
    expect(index.neighbors(USER, T0 + 2 * HOUR, T0 + 3 * HOUR)).toEqual({ before: T0 + 400000, after: T0 + 3 * HOUR });
    expect(index.overview(USER, T0, T0 + DAY)?.total).toBe(5);
});

it('строка журнала дня отдаёт место остановки и кто сменил трек', () => {
    const journal = new Journal();
    journal.list = [
        signal({ v: 3, end: 'skip', heard: 20000, pos: 95000, endedBy: 'user' }),
        signal({ at: T0 + HOUR, id: 12, v: 3, end: 'skip', heard: 60000, pos: 60000, endedBy: 'auto' }),
    ];
    const index = open(journal);
    index.sync(USER);
    expect(index.day(USER, T0, T0 + 2 * HOUR).map((row) => [row.id, row.pos, row.endedBy])).toEqual([[12, 60000, 'auto'], [11, 95000, 'user']]);
});

it('жанры топа склеивают написания: hip-hop & rap, hip-hop/rap и rap один жанр, поджанр составного жанра отдельно', () => {
    const journal = new Journal();
    journal.list = [
        signal({ id: 11, genre: 'Hip-hop & Rap' }),
        signal({ at: T0 + HOUR, id: 11, genre: 'Hip-hop & Rap' }),
        signal({ at: T0 + 2 * HOUR, id: 12, genre: 'Hip-hop/Rap' }),
        signal({ at: T0 + 3 * HOUR, id: 13, genre: 'Rap' }),
        signal({ at: T0 + 4 * HOUR, id: 14, genre: 'Club' }),
        signal({ at: T0 + 5 * HOUR, id: 15, genre: 'Hip Hop/Rap - Trap' }),
        signal({ at: T0 + 6 * HOUR, id: 16, genre: 'Trap' }),
        signal({ at: T0 + 7 * HOUR, id: 17, genre: 'Trap' }),
    ];
    const index = open(journal);
    index.sync(USER);
    expect(index.overview(USER, T0, T0 + DAY)?.genres.map((genre) => [genre.name, genre.plays])).toEqual([
        ['hip-hop & rap', 4],
        ['trap', 3],
        ['club', 1],
    ]);
});

it('замер волны: считаются только оценимые рекомендации, своё отдельно, открытия и повторы', () => {
    const wave = (patch: Partial<PlaySignal>): PlaySignal => signal({ v: 4, endedBy: 'auto', ...patch });
    const journal = new Journal();
    journal.list = [
        // До v3 неизвестно, кто сменил трек: в замер не идёт, но артист уже засчитан
        signal({ at: T0 - 3 * DAY, id: 30, artist: 101 }),
        wave({ at: T0 - 12 * HOUR, id: 31, artist: 106, end: 'skip', heard: 3000, endedBy: 'user', slot: 1 }),
        wave({ at: T0, id: 21, artist: 101, slot: 1, likedNow: true }),
        wave({ at: T0 + HOUR, id: 22, artist: 102, why: 'tasteTag', slot: 2, end: 'skip', heard: 5000, endedBy: 'user', laterNow: true }),
        wave({ at: T0 + 2 * HOUR, id: 21, artist: 101, slot: 3 }),
        wave({ at: T0 + 3 * HOUR, id: 23, artist: 103, source: 'wave:fresh', why: 'fresh', slot: 5, end: 'skip', heard: 60000, endedBy: 'user', moreNow: true }),
        // Сменил сам сайт, простой, закрытие клиента, стартовый трек: не оценка
        wave({ at: T0 + 4 * HOUR, id: 24, artist: 104, slot: 6, end: 'skip', heard: 2000 }),
        wave({ at: T0 + 5 * HOUR, id: 25, artist: 105, slot: 7, away: true }),
        wave({ at: T0 + 6 * HOUR, id: 29, artist: 105, slot: 8, end: 'stop', heard: 40000 }),
        wave({ at: T0 + 7 * HOUR, id: 28, artist: 108, why: 'seedTrack' }),
        // Своё: трек «Моей музыки» внутри волны и лайки на сайте
        wave({ at: T0 + 8 * HOUR, id: 26, artist: 109, source: 'wave:library', why: 'library' }),
        wave({ at: T0 + 9 * HOUR, id: 27, artist: 110, source: 'site:user-track_likes', why: '' }),
    ];
    const index = open(journal);
    index.sync(USER);
    const measure = (plays: number, early: number, done: number, likes = 0, more = 0, against = 0): object => ({ plays, early, done, likes, more, against });
    const day = index.waveQuality(USER, T0, T0 + DAY);
    expect(day).toMatchObject({
        from: T0,
        to: T0 + DAY,
        since: T0 - 12 * HOUR,
        wave: measure(4, 1, 2, 1, 1, 1),
        previous: measure(1, 1, 0),
        own: measure(2, 0, 2),
        sources: [{ key: 'similar', ...measure(3, 1, 2, 1, 0, 1) }, { key: 'fresh', ...measure(1, 0, 0, 0, 1) }],
        reasons: [{ key: 'similar', plays: 2 }, { key: 'fresh', plays: 1 }, { key: 'tasteTag', plays: 1 }],
        slots: { first: measure(3, 1, 2, 1, 0, 1), later: measure(1, 0, 0, 0, 1) },
        artists: 3,
        newArtists: 1,
        repeats: 1,
        weeks: [{ from: T0 + DAY - 7 * DAY, plays: 4 }],
    });
    // По местным суткам: первые начинаются с полуночи дня T0, следующие с полуночи после, в сумме весь период
    const days = day?.days ?? [];
    expect(days[0].from).toBe(localDayStart(T0));
    expect(days.slice(1).every((entry, i) => entry.from === localDayStart(days[i].from + DAY + 12 * HOUR))).toBe(true);
    expect(days.reduce((sum, entry) => sum + entry.plays, 0)).toBe(4);
    expect(days.reduce((sum, entry) => sum + entry.early, 0)).toBe(1);
    // За всё время отсчёт с первой записи, где известно, кто сменил трек; по суткам только короткие периоды
    expect(index.waveQuality(USER, null, T0 + DAY)).toMatchObject({ from: T0 - 12 * HOUR, previous: null, wave: { plays: 5, early: 2 }, days: [] });
    expect(index.waveQuality(USER, T0 - 40 * DAY, T0 + DAY)?.days).toEqual([]);
    expect(index.waveQuality(USER, T0 - 29 * DAY, T0 + DAY)?.days.length).toBeGreaterThanOrEqual(30);
    expect(index.waveQuality(0, T0, T0 + DAY)).toBeNull();
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
