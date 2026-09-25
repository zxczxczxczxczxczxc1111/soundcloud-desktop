import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { WaveTrack } from './wave';
import { cleanStoredTrack } from './playbackStore';
import { text } from './waveSignals';
import {
    IDENTITY_VERSION, confirmedGroups, familyKey, isrcOf, matchLevel, parseTrackTitle, trackCredits, trackDuration, uploadKey, uploaderId, versionKey,
    type RecordingLink, type TrackCredit,
} from './trackIdentity';
import { cleanCoverage, cleanRadarItem, type RadarEdition, type RadarItem } from './radar';

// Хранилище рекомендаций: загрузки с разобранными версиями, связи записей и состояние обхода источников,
// файл recommend-<userId>.sqlite на аккаунт. В отличие от индекса истории его не пересобрать из журнала:
// испорченный файл откладывается рядом, а не удаляется, миграция идёт в транзакции с копией прежней версии.
// Пользовательские отметки («Не нравится», скрытые, «Больше такого») остаются в exclusions-<userId>.json.

/** Ступени схемы: ступень N поднимает user_version с N до N+1. Новые таблицы добавлять новой ступенью */
export const RECOMMEND_MIGRATIONS: string[][] = [
    [
        'create table meta(key text primary key, value text not null)',
        // Загрузка и её разбор: версия и семья посчитаны разбором версии parser, даты в мс, релиз днём YYYY-MM-DD
        "create table uploads(key text primary key, id integer not null, uploader integer not null default 0, uploader_name text not null default '', " +
            "title text not null default '', family_key text not null default '', version_key text not null default '', version text not null default '', " +
            "credits text not null default '[]', isrc text not null default '', duration integer not null default 0, created_at integer not null default 0, " +
            "display_at integer not null default 0, release_day text not null default '', genre text not null default '', tags text not null default '', " +
            "policy text not null default '', parser integer not null default 0, first_seen integer not null, checked integer not null)",
        'create index uploads_family on uploads(family_key)',
        'create index uploads_version on uploads(version_key)',
        'create index uploads_uploader on uploads(uploader, created_at)',
        "create index uploads_isrc on uploads(isrc) where isrc != ''",
        // Связи записей: решение пользователя или каталога, пара упорядочена a < b
        'create table relations(a text not null, b text not null, source text not null, same integer not null, at integer not null, primary key(a, b, source)) without rowid',
        // Обход источника: номер прогона отсекает ответы прошлого прогона, курсор позволяет продолжить
        "create table sources(source text primary key, run integer not null default 0, resumed integer not null default 0, status text not null default 'idle', " +
            "cursor text not null default '', started integer not null default 0, updated integer not null default 0, completed integer not null default 0, " +
            "count integer not null default 0, error text not null default '')",
        // Состав источника (лайки, подписки, плейлисты): удаляется только после полного обхода без продолжений
        'create table members(source text not null, key text not null, added integer not null default 0, seen_run integer not null, removed integer not null default 0, primary key(source, key)) without rowid',
    ],
    [
        // Источники радара: каталог аккаунта user:<id> или свежий поиск search:<ключ имени>; status ok, gone (аккаунта нет) или failed
        "create table catalog(key text primary key, label text not null default '', checked integer not null default 0, status text not null default '', " +
            "error text not null default '', found integer not null default 0)",
        // Выпуски радара: состав и порядок не меняются после записи. manual 0 только у автоматического выпуска периода,
        // ручная пересборка добавляет ревизию того же периода
        'create table editions(period text not null, revision integer not null, created integer not null, cutoff integer not null, status text not null, ' +
            'manual integer not null default 0, algorithm integer not null, taste integer not null, coverage text not null, items text not null, ' +
            'uploads text not null, primary key(period, revision)) without rowid',
        // Задача периода: её старт задаёт бюджет сбора и переживает перезапуск
        'create table radar_tasks(period text primary key, cutoff integer not null, zone text not null, started integer not null)',
        'create index uploads_display on uploads(display_at)',
        'create index uploads_created on uploads(created_at)',
        'create index uploads_release on uploads(release_day)',
    ],
];

export type SyncStatus = 'idle' | 'running' | 'complete' | 'partial' | 'failed';
export interface SourceState {
    source: string;
    run: number;
    /** Прогон продолжен с сохранённого курсора: удаления по нему не применяются */
    resumed: boolean;
    status: SyncStatus;
    /** Параметры следующей страницы; пусто, если обход с начала или завершён */
    cursor: Record<string, string | number> | null;
    started: number;
    updated: number;
    completed: number;
    count: number;
    error: string;
}
export interface StoredUpload {
    key: string;
    id: number;
    uploader: number;
    uploaderName: string;
    title: string;
    familyKey: string;
    versionKey: string;
    version: string[];
    credits: TrackCredit[];
    isrc: string;
    duration: number;
    createdAt: number;
    displayAt: number;
    releaseDay: string;
    genre: string;
    tags: string;
    policy: string;
    parser: number;
    firstSeen: number;
    checked: number;
}
export interface LibraryMember {
    key: string;
    /** Когда добавлено по данным сайта, мс; 0 если неизвестно */
    added: number;
}
/** Загрузка для модели вкуса: только то, из чего складываются направления */
export interface TasteUpload {
    id: number;
    uploader: number;
    uploaderName: string;
    title: string;
    duration: number;
    genre: string;
    tags: string;
    credits: TrackCredit[];
}
export interface TasteLibrary {
    /** Лайки сайта, новые сверху; added 0, если дата неизвестна (массовый импорт). upload null, если загрузка не сохранилась */
    likes: Array<{ id: number; added: number; upload: TasteUpload | null }>;
    /** Подписки: id аккаунтов */
    follows: number[];
    /** Разбор сыгранных загрузок, которые есть в хранилище: кредиты из метаданных издателя */
    uploads: TasteUpload[];
}

