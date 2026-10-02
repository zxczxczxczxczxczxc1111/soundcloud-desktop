import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import type { PlaySignal } from '../types';
import { artworkOf, spanCoverage, text, trackPathOf } from './waveSignals';
import { genreMain, type WaveTrack } from './wave';
import { copyKey, nameKey, performerKey, trackCredits } from './trackIdentity';

// Индекс истории прослушиваний поверх журнала сигналов. Первоисточник остаётся JSONL: индекс досинхронизируется
// из него при открытии страницы истории и пересобирается целиком, если файла нет, схема сменилась или файл испорчен
// 2: теги трека и лайк во время прослушивания для модели вкуса волны
// 3: покрытие сыгранными участками, кто сменил трек и выбран ли он кликом (сигналы v3)
// 4: место остановки: «пропущен на» показывает его, а не сколько играло
// 5: разбор выдачи волны для замера (сигналы v4): причина и исходная причина, зерно, поколение, место, оценка вкуса,
//    режим, жанр и порядок «Моей музыки», отметки во время трека
// 6: круг повтора трека, версия модели вкуса, пресет настроения
export const HISTORY_SCHEMA = 6;
/** Трек засчитывается в топах и счётчиках с 30 секунд реально прозвучавшего звука */
export const COUNTED_MS = 30000;
/** Меньше секунды звука: трек сменили с порога. Замер волны это видит, история и счётчики нет */
export const HEARD_MIN_MS = 1000;
/** Круг повтора у записей без пометки: тот же трек сразу после дослушивания, с запасом на паузу */
const LOOP_GAP_MS = 15000;
const DAY = 86400000;
const WEEK_HOURS = 168;
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;

export interface SignalSource {
    load(userId: unknown, since?: number): PlaySignal[];
}
export interface HistoryRow {
    at: number;
    id: number;
    artist: number;
    heard: number;
    dur: number;
    end: string;
    source: string;
    liked: boolean;
    away: boolean;
    /** Где остановился, мс; null у записей, пришедших в индекс без него */
    pos: number | null;
    /** Кто сменил трек: user, auto или пусто у событий до v3 */
    endedBy: string;
    title: string;
    artistName: string;
    path: string;
    artwork: string;
    /** 0: название ещё не добрано, 1: есть, 2: сайт трек не отдал */
    resolved: number;
}
export interface HistoryTop {
    key: number | string;
    name: string;
    artistName: string;
    artwork: string;
    path: string;
    plays: number;
    ms: number;
}
export interface HistoryOverview {
    from: number;
    to: number;
    heard: number;
    counted: number;
    artistCount: number;
    fresh: number;
    artists: HistoryTop[];
    tracks: HistoryTop[];
    genres: HistoryTop[];
    wave: { from: number; binHours: number; bins: number[] };
    /** Минуты звука по часам, 7 строк по 24 часа, неделя с понедельника */
    heat: number[];
    total: number;
    firstAt: number | null;
}
/** Прослушивание для модели вкуса: исход, источник и метки трека */
export interface TastePlay {
    at: number;
    id: number;
    artist: number;
    heard: number;
    dur: number;
    end: string;
    source: string;
    likedNow: boolean;
    away: boolean;
    /** Уникальное покрытие сыгранными участками, мс; null у событий до v3 */
    covered: number | null;
    /** Кто сменил трек; пусто у событий до v3 */
    endedBy: 'user' | 'auto' | '';
    /** Запущен кликом по самому треку (v3) */
    picked: boolean;
    /** Круг повтора: тот же трек сразу после своего конца */
    looped: boolean;
    genre: string;
    tags: string;
    title: string;
    artistName: string;
    artwork: string;
    path: string;
}
/** Счётчики трека за период и его описание для полки (П11) */
export interface TrackLove {
    id: number;
    artist: number;
    done: number;
    early: number;
    loops: number;
    genre: string;
    tags: string;
    title: string;
    artistName: string;
    artwork: string;
    path: string;
    dur: number;
}
/** Меры волны: оценимые прослушивания и что с ними стало */
export interface WaveMeasure {
    /** Дослушанные и переключённые человеком; смена сайтом, закрытие клиента и простой не в счёт */
    plays: number;
    /** Переключено человеком раньше 30 секунд */
    early: number;
    done: number;
    /** Лайк во время прослушивания */
    likes: number;
    /** «Больше такого» во время трека, с сигналов v4 */
    more: number;
    /** «Не нравится», скрытый артист или «Не сейчас» во время трека */
    against: number;
}
export type WaveSlice = WaveMeasure & { key: string };
/** Как попадает волна за период */
export interface WaveQuality {
    from: number;
    to: number;
    /** С какого момента есть данные для замера (сигналы с v3); null, если их нет */
    since: number | null;
    wave: WaveMeasure;
    /** Такой же отрезок перед from; null за всё время */
    previous: WaveMeasure | null;
    /** Своя музыка для сравнения: лайки на сайте и свои треки «Моей музыки» */
    own: WaveMeasure;
    /** По подборке: source без приставки wave: */
    sources: WaveSlice[];
    /** По причине, которую видел человек */
    reasons: WaveSlice[];
    /** По исходной причине, до подмены причиной по вкусу; у записей до v4 подменённая причина пустая */
    origins: WaveSlice[];
    /** Места 1-3 в выдаче против остальных, с сигналов v4 */
    slots: { first: WaveMeasure; later: WaveMeasure };
    /** По пресету настроения, только треки, поставленные с пресетом */
    presets: WaveSlice[];
    artists: number;
    /** Артисты, впервые засчитанные именно в волне за период */
    newArtists: number;
    /** Открытия волны, уже засчитанные за 3 дня до того */
    repeats: number;
    /** По неделям от конца периода, не больше 12 */
    weeks: Array<WaveMeasure & { from: number }>;
    /** По местным суткам, старые слева; только у периода не длиннее 31 дня, иначе пусто */
    days: Array<WaveMeasure & { from: number }>;
}
export interface ResolvedTrack {
    id: number;
    artist: number;
    title: string;
    artistName: string;
    path: string;
    artwork: string;
    genre: string;
    dur: number;
}

