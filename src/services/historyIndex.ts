import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import type { PlaySignal } from '../types';
import { artworkOf, text, trackPathOf } from './waveSignals';

// Индекс истории прослушиваний поверх журнала сигналов. Первоисточник остаётся JSONL: индекс досинхронизируется
// из него при открытии страницы истории и пересобирается целиком, если файла нет, схема сменилась или файл испорчен
// 2: теги трека и лайк во время прослушивания для модели вкуса волны
export const HISTORY_SCHEMA = 2;
/** Трек засчитывается в топах и счётчиках с 30 секунд реально прозвучавшего звука */
export const COUNTED_MS = 30000;
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
    genre: string;
    tags: string;
    artistName: string;
    artwork: string;
    path: string;
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
    'create table if not exists plays(at integer not null, id integer not null, artist integer not null, heard integer not null, dur integer not null, end text not null, source text not null, liked integer not null, liked_now integer not null default 0, away integer not null, tz integer, primary key(at, id)) without rowid',
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
    'select p.at, p.id, p.artist, p.heard, p.dur, p.end, p.source, p.liked, p.away, ' +
    "coalesce(t.title, '') as title, coalesce(t.artist_name, '') as artistName, coalesce(t.path, '') as path, coalesce(t.artwork, '') as artwork, coalesce(t.resolved, 0) as resolved " +
    'from plays p left join tracks t on t.id = p.id';

