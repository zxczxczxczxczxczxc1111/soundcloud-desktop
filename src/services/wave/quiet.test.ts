/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installQuiet, openStream, quietBounds, quietOptionsOf, type QuietOptions } from './quiet';
import type { SitePlayer, SiteSound } from '../wave';
import type { WaveTrack } from '../waveTypes';

// 200 отсчётов на 200 с: отсчёт на секунду. Тишина 0, звук 100
const form = (intro: number, loud: number, tail: number): number[] => [...Array(intro).fill(0), ...Array(loud).fill(100), ...Array(tail).fill(0)];

it('quietBounds: тишина в начале и в конце по форме волны', () => {
    const bounds = quietBounds(form(5, 190, 5), 200000);
    expect(bounds).toEqual({ introEnd: 5000, loudEnd: 195000 });
    // Одиночный щелчок в тишине звук не начинает
    const click = form(6, 194, 0);
    click[2] = 100;
    expect(quietBounds(click, 200000)?.introEnd).toBe(6000);
    // Короткий трек, пустая форма и тишина целиком не разбираются
    expect(quietBounds(form(5, 190, 5), 20000)).toBeNull();
    expect(quietBounds([1, 2, 3], 200000)).toBeNull();
    expect(quietBounds(Array(200).fill(0), 200000)).toBeNull();
});

it('quietOptionsOf: длина перехода целая от 1 до 12 с, остальное выключает', () => {
    expect(quietOptionsOf({ edges: false, crossfade: 5 })).toEqual({ edges: false, crossfade: 5 });
    expect(quietOptionsOf({ crossfade: 30 })).toEqual({ edges: true, crossfade: 12 });
    expect(quietOptionsOf({ crossfade: 0.4 }).crossfade).toBe(0);
    expect(quietOptionsOf({ crossfade: '5' }).crossfade).toBe(0);
    expect(quietOptionsOf(null)).toEqual({ edges: true, crossfade: 0 });
});

const API = 'https://api-v2.soundcloud.com/media/soundcloud:tracks:1/abc/stream/hls';
const streamTrack = (id: number): WaveTrack =>
    ({
        id, kind: 'track', title: 'T' + id, duration: 200000, waveform_url: 'https://wave.sndcdn.com/x.json', track_authorization: 'auth+1',
        media: { transcodings: [
            { url: API.replace('hls', 'progressive'), format: { protocol: 'progressive', mime_type: 'audio/mpeg' } },
            { url: API + '-enc', format: { protocol: 'ctr-encrypted-hls', mime_type: 'audio/mp4; codecs="mp4a.40.2"' } },
            { url: API, snipped: false, format: { protocol: 'hls', mime_type: 'audio/mp4; codecs="mp4a.40.2"' } },
        ] },
    }) as WaveTrack;

it('openStream: открытый HLS AAC с track_authorization, без отрывков и шифрованных потоков', () => {
    expect(openStream(streamTrack(1))).toBe(API + '?track_authorization=auth%2B1');
    const snipped = streamTrack(1) as WaveTrack & { media: { transcodings: Array<{ snipped?: boolean }> } };
    snipped.media.transcodings[2].snipped = true;
    expect(openStream(snipped)).toBeNull();
    expect(openStream({ ...streamTrack(1), track_authorization: undefined } as WaveTrack)).toBeNull();
    expect(openStream({ id: 1 })).toBeNull();
});

// Поддельный Web Audio: значение регулятора сразу становится конечным значением запланированного изменения
interface FakeParam { value: number; cancelScheduledValues: () => void; setValueAtTime: (v: number) => void; linearRampToValueAtTime: (v: number) => void; setValueCurveAtTime: (c: Float32Array) => void }
const fakeParam = (value: number): FakeParam => {
    const param: FakeParam = {
        value,
        cancelScheduledValues: () => undefined,
        setValueAtTime: (v) => { param.value = v; },
        linearRampToValueAtTime: (v) => { param.value = v; },
        setValueCurveAtTime: (c) => { param.value = c[c.length - 1]; },
    };
    return param;
};
const fakeGain = () => ({ gain: fakeParam(1), connect: vi.fn(), disconnect: vi.fn() });