const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 24 * 3600000;
/** Колонки схемы 5: у записей до v4 разбора выдачи нет, они остаются пустыми */
const V5_COLUMNS = ['why text', 'origin text', 'seed integer', 'gen integer', 'slot integer', 'score real', 'known integer', 'mode text', 'wave_genre text', 'lib_mode text', 'disliked integer', 'hidden integer', 'later_now integer', 'more_now integer'];
/** Колонки схемы 6 */
const V6_COLUMNS = ['looped integer', 'tv integer', 'preset text'];
const flag = (value: boolean | undefined): number | null => (value === undefined ? null : value ? 1 : 0);
// Замер волны. Оценимое прослушивание: известно, кто сменил трек (сигналы с v3), не простой, не закрытие клиента, не смена самим сайтом,
// не круг повтора: трек на повторе считается одним прослушиванием
const JUDGED = "p.ended_by is not null and p.away = 0 and p.end != 'stop' and not (p.end = 'skip' and p.ended_by = 'auto') and coalesce(p.looped, 0) = 0";
// Строка истории и счётчиков: смена трека с порога в них не видна
const SHOWN = 'p.heard >= ' + HEARD_MIN_MS;
// Рекомендация волны: свои треки «Моей музыки» и трек, с которого волну запустил сам человек, не в счёт
const WAVE = "p.source like 'wave:%' and coalesce(p.why, '') not in ('library', 'seedTrack')";
const OWN = "(p.source = 'site:user-track_likes' or (p.source = 'wave:library' and p.why = 'library'))";
// Открытие: не подборка из своего и не выбранное кликом. Его повтор за 3 дня это недосмотр волны
const DISCOVERY = WAVE + " and p.source not in ('wave:library', 'wave:forgotten', 'wave:radar', 'wave:artistAll') and coalesce(p.picked, 0) = 0";
const MEASURE =
    "count(*) as plays, coalesce(sum(p.end = 'skip' and p.ended_by = 'user' and p.heard < " + COUNTED_MS + '), 0) as early, ' +
    "coalesce(sum(p.end = 'done'), 0) as done, coalesce(sum(p.liked_now = 1), 0) as likes, coalesce(sum(p.more_now = 1), 0) as more, " +
    'coalesce(sum(p.disliked = 1 or p.hidden = 1 or p.later_now = 1), 0) as against';
const WEEK_MS = 7 * DAY;
export const genreKey = (value: unknown): string => text(value, 80).toLowerCase().replace(/\s+/g, ' ');

/** Местное время записи для чтения через getUTC*: пояс из записи, у старых записей пояс машины на тот момент */
export function localClock(at: number, tz?: number | null): Date {
    const offset = typeof tz === 'number' ? tz : -new Date(at).getTimezoneOffset();
    return new Date(at + offset * 60000);
}
export function localDayStart(at: number): number {
    const date = new Date(at);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}
/** Шаг волны периода: не больше 200 столбцов */
export function waveBinHours(from: number, to: number): number {
    const hours = Math.max(1, (to - from) / 3600000);
    return [1, 2, 3, 6, 12, 24, 48].find((step) => hours / step <= 200) ?? WEEK_HOURS;
}
/** Запрос поиска для FTS5: слова в кавычках с поиском по началу, всё остальное отбрасывается */
export function ftsQuery(value: unknown): string {
    const words = text(value, 200).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    return words.slice(0, 8).map((word) => '"' + word + '"*').join(' ');
}

const SCHEMA = [
    'create table if not exists meta(key text primary key, value integer not null)',
    "create table if not exists tracks(id integer primary key, artist integer not null default 0, title text not null default '', artist_name text not null default '', path text not null default '', artwork text not null default '', genre text not null default '', tags text not null default '', dur integer not null default 0, resolved integer not null default 0)",
    'create table if not exists plays(at integer not null, id integer not null, artist integer not null, heard integer not null, dur integer not null, end text not null, source text not null, liked integer not null, liked_now integer not null default 0, away integer not null, tz integer, covered integer, ended_by text, picked integer, pos integer, ' +
        'why text, origin text, seed integer, gen integer, slot integer, score real, known integer, mode text, wave_genre text, lib_mode text, disliked integer, hidden integer, later_now integer, more_now integer, ' +
        'looped integer, tv integer, preset text, primary key(at, id)) without rowid',
    'create index if not exists plays_id on plays(id)',
    'create index if not exists plays_artist on plays(artist, at)',
    'create index if not exists tracks_resolved on tracks(resolved)',
];
const FTS = [
    "create virtual table if not exists tracks_fts using fts5(title, artist_name, content='tracks', content_rowid='id', tokenize='unicode61 remove_diacritics 2')",
    'create trigger if not exists tracks_ai after insert on tracks begin insert into tracks_fts(rowid, title, artist_name) values (new.id, new.title, new.artist_name); end',
    "create trigger if not exists tracks_ad after delete on tracks begin insert into tracks_fts(tracks_fts, rowid, title, artist_name) values ('delete', old.id, old.title, old.artist_name); end",
    "create trigger if not exists tracks_au after update of title, artist_name on tracks begin insert into tracks_fts(tracks_fts, rowid, title, artist_name) values ('delete', old.id, old.title, old.artist_name); insert into tracks_fts(rowid, title, artist_name) values (new.id, new.title, new.artist_name); end",
];
const UPSERT_TRACK =
    'insert into tracks(id, artist, title, artist_name, path, artwork, genre, tags, dur, resolved) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict(id) do update set ' +
    'artist = case when excluded.artist > 0 then excluded.artist else tracks.artist end, ' +
    "title = case when excluded.title != '' then excluded.title else tracks.title end, " +
    "artist_name = case when excluded.artist_name != '' then excluded.artist_name else tracks.artist_name end, " +
    "path = case when excluded.path != '' then excluded.path else tracks.path end, " +
    "artwork = case when excluded.artwork != '' then excluded.artwork else tracks.artwork end, " +
    "genre = case when excluded.genre != '' then excluded.genre else tracks.genre end, " +
    "tags = case when excluded.tags != '' then excluded.tags else tracks.tags end, " +
    'dur = case when excluded.dur > 0 then excluded.dur else tracks.dur end, ' +
    "resolved = case when excluded.title != '' or tracks.title != '' then 1 else max(tracks.resolved, excluded.resolved) end";