export type CatalogStatus = 'ok' | 'gone' | 'failed';
/** Проверка источника радара */
export interface CatalogCheck {
    key: string;
    label: string;
    checked: number;
    status: CatalogStatus | '';
    error: string;
    found: number;
}
export interface EditionSummary {
    period: string;
    revision: number;
    created: number;
    cutoff: number;
    status: RadarEdition['status'];
    manual: boolean;
    items: number;
    uploads: number;
}

type Values = Record<string, unknown>;
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;
const STATUSES = new Set<SyncStatus>(['complete', 'partial', 'failed']);
const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const num = (value: unknown): number => (typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : 0);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
/** Ключ загрузки, аккаунта или плейлиста SoundCloud */
export const isEntityKey = (value: unknown): value is string => typeof value === 'string' && /^sc:(track|user|playlist):[1-9]\d{0,15}$/.test(value);
const isTrackKey = (value: unknown): value is string => isEntityKey(value) && value.startsWith('sc:track:');
const isSource = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9:_-]{0,60}$/.test(value);
const DAY = 86400000;
const CATALOG_STATUSES = new Set<string>(['ok', 'gone', 'failed']);
/** Источник радара: каталог аккаунта или поиск по ключу имени (буквы и цифры) */
export const isCatalogKey = (value: unknown): value is string => typeof value === 'string' && /^(?:user:[1-9]\d{0,15}|search:[\p{L}\p{N}]{1,80})$/u.test(value);
/** Период выпуска: местная дата слота */
const isPeriod = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const time = (value: string | undefined): number => {
    const at = value ? Date.parse(value) : NaN;
    return Number.isFinite(at) && at > 0 ? at : 0;
};
const parseJson = (value: string): unknown => {
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return null;
    }
};

// Курсор со страницы недоверенный: только плоские параметры запроса разумного размера
export function cleanCursor(value: unknown): Record<string, string | number> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length || entries.length > 20) return null;
    const cursor: Record<string, string | number> = {};
    for (const [key, item] of entries) {
        if (!/^[a-z_.]{1,40}$/i.test(key)) return null;
        if (typeof item === 'number' && Number.isFinite(item)) cursor[key] = item;
        else if (typeof item === 'string' && item.length <= 500) cursor[key] = item;
        else return null;
    }
    return JSON.stringify(cursor).length <= 2000 ? cursor : null;
}