const volume = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
// Громкость, которая реально стоит у элемента, мимо подмены свойства
const heard = (element: HTMLMediaElement): number => volume?.get?.call(element) as number;

let started = 0;
let from = 0;
let playing = true;
let sound: SiteSound & { attributes: WaveTrack };
let player: SitePlayer;
let options: QuietOptions;
let raw: number[] | null;
let siteAudio: HTMLAudioElement;
let siteGain: ReturnType<typeof fakeGain>;
let deck: HTMLAudioElement | null;
let deckPlaying = false;
let deckTime = 0;
let resolveStream: (url: string) => Promise<string | null>;
let hasNext = true;
const originalPlay = HTMLMediaElement.prototype.play;
// Позиция первого трека идёт по часам, пока он играет
const firstPosition = (): number => from + (Date.now() - started);

function makeSound(id: number, position: () => number): SiteSound & { attributes: WaveTrack } {
    const context = {
        state: 'running', currentTime: 0, destination: {},
        createGain: fakeGain,
        createMediaElementSource: (element: HTMLAudioElement) => {
            deck = element;
            Object.defineProperties(element, {
                readyState: { configurable: true, get: () => 4 },
                duration: { configurable: true, get: () => 200 },
                seeking: { configurable: true, get: () => false },
                paused: { configurable: true, get: () => !deckPlaying },
                ended: { configurable: true, get: () => false },
                currentTime: { configurable: true, get: () => (deckPlaying ? firstPosition() / 1000 : deckTime), set: (value: number) => { deckTime = value; } },
                play: { configurable: true, value: () => { deckPlaying = true; return Promise.resolve(); } },
                pause: { configurable: true, value: () => { deckPlaying = false; } },
                load: { configurable: true, value: () => undefined },
            });
            return { connect: vi.fn() };
        },
    };
    const orchestration = { context, gainNodes: { glitchCoverup: siteGain }, mediaElementSource: { mediaElement: siteAudio } };
    return {
        id,
        attributes: streamTrack(id),
        seek: vi.fn((ms: number) => { from = ms; started = Date.now(); }),
        currentTime: position,
        getMediaDuration: () => 200000,
        isSnippetized: () => false,
        player: { player: { _player: { _player: { _webAudioOrchestration: orchestration } } } },
    } as SiteSound & { attributes: WaveTrack };
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    started = Date.now();
    from = 0;
    playing = true;
    deck = null;
    deckPlaying = false;
    deckTime = 0;
    hasNext = true;
    options = { edges: true, crossfade: 0 };
    raw = form(5, 190, 5);
    resolveStream = vi.fn(async () => 'https://playback.media-streaming.soundcloud.cloud/x/playlist.m3u8');
    // В jsdom звук не играет: запуск только отдаёт обещание
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
    siteAudio = new Audio();
    siteGain = fakeGain();
    sound = makeSound(1, () => (playing ? firstPosition() : from));
    player = {
        getCurrentSound: () => sound,
        isPlaying: () => playing,
        hasNextSound: () => hasNext,
        playNext: vi.fn(() => {
            const at = Date.now();
            sound = makeSound(2, () => Math.max(0, Date.now() - at - 200));
        }),
    } as unknown as SitePlayer;
    document.body.innerHTML = '';
});
afterEach(() => {
    HTMLMediaElement.prototype.play = originalPlay;
    vi.restoreAllMocks();
    vi.useRealTimers();
});

function install() {
    return installQuiet({ player: () => player, rawSamples: () => raw, resolveStream: (url) => resolveStream(url), held: () => false, options: () => options, disposed: () => false });
}

it('тишина в начале проматывается один раз, тихий хвост проматывается к концу', async () => {
    playing = false;
    const section = install();
    playing = true;
    started = Date.now();
    await vi.advanceTimersByTimeAsync(600);
    expect(sound.seek).toHaveBeenCalledWith(4700);
    // Человек вернулся в начало сам: повторно не проматывается
    from = 2000;
    started = Date.now();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sound.seek).toHaveBeenCalledTimes(1);
    from = 195600;
    started = Date.now();
    await vi.advanceTimersByTimeAsync(300);
    expect(sound.seek).toHaveBeenLastCalledWith(199750);
    section.dispose();
});

