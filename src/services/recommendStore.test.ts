import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { RECOMMEND_MIGRATIONS, RecommendStore } from './recommendStore';
import type { RadarEdition } from './radar';

const folders: string[] = [];
const stores: RecommendStore[] = [];
const folder = (): string => {
    const created = mkdtempSync(join(tmpdir(), 'sc-recommend-test-'));
    folders.push(created);
    return created;
};
const open = (directory: string, migrations = RECOMMEND_MIGRATIONS): RecommendStore => {
    const store = new RecommendStore(directory, migrations);
    stores.push(store);
    return store;
};
afterEach(() => {
    for (const store of stores.splice(0)) store.close();
    for (const created of folders.splice(0)) rmSync(created, { recursive: true, force: true });
    vi.restoreAllMocks();
});
const track = (id: number, title: string, uploader: number, extra: Record<string, unknown> = {}): Record<string, unknown> =>
    ({ id, kind: 'track', title, user_id: uploader, user: { id: uploader, username: 'user' + uploader }, duration: 180000, ...extra });
const members = (store: RecommendStore, user: number): string[] => store.libraryMembers(user, 'likes').map((item) => item.key);

it('загрузки хранят разбор версии, даты и кредиты, первое появление не перетирается', () => {
    const store = open(folder());
    const raw = track(5, 'Artist - Song (Altare Remix)', 9, {
        created_at: '2026-09-25T08:38:54Z', display_date: '2026-09-26T10:00:00Z', release_date: '2026-09-24T00:00:00Z',
        publisher_metadata: { artist: 'Artist', isrc: 'SE6XW2681132', writer_composer: 'Writer' }, secret_token: 's-123',
    });
    expect(store.recordUploads(77, [raw, { id: 'bad' }, null], 1000)).toBe(1);
    expect(store.recordUploads(77, [{ ...raw, title: 'Artist - Song (Altare Remix)' }], 2000)).toBe(1);
    const [saved] = store.uploads(77, ['sc:track:5', 'sc:track:6', 'junk']);
    expect(saved).toMatchObject({
        key: 'sc:track:5', uploader: 9, version: ['remix:altare'], familyKey: 'song|artist', isrc: 'SE6XW2681132', createdAt: Date.parse('2026-09-25T08:38:54Z'),
        displayAt: Date.parse('2026-09-26T10:00:00Z'), releaseDay: '2026-09-24', parser: 1, firstSeen: 1000, checked: 2000,
    });
    expect(saved.credits.map((credit) => credit.role + ':' + credit.name)).toEqual(['remixer:Altare', 'artist:Artist', 'writer:Writer']);
    expect(store.uploads(78, ['sc:track:5'])).toEqual([]);
});

it('связь каталога только при одном ISRC и той же версии, пропадает вместе с условием; решение пользователя последнее', () => {
    const store = open(folder());
    const isrc = { publisher_metadata: { isrc: 'QZMHP2505378' } };
    store.recordUploads(77, [track(1, 'Artist - Song', 1, isrc), track(2, 'Artist - Song', 2, { ...isrc, duration: 181000 }), track(3, 'Artist - Song (Slowed)', 3, isrc)], 10);
    expect(store.recordingLinks(77).map((link) => [link.a, link.b, link.source, link.same])).toEqual([['sc:track:1', 'sc:track:2', 'catalog', true]]);
    // Загрузчик переименовал трек в slowed: прежняя связь больше не подтверждена
    store.recordUploads(77, [track(2, 'Artist - Song (Slowed)', 2, { ...isrc, duration: 181000 })], 20);
    expect(store.recordingLinks(77).map((link) => [link.a, link.b])).toEqual([['sc:track:2', 'sc:track:3']]);
    expect(store.setRecordingLink(77, 'sc:track:9', 'sc:track:4', true, 30)).toBe(true);
    expect(store.setRecordingLink(77, 'sc:track:4', 'sc:track:9', false, 40)).toBe(true);
    expect(store.setRecordingLink(77, 'sc:track:4', 'sc:track:4', true)).toBe(false);
    expect(store.setRecordingLink(77, 'sc:user:4', 'sc:track:5', true)).toBe(false);
    expect(store.recordingLinks(77).filter((link) => link.source === 'user')).toEqual([{ a: 'sc:track:4', b: 'sc:track:9', same: false, source: 'user', at: 40 }]);
});