function toUpload(row: Values): StoredUpload {
    const version = str(row.version);
    const credits = parseJson(str(row.credits));
    return {
        key: str(row.key),
        id: num(row.id),
        uploader: num(row.uploader),
        uploaderName: str(row.uploader_name),
        title: str(row.title),
        familyKey: str(row.family_key),
        versionKey: str(row.version_key),
        version: version ? version.split('+') : [],
        credits: Array.isArray(credits) ? (credits as TrackCredit[]) : [],
        isrc: str(row.isrc),
        duration: num(row.duration),
        createdAt: num(row.created_at),
        displayAt: num(row.display_at),
        releaseDay: str(row.release_day),
        genre: str(row.genre),
        tags: str(row.tags),
        policy: str(row.policy),
        parser: num(row.parser),
        firstSeen: num(row.first_seen),
        checked: num(row.checked),
    };
}
function toState(row: Values): SourceState {
    const status = str(row.status);
    const cursor = str(row.cursor);
    return {
        source: str(row.source),
        run: num(row.run),
        resumed: num(row.resumed) === 1,
        status: status === 'running' || STATUSES.has(status as SyncStatus) ? (status as SyncStatus) : 'idle',
        cursor: cursor ? cleanCursor(parseJson(cursor)) : null,
        started: num(row.started),
        updated: num(row.updated),
        completed: num(row.completed),
        count: num(row.count),
        error: str(row.error),
    };
}
function toTasteUpload(row: Values): TasteUpload {
    const credits = parseJson(str(row.credits));
    return {
        id: num(row.id),
        uploader: num(row.uploader),
        uploaderName: str(row.uploader_name),
        title: str(row.title),
        duration: num(row.duration),
        genre: str(row.genre),
        tags: str(row.tags),
        credits: Array.isArray(credits) ? (credits as TrackCredit[]) : [],
    };
}
const TASTE_UPLOAD = 'u.id, u.uploader, u.uploader_name, u.title, u.duration, u.genre, u.tags, u.credits';
function toEdition(row: Values): RadarEdition {
    const list = (value: unknown): RadarItem[] => {
        const parsed = parseJson(str(value));
        return Array.isArray(parsed) ? parsed.map(cleanRadarItem).filter((item): item is RadarItem => item !== null) : [];
    };
    return {
        period: str(row.period),
        revision: num(row.revision),
        created: num(row.created),
        cutoff: num(row.cutoff),
        status: str(row.status) === 'complete' ? 'complete' : 'partial',
        coverage: cleanCoverage(parseJson(str(row.coverage))),
        algorithm: num(row.algorithm),
        taste: num(row.taste),
        items: list(row.items),
        uploads: list(row.uploads),
    };
}
/** Часть резервной копии: архив выпусков радара и решения пользователя о версиях. Остальное хранилища берётся с сайта заново */
export interface RecommendBackup {
    editions: Array<RadarEdition & { manual: boolean }>;
    links: RecordingLink[];
}
const LIMIT_EDITIONS = 5000;
const LIMIT_LINKS = 50000;
/** Часть копии недоверенная: выпуск проходит те же проверки, что при чтении из базы, связь только пользовательская и упорядоченная */
export function cleanRecommendBackup(value: unknown): RecommendBackup | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = value as { editions?: unknown; links?: unknown };
    if (!Array.isArray(source.editions) || !Array.isArray(source.links) || source.editions.length > LIMIT_EDITIONS || source.links.length > LIMIT_LINKS) return null;
    const count = (item: unknown): item is number => typeof item === 'number' && Number.isSafeInteger(item) && item >= 0;
    const items = (list: unknown): RadarItem[] | null =>
        Array.isArray(list) && list.length <= 5000 ? list.map(cleanRadarItem).filter((item): item is RadarItem => item !== null) : null;
    const editions: RecommendBackup['editions'] = [];
    for (const raw of source.editions) {
        const edition = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        const list = items(edition.items);
        const uploads = items(edition.uploads);
        if (!isPeriod(edition.period) || !isId(edition.revision) || !isTime(edition.created) || !isTime(edition.cutoff) || typeof edition.manual !== 'boolean'
            || (edition.status !== 'complete' && edition.status !== 'partial') || !count(edition.algorithm) || !count(edition.taste) || !list || !uploads) return null;
        editions.push({
            period: edition.period, revision: edition.revision, created: edition.created, cutoff: edition.cutoff, status: edition.status, manual: edition.manual,
            algorithm: edition.algorithm, taste: edition.taste, coverage: cleanCoverage(edition.coverage), items: list, uploads,
        });
    }
    const links: RecordingLink[] = [];
    for (const raw of source.links) {
        const link = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        if (!isTrackKey(link.a) || !isTrackKey(link.b) || link.a >= link.b || typeof link.same !== 'boolean' || !isTime(link.at)) return null;
        links.push({ a: link.a, b: link.b, same: link.same, source: 'user', at: link.at });
    }
    return { editions, links };
}
// Строка хранилища обратно в трек для сравнения версий
const asTrack = (row: Values): WaveTrack => ({
    id: num(row.id),
    title: str(row.title),
    user_id: num(row.uploader),
    user: { id: num(row.uploader), username: str(row.uploader_name) },
    duration: num(row.duration),
    publisher_metadata: { isrc: str(row.isrc) },
});

export class RecommendStore {
    private handles = new Map<number, DatabaseSync>();

    constructor(private directory: string, private migrations: string[][] = RECOMMEND_MIGRATIONS) {}

    private file(userId: number): string {
        return join(this.directory, 'recommend-' + userId + '.sqlite');
    }
    private open(userId: number): DatabaseSync {
        mkdirSync(this.directory, { recursive: true });
        const file = this.file(userId);
        const db = new DatabaseSync(file);
        try {
            const version = num((db.prepare('pragma user_version').get() as Values | undefined)?.user_version);
            const target = this.migrations.length;
            if (version > target) throw new Error('Хранилище рекомендаций записано более новой версией клиента (схема ' + version + ')');
            if (version < target) {
                // Копия прежней схемы до миграции: откат сборки или сбой миграции не теряют данные
                if (version > 0) {
                    const backup = join(this.directory, 'recommend-' + userId + '.v' + version + '.sqlite');
                    rmSync(backup, { force: true });
                    db.prepare('vacuum into ?').run(backup);
                }
                db.exec('begin');
                try {
                    for (let step = version; step < target; step++) for (const statement of this.migrations[step]) db.exec(statement);
                    db.exec('pragma user_version = ' + target);
                    db.exec('commit');
                } catch (error) {
                    db.exec('rollback');
                    throw error;
                }
            }
            return db;
        } catch (error) {
            if (db.isOpen) db.close();
            throw error;
        }
    }
    private handle(userId: number): DatabaseSync {
        const cached = this.handles.get(userId);
        if (cached) return cached;
        const db = this.open(userId);
        this.handles.set(userId, db);
        return db;
    }
    /** Испорченный файл откладывается рядом с отметкой времени и начинается новый; остальные ошибки уходят наверх */
    private guarded<T>(userId: number, work: (db: DatabaseSync) => T): T {
        try {
            return work(this.handle(userId));
        } catch (error) {
            const code = (error as { errcode?: unknown }).errcode;
            if (typeof code !== 'number' || ![SQLITE_CORRUPT, SQLITE_NOTADB].includes(code & 0xff)) throw error;
            console.warn('Рекомендации: хранилище испорчено, отложено и начато заново', error);
            const cached = this.handles.get(userId);
            if (cached?.isOpen) cached.close();
            this.handles.delete(userId);
            const file = this.file(userId);
            const aside = join(this.directory, 'recommend-' + userId + '.broken-' + Date.now() + '.sqlite');
            if (existsSync(file)) renameSync(file, aside);
            for (const suffix of ['-wal', '-shm', '-journal']) rmSync(file + suffix, { force: true });
            return work(this.handle(userId));
        }
    }
    private transaction<T>(db: DatabaseSync, work: () => T): T {
        db.exec('begin');
        try {
            const result = work();
            db.exec('commit');
            return result;
        } catch (error) {
            db.exec('rollback');
            throw error;
        }
    }

