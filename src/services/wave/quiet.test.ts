/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installQuiet, quietBounds, type QuietOptions } from './quiet';
import type { SitePlayer, SiteSound } from '../wave';
import type { WaveTrack } from '../waveTypes';

// 200 отсчётов на 200 с: отсчёт на секунду. Тишина 0, звук 100, тихий конец 10
const form = (intro: number, loud: number, tail: number, end = 100): number[] =>
    [...Array(intro).fill(0), ...Array(loud - 3).fill(100), end, end, end, ...Array(tail).fill(0)];

it('quietBounds: тишина в начале и в конце по форме волны, громкий обрыв просит затухания', () => {
    const bounds = quietBounds(form(5, 190, 5), 200000);
    expect(bounds?.introEnd).toBe(5000);
    expect(bounds?.loudEnd).toBe(195000);
    expect(bounds?.fadeOut).toBe(true);
    // Трек затихает сам: последние секунды тихие, затухание не нужно
    expect(quietBounds(form(0, 200, 0, 10), 200000)?.fadeOut).toBe(false);
    // Одиночный щелчок в тишине звук не начинает
    const click = form(6, 194, 0);
    click[2] = 100;
    expect(quietBounds(click, 200000)?.introEnd).toBe(6000);
    // Короткий трек, пустая форма и тишина целиком не разбираются
    expect(quietBounds(form(5, 190, 5), 20000)).toBeNull();
    expect(quietBounds([1, 2, 3], 200000)).toBeNull();
    expect(quietBounds(Array(200).fill(0), 200000)).toBeNull();
});

let position = 0;
let playing = true;
let sound: SiteSound & { attributes: WaveTrack };
let player: SitePlayer;
let options: QuietOptions;
let raw: number[] | null;
const originalPlay = HTMLMediaElement.prototype.play;

beforeEach(() => {
    vi.useFakeTimers();
    position = 0;
    playing = true;
    options = { edges: true, fade: true };
    raw = form(5, 190, 5);
    // В jsdom звук не играет: запуск только отдаёт обещание
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
    sound = {
        id: 1,
        attributes: { id: 1, kind: 'track', title: 'T', duration: 200000, waveform_url: 'https://wave.sndcdn.com/x.json' },
        seek: vi.fn((ms: number) => { position = ms; }),
        currentTime: () => position,
        getMediaDuration: () => 200000,
        isSnippetized: () => false,
    };
    player = { getCurrentSound: () => sound, isPlaying: () => playing } as unknown as SitePlayer;
});
afterEach(() => {
    HTMLMediaElement.prototype.play = originalPlay;
    vi.useRealTimers();
});

function install() {
    return installQuiet({ player: () => player, rawSamples: () => raw, options: () => options, disposed: () => false });
}

it('тишина в начале проматывается один раз, тихий хвост проматывается к концу', async () => {
    const section = install();
    await vi.advanceTimersByTimeAsync(600);
    expect(sound.seek).toHaveBeenCalledWith(4700);
    // Человек вернулся в начало сам: повторно не проматывается
    position = 2000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(sound.seek).toHaveBeenCalledTimes(1);
    position = 195600;
    await vi.advanceTimersByTimeAsync(300);
    expect(sound.seek).toHaveBeenLastCalledWith(199750);
    section.dispose();
});

it('громкий обрыв затихает к концу звука, смена громкости человеком и смена трека возвращают громкость', async () => {
    const audio = new Audio();
    const section = install();
    void audio.play();
    audio.volume = 0.8;
    position = 10000;
    await vi.advanceTimersByTimeAsync(600);
    expect(audio.volume).toBe(0.8);
    // Звук кончается на 195,5 с: за 3 с до этого громкость на полпути вниз по децибелам. До зоны затухания шаг раз в секунду
    position = 192500;
    await vi.advanceTimersByTimeAsync(1100);
    expect(audio.volume).toBeCloseTo(0.8 * Math.pow(10, -18 / 20), 3);
    // Новый трек: громкость прежняя
    sound = { ...sound, id: 2 };
    position = 0;
    raw = null;
    await vi.advanceTimersByTimeAsync(300);
    expect(audio.volume).toBe(0.8);
    // Затухание шло, человек тронул ползунок: дальше на этом треке громкость его
    sound = { ...sound, id: 3 };
    raw = form(5, 190, 5);
    position = 192500;
    await vi.advanceTimersByTimeAsync(300);
    expect(audio.volume).toBeLessThan(0.8);
    audio.volume = 0.5;
    position = 194500;
    await vi.advanceTimersByTimeAsync(300);
    expect(audio.volume).toBe(0.5);
    section.dispose();
});

it('выключенные настройки и пауза ничего не трогают, dispose снимает перехват запуска', async () => {
    const stub = HTMLMediaElement.prototype.play;
    options = { edges: false, fade: false };
    const audio = new Audio();
    const section = install();
    void audio.play();
    audio.volume = 0.7;
    await vi.advanceTimersByTimeAsync(600);
    expect(sound.seek).not.toHaveBeenCalled();
    position = 193000;
    await vi.advanceTimersByTimeAsync(300);
    expect(audio.volume).toBe(0.7);
    options = { edges: true, fade: true };
    playing = false;
    await vi.advanceTimersByTimeAsync(300);
    expect(audio.volume).toBe(0.7);
    section.dispose();
    expect(HTMLMediaElement.prototype.play).toBe(stub);
});
