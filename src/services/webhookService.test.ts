import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WebhookTrackData } from '../types';
const send = vi.hoisted(() => vi.fn());
vi.mock('cross-fetch', () => ({ default: send }));
import { WebhookService } from './webhookService';
const track: WebhookTrackData = {
    title: 'Track',
    author: 'Artist',
    url: 'https://soundcloud.com/a/one',
    artwork: '',
    elapsed: '0:00',
    duration: '4:00',
};
const settings = new Map<string, unknown>();
let service: WebhookService;
beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    send.mockReset();
    send.mockResolvedValue({ ok: true });
    settings.clear();
    settings.set('webhookEnabled', true);
    settings.set('webhookUrl', 'https://example.com/hook');
    service = new WebhookService({
        get: (key, fallback) => settings.get(key) ?? fallback,
        set: (key, value) => {
            settings.set(key, value);
        },
        delete: (key) => {
            settings.delete(key);
        },
    });
});
afterEach(() => {
    service.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
});
it('учитывает только воспроизведение, исключая паузу', async () => {
    await service.updateTrackInfo(track, true);
    await vi.advanceTimersByTimeAsync(30000);
    await service.updateTrackInfo({ ...track, elapsed: '0:30' }, false);
    await vi.advanceTimersByTimeAsync(300000);
    expect(send).not.toHaveBeenCalled();
    await service.updateTrackInfo({ ...track, elapsed: '0:30' }, true);
    await vi.advanceTimersByTimeAsync(90000);
    expect(send).toHaveBeenCalledTimes(1);
});
it('перемотка назад не сбрасывает время прослушивания', async () => {
    await service.updateTrackInfo(track, true);
    await vi.advanceTimersByTimeAsync(30000);
    await service.updateTrackInfo({ ...track, elapsed: '0:20' }, true, 'seek-change');
    await vi.advanceTimersByTimeAsync(90000);
    expect(send).toHaveBeenCalledTimes(1);
});
it('задержавшийся ответ не отмечает новый трек отправленным', async () => {
    let finish!: (response: { ok: boolean }) => void;
    send.mockReturnValueOnce(
        new Promise((resolve) => {
            finish = resolve;
        }),
    );
    await service.updateTrackInfo({ ...track, duration: '0:02' });
    await vi.advanceTimersByTimeAsync(1000);
    await service.updateTrackInfo({ ...track, title: 'Second', url: 'https://soundcloud.com/a/two', duration: '0:02' });
    finish({ ok: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(send.mock.calls[1][1].body).track).toBe('Second');
});
it('отключение отменяет таймер и выполняющийся запрос', async () => {
    send.mockReturnValue(new Promise(() => undefined));
    await service.updateTrackInfo({ ...track, duration: '0:02' });
    await vi.advanceTimersByTimeAsync(1000);
    const signal = send.mock.calls[0][1].signal as AbortSignal;
    service.setEnabled(false);
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(300000);
    expect(send).toHaveBeenCalledTimes(1);
});
it('поддерживает порог 0 и не отправляет дубликаты при обновлении позиции', async () => {
    service.setTriggerPercentage(0);
    await service.updateTrackInfo(track);
    await vi.advanceTimersByTimeAsync(1);
    await service.updateTrackInfo({ ...track, elapsed: '0:01' });
    await vi.advanceTimersByTimeAsync(300000);
    expect(send).toHaveBeenCalledTimes(1);
});
it('отрицательное оставшееся время преобразует в полную длительность', async () => {
    await service.updateTrackInfo({ ...track, elapsed: '1:00', duration: '-3:00' });
    await vi.advanceTimersByTimeAsync(90000);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][1].body).duration).toBe(240);
});
