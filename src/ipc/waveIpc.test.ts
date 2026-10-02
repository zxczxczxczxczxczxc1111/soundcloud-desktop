import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WaveExclusionList } from '../services/waveExclusions';
import { FakeIpc, fakeEvent, trusting } from './fakeIpc.helper.test';
import { registerWaveIpc, type WaveIpcDeps } from './waveIpc';

const DAY = 86400000;
const NOW = 100 * DAY;
const list = (more: WaveExclusionList['more'] = []): WaveExclusionList => ({ tracks: [], artists: [], laterTracks: [], laterArtists: [], more, families: [] });

function setup(responses: Record<string, unknown> = {}) {
    const ipc = new FakeIpc();
    const site = fakeEvent();
    const own = fakeEvent();
    const journal = { load: vi.fn(() => [1, 2]), add: vi.fn() };
    const signals = { add: vi.fn(() => 1) };
    const exclusions = {
        load: vi.fn(() => list([{ id: 7, title: 'Песня', artist: 'Автор', url: '', at: 5, artistId: 70, genre: 'phonk' }])),
        set: vi.fn(() => true),
        currentUser: vi.fn(() => 11),
    };
    const request = vi.fn(async (method: string) => {
        const value = responses[method];
        if (value instanceof Error) throw value;
        return value;
    });
    const library = { request, invalidate: vi.fn() } as unknown as WaveIpcDeps['library'];
    const shelf = { load: vi.fn(() => null), save: vi.fn(() => true) };
    const settingsView = { send: vi.fn() };
    const page = { isDestroyed: () => false, executeJavaScript: vi.fn(async () => null) };
    const deps: WaveIpcDeps = {
        trustedSite: trusting(site),
        trustedLocal: trusting(own),
        store: { get: vi.fn(() => ({ mode: 'order', pick: {} })), set: vi.fn(), delete: vi.fn() },
        diagnostics: { record: vi.fn() },
        journal: () => journal,
        signals: () => signals,
        exclusions,
        library,
        shelf,
        settingsView: () => settingsView,
        page: () => page,
        applySettingChange: vi.fn(),
    };
    registerWaveIpc(ipc, deps);
    return { ipc, site, own, journal, signals, exclusions, request, library, shelf, settingsView, page, deps };
}

afterEach(() => {
    vi.useRealTimers();
});

