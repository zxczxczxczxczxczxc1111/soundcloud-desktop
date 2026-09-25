// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { installPlaybackRecovery, type PlaybackRecovery } from './playbackRecovery';
import type { SitePlayer } from './wave';
let recovery: PlaybackRecovery | undefined;
afterEach(() => { recovery?.dispose(); vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML = ''; });
function fixture() {
    vi.useFakeTimers(); vi.setSystemTime(1000000);
    let playing = true;
    const player = { getCurrentSound: () => ({ id: 42, currentTime: () => 10000 }), isPlaying: () => playing,
        pauseCurrent: vi.fn(() => { playing = false; }), playCurrent: vi.fn(() => { playing = true; }), replaceQueue: vi.fn() };
    recovery = installPlaybackRecovery({ player: () => player as unknown as SitePlayer, refresh: vi.fn(), checkpoint: async () => {}, language: 'en' });
    return { player, setPlaying: (value: boolean) => { playing = value; } };
}
it('ограничивает повторы зависшего потока и сохраняет очередь', () => {
    const { player } = fixture(); recovery!.tick();
    for (let i = 0; i < 20; i++) { vi.advanceTimersByTime(5000); recovery!.tick(); }
    expect(player.playCurrent).toHaveBeenCalledTimes(3);
    expect(player.replaceQueue).not.toHaveBeenCalled();
    expect(document.getElementById('sc-playback-status')?.textContent).toContain('Press Play');
});
it('возврат сети и сон не отменяют выбранную пользователем паузу', () => {
    const { player, setPlaying } = fixture(); recovery!.tick(); window.dispatchEvent(new Event('offline'));
    const pause = document.createElement('button'); pause.className = 'playControls__play'; document.body.append(pause);
    pause.click(); setPlaying(false); window.dispatchEvent(new Event('online')); recovery!.resume();
    expect(player.playCurrent).not.toHaveBeenCalled();
});
it('возвращает воспроизведение после сети без замены очереди', () => {
    const { player } = fixture(); recovery!.tick(); window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online'));
    expect(player.playCurrent).toHaveBeenCalledOnce(); expect(player.replaceQueue).not.toHaveBeenCalled();
});