it('A16: полный обход снимает пропавшее, неполный и продолженный ничего не удаляют', () => {
    const store = open(folder());
    const first = store.syncStart(77, 'likes', false, 100);
    expect(first).toMatchObject({ run: 1, status: 'running', cursor: null });
    expect(store.syncPage(77, 'likes', 1, [{ key: 'sc:track:1', added: 50 }, { key: 'sc:track:2' }], { offset: '2', limit: 200 }, 110)).toBe(true);
    expect(store.syncPage(77, 'likes', 1, [{ key: 'sc:track:3', added: 40 }], null, 120)).toBe(true);
    expect(store.syncFinish(77, 'likes', 1, 'complete', '', 130)).toMatchObject({ status: 'complete', completed: 130, count: 3, cursor: null });
    expect(members(store, 77)).toEqual(['sc:track:1', 'sc:track:3', 'sc:track:2']);
    // Второй прогон оборвался на первой странице: удалений нет, курсор для продолжения остался
    store.syncStart(77, 'likes', false, 200);
    store.syncPage(77, 'likes', 2, [{ key: 'sc:track:1' }], { offset: '1' }, 210);
    expect(store.syncFinish(77, 'likes', 2, 'partial', 'HTTP 429', 220)).toMatchObject({ status: 'partial', cursor: { offset: '1' }, error: 'HTTP 429' });
    expect(members(store, 77)).toHaveLength(3);
    // Продолжение того же прогона завершает его, но по нему не удаляется
    expect(store.syncStart(77, 'likes', true, 300)).toMatchObject({ run: 2, resumed: true, cursor: { offset: '1' } });
    store.syncPage(77, 'likes', 2, [], null, 310);
    store.syncFinish(77, 'likes', 2, 'complete', '', 320);
    expect(members(store, 77)).toHaveLength(3);
    // Новый полный прогон без трека 2: трек снят, дата лайка трека 1 сохранилась
    store.syncStart(77, 'likes', true, 400);
    store.syncPage(77, 'likes', 3, [{ key: 'sc:track:1' }, { key: 'sc:track:3' }], null, 410);
    store.syncFinish(77, 'likes', 3, 'complete', '', 420);
    expect(store.libraryMembers(77, 'likes')).toEqual([{ key: 'sc:track:1', added: 50 }, { key: 'sc:track:3', added: 40 }]);
});

it('для вкуса: лайки с датой и разбором загрузки, подписки, кредиты сыгранного; снятое с лайков не идёт', () => {
    const store = open(folder());
    store.recordUploads(77, [track(1, 'Artist - Song', 9, { genre: 'House', publisher_metadata: { artist: 'Real Name' } }), track(5, 'Other', 8)], 10);
    store.syncStart(77, 'likes', false, 100);
    store.syncPage(77, 'likes', 1, [{ key: 'sc:track:1', added: 50 }, { key: 'sc:track:2' }], null, 110);
    store.syncFinish(77, 'likes', 1, 'complete', '', 120);
    store.syncStart(77, 'followings', false, 100);
    store.syncPage(77, 'followings', 1, [{ key: 'sc:user:9' }, { key: 'sc:user:12' }], null, 110);
    store.syncFinish(77, 'followings', 1, 'complete', '', 120);
    const library = store.tasteLibrary(77, [5, 6, 5, -1]);
    expect(library.likes).toEqual([
        expect.objectContaining({ id: 1, added: 50, upload: expect.objectContaining({ uploader: 9, uploaderName: 'user9', title: 'Artist - Song', genre: 'House' }) }),
        { id: 2, added: 0, upload: null },
    ]);
    expect(library.likes[0].upload?.credits.map((credit) => credit.role + ':' + credit.key)).toEqual(['artist:artist', 'artist:realname']);
    expect(library.follows.sort((a, b) => a - b)).toEqual([9, 12]);
    expect(library.uploads.map((upload) => upload.id)).toEqual([5]);
    // Лайк снят полным обходом: во вкус больше не идёт
    store.syncStart(77, 'likes', false, 200);
    store.syncPage(77, 'likes', 2, [{ key: 'sc:track:2' }], null, 210);
    store.syncFinish(77, 'likes', 2, 'complete', '', 220);
    expect(store.tasteLibrary(77, []).likes.map((like) => like.id)).toEqual([2]);
    expect(store.tasteLibrary(0, [5])).toEqual({ likes: [], follows: [], playlists: [], uploads: [] });
});

