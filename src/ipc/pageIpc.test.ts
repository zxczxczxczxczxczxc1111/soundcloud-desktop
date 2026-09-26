import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SiteDictionary, TrackInfo } from '../types';
import { FakeIpc, fakeEvent, trusting } from './fakeIpc.helper.test';
import { registerPageIpc, type PageIpcDeps, type PlaybackState } from './pageIpc';

const dictionary = { marker: 'словарь' } as unknown as SiteDictionary;
const track = (fields: Partial<TrackInfo> = {}): TrackInfo => ({
    title: 'Песня', author: 'Автор', artwork: '', elapsed: '0:10', duration: '3:00', isPlaying: false, isLiked: false, url: '', artistUrl: '', ...fields,
});

function setup(settings: Record<string, unknown> = {}) {
    const ipc = new FakeIpc();
    const site = fakeEvent();
    const playback: PlaybackState = { info: track({ title: '', elapsed: '' }), playedThisRun: false, updates: 0, changes: 0, lastUpdateAt: 0, lastProgressAt: 0 };
    const page = { isDestroyed: () => false, executeJavaScript: vi.fn(async () => null) };
    const controller = { execute: vi.fn(async () => true) };
    const settingsManager = { setSiteState: vi.fn() };
    const history = { setPlayerArea: vi.fn(), show: vi.fn(), setNowPlaying: vi.fn() };
    const presence = { updateMeta: vi.fn(), updatePresence: vi.fn(async () => {}) };
    const webhooks = { updateTrackInfo: vi.fn(async () => {}) };
    const deps: PageIpcDeps = {
        trustedSite: trusting(site),
        store: { get: (key, fallback) => (key in settings ? settings[key] : fallback), set: vi.fn(), delete: vi.fn() },
        diagnostics: { record: vi.fn() },
        playback,
        devMode: false,
        page: () => page,
        controller: () => controller,
        siteDictionary: () => dictionary,
        hiddenBlocksCss: () => '.a{display:none}',
        settings: () => settingsManager,
        history: () => history,
        presence: () => presence,
        webhooks: () => webhooks,
        previewPresence: vi.fn(),
        updateThumbar: vi.fn(),
    };
    registerPageIpc(ipc, deps);
    return { ipc, site, playback, page, controller, settingsManager, history, presence, webhooks, deps };
}

afterEach(() => {
    vi.useRealTimers();
});

