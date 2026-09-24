import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackInfo } from '../types';
import { TranslationService } from './translationService';

const mocks = vi.hoisted(() => ({
    login: vi.fn(),
    setActivity: vi.fn(),
    clearActivity: vi.fn(),
    destroy: vi.fn(),
    clients: [] as { isConnected: boolean; disconnected?: () => void }[],
}));
vi.mock('@xhayper/discord-rpc', () => ({
    Client: class {
        isConnected = false;
        disconnected?: () => void;
        user = { setActivity: mocks.setActivity, clearActivity: mocks.clearActivity };
        constructor() {
            mocks.clients.push(this);
        }
        async login() {
            await mocks.login();
            this.isConnected = true;
        }
        async destroy() {
            this.isConnected = false;
            await mocks.destroy();
        }
        on(_event: string, listener: () => void) {
            this.disconnected = listener;
        }
    },
}));
import { PresenceService, PRESENCE_INTERVAL_MS, GITHUB_ICON_URL, GITHUB_REPOSITORY_URL, LOGO_ASSET, formatCount, renderTemplate } from './presenceService';
import type { TrackMeta } from '../types';

const track: TrackInfo = {
    title: 'First',
    author: 'Artist',
    artwork: '',
    elapsed: '0:10',
    duration: '4:00',
    isPlaying: true,
    isLiked: false,
    url: 'https://soundcloud.com/artist/first',
    artistUrl: 'https://soundcloud.com/artist',
};
let service: PresenceService;
let enabled: boolean;
let githubEnabled: boolean;
beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    vi.clearAllMocks();
    mocks.clients.length = 0;
    mocks.login.mockResolvedValue(undefined);
    mocks.setActivity.mockResolvedValue(undefined);
    mocks.destroy.mockResolvedValue(undefined);
    enabled = true;
    githubEnabled = true;
    service = new PresenceService(
        { get: (key, fallback) => (key === 'discordRichPresence' ? enabled : key === 'displayGithubLink' ? githubEnabled : fallback) },
        new TranslationService(),
    );
});
afterEach(async () => {
    await service.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('Discord presence', () => {
    it('ожидает одно подключение и отправляет последний трек', async () => {
        let connected!: () => void;
        mocks.login.mockReturnValue(
            new Promise<void>((resolve) => {
                connected = resolve;
            }),
        );
        const first = service.updatePresence(track);
        const second = service.updatePresence({ ...track, title: 'Second' });
        expect(mocks.login).toHaveBeenCalledTimes(1);
        expect(mocks.setActivity).not.toHaveBeenCalled();
        connected();
        await Promise.all([first, second]);
        expect(mocks.setActivity).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ details: 'Second' }));
    });
    it('объединяет обновления и ограничивает частоту', async () => {
        await service.updatePresence(track);
        await service.updatePresence({ ...track, title: 'Second' });
        await service.updatePresence({ ...track, title: 'Third' });
        expect(mocks.setActivity).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS);
        expect(mocks.setActivity).toHaveBeenCalledTimes(2);
        expect(mocks.setActivity).toHaveBeenLastCalledWith(expect.objectContaining({ details: 'Third' }));
    });
    it('не отправляет неизменённую активность', async () => {
        await service.updatePresence(track);
        await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS);
        await service.updatePresence({ ...track, elapsed: '0:15' });
        expect(mocks.setActivity).toHaveBeenCalledTimes(1);
    });
    it('восстанавливает активность после разрыва без нового события трека', async () => {
        await service.updatePresence(track);
        mocks.clients[0].isConnected = false;
        mocks.clients[0].disconnected?.();
        await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS);
        expect(mocks.login).toHaveBeenCalledTimes(2);
        expect(mocks.setActivity).toHaveBeenCalledTimes(2);
    });
    it('повторяет неудачное подключение новым клиентом', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mocks.login.mockRejectedValueOnce(new Error('Discord closed'));
        await service.updatePresence(track);
        await vi.advanceTimersByTimeAsync(2000);
        expect(mocks.clients).toHaveLength(2);
        expect(mocks.setActivity).toHaveBeenCalledTimes(1);
    });
    it('не публикует трек, если интеграцию выключили во время подключения', async () => {
        let connected!: () => void;
        mocks.login.mockReturnValue(
            new Promise<void>((resolve) => {
                connected = resolve;
            }),
        );
        const pending = service.updatePresence(track);
        enabled = false;
        service.clearActivity();
        connected();
        await pending;
        expect(mocks.setActivity).not.toHaveBeenCalled();
        expect(mocks.clearActivity).toHaveBeenCalledTimes(1);
    });
    it('отключённая интеграция не подключается к Discord', async () => {
        enabled = false;
        await service.updatePresence(track);
        expect(mocks.login).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
});