it('плавный переход: хвост в своём элементе, сайт переходит дальше, громкость вступает и возвращается', async () => {
    options = { edges: true, crossfade: 5 };
    from = 179000;
    const section = install();
    void siteAudio.play();
    siteAudio.volume = 0.8;
    // Звук кончается на 195,5 с, переход с 190,5 с, хвост готовится с 180,5 с
    await vi.advanceTimersByTimeAsync(3000);
    expect(resolveStream).toHaveBeenCalledWith(API + '?track_authorization=auth%2B1');
    expect(deck?.getAttribute('src')).toContain('playlist.m3u8');
    expect(deckPlaying).toBe(true);
    expect(heard(siteAudio)).toBeCloseTo(0.8);
    await vi.advanceTimersByTimeAsync(8600);
    expect(player.playNext).toHaveBeenCalledTimes(1);
    expect(section.crossfaded(1)).toBe(true);
    expect(sound.id).toBe(2);
    // Новый трек заиграл через 0,2 с и за 2,5 с набрал половину пути по синусу; ползунок сайта видит свою громкость
    await vi.advanceTimersByTimeAsync(2800);
    expect(siteAudio.volume).toBe(0.8);
    expect(heard(siteAudio)).toBeGreaterThan(0.8 * 0.6);
    expect(heard(siteAudio)).toBeLessThan(0.8 * 0.8);
    expect(siteGain.gain.value).toBe(1);
    // Человек двигает ползунок во время перехода: новая громкость тоже с множителем
    siteAudio.volume = 0.5;
    expect(heard(siteAudio)).toBeLessThan(0.5);
    await vi.advanceTimersByTimeAsync(3000);
    expect(heard(siteAudio)).toBeCloseTo(0.5);
    expect(deckPlaying).toBe(false);
    expect(deck?.hasAttribute('src')).toBe(false);
    section.dispose();
    expect(Object.prototype.hasOwnProperty.call(siteAudio, 'volume')).toBe(false);
    expect(siteAudio.volume).toBe(0.5);
});

it('потока нет: трек просто затихает к концу звука, новый трек звучит в полную громкость', async () => {
    options = { edges: true, crossfade: 5 };
    resolveStream = vi.fn(async () => null);
    from = 185000;
    const section = install();
    void siteAudio.play();
    siteAudio.volume = 0.8;
    await vi.advanceTimersByTimeAsync(8000);
    expect(heard(siteAudio)).toBeLessThan(0.8 * 0.75);
    expect(player.playNext).not.toHaveBeenCalled();
    sound = makeSound(3, () => 1000);
    await vi.advanceTimersByTimeAsync(300);
    expect(heard(siteAudio)).toBeCloseTo(0.8);
    expect(section.crossfaded(1)).toBe(false);
    section.dispose();
});

it('на повторе трека, без следующего трека и с выключенной настройкой перехода нет', async () => {
    options = { edges: true, crossfade: 5 };
    from = 185000;
    document.body.innerHTML = '<button class="repeatControl m-one"></button>';
    let section = install();
    void siteAudio.play();
    await vi.advanceTimersByTimeAsync(8000);
    expect(resolveStream).not.toHaveBeenCalled();
    expect(heard(siteAudio)).toBe(1);
    section.dispose();
    document.body.innerHTML = '';
    hasNext = false;
    from = 185000;
    started = Date.now();
    section = install();
    await vi.advanceTimersByTimeAsync(8000);
    expect(resolveStream).not.toHaveBeenCalled();
    section.dispose();
    hasNext = true;
    options = { edges: false, crossfade: 0 };
    from = 185000;
    started = Date.now();
    const stub = HTMLMediaElement.prototype.play;
    section = install();
    await vi.advanceTimersByTimeAsync(8000);
    expect(resolveStream).not.toHaveBeenCalled();
    expect(sound.seek).not.toHaveBeenCalled();
    expect(player.playNext).not.toHaveBeenCalled();
    section.dispose();
    expect(HTMLMediaElement.prototype.play).toBe(stub);
});