it('для вкуса: треки плейлистов из текущих списков, свой главнее сохранённого, убранный плейлист не идёт', () => {
    const store = open(folder());
    store.recordUploads(77, [track(1, 'One', 9, { genre: 'House' }), track(3, 'Three', 8)], 10);
    const sync = (source: string, keys: string[], run: number): void => {
        store.syncStart(77, source, false, 100 * run);
        store.syncPage(77, source, run, keys.map((key) => ({ key })), null, 100 * run + 10);
        store.syncFinish(77, source, run, 'complete', '', 100 * run + 20);
    };
    sync('playlists', ['sc:playlist:10'], 1);
    sync('playlist-likes', ['sc:playlist:20', 'sc:playlist:30'], 1);
    sync('playlist:10', ['sc:track:1', 'sc:track:2'], 1);
    sync('playlist:20', ['sc:track:1', 'sc:track:3'], 1);
    sync('playlist:40', ['sc:track:4'], 1);
    const tracks = store.tasteLibrary(77, []).playlists.sort((a, b) => a.id - b.id);
    expect(tracks.map((entry) => [entry.id, entry.own, entry.upload?.genre ?? null])).toEqual([[1, true, 'House'], [2, true, null], [3, false, '']]);
    // Сохранённый плейлист убрали из библиотеки: его треки во вкус больше не идут
    sync('playlist-likes', ['sc:playlist:30'], 2);
    expect(store.tasteLibrary(77, []).playlists.map((entry) => entry.id).sort((a, b) => a - b)).toEqual([1, 2]);
});

it('A15: ответ прошлого прогона и чужого аккаунта не принимается', () => {
    const store = open(folder());
    store.syncStart(77, 'likes', false, 100);
    store.syncStart(77, 'likes', false, 200);
    expect(store.syncPage(77, 'likes', 1, [{ key: 'sc:track:1' }], null, 210)).toBe(false);
    expect(store.syncFinish(77, 'likes', 1, 'complete', '', 220)).toBeNull();
    expect(store.syncPage(78, 'likes', 2, [{ key: 'sc:track:1' }], null, 230)).toBe(false);
    expect(store.syncPage(77, 'likes', 2, [{ key: 'https://evil' }], null, 240)).toBe(false);
    expect(store.syncPage(77, 'likes', 2, [], { 'x y': 1 }, 250)).toBe(false);
    expect(store.syncStart(77, '../likes', false)).toBeNull();
    expect(store.syncFinish(77, 'likes', 2, 'done', '', 260)).toBeNull();
    expect(members(store, 77)).toEqual([]);
    expect(store.syncState(78)).toEqual([]);
});

it('данные переживают перезапуск, аккаунты в разных файлах', () => {
    const directory = folder();
    const store = open(directory);
    store.recordUploads(77, [track(1, 'Song', 1)], 10);
    store.syncStart(77, 'likes', false, 10);
    store.close();
    const reopened = open(directory);
    expect(reopened.uploads(77, ['sc:track:1'])).toHaveLength(1);
    expect(reopened.syncState(77)).toMatchObject([{ source: 'likes', run: 1, status: 'running' }]);
    reopened.recordUploads(78, [track(2, 'Other', 2)], 10);
    expect(reopened.uploads(77, ['sc:track:2'])).toEqual([]);
    expect(readdirSync(directory).filter((name) => name.endsWith('.sqlite')).sort()).toEqual(['recommend-77.sqlite', 'recommend-78.sqlite']);
});