it('shows a clickable GitHub badge and removes its URL when disabled', async () => {
    await service.updatePresence(track);
    expect(mocks.setActivity).toHaveBeenLastCalledWith(expect.objectContaining({ smallImageKey: GITHUB_ICON_URL, smallImageUrl: GITHUB_REPOSITORY_URL }));
    githubEnabled = false;
    service.updateDisplaySettings(true);
    await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS);
    const activity = mocks.setActivity.mock.calls[mocks.setActivity.mock.calls.length - 1][0];
    expect(activity.smallImageKey).toBe('soundcloud-logo');
    expect(activity.smallImageUrl).toBeUndefined();
});

it('does not lose the first track immediately after changing settings', async () => {
    service.updateDisplaySettings(true);
    await service.updatePresence(track);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.setActivity).toHaveBeenCalledTimes(1);
});

it('по умолчанию показывает SoundCloud и делает трек, артиста и обложку кликабельными', async () => {
    await service.updatePresence(track);
    expect(mocks.setActivity).toHaveBeenLastCalledWith(
        expect.objectContaining({
            name: 'SoundCloud',
            statusDisplayType: 1,
            detailsUrl: 'https://soundcloud.com/artist/first',
            stateUrl: 'https://soundcloud.com/artist',
            largeImageUrl: 'https://soundcloud.com/artist/first',
        }),
    );
});

it('не отправляет ссылки не на SoundCloud', async () => {
    await service.updatePresence({ ...track, url: 'https://example.com/first', artistUrl: 'https://example.com/artist' });
    const activity = mocks.setActivity.mock.calls[mocks.setActivity.mock.calls.length - 1][0];
    expect(activity.detailsUrl).toBeUndefined();
    expect(activity.stateUrl).toBeUndefined();
    expect(activity.largeImageUrl).toBeUndefined();
});

it('кнопка ведёт на страницу-переходник, у приватного трека нет ни кнопки, ни ссылок на трек', async () => {
    service.updateDisplaySettings(true, true);
    await service.updatePresence(track);
    await vi.advanceTimersByTimeAsync(0);
    let activity = mocks.setActivity.mock.calls[mocks.setActivity.mock.calls.length - 1][0];
    expect(activity.buttons).toEqual([{ label: 'Слушать в SoundCloud', url: 'https://zxczxczxczxczxczxc1111.github.io/soundcloud-desktop/open/?t=artist/first' }]);

    await service.updatePresence({ ...track, url: 'https://soundcloud.com/artist/first/s-SeCrEt', title: 'Private' });
    await vi.advanceTimersByTimeAsync(20000);
    activity = mocks.setActivity.mock.calls[mocks.setActivity.mock.calls.length - 1][0];
    expect(JSON.stringify(activity)).not.toContain('s-SeCrEt');
    expect(activity.buttons).toBeUndefined();
    expect(activity.detailsUrl).toBeUndefined();
    expect(activity.largeImageUrl).toBeUndefined();
    expect(activity.stateUrl).toBe('https://soundcloud.com/artist');
});

it('на паузе убирает статус', async () => {
    await service.updatePresence(track);
    await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS);
    await service.updatePresence({ ...track, isPlaying: false });
    expect(mocks.clearActivity).toHaveBeenCalledTimes(1);
    expect(mocks.setActivity).toHaveBeenCalledTimes(1);
});

it('заголовок остаётся SoundCloud, когда в строке статуса выбрано название приложения', async () => {
    service.setStatusDisplayType(0);
    await service.updatePresence(track);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.setActivity).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'SoundCloud', statusDisplayType: 0 }));
});