describe('обработчики страницы сайта', () => {
    it('чужой отправитель: трек и команды не проходят, синхронные запросы всё равно получают ответ', async () => {
        const { ipc, playback, controller, presence } = setup();
        const stranger = fakeEvent();
        await ipc.send('soundcloud:track-update', stranger, { data: track({ isPlaying: true }), reason: 'track-change' });
        await ipc.send('soundcloud:playback', stranger, 'play');
        expect(playback.playedThisRun).toBe(false);
        expect(playback.updates).toBe(0);
        expect(controller.execute).not.toHaveBeenCalled();
        expect(presence.updatePresence).not.toHaveBeenCalled();
        // Без ответа страница встала бы на синхронном запросе
        await expect(ipc.send('soundcloud:site-translation', stranger)).resolves.toBeNull();
        await expect(ipc.send('soundcloud:early-blocks', fakeEvent())).resolves.toBe('');
    });
    it('«музыка уже звучала» ставится первым обновлением с игрой и не снимается паузой', async () => {
        const { ipc, site, playback } = setup();
        await ipc.send('soundcloud:track-update', site, { data: track({ isPlaying: false }), reason: 'initial-state' });
        expect(playback.playedThisRun).toBe(false);
        await ipc.send('soundcloud:track-update', site, { data: track({ isPlaying: true }), reason: 'playback-state-change' });
        expect(playback.playedThisRun).toBe(true);
        await ipc.send('soundcloud:track-update', site, { data: track({ isPlaying: false }), reason: 'playback-state-change' });
        expect(playback.playedThisRun).toBe(true);
        expect(playback.info.isPlaying).toBe(false);
    });
    it('счётчики журнала: смена трека, движение позиции, скрипт медиаклавиш на новом треке', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000);
        const { ipc, site, playback, page, webhooks, presence, deps } = setup();
        await ipc.send('soundcloud:track-update', site, { data: track({ elapsed: '0:01' }), reason: 'track-change' });
        expect(playback).toMatchObject({ updates: 1, changes: 1, lastUpdateAt: 1000, lastProgressAt: 1000 });
        expect(page.executeJavaScript).toHaveBeenCalledOnce();
        vi.setSystemTime(2000);
        await ipc.send('soundcloud:track-update', site, { data: track({ elapsed: '0:01' }), reason: 'progress' });
        expect(playback).toMatchObject({ updates: 2, changes: 1, lastUpdateAt: 2000, lastProgressAt: 1000 });
        vi.setSystemTime(3000);
        await ipc.send('soundcloud:track-update', site, { data: track({ elapsed: '0:02' }), reason: 'progress' });
        expect(playback.lastProgressAt).toBe(3000);
        expect(page.executeJavaScript).toHaveBeenCalledOnce();
        expect(webhooks.updateTrackInfo).toHaveBeenCalledTimes(3);
        expect(presence.updatePresence).toHaveBeenCalledTimes(3);
        expect(deps.updateThumbar).toHaveBeenLastCalledWith(false, false);
    });
    it('мусор вместо трека и неизвестная команда отклонены', async () => {
        const { ipc, site, playback, controller } = setup();
        await ipc.send('soundcloud:track-update', site, 'не трек');
        await ipc.send('soundcloud:track-update', site, { data: null });
        expect(playback.updates).toBe(0);
        await ipc.send('soundcloud:playback', site, 'rm -rf');
        expect(controller.execute).not.toHaveBeenCalled();
        await ipc.send('soundcloud:playback', site, 'next');
        expect(controller.execute).toHaveBeenCalledWith('next');
    });
    it('словарь перевода только для русского сайта; сбой словаря не вешает страницу', async () => {
        const ru = setup();
        await expect(ru.ipc.send('soundcloud:site-translation', ru.site)).resolves.toBe(dictionary);
        const en = setup({ siteLanguage: 'en' });
        await expect(en.ipc.send('soundcloud:site-translation', en.site)).resolves.toBeNull();
        const broken = setup();
        broken.deps.siteDictionary = () => {
            throw new Error('словарь битый');
        };
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(broken.ipc.send('soundcloud:site-translation', broken.site)).resolves.toBeNull();
        expect(error).toHaveBeenCalledOnce();
        error.mockRestore();
    });
    it('отчёт о модулях сайта: поломка в журнал и F1, находка снимает строку, мусор игнорируется', async () => {
        const { ipc, site, settingsManager, deps } = setup();
        const broken = { player: false, api: true, sound: true, translation: true };
        await ipc.send('soundcloud:site-state', site, broken);
        expect(deps.diagnostics.record).toHaveBeenCalledWith('site.modules-missing', { sitePlayer: false, siteApi: true, siteSound: true, siteTranslation: true });
        expect(settingsManager.setSiteState).toHaveBeenLastCalledWith(broken);
        await ipc.send('soundcloud:site-state', site, { player: true, api: true, sound: true, translation: true });
        expect(settingsManager.setSiteState).toHaveBeenLastCalledWith(null);
        await ipc.send('soundcloud:site-state', site, 'сломано');
        await ipc.send('soundcloud:site-state', fakeEvent(), broken);
        expect(settingsManager.setSiteState).toHaveBeenCalledTimes(2);
        expect(deps.diagnostics.record).toHaveBeenCalledOnce();
    });
    it('метаданные трека доходят до истории и карточки, битые отклонены', async () => {
        const { ipc, site, history, presence, deps } = setup();
        await ipc.send('soundcloud:track-meta', site, { id: -1 });
        expect(presence.updateMeta).not.toHaveBeenCalled();
        await ipc.send('soundcloud:track-meta', site, { id: 42, genre: 'phonk' });
        expect(history.setNowPlaying).toHaveBeenCalledWith(42);
        expect(presence.updateMeta).toHaveBeenCalledWith(expect.objectContaining({ id: 42, genre: 'phonk' }));
        expect(deps.previewPresence).toHaveBeenCalledOnce();
        await ipc.send('soundcloud:open-history', site);
        await ipc.send('soundcloud:player-area', site, 80, 900);
        expect(history.show).toHaveBeenCalledOnce();
        expect(history.setPlayerArea).toHaveBeenCalledWith(80, 900);
    });
});