describe('обработчики волны', () => {
    it('чужой отправитель получает пустые ответы, до хранилищ ничего не доходит', async () => {
        const { ipc, journal, signals, exclusions, request, shelf, deps } = setup();
        const stranger = fakeEvent();
        await expect(ipc.invoke('soundcloud:wave-journal:load', stranger, 11)).resolves.toEqual([]);
        await ipc.send('soundcloud:wave-journal:add', stranger, 11, [3]);
        await ipc.send('soundcloud:wave-signals:add', stranger, 11, [{}]);
        await ipc.send('soundcloud:wave-empty', stranger, { seen: 1 });
        await expect(ipc.invoke('soundcloud:wave-exclusions:load', stranger, 11)).resolves.toBeNull();
        await expect(ipc.invoke('soundcloud:wave-exclusions:set', stranger, 11, 'track', { id: 1 }, true)).resolves.toBe(false);
        await expect(ipc.invoke('soundcloud:wave-taste', stranger, 11)).resolves.toBeNull();
        await expect(ipc.invoke('soundcloud:wave-shelf:load', stranger, 11)).resolves.toBeNull();
        await expect(ipc.invoke('soundcloud:wave-shelf:save', stranger, 11, {})).resolves.toBe(false);
        await expect(ipc.invoke('soundcloud:wave-library:load', stranger)).resolves.toBeNull();
        await expect(ipc.invoke('soundcloud:wave-library:save', stranger, { mode: 'order', pick: {} })).resolves.toBe(false);
        await expect(ipc.invoke('soundcloud:wave-library:heard', stranger, 11)).resolves.toEqual([]);
        expect([journal.load, journal.add, signals.add, exclusions.set, request, shelf.load, shelf.save, deps.applySettingChange, deps.diagnostics.record].every((fn) => vi.mocked(fn).mock.calls.length === 0)).toBe(true);
    });
    it('отметки из F1 снимает только своя страница клиента, сайту это не доступно', async () => {
        const { ipc, site, exclusions } = setup();
        await expect(ipc.invoke('get-wave-exclusions', site)).rejects.toThrow('Недопустимый отправитель IPC');
        await expect(ipc.invoke('remove-wave-exclusion', site, 'track', 7)).rejects.toThrow('Недопустимый отправитель IPC');
        expect(exclusions.set).not.toHaveBeenCalled();
    });
    it('новая отметка сообщает F1 и переучивает вкус по «Больше такого»', async () => {
        const { ipc, site, library, settingsView } = setup();
        await expect(ipc.invoke('soundcloud:wave-exclusions:set', site, 11, 'more', { id: 7 }, true)).resolves.toBe(true);
        expect(settingsView.send).toHaveBeenCalledWith('wave-exclusions-changed');
        expect(library.invalidate).toHaveBeenCalledWith(11, [{ id: 7, artist: 70, genre: 'phonk', tags: '', at: 5, kind: 'more', title: 'Песня', name: 'Автор' }]);
    });
    it('лайк во время трека сразу сбрасывает вкус в main, обычный сигнал нет', async () => {
        const { ipc, site, signals, library } = setup();
        await ipc.send('soundcloud:wave-signals:add', site, 11, [{ id: 1, likedNow: false }]);
        expect(library.invalidate).not.toHaveBeenCalled();
        await ipc.send('soundcloud:wave-signals:add', site, 11, [{ id: 1, likedNow: false }, { id: 2, likedNow: true }]);
        expect(library.invalidate).toHaveBeenCalledOnce();
        // Журнал ничего не принял: вкус не трогается
        signals.add.mockReturnValueOnce(0);
        await ipc.send('soundcloud:wave-signals:add', site, 11, [{ id: 3, likedNow: true }]);
        expect(library.invalidate).toHaveBeenCalledOnce();
    });
    it('снятие в F1: отказ хранилища приходит ошибкой, успех переучивает вкус и будит страницу', async () => {
        const { ipc, own, exclusions, library, page } = setup();
        exclusions.set.mockReturnValueOnce(false);
        await expect(ipc.invoke('remove-wave-exclusion', own, 'track', 7)).rejects.toThrow('Отметка не снята');
        expect(library.invalidate).not.toHaveBeenCalled();
        await ipc.invoke('remove-wave-exclusion', own, 'track', 7);
        expect(exclusions.set).toHaveBeenLastCalledWith(11, 'track', { id: 7 }, false);
        expect(library.invalidate).toHaveBeenCalledOnce();
        expect(page.executeJavaScript).toHaveBeenCalledWith('window.__scWaveExclusionsChanged && window.__scWaveExclusionsChanged()');
    });
    it('пустая волна: счётчики со страницы обрезаются и не бывают мусором', async () => {
        const { ipc, site, deps } = setup();
        await ipc.send('soundcloud:wave-empty', site, { seen: -3, artistTracks: 1e9, moodTags: 2.5 });
        await ipc.send('soundcloud:wave-empty', site, 'пусто');
        expect(deps.diagnostics.record).toHaveBeenCalledOnce();
        expect(deps.diagnostics.record).toHaveBeenCalledWith('wave.empty', { waveSeen: 0, waveArtistTracks: 10000, waveMoodTags: 0 });
    });
    it('подборки дня собираются из прослушанного, плейлистов и свежих лайков', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        const play = (id: number, at: number, heard: number) => ({ id, at, heard, artist: 1, title: 't', artistName: 'a', genre: 'g', tags: '', path: '/a/t', artwork: '', dur: 180000 });
        const { ipc, site, shelf, request } = setup({
            tastePlays: [play(1, NOW - 40 * DAY, 60000), play(2, NOW - DAY, 10000), play(3, NOW - DAY, 90000), play(7, NOW - 3600000, 5000)],
            playlistTracks: [
                { id: 5, own: true, upload: { uploader: 9, title: 'p', uploaderName: 'u', genre: 'g', tags: '', duration: 1000 } },
                { id: 6, own: false, upload: null },
            ],
            libraryMembers: [{ key: 'sc:track:8', added: NOW - DAY }, { key: 'sc:track:9', added: NOW - 60 * DAY }, { key: 'sc:track:x', added: NOW }],
            trackLove: [{ id: 4, artist: 1, done: 5, early: 1, loops: 2, title: 't', artistName: 'a', genre: 'g', tags: '', path: '/a/t', artwork: '', dur: 180000 }],
        });
        const result = (await ipc.invoke('soundcloud:wave-shelf:load', site, 11)) as { recent: number[]; today: number[]; heard: Array<{ id: number }>; playlists: Array<{ id: number; share: number }>; fresh: number[]; love: Array<{ id: number; done: number; early: number; loops: number }> };
        expect(result.recent).toEqual([2, 3, 7]);
        // Ф5: игравшее за сутки, даже коротко
        expect(result.today).toEqual([2, 3, 7]);
        expect(result.heard.map((item) => item.id)).toEqual([1, 3]);
        expect(result.playlists.map((item) => item.id)).toEqual([5]);
        expect(result.playlists[0].share).toBeGreaterThan(0);
        expect(result.fresh).toEqual([8]);
        // П11: любовь к трекам за год
        expect(result.love).toEqual([expect.objectContaining({ id: 4, done: 5, early: 1, loops: 2, path: '/a/t' })]);
        expect(request).toHaveBeenCalledWith('trackLove', 11, NOW - 365 * DAY, 3000);
        expect(shelf.load).toHaveBeenCalledWith(11);
    });
    it('П2: дослушанное за час для старта волны: до конца или от 80% покрытия, без простоя и кругов повтора', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        const play = (id: number, extra: object) => ({ id, at: NOW - 60000, heard: 0, dur: 200000, end: 'skip', away: false, looped: false, covered: null, artist: 1, title: 't', artistName: 'a', genre: 'g', tags: '', path: '/a/t', artwork: '' , ...extra });
        const { ipc, site, request } = setup({
            tastePlays: [
                play(1, { end: 'done', heard: 200000 }),
                play(2, { heard: 170000, covered: 165000 }),
                play(3, { heard: 170000, covered: 60000 }),
                play(4, { end: 'done', heard: 200000, away: true }),
                play(5, { end: 'done', heard: 200000, looped: true }),
                play(6, { heard: 20000 }),
            ],
        });
        const result = (await ipc.invoke('soundcloud:wave-library:recent', site, 11)) as Array<{ id: number; at: number; path: string }>;
        expect(result.map((item) => item.id)).toEqual([1, 2]);
        expect(result[0]).toMatchObject({ at: NOW - 60000, path: '/a/t' });
        expect(request).toHaveBeenCalledWith('tastePlays', 11, NOW - 3600000);
        await expect(ipc.invoke('soundcloud:wave-library:recent', fakeEvent(), 11)).resolves.toEqual([]);
    });
    it('сбой хранилища не валит подборки, неверный пользователь не идёт в хранилище', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const failing = setup({ tastePlays: new Error('нет'), playlistTracks: new Error('нет'), libraryMembers: new Error('нет'), trackLove: new Error('нет') });
        await expect(failing.ipc.invoke('soundcloud:wave-shelf:load', failing.site, 11)).resolves.toEqual({ snapshot: null, recent: [], today: [], heard: [], playlists: [], fresh: [], love: [] });
        expect(warn).toHaveBeenCalledTimes(4);
        warn.mockRestore();
        const { ipc, site, request } = setup();
        await expect(ipc.invoke('soundcloud:wave-library:heard', site, -1)).resolves.toEqual([]);
        await ipc.invoke('soundcloud:wave-shelf:load', site, 'чужой');
        expect(request).not.toHaveBeenCalled();
    });
    it('«Моя музыка»: мусор не сохраняется, верный выбор идёт как смена настройки', async () => {
        const { ipc, site, deps } = setup();
        await expect(ipc.invoke('soundcloud:wave-library:save', site, { mode: 'всё', pick: {} })).resolves.toBe(false);
        expect(deps.applySettingChange).not.toHaveBeenCalled();
        await expect(ipc.invoke('soundcloud:wave-library:save', site, { mode: 'shuffle', pick: { '11': ['likes'] } })).resolves.toBe(true);
        expect(deps.applySettingChange).toHaveBeenCalledWith({ key: 'myMusic', value: { mode: 'shuffle', pick: { '11': ['likes'] } } });
        await expect(ipc.invoke('soundcloud:wave-library:load', site)).resolves.toEqual({ mode: 'order', pick: {} });
    });
    it('повторная регистрация при новом init снимает прежние обработчики', () => {
        const { ipc, deps } = setup();
        expect(() => registerWaveIpc(ipc, deps)).not.toThrow();
        expect(ipc.listeners.get('soundcloud:wave-signals:add')).toHaveLength(1);
        expect(ipc.listeners.get('soundcloud:wave-journal:add')).toHaveLength(1);
    });
});