it('A18: миграция в транзакции с копией прежней схемы, сбой откатывается и повторяется', () => {
    const directory = folder();
    open(directory).recordUploads(77, [track(1, 'Song', 1)], 10);
    stores.splice(0).forEach((store) => store.close());
    const broken = [...RECOMMEND_MIGRATIONS, ['create table extra(x integer)', 'insert into nowhere values (1)']];
    expect(() => open(directory, broken).uploads(77, ['sc:track:1'])).toThrow();
    const current = RECOMMEND_MIGRATIONS.length;
    const check = new DatabaseSync(join(directory, 'recommend-77.sqlite'));
    expect(check.prepare('pragma user_version').get()).toEqual({ user_version: current });
    expect(check.prepare("select count(*) as n from sqlite_master where name = 'extra'").get()).toEqual({ n: 0 });
    check.close();
    const fixed = [...RECOMMEND_MIGRATIONS, ['create table extra(x integer)']];
    expect(open(directory, fixed).uploads(77, ['sc:track:1'])).toHaveLength(1);
    expect(existsSync(join(directory, 'recommend-77.v' + current + '.sqlite'))).toBe(true);
    stores.splice(0).forEach((store) => store.close());
    // Файл новее клиента не трогается
    expect(() => open(directory).uploads(77, ['sc:track:1'])).toThrow(/более новой версией/);
    const again = new DatabaseSync(join(directory, 'recommend-77.sqlite'));
    expect(again.prepare('pragma user_version').get()).toEqual({ user_version: current + 1 });
    again.close();
});

it('хранилище первой схемы поднимается до радара на месте: загрузки и обход целы, копия прежней схемы рядом', () => {
    const directory = folder();
    const old = open(directory, RECOMMEND_MIGRATIONS.slice(0, 1));
    old.recordUploads(77, [track(1, 'Song', 1)], 10);
    old.syncStart(77, 'likes', false, 10);
    stores.splice(0).forEach((store) => store.close());
    const store = open(directory);
    expect(store.uploads(77, ['sc:track:1'])).toHaveLength(1);
    expect(store.syncState(77)).toMatchObject([{ source: 'likes', run: 1 }]);
    expect(store.editions(77)).toEqual([]);
    expect(store.catalogChecked(77, 'user:5', 'Five', 'ok', '', 3, 100)).toBe(true);
    expect(existsSync(join(directory, 'recommend-77.v1.sqlite'))).toBe(true);
});

it('испорченный файл откладывается рядом, а не удаляется', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const directory = folder();
    writeFileSync(join(directory, 'recommend-77.sqlite'), 'not a database at all, just text that is long enough to be read as a header');
    const store = open(directory);
    expect(store.recordUploads(77, [track(1, 'Song', 1)], 10)).toBe(1);
    expect(readdirSync(directory).some((name) => /^recommend-77\.broken-\d+\.sqlite$/.test(name))).toBe(true);
});

const DAY = 86400000;
const iso = (at: number): string => new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z');
const edition = (period: string, cutoff: number, directions: string[] = []): RadarEdition => ({
    period, revision: 0, created: cutoff + 1000, cutoff, status: 'complete', coverage: { accounts: 1, checked: 1, failed: 0, searches: 0, searchesDone: 0 },
    algorithm: 1, taste: 2, uploads: [],
    items: directions.map((direction, index) => ({
        key: 'sc:track:' + (index + 1), id: index + 1, title: 'T' + index, artist: 'A', kind: 'release', at: cutoff - DAY, heard: false,
        score: 0.5, base: 0.5, bonus: 0, penalty: 0, direction, reason: { kind: 'taste' },
    })),
});

it('источники радара: проверка с отметкой времени worker, пустая подпись не стирает прежнюю, чужие ключи отклоняются', () => {
    const store = open(folder());
    expect(store.catalogChecked(77, 'user:5', 'Five', 'ok', '', 12, 100)).toBe(true);
    expect(store.catalogChecked(77, 'user:5', '', 'failed', 'rate', 0, 200)).toBe(true);
    expect(store.catalogChecked(77, 'search:artistname', 'Artist Name', 'gone', '', 0, 300)).toBe(true);
    expect(store.catalogChecked(77, 'user:0', 'x', 'ok', '', 0)).toBe(false);
    expect(store.catalogChecked(77, 'search:a b', 'x', 'ok', '', 0)).toBe(false);
    expect(store.catalogChecked(77, 'user:5', 'x', 'done', '', 0)).toBe(false);
    expect(store.catalogState(77)).toEqual([
        { key: 'search:artistname', label: 'Artist Name', checked: 300, status: 'gone', error: '', found: 0 },
        { key: 'user:5', label: 'Five', checked: 200, status: 'failed', error: 'rate', found: 0 },
    ]);
});