const ROW =
    "select p.at, p.id, p.artist, p.heard, p.dur, p.end, p.source, p.liked, p.away, p.pos, coalesce(p.ended_by, '') as endedBy, " +
    "coalesce(t.title, '') as title, coalesce(t.artist_name, '') as artistName, coalesce(t.path, '') as path, coalesce(t.artwork, '') as artwork, coalesce(t.resolved, 0) as resolved " +
    'from plays p left join tracks t on t.id = p.id';

type Values = Record<string, unknown>;
const num = (value: unknown): number => (typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : 0);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const rowTrack = (row: Values): WaveTrack => ({ id: num(row.id), title: str(row.title), user_id: num(row.artist), user: { id: num(row.artist), username: str(row.artistName) }, duration: num(row.dur) });
// Исполнитель трека истории: своя загрузка это аккаунт, чужая песня на канале это исполнитель из названия,
// а если у исполнителя среди прослушанного есть свой аккаунт, то этот аккаунт. rows это треки всей истории
function performers(rows: Values[]): (row: Values) => string {
    const keys = new Map<number, string>();
    const accounts = new Map<string, number>();
    for (const row of rows) {
        const key = performerKey(num(row.artist), str(row.artistName), trackCredits(rowTrack(row)));
        keys.set(num(row.id), key);
        const own = nameKey(str(row.artistName));
        if (key.startsWith('u:') && own && !accounts.has(own)) accounts.set(own, num(row.artist));
    }
    return (row) => {
        const key = keys.get(num(row.id)) ?? performerKey(num(row.artist), str(row.artistName), trackCredits(rowTrack(row)));
        const account = key.startsWith('a:') ? accounts.get(key.slice(2)) : undefined;
        return account ? 'u:' + account : key;
    };
}
// Имя исполнителя чужой песни: первый исполнитель из названия, не сам загрузчик
function performerName(row: Values): string {
    const own = nameKey(str(row.artistName));
    return trackCredits(rowTrack(row)).find((credit) => credit.role === 'artist' && credit.key && credit.key !== own)?.name ?? str(row.artistName);
}
/** Круги повтора: пометка из сигнала, у записей без неё тот же трек сразу после своего дослушивания */
export function loopedPlays(signals: readonly PlaySignal[]): Set<PlaySignal> {
    const loops = new Set<PlaySignal>();
    let previous: PlaySignal | undefined;
    for (const signal of [...signals].sort((a, b) => a.at - b.at)) {
        const after = previous !== undefined && previous.id === signal.id && previous.end === 'done' && signal.at - previous.at <= Math.max(previous.dur, previous.heard) + LOOP_GAP_MS;
        if (signal.looped || after) loops.add(signal);
        previous = signal;
    }
    return loops;
}
const toMeasure = (row: Values | undefined): WaveMeasure => ({
    plays: num(row?.plays), early: num(row?.early), done: num(row?.done), likes: num(row?.likes), more: num(row?.more), against: num(row?.against),
});
function toRow(value: Values): HistoryRow {
    return {
        at: num(value.at),
        id: num(value.id),
        artist: num(value.artist),
        heard: num(value.heard),
        dur: num(value.dur),
        end: str(value.end),
        source: str(value.source),
        liked: num(value.liked) === 1,
        away: num(value.away) === 1,
        pos: value.pos === null || value.pos === undefined ? null : num(value.pos),
        endedBy: str(value.endedBy),
        title: str(value.title),
        artistName: str(value.artistName),
        path: str(value.path),
        artwork: str(value.artwork),
        resolved: num(value.resolved),
    };
}

interface Handle {
    db: DatabaseSync;
    fts: boolean;
}

export class HistoryIndex {
    private handles = new Map<number, Handle>();

    constructor(private directory: string, private source: SignalSource) {}