describe('шаблоны, инкогнито и стоп-листы', () => {
    const meta: TrackMeta = {
        id: 5,
        url: 'https://soundcloud.com/artist/first',
        genre: 'Witch House',
        tags: 'dark "cold wave"',
        plays: 120794,
        likes: 21,
        artist: 'Uploader',
        avatar: 'https://i1.sndcdn.com/avatars-abc-large.jpg',
        artwork: '',
        wave: 'Моя волна · Похожее',
    };
    let settings: Map<string, unknown>;
    let custom: PresenceService;
    beforeEach(() => {
        settings = new Map<string, unknown>([['discordRichPresence', true], ['displayGithubLink', false]]);
        custom = new PresenceService({ get: (key, fallback) => (settings.has(key) ? settings.get(key) : fallback) }, new TranslationService());
    });
    afterEach(async () => {
        await custom.dispose();
    });
    const last = () => mocks.setActivity.mock.calls[mocks.setActivity.mock.calls.length - 1][0];

    it('собирает строки по шаблону из сведений страницы и убирает следы пустых полей', async () => {
        settings.set('discordLine1', '{track} · {genre}');
        settings.set('discordLine2', '{artist} · {plays}');
        settings.set('discordCoverText', '{wave} · {likes}');
        custom.updateMeta(meta);
        await custom.updatePresence(track);
        await vi.advanceTimersByTimeAsync(0);
        expect(last()).toEqual(expect.objectContaining({ details: 'First · Witch House', state: 'Artist · 120,8 тыс. прослушиваний', largeImageText: 'Моя волна · Похожее · 21 лайк' }));
        // Сведения о другом треке не подмешиваются
        await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS);
        await custom.updatePresence({ ...track, url: 'https://soundcloud.com/artist/second', title: 'Second' });
        await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS);
        expect(last()).toEqual(expect.objectContaining({ details: 'Second', state: 'Artist', largeImageText: undefined }));
    });
    it('пустой шаблон строки убирает строку из карточки', async () => {
        settings.set('discordLine2', '');
        await custom.updatePresence(track);
        expect(last().state).toBeUndefined();
        expect(last().stateUrl).toBeUndefined();
        expect(custom.preview().card?.statusLine).toBe('SoundCloud');
    });
    it('вместо серой заглушки аватара ставит аватар из модели или логотип', async () => {
        await custom.updatePresence({ ...track, artwork: 'https://a1.sndcdn.com/images/default_avatar_t500x500.png' });
        expect(last().largeImageKey).toBe(LOGO_ASSET);
        custom.updateMeta(meta);
        await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS);
        expect(last().largeImageKey).toBe('https://i1.sndcdn.com/avatars-abc-t500x500.jpg');
    });
    it('инкогнито и стоп-листы снимают карточку и называют причину', async () => {
        await custom.updatePresence(track);
        expect(mocks.setActivity).toHaveBeenCalledTimes(1);
        settings.set('discordIncognito', true);
        custom.refresh();
        await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS);
        expect(mocks.clearActivity).toHaveBeenCalledTimes(1);
        expect(custom.preview()).toEqual({ card: null, hidden: 'incognito' });

        settings.set('discordIncognito', false);
        settings.set('discordHiddenArtists', 'someone, ARTIST');
        custom.refresh();
        expect(custom.preview().hidden).toBe('artist');
        settings.set('discordHiddenArtists', '');
        settings.set('discordHiddenGenres', 'techno\ncold wave');
        custom.updateMeta(meta);
        expect(custom.preview().hidden).toBe('genre');
        settings.set('discordHiddenGenres', 'techno');
        custom.refresh();
        expect(custom.preview().hidden).toBeNull();
    });
});

it('числа со словом: русские формы, сокращения, английский', () => {
    expect(formatCount(1, 'plays', 'ru')).toBe('1 прослушивание');
    expect(formatCount(3, 'likes', 'ru')).toBe('3 лайка');
    expect(formatCount(11, 'likes', 'ru')).toBe('11 лайков');
    expect(formatCount(1500000, 'plays', 'ru')).toBe('1,5\u00a0млн прослушиваний');
    expect(formatCount(1, 'plays', 'en')).toBe('1 play');
    expect(formatCount(1200, 'likes', 'en')).toBe('1.2K likes');
    expect(formatCount(0, 'plays', 'ru')).toBe('');
});

it('шаблон без пустых полей не трогает дефисы и двоеточия внутри названий', () => {
    expect(renderTemplate('{artist} - {track}', { artist: '', track: 'Lo-Fi: Intro' })).toBe('Lo-Fi: Intro');
    expect(renderTemplate('{track} ({genre})', { track: 'A', genre: '' })).toBe('A');
    expect(renderTemplate('{track} | {genre} | {plays}', { track: 'A', genre: '', plays: '5 plays' })).toBe('A | 5 plays');
    expect(renderTemplate('{unknown} {track}', { track: 'A' })).toBe('{unknown} A');
});