it('окно радара: публикация или день релиза в окне; перезалив виден по более ранней копии той же версии', () => {
    const store = open(folder());
    const cutoff = Date.parse('2026-09-25T06:00:00Z');
    const fresh = iso(cutoff - 3 * DAY);
    store.recordUploads(77, [
        // Старая загрузка той же версии и её свежий перезалив на другом канале
        track(1, 'Artist - Song', 1, { created_at: iso(cutoff - 400 * DAY) }),
        track(2, 'Artist - Song', 2, { created_at: fresh, duration: 181000 }),
        // Другая версия той же песни: не перезалив
        track(3, 'Artist - Song (Slowed)', 3, { created_at: fresh }),
        // Скрыто загружена давно, опубликована в окне
        track(4, 'Late', 4, { created_at: iso(cutoff - 90 * DAY), display_date: fresh }),
        // Старая публикация с заявленным релизом в окне
        track(5, 'Label Song', 5, { created_at: iso(cutoff - 90 * DAY), release_date: iso(cutoff - 2 * DAY) }),
        track(6, 'Too Old', 6, { created_at: iso(cutoff - 60 * DAY) }),
        // Пользователь подтвердил: 7 и 8 одна запись, 8 выложена раньше
        track(7, 'Renamed', 7, { created_at: fresh }),
        track(8, 'Original Name', 8, { created_at: iso(cutoff - 200 * DAY) }),
    ], 10);
    store.setRecordingLink(77, 'sc:track:7', 'sc:track:8', true, 20);
    const window = store.radarUploads(77, cutoff - 28 * DAY, cutoff);
    expect(window.uploads.map((upload) => upload.id).sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 7]);
    expect(window.reuploads.sort()).toEqual(['sc:track:2', 'sc:track:7']);
    expect(store.radarUploads(77, cutoff, cutoff - DAY)).toEqual({ uploads: [], reuploads: [] });
});

it('A17: задача периода одна и переживает перезапуск; неделя не дублируется ни повтором, ни сменой зоны', () => {
    const directory = folder();
    const store = open(directory);
    const cutoff = Date.parse('2026-09-25T06:00:00Z');
    expect(store.radarTask(77, '2026-09-25', cutoff, 'Europe/Moscow', 1000)).toEqual({ started: 1000 });
    store.close();
    const reopened = open(directory);
    expect(reopened.radarTask(77, '2026-09-25', cutoff, 'Europe/Moscow', 5000)).toEqual({ started: 1000 });
    expect(reopened.radarStatus(77, '2026-09-25', cutoff)).toEqual({ published: false, started: 1000 });
    expect(reopened.saveEdition(77, edition('2026-09-25', cutoff, ['phonk']), false)).toMatchObject({ period: '2026-09-25', revision: 1 });
    expect(reopened.radarStatus(77, '2026-09-25', cutoff).published).toBe(true);
    // Повтор автоматического выпуска и соседний период после смены зоны не записываются
    expect(reopened.saveEdition(77, edition('2026-09-25', cutoff, ['pop']), false)).toBeNull();
    expect(reopened.saveEdition(77, edition('2026-09-24', cutoff - 11 * 3600000, ['pop']), false)).toBeNull();
    expect(reopened.radarStatus(77, '2026-09-24', cutoff - 11 * 3600000).published).toBe(true);
    // Ручная пересборка добавляет ревизию, прежняя остаётся
    expect(reopened.saveEdition(77, edition('2026-09-25', cutoff, ['jazz']), true)).toMatchObject({ revision: 2 });
    expect(reopened.edition(77, '2026-09-25')?.items.map((item) => item.direction)).toEqual(['jazz']);
    expect(reopened.edition(77, '2026-09-25', 1)?.items.map((item) => item.direction)).toEqual(['phonk']);
    expect(reopened.saveEdition(77, edition('2026-10-02', cutoff + 7 * DAY, ['rock']), false)).toMatchObject({ revision: 1 });
    expect(reopened.editions(77).map((item) => [item.period, item.revision, item.manual, item.items])).toEqual([
        ['2026-10-02', 1, false, 1], ['2026-09-25', 2, true, 1], ['2026-09-25', 1, false, 1],
    ]);
    // Направления прошлых выпусков: последняя ревизия каждого периода
    expect(reopened.radarDirections(77, '2026-10-09')).toEqual([['rock'], ['jazz']]);
    expect(reopened.edition(78, '2026-09-25')).toBeNull();
    expect(reopened.radarTask(77, '../x', cutoff, 'Europe/Moscow')).toBeNull();
});