    private file(userId: number): string {
        return join(this.directory, 'history-' + userId + '.sqlite');
    }
    private create(userId: number): Handle {
        mkdirSync(this.directory, { recursive: true });
        let db = new DatabaseSync(this.file(userId));
        try {
            let version = num((db.prepare('pragma user_version').get() as Values | undefined)?.user_version);
            const added: Record<number, string[]> = {
                2: ['covered integer', 'ended_by text', 'picked integer', 'pos integer', ...V5_COLUMNS, ...V6_COLUMNS], 3: ['pos integer', ...V5_COLUMNS, ...V6_COLUMNS],
                4: [...V5_COLUMNS, ...V6_COLUMNS], 5: V6_COLUMNS,
            };
            if (added[version]) {
                // Со второй по пятую схему колонки добавляются на месте: пересборка потеряла бы названия, добранные у сайта.
                // Журнал перечитывается целиком, чтобы старые записи получили место остановки и то, что есть о выдаче волны.
                // Не вышло: индекс собирается заново ниже, как при любой чужой схеме
                db.exec('begin');
                try {
                    for (const column of added[version]) db.exec('alter table plays add column ' + column);
                    db.exec("delete from meta where key = 'synced_at'");
                    db.exec('pragma user_version = ' + HISTORY_SCHEMA);
                    db.exec('commit');
                    version = HISTORY_SCHEMA;
                } catch (error) {
                    db.exec('rollback');
                    console.warn('История: колонки схемы ' + HISTORY_SCHEMA + ' не добавлены, индекс пересобирается', error);
                }
            }
            if (version !== 0 && version !== HISTORY_SCHEMA) {
                // Индекс другой схемы: собрать заново из журнала
                db.close();
                this.remove(userId);
                db = new DatabaseSync(this.file(userId));
            }
            for (const statement of SCHEMA) db.exec(statement);
            let fts = true;
            try {
                for (const statement of FTS) db.exec(statement);
            } catch (error) {
                // Сборка SQLite без FTS5: поиск уходит в LIKE
                fts = false;
                console.warn('История: FTS5 недоступен, поиск без индекса', error);
            }
            db.exec('pragma user_version = ' + HISTORY_SCHEMA);
            return { db, fts };
        } catch (error) {
            // Открытый дескриптор на Windows не даст удалить испорченный файл
            if (db.isOpen) db.close();
            throw error;
        }
    }
    private remove(userId: number): void {
        for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(this.file(userId) + suffix, { force: true });
    }
    private handle(userId: number): Handle {
        const cached = this.handles.get(userId);
        if (cached) return cached;
        const handle = this.create(userId);
        this.handles.set(userId, handle);
        return handle;
    }
    /** Испорченный индекс удаляется и собирается заново из журнала; остальные ошибки уходят наверх */
    private guarded<T>(userId: number, work: (handle: Handle) => T): T {
        try {
            return work(this.handle(userId));
        } catch (error) {
            const code = (error as { errcode?: unknown }).errcode;
            if (typeof code !== 'number' || ![SQLITE_CORRUPT, SQLITE_NOTADB].includes(code & 0xff)) throw error;
            console.warn('История: индекс испорчен и пересобирается', error);
            const cached = this.handles.get(userId);
            if (cached?.db.isOpen) cached.db.close();
            this.handles.delete(userId);
            this.remove(userId);
            const handle = this.handle(userId);
            this.ingest(handle, 0, userId);
            return work(handle);
        }
    }

