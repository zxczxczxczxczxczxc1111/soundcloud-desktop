import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { RECOMMEND_MIGRATIONS, RecommendStore } from './recommendStore';

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
    expect(store.tasteLibrary(0, [5])).toEqual({ likes: [], follows: [], uploads: [] });
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
    const check = new DatabaseSync(join(directory, 'recommend-77.sqlite'));
    expect(check.prepare('pragma user_version').get()).toEqual({ user_version: 1 });
    expect(check.prepare("select count(*) as n from sqlite_master where name = 'extra'").get()).toEqual({ n: 0 });
    check.close();
    const fixed = [...RECOMMEND_MIGRATIONS, ['create table extra(x integer)']];
    expect(open(directory, fixed).uploads(77, ['sc:track:1'])).toHaveLength(1);
    expect(existsSync(join(directory, 'recommend-77.v1.sqlite'))).toBe(true);
    stores.splice(0).forEach((store) => store.close());
    // Файл новее клиента не трогается
    expect(() => open(directory).uploads(77, ['sc:track:1'])).toThrow(/более новой версией/);
    const again = new DatabaseSync(join(directory, 'recommend-77.sqlite'));
    expect(again.prepare('pragma user_version').get()).toEqual({ user_version: 2 });
    again.close();
});

it('испорченный файл откладывается рядом, а не удаляется', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const directory = folder();
    writeFileSync(join(directory, 'recommend-77.sqlite'), 'not a database at all, just text that is long enough to be read as a header');
    const store = open(directory);
    expect(store.recordUploads(77, [track(1, 'Song', 1)], 10)).toBe(1);
    expect(readdirSync(directory).some((name) => /^recommend-77\.broken-\d+\.sqlite$/.test(name))).toBe(true);
});
