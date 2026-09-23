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
import { PresenceService, PRESENCE_INTERVAL_MS } from './presenceService';

const track: TrackInfo = {
    title: 'First',
    author: 'Artist',
    artwork: '',
    elapsed: '0:10',
    duration: '4:00',
    isPlaying: true,
    isLiked: false,
    url: 'https://soundcloud.com/artist/first',
};
let service: PresenceService;
let enabled: boolean;
beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    vi.clearAllMocks();
    mocks.clients.length = 0;
    mocks.login.mockResolvedValue(undefined);
    mocks.setActivity.mockResolvedValue(undefined);
    mocks.destroy.mockResolvedValue(undefined);
    enabled = true;
    service = new PresenceService(
        { get: (key, fallback) => (key === 'discordRichPresence' ? enabled : fallback) },
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