type Values = Record<string, unknown>;
const num = (value: unknown): number => (typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : 0);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
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
            const version = num((db.prepare('pragma user_version').get() as Values | undefined)?.user_version);
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
    private ingest(handle: Handle, since: number, userId: number): number {
        const signals = this.source.load(userId, Math.max(0, since));
        if (!signals.length) return 0;
        const { db } = handle;
        const upsert = db.prepare(UPSERT_TRACK);
        const insert = db.prepare('insert or ignore into plays(at, id, artist, heard, dur, end, source, liked, liked_now, away, tz) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        let added = 0;
        let latest = 0;
        db.exec('begin');
        try {
            for (const signal of signals) {
                const title = signal.title ?? '';
                upsert.run(signal.id, signal.artist, title, signal.artistName ?? '', signal.path ?? '', signal.artwork ?? '', genreKey(signal.genre), text(signal.tags, 300), signal.dur, title ? 1 : 0);
                const result = insert.run(
                    signal.at, signal.id, signal.artist, signal.heard, signal.dur, signal.end, signal.source,
                    signal.liked || signal.likedNow ? 1 : 0, signal.likedNow ? 1 : 0, signal.away ? 1 : 0, signal.tz ?? null,
                );
                added += num(result.changes);
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
            const first = (db.prepare('select min(at) as at, count(*) as total from plays').get() as Values | undefined) ?? {};
            const firstAt = first.at === null || first.at === undefined ? null : num(first.at);
            const start = from ?? (firstAt === null ? localDayStart(to - DAY) : localDayStart(firstAt));
            const range = [start, to] as const;
            const totals = db.prepare('select coalesce(sum(heard), 0) as heard, coalesce(sum(heard >= ?), 0) as counted, count(distinct case when heard >= ? and artist > 0 then artist end) as artists from plays where at >= ? and at < ?').get(COUNTED_MS, COUNTED_MS, ...range) as Values;
            const fresh = db.prepare('select count(*) as n from (select min(at) as first from plays where heard >= ? and artist > 0 group by artist) where first >= ? and first < ?').get(COUNTED_MS, ...range) as Values;

            const bestTrack = db.prepare(
                "select coalesce(t.artist_name, '') as artistName, coalesce(t.artwork, '') as artwork, coalesce(t.path, '') as path from plays p left join tracks t on t.id = p.id " +
                    'where p.artist = ? and p.at >= ? and p.at < ? and p.heard >= ? group by p.id order by count(*) desc, max(p.at) desc limit 1',
            );
            const artists = (db.prepare('select artist, count(*) as plays, sum(heard) as ms from plays where at >= ? and at < ? and heard >= ? and artist > 0 group by artist order by plays desc, ms desc limit 25').all(...range, COUNTED_MS) as Values[]).map((row) => {
                const best = (bestTrack.get(num(row.artist), ...range, COUNTED_MS) as Values | undefined) ?? {};
                return { key: num(row.artist), name: str(best.artistName), artistName: str(best.artistName), artwork: str(best.artwork), path: str(best.path), plays: num(row.plays), ms: num(row.ms) };
            });
            const tracks = (db.prepare(
                "select p.id, count(*) as plays, sum(p.heard) as ms, coalesce(t.title, '') as title, coalesce(t.artist_name, '') as artistName, coalesce(t.artwork, '') as artwork, coalesce(t.path, '') as path " +
                    'from plays p left join tracks t on t.id = p.id where p.at >= ? and p.at < ? and p.heard >= ? group by p.id order by plays desc, ms desc limit 8',
            ).all(...range, COUNTED_MS) as Values[]).map((row) => ({ key: num(row.id), name: str(row.title), artistName: str(row.artistName), artwork: str(row.artwork), path: str(row.path), plays: num(row.plays), ms: num(row.ms) }));
            const genres = (db.prepare(
                "select t.genre, count(*) as plays, sum(p.heard) as ms from plays p join tracks t on t.id = p.id where p.at >= ? and p.at < ? and p.heard >= ? and t.genre != '' group by t.genre order by plays desc, ms desc limit 5",
            ).all(...range, COUNTED_MS) as Values[]).map((row) => ({ key: str(row.genre), name: str(row.genre), artistName: '', artwork: '', path: '', plays: num(row.plays), ms: num(row.ms) }));

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
                artistCount: num(totals.artists),
                fresh: num(fresh.n),
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

    /** Прослушивания с момента since для модели вкуса, старые сверху; закрытие клиента (stop) не сигнал */
    public tastePlays(userId: unknown, since: number): TastePlay[] {
        if (!isId(userId)) return [];
        return this.guarded(userId, ({ db }) =>
            (db.prepare(
                "select p.at, p.id, p.artist, p.heard, p.dur, p.end, p.source, p.liked_now, p.away, coalesce(t.genre, '') as genre, coalesce(t.tags, '') as tags, " +
                    "coalesce(t.artist_name, '') as artistName, coalesce(t.artwork, '') as artwork, coalesce(t.path, '') as path " +
                    "from plays p left join tracks t on t.id = p.id where p.at >= ? and p.end != 'stop' order by p.at",
            ).all(since) as Values[]).map((row) => ({
                at: num(row.at),
                id: num(row.id),
                artist: num(row.artist),
                heard: num(row.heard),
                dur: num(row.dur),
                end: str(row.end),
                source: str(row.source),
                likedNow: num(row.liked_now) === 1,
                away: num(row.away) === 1,
                genre: str(row.genre),
                tags: str(row.tags),
                artistName: str(row.artistName),
                artwork: str(row.artwork),
                path: str(row.path),
            })),
        );
    }

    /** Прослушивания за [from, to), новые сверху */
    public day(userId: unknown, from: number, to: number): HistoryRow[] {
        if (!isId(userId)) return [];
        return this.guarded(userId, ({ db }) => (db.prepare(ROW + ' where p.at >= ? and p.at < ? order by p.at desc limit 2000').all(from, to) as Values[]).map(toRow));
    }
    /** Ближайшие прослушивания до from и после to: для кнопок «предыдущий» и «следующий день» */
    public neighbors(userId: unknown, from: number, to: number): { before: number | null; after: number | null } {
        if (!isId(userId)) return { before: null, after: null };
        return this.guarded(userId, ({ db }) => {
            const before = (db.prepare('select max(at) as at from plays where at < ?').get(from) as Values | undefined)?.at;
            const after = (db.prepare('select min(at) as at from plays where at >= ?').get(to) as Values | undefined)?.at;
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
                return (db.prepare(ROW + ' where p.id in (select rowid from tracks_fts where tracks_fts match ?) order by p.at desc limit ?').all(match, limit) as Values[]).map(toRow);
            }
            const needle = text(query, 200);
            if (!needle) return [];
            const like = '%' + needle.replace(/[\\%_]/g, (char) => '\\' + char) + '%';
            return (db.prepare(ROW + " where t.title like ? escape '\\' or t.artist_name like ? escape '\\' order by p.at desc limit ?").all(like, like, limit) as Values[]).map(toRow);
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