    /** Дописать в индекс всё новое из журнала; возвращает число добавленных прослушиваний */
    public sync(userId: unknown): number {
        if (!isId(userId)) return 0;
        return this.guarded(userId, (handle) => {
            const synced = num((handle.db.prepare("select value from meta where key = 'synced_at'").get() as Values | undefined)?.value);
            return this.ingest(handle, synced ? synced - 2 * DAY : 0, userId);
        });
    }
    /**
     * Перечитать журнал целиком: восстановление копии добавило в него старые записи, которые sync не увидит.
     * fresh собирает файл заново: после отката восстановления записи могли и пропасть
     */
    public reindex(userId: unknown, fresh = false): number {
        if (!isId(userId)) return 0;
        if (fresh) {
            const cached = this.handles.get(userId);
            if (cached?.db.isOpen) cached.db.close();
            this.handles.delete(userId);
            this.remove(userId);
        }
        return this.guarded(userId, (handle) => this.ingest(handle, 0, userId));
    }
    private ingest(handle: Handle, since: number, userId: number): number {
        const signals = this.source.load(userId, Math.max(0, since));
        if (!signals.length) return 0;
        const { db } = handle;
        const upsert = db.prepare(UPSERT_TRACK);
        const insert = db.prepare(
            'insert or ignore into plays(at, id, artist, heard, dur, end, source, liked, liked_now, away, tz, covered, ended_by, picked, pos, ' +
                'why, origin, seed, gen, slot, score, known, mode, wave_genre, lib_mode, disliked, hidden, later_now, more_now, looped, tv, preset) ' +
                'values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        );
        // Запись из индекса прошлой схемы: пустые колонки дописываются из журнала, заполненные не трогаются
        const fill = db.prepare(
            'update plays set pos = coalesce(pos, ?), why = coalesce(why, ?), origin = coalesce(origin, ?), seed = coalesce(seed, ?), gen = coalesce(gen, ?), slot = coalesce(slot, ?), ' +
                'score = coalesce(score, ?), known = coalesce(known, ?), mode = coalesce(mode, ?), wave_genre = coalesce(wave_genre, ?), lib_mode = coalesce(lib_mode, ?), ' +
                'disliked = coalesce(disliked, ?), hidden = coalesce(hidden, ?), later_now = coalesce(later_now, ?), more_now = coalesce(more_now, ?), ' +
                'looped = coalesce(looped, ?), tv = coalesce(tv, ?), preset = coalesce(preset, ?) where at = ? and id = ?',
        );
        const loops = loopedPlays(signals);
        let added = 0;
        let latest = 0;
        db.exec('begin');
        try {
            for (const signal of signals) {
                const title = signal.title ?? '';
                upsert.run(signal.id, signal.artist, title, signal.artistName ?? '', signal.path ?? '', signal.artwork ?? '', genreKey(signal.genre), text(signal.tags, 300), signal.dur, title ? 1 : 0);
                const wave = [
                    signal.why, signal.origin ?? null, signal.seed ?? null, signal.gen ?? null, signal.slot ?? null, signal.score ?? null, flag(signal.known),
                    signal.mode ?? null, signal.waveGenre ?? null, signal.libMode ?? null, flag(signal.disliked), flag(signal.hiddenArtist), flag(signal.laterNow), flag(signal.moreNow),
                    loops.has(signal) ? 1 : 0, signal.tv ?? null, signal.preset ?? null,
                ];
                const result = insert.run(
                    signal.at, signal.id, signal.artist, signal.heard, signal.dur, signal.end, signal.source,
                    signal.liked || signal.likedNow ? 1 : 0, signal.likedNow ? 1 : 0, signal.away ? 1 : 0, signal.tz ?? null,
                    signal.spans ? spanCoverage(signal.spans) : null, signal.endedBy ?? null, flag(signal.picked), signal.pos, ...wave,
                );
                if (num(result.changes)) added++;
                else fill.run(signal.pos, ...wave, signal.at, signal.id);
                latest = Math.max(latest, signal.at);
            }
            db.prepare("insert into meta(key, value) values ('synced_at', ?) on conflict(key) do update set value = max(meta.value, excluded.value)").run(latest);
            db.exec('commit');
        } catch (error) {
            db.exec('rollback');
            throw error;
        }
        return added;
    }

    /** Треки, у которых нет названия: их добирает страница сайта */
    public missing(userId: unknown, limit = 200): number[] {
        if (!isId(userId)) return [];
        return this.guarded(userId, ({ db }) =>
            (db.prepare('select id from tracks where resolved = 0 order by id limit ?').all(limit) as Values[]).map((row) => num(row.id)),
        );
    }
    /** Ответ страницы недоверенный: берутся только запрошенные треки с проверенными полями; ненайденные больше не запрашиваются */
    public resolve(userId: unknown, requested: readonly number[], input: unknown): number {
        if (!isId(userId) || !Array.isArray(input)) return 0;
        const wanted = new Set(requested);
        const found: ResolvedTrack[] = [];
        for (const item of input.slice(0, 1000)) {
            if (!item || typeof item !== 'object') continue;
            const value = item as Record<string, unknown>;
            if (!isId(value.id) || !wanted.has(value.id)) continue;
            const title = text(value.title, 300);
            if (!title) continue;
            found.push({
                id: value.id,
                artist: isId(value.artist) ? value.artist : 0,
                title,
                artistName: text(value.artistName, 200),
                path: trackPathOf(value.path),
                artwork: artworkOf(value.artwork),
                genre: genreKey(value.genre),
                dur: isTime(value.dur) ? Math.round(value.dur) : 0,
            });
        }
        return this.guarded(userId, ({ db }) => {
            const upsert = db.prepare(UPSERT_TRACK);
            const giveUp = db.prepare('update tracks set resolved = 2 where id = ? and resolved = 0');
            db.exec('begin');
            try {
                for (const track of found) upsert.run(track.id, track.artist, track.title, track.artistName, track.path, track.artwork, track.genre, '', track.dur, 1);
                const got = new Set(found.map((track) => track.id));
                for (const id of wanted) if (!got.has(id)) giveUp.run(id);
                db.exec('commit');
            } catch (error) {
                db.exec('rollback');
                throw error;
            }
            return found.length;
        });
    }

    /** Сводка за [from, to); from = null значит всё время */
    public overview(userId: unknown, from: number | null, to: number): HistoryOverview | null {
        if (!isId(userId)) return null;
        return this.guarded(userId, ({ db }) => {
            const first = (db.prepare('select min(p.at) as at, count(*) as total from plays p where ' + SHOWN).get() as Values | undefined) ?? {};
            const firstAt = first.at === null || first.at === undefined ? null : num(first.at);
            const start = from ?? (firstAt === null ? localDayStart(to - DAY) : localDayStart(firstAt));
            const range = [start, to] as const;
            const totals = db.prepare('select coalesce(sum(heard), 0) as heard, coalesce(sum(heard >= ?), 0) as counted from plays where at >= ? and at < ?').get(COUNTED_MS, ...range) as Values;

            // Артист это исполнитель, а не загрузчик: сборный канал выкладывает чужие песни, и его «артистом» быть не должно.
            // Песня исполнителя, у которого среди прослушанного есть свой аккаунт, идёт этому аккаунту
            const byTrack = (sql: string, ...args: number[]): Values[] => db.prepare(
                "select p.id, p.artist, count(*) as plays, sum(p.heard) as ms, min(p.at) as first, max(p.at) as last, max(p.dur) as dur, coalesce(t.title, '') as title, " +
                    "coalesce(t.artist_name, '') as artistName, coalesce(t.artwork, '') as artwork, coalesce(t.path, '') as path from plays p left join tracks t on t.id = p.id " +
                    'where p.heard >= ? and p.artist > 0' + sql + ' group by p.id',
            ).all(COUNTED_MS, ...args) as Values[];
            const everything = byTrack('');
            const performerOf = performers(everything);
            // «Новый артист»: первое засчитанное прослушивание исполнителя за всю историю попало в период
            const firstOf = new Map<string, number>();
            for (const row of everything) {
                const key = performerOf(row);
                firstOf.set(key, Math.min(firstOf.get(key) ?? Infinity, num(row.first)));
            }
            const inRange = byTrack(' and p.at >= ? and p.at < ?', ...range);
            // best: самый слушаемый трек группы; у аккаунта имя и ссылка берутся только с его собственной загрузки,
            // а не со сборного канала, чья песня влилась в него
            type Group = { plays: number; ms: number; best: Values | null };
            const groups = new Map<string, Group>();
            const better = (row: Values, than: Values | null): boolean => !than || num(row.plays) > num(than.plays) || (num(row.plays) === num(than.plays) && num(row.last) > num(than.last));
            for (const row of inRange) {
                const key = performerOf(row);
                const group = groups.get(key) ?? { plays: 0, ms: 0, best: null };
                group.plays += num(row.plays);
                group.ms += num(row.ms);
                const own = !key.startsWith('u:') || key === 'u:' + num(row.artist);
                if (own && better(row, group.best)) group.best = row;
                groups.set(key, group);
            }
            // Артисты по времени: у карточки подписано время, и порядок по числу прослушиваний читался бы вразнобой
            const artists = [...groups].sort((a, b) => b[1].ms - a[1].ms || b[1].plays - a[1].plays).slice(0, 25).map(([key, group]) => {
                const best = group.best ?? inRange.find((row) => performerOf(row) === key) ?? {};
                const account = key.startsWith('u:') && group.best !== null;
                const name = account ? str(best.artistName) : performerName(best);
                // У исполнителя без своего аккаунта ссылки нет: путь трека вёл бы на сборный канал
                return { key: key.startsWith('u:') ? Number(key.slice(2)) : key, name, artistName: name, artwork: str(best.artwork), path: account ? str(best.path) : '', plays: group.plays, ms: group.ms };
            });
            const fresh = [...groups.keys()].filter((key) => (firstOf.get(key) ?? 0) >= start).length;
            // Перезаливы одной песни (та же версия, длительность рядом) одной строкой, ведёт самая слушаемая загрузка
            const songs = new Map<string, { plays: number; ms: number; best: Values }>();
            for (const row of inRange) {
                const key = copyKey({ id: num(row.id), title: str(row.title), user_id: num(row.artist), user: { id: num(row.artist), username: str(row.artistName) }, duration: num(row.dur) });
                const song = songs.get(key);
                if (!song) songs.set(key, { plays: num(row.plays), ms: num(row.ms), best: row });
                else {
                    song.plays += num(row.plays);
                    song.ms += num(row.ms);
                    if (num(row.plays) > num(song.best.plays)) song.best = row;
                }
            }
            const tracks = [...songs.values()].sort((a, b) => b.plays - a.plays || b.ms - a.ms).slice(0, 8).map((song) => ({
                key: num(song.best.id), name: str(song.best.title), artistName: str(song.best.artistName), artwork: str(song.best.artwork), path: str(song.best.path), plays: song.plays, ms: song.ms,
            }));
            // Написания одного жанра склеиваются той же таблицей, что у полки волны; подпись это самое слушаемое написание
            const merged = new Map<string, { plays: number; ms: number; labels: Map<string, number> }>();
            for (const row of db.prepare(
                "select t.genre, count(*) as plays, sum(p.heard) as ms from plays p join tracks t on t.id = p.id where p.at >= ? and p.at < ? and p.heard >= ? and t.genre != '' group by t.genre",
            ).all(...range, COUNTED_MS) as Values[]) {
                const main = genreMain(str(row.genre));
                if (!main.key) continue;
                const entry = merged.get(main.key) ?? { plays: 0, ms: 0, labels: new Map<string, number>() };
                entry.plays += num(row.plays);
                entry.ms += num(row.ms);
                entry.labels.set(main.label, (entry.labels.get(main.label) ?? 0) + num(row.plays));
                merged.set(main.key, entry);
            }
            const genres = [...merged].sort((a, b) => b[1].plays - a[1].plays || b[1].ms - a[1].ms).slice(0, 5).map(([key, entry]) => {
                const name = [...entry.labels].sort((a, b) => b[1] - a[1])[0][0];
                return { key, name, artistName: '', artwork: '', path: '', plays: entry.plays, ms: entry.ms };
            });

            const binHours = waveBinHours(start, to);
            const binMs = binHours * 3600000;
            const bins = new Array<number>(Math.max(1, Math.ceil((to - start) / binMs))).fill(0);
            const heat = new Array<number>(7 * 24).fill(0);
            for (const row of db.prepare('select at, heard, tz from plays where at >= ? and at < ?').all(...range) as Values[]) {
                const at = num(row.at);
                const heard = num(row.heard);
                const index = Math.floor((at - start) / binMs);
                if (index >= 0 && index < bins.length) bins[index] += heard;
                const clock = localClock(at, row.tz === null ? null : num(row.tz));
                heat[((clock.getUTCDay() + 6) % 7) * 24 + clock.getUTCHours()] += heard;
            }
            const minutes = (ms: number): number => Math.round(ms / 60000);
            return {
                from: start,
                to,
                heard: num(totals.heard),
                counted: num(totals.counted),
                artistCount: groups.size,
                fresh,
                artists,
                tracks,
                genres,
                wave: { from: start, binHours, bins: bins.map(minutes) },
                heat: heat.map(minutes),
                total: num(first.total),
                firstAt,
            };
        });
    }

    /** Как попадает волна за [from, to); from = null значит всё время, с первой записи, где известно, кто сменил трек */
    public waveQuality(userId: unknown, from: number | null, to: number): WaveQuality | null {
        if (!isId(userId)) return null;
        return this.guarded(userId, ({ db }) => {
            const first = db.prepare('select min(at) as at from plays where ended_by is not null').get() as Values | undefined;
            const since = first?.at === null || first?.at === undefined ? null : num(first.at);
            const start = from ?? since ?? to;
            const judged = (where: string): string => 'from plays p where ' + JUDGED + ' and ' + where;
            const measure = (where: string, ...args: number[]): WaveMeasure => toMeasure(db.prepare('select ' + MEASURE + ' ' + judged(where)).get(...args) as Values | undefined);
            const count = (sql: string, ...args: number[]): number => num((db.prepare(sql).get(...args) as Values | undefined)?.n);
            const range = 'p.at >= ? and p.at < ?';
            const sliced = (key: string, where = ''): WaveSlice[] =>
                (db.prepare('select ' + key + ' as key, ' + MEASURE + ' ' + judged(WAVE + where + ' and ' + range) + ' group by key order by plays desc, key').all(start, to) as Values[])
                    .map((row) => ({ key: str(row.key), ...toMeasure(row) }));
            const weekFrom = Math.max(start, to - 12 * WEEK_MS);
            // Сутки местные и считаются каждая своей границей: переход на летнее время даёт 23 или 25 часов
            const days: WaveQuality['days'] = [];
            if (from !== null && to - start <= 31 * DAY)
                for (let day = localDayStart(start); day < to;) {
                    const next = localDayStart(day + DAY + 12 * 3600000);
                    days.push({ from: day, ...measure(WAVE + ' and ' + range, Math.max(day, start), Math.min(next, to)) });
                    day = next;
                }
            return {
                from: start,
                to,
                since,
                wave: measure(WAVE + ' and ' + range, start, to),
                previous: from === null ? null : measure(WAVE + ' and ' + range, Math.max(0, start - (to - start)), start),
                own: measure(OWN + ' and ' + range, start, to),
                sources: sliced("substr(p.source, 6)"),
                reasons: sliced("coalesce(p.why, '')"),
                // У записей до v4 исходной причины нет: неподменённая причина и есть исходная, подменённая неизвестна
                origins: sliced("case when p.origin is not null then p.origin when p.why in ('tasteArtist', 'tasteTag') then '' else coalesce(p.why, '') end"),
                slots: {
                    first: measure(WAVE + ' and p.slot between 1 and 3 and ' + range, start, to),
                    later: measure(WAVE + ' and p.slot >= 4 and ' + range, start, to),
                },
                presets: sliced('p.preset', ' and p.preset is not null'),
                artists: count('select count(distinct p.artist) as n ' + judged(WAVE + ' and p.artist > 0 and ' + range), start, to),
                newArtists: count(
                    'select count(distinct p.artist) as n ' + judged(WAVE + ' and p.artist > 0 and p.heard >= ? and ' + range + ' and p.at = (select min(q.at) from plays q where q.artist = p.artist and q.heard >= ?)'),
                    COUNTED_MS, start, to, COUNTED_MS,
                ),
                repeats: count(
                    'select count(*) as n ' + judged(DISCOVERY + ' and ' + range + ' and exists (select 1 from plays q where q.id = p.id and q.at < p.at and q.at >= p.at - ? and q.heard >= ?)'),
                    start, to, 3 * DAY, COUNTED_MS,
                ),
                weeks: (db.prepare('select cast((? - p.at) / ? as integer) as week, ' + MEASURE + ' ' + judged(WAVE + ' and ' + range) + ' group by week order by week').all(to, WEEK_MS, weekFrom, to) as Values[])
                    .map((row) => ({ from: to - (num(row.week) + 1) * WEEK_MS, ...toMeasure(row) })),
                days,
            };
        });
    }

    /** Исход треков волны за [from, to) по исходной причине (П9). Без остального отчёта waveQuality: зовётся при каждом пересчёте вкуса */
    public waveOrigins(userId: unknown, from: number, to: number): WaveSlice[] {
        if (!isId(userId)) return [];
        return this.guarded(userId, ({ db }) =>
            (db.prepare(
                "select case when p.origin is not null then p.origin when p.why in ('tasteArtist', 'tasteTag') then '' else coalesce(p.why, '') end as key, " +
                    MEASURE + ' from plays p where ' + JUDGED + ' and ' + WAVE + " and p.source not in ('wave:library', 'wave:forgotten', 'wave:radar', 'wave:artistAll') and p.at >= ? and p.at < ? group by key order by plays desc, key",
            ).all(from, to) as Values[]).map((row) => ({ key: str(row.key), ...toMeasure(row) })),
        );
    }

    /** Любовь к трекам с момента since для «Давно не слушал» (П11): дослушано (покрытие от 80%, перемотка в конец не в счёт),
     *  ранних пропусков человеком и кругов повтора по треку, с описанием трека. Простой системы не в счёт. До limit
     *  самых дослушиваемых */
    public trackLove(userId: unknown, since: number, limit = 5000): TrackLove[] {
        if (!isId(userId)) return [];
        return this.guarded(userId, ({ db }) =>
            (db.prepare(
                'select p.id, max(p.artist) as artist, ' +
                    "coalesce(sum(coalesce(p.looped, 0) = 0 and ((p.dur > 0 and min(p.heard, coalesce(p.covered, p.heard)) >= p.dur * 0.8) or (p.dur <= 0 and p.end = 'done'))), 0) as done, " +
                    "coalesce(sum(p.end = 'skip' and p.ended_by = 'user' and p.heard >= ? and p.heard < ? and coalesce(p.looped, 0) = 0), 0) as early, " +
                    'coalesce(sum(coalesce(p.looped, 0) = 1), 0) as loops, ' +
                    "coalesce(t.genre, '') as genre, coalesce(t.tags, '') as tags, coalesce(t.title, '') as title, coalesce(t.artist_name, '') as artistName, " +
                    "coalesce(t.artwork, '') as artwork, coalesce(t.path, '') as path, max(p.dur) as dur " +
                    'from plays p left join tracks t on t.id = p.id where p.at >= ? and p.away = 0 group by p.id having done > 0 or early > 0 or loops > 0 ' +
                    'order by done desc, loops desc, p.id limit ?',
            ).all(HEARD_MIN_MS, COUNTED_MS, since, Math.max(1, Math.min(20000, Math.floor(limit)))) as Values[]).map((row) => ({
                id: num(row.id), artist: num(row.artist), done: num(row.done), early: num(row.early), loops: num(row.loops),
                genre: str(row.genre), tags: str(row.tags), title: str(row.title), artistName: str(row.artistName), artwork: str(row.artwork), path: str(row.path), dur: num(row.dur),
            })),
        );
    }

    /** Прослушивания с момента since для модели вкуса, старые сверху. Закрытие клиента (stop) тоже здесь: слышанное до него не пропадает */
    public tastePlays(userId: unknown, since: number): TastePlay[] {
        if (!isId(userId)) return [];
        return this.guarded(userId, ({ db }) =>
            (db.prepare(
                "select p.at, p.id, p.artist, p.heard, p.dur, p.end, p.source, p.liked_now, p.away, p.covered, coalesce(p.ended_by, '') as endedBy, p.picked, p.looped, " +
                    "coalesce(t.genre, '') as genre, coalesce(t.tags, '') as tags, coalesce(t.title, '') as title, " +
                    "coalesce(t.artist_name, '') as artistName, coalesce(t.artwork, '') as artwork, coalesce(t.path, '') as path " +
                    'from plays p left join tracks t on t.id = p.id where p.at >= ? order by p.at',
            ).all(since) as Values[]).map((row) => {
                const endedBy = str(row.endedBy);
                return {
                    at: num(row.at),
                    id: num(row.id),
                    artist: num(row.artist),
                    heard: num(row.heard),
                    dur: num(row.dur),
                    end: str(row.end),
                    source: str(row.source),
                    likedNow: num(row.liked_now) === 1,
                    away: num(row.away) === 1,
                    covered: row.covered === null || row.covered === undefined ? null : num(row.covered),
                    endedBy: endedBy === 'user' || endedBy === 'auto' ? endedBy : '',
                    picked: num(row.picked) === 1,
                    looped: num(row.looped) === 1,
                    genre: str(row.genre),
                    tags: str(row.tags),
                    title: str(row.title),
                    artistName: str(row.artistName),
                    artwork: str(row.artwork),
                    path: str(row.path),
                };
            }),
        );
    }

    /** Прослушивания за [from, to), новые сверху */
    public day(userId: unknown, from: number, to: number): HistoryRow[] {
        if (!isId(userId)) return [];
        return this.guarded(userId, ({ db }) => (db.prepare(ROW + ' where p.at >= ? and p.at < ? and ' + SHOWN + ' order by p.at desc limit 2000').all(from, to) as Values[]).map(toRow));
    }
    /** Ближайшие прослушивания до from и после to: для кнопок «предыдущий» и «следующий день» */
    public neighbors(userId: unknown, from: number, to: number): { before: number | null; after: number | null } {
        if (!isId(userId)) return { before: null, after: null };
        return this.guarded(userId, ({ db }) => {
            const before = (db.prepare('select max(p.at) as at from plays p where p.at < ? and ' + SHOWN).get(from) as Values | undefined)?.at;
            const after = (db.prepare('select min(p.at) as at from plays p where p.at >= ? and ' + SHOWN).get(to) as Values | undefined)?.at;
            return { before: before === null || before === undefined ? null : num(before), after: after === null || after === undefined ? null : num(after) };
        });
    }
    /** Поиск по названию и артисту во всей истории, новые сверху */
    public search(userId: unknown, query: unknown, limit = 200): HistoryRow[] {
        if (!isId(userId)) return [];
        return this.guarded(userId, ({ db, fts }) => {
            if (fts) {
                const match = ftsQuery(query);
                if (!match) return [];
                return (db.prepare(ROW + ' where p.id in (select rowid from tracks_fts where tracks_fts match ?) and ' + SHOWN + ' order by p.at desc limit ?').all(match, limit) as Values[]).map(toRow);
            }
            const needle = text(query, 200);
            if (!needle) return [];
            const like = '%' + needle.replace(/[\\%_]/g, (char) => '\\' + char) + '%';
            return (db.prepare(ROW + " where (t.title like ? escape '\\' or t.artist_name like ? escape '\\') and " + SHOWN + ' order by p.at desc limit ?').all(like, like, limit) as Values[]).map(toRow);
        });
    }
    public close(): void {
        for (const { db } of this.handles.values()) {
            try {
                db.close();
            } catch (error) {
                console.warn('История: индекс не закрыт', error);
            }
        }
        this.handles.clear();
    }
}