    /** Запомнить увиденные загрузки с разбором версии и датами; связи каталога по ISRC пересчитываются. Возвращает число принятых */
    public recordUploads(userId: unknown, input: unknown, now = Date.now()): number {
        if (!isId(userId) || !Array.isArray(input)) return 0;
        const tracks = input.slice(0, 5000).map(cleanStoredTrack).filter((track): track is WaveTrack => track !== null);
        if (!tracks.length) return 0;
        return this.guarded(userId, (db) => {
            const upsert = db.prepare(
                'insert into uploads(key, id, uploader, uploader_name, title, family_key, version_key, version, credits, isrc, duration, created_at, display_at, ' +
                    'release_day, genre, tags, policy, parser, first_seen, checked) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
                    'on conflict(key) do update set uploader = excluded.uploader, uploader_name = excluded.uploader_name, title = excluded.title, ' +
                    'family_key = excluded.family_key, version_key = excluded.version_key, version = excluded.version, credits = excluded.credits, isrc = excluded.isrc, ' +
                    'duration = case when excluded.duration > 0 then excluded.duration else uploads.duration end, ' +
                    'created_at = case when excluded.created_at > 0 then excluded.created_at else uploads.created_at end, ' +
                    'display_at = case when excluded.display_at > 0 then excluded.display_at else uploads.display_at end, ' +
                    "release_day = case when excluded.release_day != '' then excluded.release_day else uploads.release_day end, " +
                    'genre = excluded.genre, tags = excluded.tags, policy = excluded.policy, parser = excluded.parser, checked = excluded.checked',
            );
            const drop = db.prepare("delete from relations where source = 'catalog' and (a = ? or b = ?)");
            const peers = db.prepare('select id, uploader, uploader_name, title, duration, isrc from uploads where isrc = ? and key != ?');
            const link = db.prepare("insert into relations(a, b, source, same, at) values (?, ?, 'catalog', 1, ?) on conflict(a, b, source) do update set same = 1, at = excluded.at");
            return this.transaction(db, () => {
                for (const track of tracks) {
                    const parsed = parseTrackTitle(track.title);
                    const key = uploadKey(track);
                    const isrc = isrcOf(track);
                    upsert.run(
                        key, track.id, uploaderId(track), text(track.user?.username, 200), track.title ?? '', familyKey(track, parsed), versionKey(track, parsed),
                        parsed.version.join('+'), JSON.stringify(trackCredits(track, parsed)), isrc, trackDuration(track), time(track.created_at), time(track.display_date),
                        track.release_date ? track.release_date.slice(0, 10) : '', track.genre ?? '', track.tag_list ?? '', track.policy ?? '', IDENTITY_VERSION, now, now,
                    );
                    // Связь каталога живёт, пока у обеих загрузок один ISRC и та же версия: пересчёт при каждом обновлении
                    drop.run(key, key);
                    if (!isrc) continue;
                    for (const row of peers.all(isrc, key) as Values[]) {
                        const other = asTrack(row);
                        if (matchLevel(track, other) !== 'confirmed') continue;
                        const [a, b] = [key, uploadKey(other)].sort();
                        link.run(a, b, now);
                    }
                }
                return tracks.length;
            });
        });
    }
    public uploads(userId: unknown, keys: unknown): StoredUpload[] {
        if (!isId(userId) || !Array.isArray(keys)) return [];
        const list = [...new Set(keys.filter(isTrackKey))].slice(0, 5000);
        if (!list.length) return [];
        return this.guarded(userId, (db) => {
            const select = db.prepare('select * from uploads where key = ?');
            return list.flatMap((key) => {
                const row = select.get(key) as Values | undefined;
                return row ? [toUpload(row)] : [];
            });
        });
    }
    /** Связи записей: решения пользователя и каталога */
    public recordingLinks(userId: unknown): RecordingLink[] {
        if (!isId(userId)) return [];
        return this.guarded(userId, (db) => this.readLinks(db));
    }
    /** Решение пользователя «та же запись» или «разные записи»; последнее решение по паре заменяет прежнее */
    public setRecordingLink(userId: unknown, a: unknown, b: unknown, same: unknown, now = Date.now()): boolean {
        if (!isId(userId) || !isTrackKey(a) || !isTrackKey(b) || a === b || typeof same !== 'boolean') return false;
        const [first, second] = [a, b].sort();
        return this.guarded(userId, (db) => {
            db.prepare("insert into relations(a, b, source, same, at) values (?, ?, 'user', ?, ?) on conflict(a, b, source) do update set same = excluded.same, at = excluded.at")
                .run(first, second, same ? 1 : 0, now);
            return true;
        });
    }

