// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waveScript, type WaveTrack } from './wave';

// Поддельный сайт: плеер, API и модель трека через тот же webpackJsonp, что у SoundCloud
interface FakeItem { sound: { id: number }; explicit?: boolean }
function fakeSite(related: (seed: number) => WaveTrack[]) {
    let items: FakeItem[] = [];
    let index = -1;
    let playing = false;
    const states: Record<string, boolean> = { fallbackEnabled: true };
    class Item {
        constructor(_attributes: object, options: object) {
            Object.assign(this, options);
        }
        release(): void {}
    }
    class Sound {
        id: number;
        constructor(json: WaveTrack) {
            this.id = json.id;
        }
        isSnippetized(): boolean { return false; }
        isBlocked(): boolean { return false; }
        isPlayable(): boolean { return true; }
        seek(): void {}
        getMediaDuration(): number { return 200000; }
        currentTime(): number { return 0; }
    }
    const queue = {
        model: Item,
        get length() { return items.length; },
        slice: (start?: number, end?: number) => items.slice(start, end),
        add: (list: FakeItem[]) => { items = items.concat(list); },
        reset: (list: FakeItem[]) => { items = list; },
    };
    const player = {
        getQueue: () => queue,
        getQueueState: () => ({ currentIndex: index }),
        getCurrentQueueItem: () => items[index] ?? null,
        getCurrentSound: () => items[index]?.sound ?? null,
        replaceQueue: vi.fn((list: FakeItem[], start: number) => { items = list; index = start; }),
        playCurrent: vi.fn(() => { playing = true; }),
        pauseCurrent: vi.fn(() => { playing = false; }),
        isPlaying: () => playing,
        setCurrentItem: (item: FakeItem) => { index = items.indexOf(item); },
        getState: (name: string) => states[name],
        toggleState: vi.fn((name: string, value: boolean) => { states[name] = value; }),
    };
    const seeds: WaveTrack[] = [1, 2, 3].map((id) => ({ id, kind: 'track', user_id: 100 + id, duration: 180000, title: 'Seed ' + id }));
    const api = {
        callEndpointByUrl: vi.fn(),
        callEndpoint: vi.fn(async (name: string, path: { track_id?: number }) => {
            switch (name) {
                case 'me': return { body: { id: 77 } };
                case 'playHistoryTracks': return { body: { collection: seeds.map((track) => ({ track })) } };
                case 'soundLikesIds': return { body: { collection: [] } };
                case 'relatedSounds': return { body: { collection: related(path.track_id ?? 0) } };
                default: return { body: { collection: [] } };
            }
        }),
    };
    const modules = { 1: { exports: player }, 2: { exports: api }, 3: { exports: Sound } };
    const jsonp: unknown[] = [];
    Object.defineProperty(jsonp, 'push', {
        value: (chunk: [unknown, Record<string, (m: object, e: object, r: object) => void>, string[][]]) => {
            for (const [id] of chunk[2]) chunk[1][id]({}, {}, { c: modules });
            return 0;
        },
    });
    Object.assign(window, { webpackJsonp: jsonp });
    return { player, api, states, setItems: (list: FakeItem[], at: number) => { items = list; index = at; } };
}

beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState(null, '', '/discover');
    localStorage.clear();
    document.body.innerHTML = '<div class="l-content"><div class="modular-home-mixed-selection"></div></div>';
    // В jsdom нет раскладки: блок считается видимым, пока он в документе
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get(this: HTMLElement) { return this.parentElement; } });
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('сеть в тесте закрыта'))));
});
afterEach(() => {
    window.dispatchEvent(new Event('pagehide'));
    delete (window as unknown as Record<string, unknown>).webpackJsonp;
    Reflect.deleteProperty(HTMLElement.prototype, 'offsetParent');
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = '';
});

const relatedTracks = (seed: number): WaveTrack[] =>
    Array.from({ length: 8 }, (_, i) => ({ id: seed * 1000 + i, kind: 'track', user_id: seed * 10 + i, duration: 200000, title: 'Rel ' + seed + '-' + i, policy: i === 7 ? 'SNIP' : 'ALLOW' }));

it('подбирает треки до запуска, запускает волну и гасит автоплей сайта', async () => {
    const site = fakeSite(relatedTracks);
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const section = document.getElementById('sc-wave')!;
    expect(section.nextElementSibling?.className).toBe('modular-home-mixed-selection');
    expect(section.querySelectorAll('.scw-tile[data-track]')).toHaveLength(5);
    expect(section.querySelector('.scw-track')?.textContent).toMatch(/Seed \d/);
    expect(section.textContent).not.toContain('Rel 1-7');

    section.querySelector<HTMLButtonElement>('.scw-play')!.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(site.player.replaceQueue).toHaveBeenCalledTimes(1);
    const queued = site.player.replaceQueue.mock.calls[0][0] as FakeItem[];
    expect(queued).toHaveLength(10);
    expect(queued.every((item) => item.sound.id % 1000 !== 7)).toBe(true);
    expect(site.states.fallbackEnabled).toBe(false);
    expect(site.player.playCurrent).toHaveBeenCalled();
    expect(section.querySelector('.scw-track')?.textContent).toMatch(/^Rel /);
    expect(section.querySelector('.scw-up-h')?.textContent).toBe('Next up');
});

it('заканчивается, когда пользователь включил другое, и возвращает автоплей', async () => {
    const site = fakeSite(relatedTracks);
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    document.querySelector<HTMLButtonElement>('#sc-wave .scw-play')!.click();
    await vi.advanceTimersByTimeAsync(100);
    site.setItems([{ sound: { id: 5 } }], 0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(site.states.fallbackEnabled).toBe(true);
    expect(document.querySelector('#sc-wave .scw-up-h')?.textContent).toBe('Up first');
});

it('догружает хвост своей очереди, когда впереди остаётся мало треков', async () => {
    const site = fakeSite(relatedTracks);
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    document.querySelector<HTMLButtonElement>('#sc-wave .scw-play')!.click();
    await vi.advanceTimersByTimeAsync(100);
    const queued = site.player.replaceQueue.mock.calls[0][0] as FakeItem[];
    site.setItems(queued, 7);
    await vi.advanceTimersByTimeAsync(1100);
    const queue = site.player.getQueue();
    expect(queue.length).toBeGreaterThan(10);
    const ids = queue.slice().map((item) => item.sound.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(site.states.fallbackEnabled).toBe(false);
});

it('без модулей сайта говорит, что волна не работает, и не падает', async () => {
    Object.assign(window, { webpackJsonp: [] });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(21000);
    expect(document.querySelector('#sc-wave .scw-track')?.textContent).toBe('My Wave doesn’t work with this SoundCloud version');
    expect(document.querySelector<HTMLButtonElement>('#sc-wave .scw-play')?.disabled).toBe(true);
});

it('на русском сайте пишет по-русски и помнит режим', async () => {
    fakeSite(relatedTracks);
    Object.assign(window, { __scSiteTranslation: { language: 'ru' } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const section = document.getElementById('sc-wave')!;
    expect(section.querySelector('.scw-title')?.textContent).toBe('Моя волна');
    section.querySelector<HTMLButtonElement>('[data-mode="fresh"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(JSON.parse(localStorage.getItem('scDesktopWave') ?? '{}').mode).toBe('fresh');
    expect(section.querySelector('[data-mode="fresh"]')?.getAttribute('aria-checked')).toBe('true');
    delete (window as unknown as Record<string, unknown>).__scSiteTranslation;
});
