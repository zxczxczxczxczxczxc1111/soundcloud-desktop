// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installAudioMonitor } from './audioMonitorService';

const markup = `<div class="playControls"><button class="playControls__play playing"></button>
<a class="playbackSoundBadge__lightLink">Artist</a><a class="playbackSoundBadge__titleLink" href="https://soundcloud.com/artist/track">Track</a>
<div class="playbackSoundBadge__avatar"><div class="image__lightOutline"><span aria-label="Track" style="background-image:url(https://example.com/cover.jpg)"></span></div></div>
<div class="playbackTimeline__timePassed"><span>0:10</span></div><div class="playbackTimeline__duration"><span>4:00</span></div></div>`;
const send = vi.fn();
async function settle() {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(151);
}
beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    send.mockClear();
    document.body.innerHTML = markup;
    Object.assign(window, { soundcloudAPI: { sendTrackUpdate: send } });
});
afterEach(() => {
    window.dispatchEvent(new Event('pagehide'));
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('монитор плеера', () => {
    it('передаёт начальное состояние и не дублирует установку', async () => {
        installAudioMonitor();
        installAudioMonitor();
        expect(send).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ title: 'Track', elapsed: '0:10', isPlaying: true }),
            'initial-state',
        );
        document.querySelector('.playControls__play')?.classList.remove('playing');
        await settle();
        expect(send).toHaveBeenCalledTimes(2);
    });
    it('продолжает наблюдать после замены элемента времени', async () => {
        installAudioMonitor();
        document.querySelector('.playbackTimeline__timePassed')!.innerHTML = '<span>0:30</span>';
        await settle();
        expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ elapsed: '0:30' }), 'seek-change');
    });
    it('переподключается после замены всего плеера', async () => {
        installAudioMonitor();
        document.body.innerHTML = markup.replace(/Track/g, 'Second');
        await settle();
        expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Second' }), 'track-change');
        document.querySelector('.playControls__play')?.classList.remove('playing');
        await settle();
        expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ isPlaying: false }), 'playback-state-change');
    });
    it('передаёт изменение длительности без изменения названия', async () => {
        installAudioMonitor();
        document.querySelector('.playbackTimeline__duration span')!.textContent = '5:00';
        await settle();
        expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ duration: '5:00' }), 'playback-state-change');
    });
    it('отличает обычный прогресс от повтора и перемотки', async () => {
        installAudioMonitor();
        await vi.advanceTimersByTimeAsync(1000);
        document.querySelector('.playbackTimeline__timePassed span')!.textContent = '0:11';
        await settle();
        expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ elapsed: '0:11' }), 'progress');
        document.querySelector('.playbackTimeline__timePassed span')!.textContent = '0:02';
        await settle();
        expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ elapsed: '0:02' }), 'seek-change');
    });
    it('сбрасывает активность при исчезновении плеера', async () => {
        installAudioMonitor();
        document.body.innerHTML = '';
        await settle();
        expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ title: '', isPlaying: false }), 'track-change');
    });
    it('не собирает данные из-за изменений посторонней ленты', async () => {
        installAudioMonitor();
        for (let i = 0; i < 50; i++) document.body.appendChild(document.createElement('article'));
        await settle();
        expect(send).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('после выгрузки освобождает наблюдение и таймеры', async () => {
        installAudioMonitor();
        document.querySelector('.playControls__play')?.classList.remove('playing');
        await Promise.resolve();
        window.dispatchEvent(new Event('pagehide'));
        await settle();
        expect(send).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});