    /** Начать обход источника. resume продолжает прерванный прогон с его курсора, иначе новый прогон с начала */
    public syncStart(userId: unknown, source: unknown, resume: unknown, now = Date.now()): SourceState | null {
        if (!isId(userId) || !isSource(source)) return null;
        return this.guarded(userId, (db) => this.transaction(db, () => {
            const row = db.prepare('select * from sources where source = ?').get(source) as Values | undefined;
            const previous = row ? toState(row) : null;
            if (resume === true && previous && (previous.status === 'running' || previous.status === 'partial') && previous.cursor) {
                db.prepare("update sources set status = 'running', resumed = 1, updated = ?, error = '' where source = ?").run(now, source);
            } else {
                db.prepare(
                    "insert into sources(source, run, resumed, status, cursor, started, updated, completed, count, error) values (?, ?, 0, 'running', '', ?, ?, ?, 0, '') " +
                        "on conflict(source) do update set run = excluded.run, resumed = 0, status = 'running', cursor = '', started = excluded.started, updated = excluded.updated, count = 0, error = ''",
                ).run(source, (previous?.run ?? 0) + 1, now, now, previous?.completed ?? 0);
            }
            return toState(db.prepare('select * from sources where source = ?').get(source) as Values);
        }));
    }
    /** Страница обхода. Ответ чужого прогона (новый уже начат или этот закончен) отклоняется: false */
    public syncPage(userId: unknown, source: unknown, run: unknown, items: unknown, cursor: unknown, now = Date.now()): boolean {
        if (!isId(userId) || !isSource(source) || !isId(run) || !Array.isArray(items) || items.length > 1000) return false;
        const next = cursor === null ? null : cleanCursor(cursor);
        if (cursor !== null && !next) return false;
        const members: LibraryMember[] = [];
        for (const item of items) {
            const value = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
            if (!isEntityKey(value.key)) return false;
            const added = typeof value.added === 'number' && Number.isFinite(value.added) && value.added > 0 ? Math.round(value.added) : 0;
            members.push({ key: value.key, added });
        }
        return this.guarded(userId, (db) => this.transaction(db, () => {
            const row = db.prepare('select run, status from sources where source = ?').get(source) as Values | undefined;
            if (!row || num(row.run) !== run || str(row.status) !== 'running') return false;
            const insert = db.prepare(
                'insert into members(source, key, added, seen_run, removed) values (?, ?, ?, ?, 0) on conflict(source, key) do update set seen_run = excluded.seen_run, removed = 0, ' +
                    'added = case when excluded.added > 0 then excluded.added else members.added end',
            );
            for (const member of members) insert.run(source, member.key, member.added, run);
            db.prepare('update sources set cursor = ?, updated = ?, count = count + ? where source = ?').run(next ? JSON.stringify(next) : '', now, members.length, source);
            return true;
        }));
    }
    /**
     * Завершить прогон. complete без продолжений снимает из состава то, чего этот прогон не видел; partial и failed
     * ничего не удаляют и оставляют курсор для продолжения. Ответ чужого прогона: null
     */
    public syncFinish(userId: unknown, source: unknown, run: unknown, status: unknown, error: unknown, now = Date.now()): SourceState | null {
        if (!isId(userId) || !isSource(source) || !isId(run) || typeof status !== 'string' || !STATUSES.has(status as SyncStatus)) return null;
        return this.guarded(userId, (db) => this.transaction(db, () => {
            const row = db.prepare('select * from sources where source = ?').get(source) as Values | undefined;
            if (!row || num(row.run) !== run || str(row.status) !== 'running') return null;
            const complete = status === 'complete';
            if (complete && num(row.resumed) !== 1) db.prepare('update members set removed = 1 where source = ? and seen_run < ? and removed = 0').run(source, run);
            db.prepare(
                "update sources set status = ?, cursor = case when ? then '' else cursor end, completed = case when ? then ? else completed end, updated = ?, error = ? where source = ?",
            ).run(status, complete ? 1 : 0, complete ? 1 : 0, now, now, text(error, 200), source);
            return toState(db.prepare('select * from sources where source = ?').get(source) as Values);
        }));
    }
    public syncState(userId: unknown): SourceState[] {
        if (!isId(userId)) return [];
        return this.guarded(userId, (db) => (db.prepare('select * from sources order by source').all() as Values[]).map(toState));
    }
    /** Текущий состав источника, новые сверху; неизвестная дата добавления в конце */
    public libraryMembers(userId: unknown, source: unknown): LibraryMember[] {
        if (!isId(userId) || !isSource(source)) return [];
        return this.guarded(userId, (db) =>
            (db.prepare('select key, added from members where source = ? and removed = 0 order by added desc, key').all(source) as Values[]).map((row) => ({
                key: str(row.key), added: num(row.added),
            })),
        );
    }
    /** Для модели вкуса: лайки с датой и разбором, подписки и разбор сыгранных загрузок played */
    public tasteLibrary(userId: unknown, played: unknown): TasteLibrary {
        if (!isId(userId)) return { likes: [], follows: [], uploads: [] };
        const ids = Array.isArray(played) ? [...new Set(played.filter(isId))].slice(0, 20000) : [];
        return this.guarded(userId, (db) => {
            const likes = (db.prepare(
                'select m.key as member, m.added, ' + TASTE_UPLOAD + " from members m left join uploads u on u.key = m.key where m.source = 'likes' and m.removed = 0 " +
                    'order by m.added desc, m.key limit 20000',
            ).all() as Values[]).map((row) => ({
                id: Number(str(row.member).slice('sc:track:'.length)),
                added: num(row.added),
                upload: row.id === null || row.id === undefined ? null : toTasteUpload(row),
            })).filter((like) => isId(like.id));
            const follows = (db.prepare("select key from members where source = 'followings' and removed = 0 order by key limit 5000").all() as Values[])
                .map((row) => Number(str(row.key).slice('sc:user:'.length)))
                .filter(isId);
            const select = db.prepare('select ' + TASTE_UPLOAD + ' from uploads u where u.key = ?');
            const uploads: TasteUpload[] = [];
            for (const id of ids) {
                const row = select.get('sc:track:' + id) as Values | undefined;
                if (row) uploads.push(toTasteUpload(row));
            }
            return { likes, follows, uploads };
        });
    }
    /** Источники радара с последней проверкой */
    public catalogState(userId: unknown): CatalogCheck[] {
        if (!isId(userId)) return [];
        return this.guarded(userId, (db) => (db.prepare('select * from catalog order by key limit 20000').all() as Values[]).map((row) => {
            const status = str(row.status);
            return {
                key: str(row.key), label: str(row.label), checked: num(row.checked), status: CATALOG_STATUSES.has(status) ? (status as CatalogStatus) : '',
                error: str(row.error), found: num(row.found),
            };
        }));
    }
    /** Страница проверила источник: время ставит worker. Пустая подпись прежнюю не стирает */
    public catalogChecked(userId: unknown, key: unknown, label: unknown, status: unknown, error: unknown, found: unknown, now = Date.now()): boolean {
        if (!isId(userId) || !isCatalogKey(key) || typeof status !== 'string' || !CATALOG_STATUSES.has(status)) return false;
        const count = typeof found === 'number' && Number.isSafeInteger(found) && found >= 0 ? found : 0;
        return this.guarded(userId, (db) => {
            db.prepare(
                'insert into catalog(key, label, checked, status, error, found) values (?, ?, ?, ?, ?, ?) on conflict(key) do update set ' +
                    "label = case when excluded.label != '' then excluded.label else catalog.label end, checked = excluded.checked, status = excluded.status, " +
                    'error = excluded.error, found = excluded.found',
            ).run(key, text(label, 200), now, status, text(error, 200), count);
            return true;
        });
    }
    /**
     * Загрузки окна радара: публикация в [from, to] или заявленный день релиза рядом с окном (точную проверку делает радар).
     * reuploads: ключи загрузок, у которых есть копия той же версии, опубликованная раньше хотя бы на сутки:
     * вероятная по разбору и длительности или подтверждённая пользователем либо каталогом
     */
    public radarUploads(userId: unknown, from: unknown, to: unknown): { uploads: StoredUpload[]; reuploads: string[] } {
        if (!isId(userId) || !isTime(from) || !isTime(to) || from > to) return { uploads: [], reuploads: [] };
        const day = (at: number): string => new Date(at).toISOString().slice(0, 10);
        return this.guarded(userId, (db) => {
            const rows = db.prepare(
                'select * from uploads where display_at between ? and ? or (display_at = 0 and created_at between ? and ?) or release_day between ? and ? limit 20000',
            ).all(from, to, from, to, day(from - DAY), day(to + DAY)) as Values[];
            const links = this.readLinks(db);
            const groups = confirmedGroups(links);
            const members = new Map<string, string[]>();
            for (const [key, root] of groups) members.set(root, [...(members.get(root) ?? []), key]);
            const peers = db.prepare('select id, uploader, uploader_name, title, duration, isrc, display_at, created_at from uploads where version_key = ? and key != ? limit 200');
            const published = db.prepare('select display_at, created_at from uploads where key = ?');
            const reuploads: string[] = [];
            for (const row of rows) {
                const key = str(row.key);
                const at = num(row.display_at) || num(row.created_at);
                if (!at) continue;
                const earlier = (value: Values | undefined): boolean => {
                    const other = value ? num(value.display_at) || num(value.created_at) : 0;
                    return other > 0 && other <= at - DAY;
                };
                const root = groups.get(key);
                if (root && (members.get(root) ?? []).some((mate) => mate !== key && earlier(published.get(mate) as Values | undefined))) {
                    reuploads.push(key);
                    continue;
                }
                const version = str(row.version_key);
                if (!version) continue;
                const track = asTrack(row);
                for (const peer of peers.all(version, key) as Values[]) {
                    if (!earlier(peer)) continue;
                    const level = matchLevel(track, asTrack(peer), links);
                    if (level === 'confirmed' || level === 'probable') {
                        reuploads.push(key);
                        break;
                    }
                }
            }
            return { uploads: rows.map(toUpload), reuploads };
        });
    }
    /** Есть ли автоматический выпуск периода и когда начата его задача. Выпуск с отсечкой ближе трёх суток
     *  тоже считается: после смены зоны неделя не собирается второй раз */
    public radarStatus(userId: unknown, period: unknown, cutoff: unknown): { published: boolean; started: number } {
        if (!isId(userId) || !isPeriod(period) || !isTime(cutoff)) return { published: false, started: 0 };
        return this.guarded(userId, (db) => ({
            published: db.prepare('select 1 from editions where manual = 0 and (period = ? or abs(cutoff - ?) < ?) limit 1').get(period, cutoff, 3 * DAY) !== undefined,
            started: num((db.prepare('select started from radar_tasks where period = ?').get(period) as Values | undefined)?.started),
        }));
    }
    /** Задача периода: создаётся один раз; повторный вызов после перезапуска возвращает прежний старт */
    public radarTask(userId: unknown, period: unknown, cutoff: unknown, zone: unknown, now = Date.now()): { started: number } | null {
        if (!isId(userId) || !isPeriod(period) || !isTime(cutoff) || typeof zone !== 'string' || !zone || zone.length > 64) return null;
        return this.guarded(userId, (db) => this.transaction(db, () => {
            db.prepare('insert into radar_tasks(period, cutoff, zone, started) values (?, ?, ?, ?) on conflict(period) do nothing').run(period, cutoff, zone, now);
            db.prepare('delete from radar_tasks where cutoff < ?').run(cutoff - 60 * DAY);
            return { started: num((db.prepare('select started from radar_tasks where period = ?').get(period) as Values).started) };
        }));
    }
    /**
     * Записать выпуск одной транзакцией. Автоматический не пишется, если у периода (или соседнего по отсечке) он уже есть:
     * тогда null. Ручная пересборка добавляет следующую ревизию, прежние остаются для играющей очереди
     */
    public saveEdition(userId: unknown, edition: RadarEdition, manual: boolean): RadarEdition | null {
        if (!isId(userId) || !isPeriod(edition.period) || !isTime(edition.cutoff)) return null;
        return this.guarded(userId, (db) => this.transaction(db, () => {
            if (!manual && db.prepare('select 1 from editions where manual = 0 and (period = ? or abs(cutoff - ?) < ?) limit 1').get(edition.period, edition.cutoff, 3 * DAY))
                return null;
            const revision = num((db.prepare('select max(revision) as last from editions where period = ?').get(edition.period) as Values | undefined)?.last) + 1;
            db.prepare(
                'insert into editions(period, revision, created, cutoff, status, manual, algorithm, taste, coverage, items, uploads) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            ).run(
                edition.period, revision, edition.created, edition.cutoff, edition.status, manual ? 1 : 0, edition.algorithm, edition.taste,
                JSON.stringify(edition.coverage), JSON.stringify(edition.items), JSON.stringify(edition.uploads),
            );
            return { ...edition, revision };
        }));
    }
    /** Архив: выпуски новые сверху, без состава */
    public editions(userId: unknown, limit: unknown = 100): EditionSummary[] {
        if (!isId(userId)) return [];
        const count = typeof limit === 'number' && Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 1000) : 100;
        return this.guarded(userId, (db) => (db.prepare(
            'select period, revision, created, cutoff, status, manual, json_array_length(items) as items, json_array_length(uploads) as uploads ' +
                'from editions order by period desc, revision desc limit ?',
        ).all(count) as Values[]).map((row) => ({
            period: str(row.period), revision: num(row.revision), created: num(row.created), cutoff: num(row.cutoff),
            status: str(row.status) === 'complete' ? 'complete' as const : 'partial' as const, manual: num(row.manual) === 1, items: num(row.items), uploads: num(row.uploads),
        })));
    }
    /** Выпуск целиком; без ревизии последняя ревизия периода */
    public edition(userId: unknown, period: unknown, revision?: unknown): RadarEdition | null {
        if (!isId(userId) || !isPeriod(period)) return null;
        return this.guarded(userId, (db) => {
            const row = (isId(revision)
                ? db.prepare('select * from editions where period = ? and revision = ?').get(period, revision)
                : db.prepare('select * from editions where period = ? order by revision desc limit 1').get(period)) as Values | undefined;
            return row ? toEdition(row) : null;
        });
    }
    /** Направления последних count выпусков до периода (последняя ревизия каждого): для мягкой поддержки редких вкусов */
    public radarDirections(userId: unknown, before: unknown, count = 4): string[][] {
        if (!isId(userId) || !isPeriod(before)) return [];
        return this.guarded(userId, (db) => (db.prepare(
            'select e.items from editions e where e.period < ? and e.revision = (select max(revision) from editions where period = e.period) order by e.period desc limit ?',
        ).all(before, count) as Values[]).map((row) => {
            const items = parseJson(str(row.items));
            return Array.isArray(items) ? items.map(cleanRadarItem).filter((item): item is RadarItem => item !== null).map((item) => item.direction) : [];
        }));
    }
    /** Есть ли у аккаунта файл хранилища: копия и её проверка не создают пустой */
    public exists(userId: unknown): boolean {
        return isId(userId) && existsSync(this.file(userId));
    }
    public exportBackup(userId: unknown): RecommendBackup {
        if (!this.exists(userId)) return { editions: [], links: [] };
        return this.guarded(userId as number, (db) => ({
            editions: (db.prepare('select * from editions order by period, revision').all() as Values[]).map((row) => ({ ...toEdition(row), manual: num(row.manual) === 1 })),
            links: (db.prepare("select a, b, same, at from relations where source = 'user' order by at").all() as Values[]).map((row) => ({
                a: str(row.a), b: str(row.b), same: num(row.same) === 1, source: 'user' as const, at: num(row.at),
            })),
        }));
    }
    /** Выпуски, которые уже есть: период и время создания. Для сводки перед восстановлением */
    public editionKeys(userId: unknown): Set<string> {
        if (!this.exists(userId)) return new Set();
        return this.guarded(userId as number, (db) =>
            new Set((db.prepare('select period, created from editions').all() as Values[]).map((row) => str(row.period) + '|' + num(row.created))));
    }
    /**
     * Слить часть копии одной транзакцией. Выпуск с тем же периодом и временем создания уже есть и пропускается,
     * иначе встаёт на свою ревизию или, если она занята, на следующую. Связь пользователя заменяется только более поздней
     */
    public importBackup(userId: unknown, data: RecommendBackup): { editions: number; links: number } {
        if (!isId(userId)) return { editions: 0, links: 0 };
        return this.guarded(userId, (db) => this.transaction(db, () => {
            const known = db.prepare('select 1 from editions where period = ? and created = ? limit 1');
            const taken = db.prepare('select 1 from editions where period = ? and revision = ?');
            const last = db.prepare('select max(revision) as last from editions where period = ?');
            const insert = db.prepare(
                'insert into editions(period, revision, created, cutoff, status, manual, algorithm, taste, coverage, items, uploads) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            );
            let editions = 0;
            for (const edition of data.editions) {
                if (known.get(edition.period, edition.created)) continue;
                const revision = taken.get(edition.period, edition.revision) ? num((last.get(edition.period) as Values | undefined)?.last) + 1 : edition.revision;
                insert.run(
                    edition.period, revision, edition.created, edition.cutoff, edition.status, edition.manual ? 1 : 0, edition.algorithm, edition.taste,
                    JSON.stringify(edition.coverage), JSON.stringify(edition.items), JSON.stringify(edition.uploads),
                );
                editions++;
            }
            const link = db.prepare(
                "insert into relations(a, b, source, same, at) values (?, ?, 'user', ?, ?) on conflict(a, b, source) do update set same = excluded.same, at = excluded.at where excluded.at > relations.at",
            );
            let links = 0;
            for (const item of data.links) links += num(link.run(item.a, item.b, item.same ? 1 : 0, item.at).changes);
            return { editions, links };
        }));
    }
    /** Защитная копия файла перед восстановлением; false, если файла ещё нет */
    public snapshot(userId: unknown, target: string): boolean {
        if (!this.exists(userId)) return false;
        return this.guarded(userId as number, (db) => {
            rmSync(target, { force: true });
            db.prepare('vacuum into ?').run(target);
            return true;
        });
    }
    /** Откат восстановления: файл заменяется защитной копией, без неё удаляется */
    public replaceWith(userId: unknown, source: string | null): void {
        if (!isId(userId)) return;
        const cached = this.handles.get(userId);
        if (cached?.isOpen) cached.close();
        this.handles.delete(userId);
        const file = this.file(userId);
        for (const suffix of ['-wal', '-shm', '-journal']) rmSync(file + suffix, { force: true });
        if (!source) {
            rmSync(file, { force: true });
            return;
        }
        copyFileSync(source, file + '.tmp');
        renameSync(file + '.tmp', file);
    }
    private readLinks(db: DatabaseSync): RecordingLink[] {
        return (db.prepare('select a, b, source, same, at from relations order by at limit 50000').all() as Values[]).map((row) => ({
            a: str(row.a), b: str(row.b), same: num(row.same) === 1, source: str(row.source) === 'user' ? 'user' as const : 'catalog' as const, at: num(row.at),
        }));
    }
    public close(): void {
        for (const db of this.handles.values()) if (db.isOpen) db.close();
        this.handles.clear();
    }
}
