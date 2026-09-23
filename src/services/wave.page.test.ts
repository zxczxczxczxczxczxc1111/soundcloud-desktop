/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://soundcloud.com/discover" }
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waveScript, type WaveTrack } from './wave';

// Поддельный сайт: плеер, API и модель трека через тот же webpackJsonp, что у SoundCloud
interface FakeItem { sound: { id: number }; explicit?: boolean }
type Extra = (name: string, path: Record<string, unknown>, query: Record<string, unknown>) => unknown;
function fakeSite(related: (seed: number) => WaveTrack[], extra: Extra = () => undefined) {
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
        callEndpoint: vi.fn(async (name: string, path: { track_id?: number }, query: Record<string, unknown>) => {
            const body = extra(name, path, query);
            if (body !== undefined) return { body };
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
    delete (window as unknown as Record<string, unknown>).soundcloudAPI;
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

it('пауза кнопкой сайта или медиаклавишей переключает кнопку блока', async () => {
    const site = fakeSite(relatedTracks);
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    document.querySelector<HTMLButtonElement>('#sc-wave .scw-play')!.click();
    await vi.advanceTimersByTimeAsync(1100);
    expect(document.querySelector('#sc-wave .scw-play')?.getAttribute('aria-label')).toBe('Pause');
    site.player.pauseCurrent();
    await vi.advanceTimersByTimeAsync(1100);
    expect(document.querySelector('#sc-wave .scw-play')?.getAttribute('aria-label')).toBe('Play wave');
    site.player.playCurrent();
    await vi.advanceTimersByTimeAsync(1100);
    expect(document.querySelector('#sc-wave .scw-play')?.getAttribute('aria-label')).toBe('Pause');
});

it('без модулей сайта говорит, что волна не работает, и не падает', async () => {
    Object.assign(window, { webpackJsonp: [] });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(21000);
    expect(document.querySelector('#sc-wave .scw-track')?.textContent).toBe('My Wave doesn’t work with this SoundCloud version');
    expect(document.querySelector<HTMLButtonElement>('#sc-wave .scw-play')?.disabled).toBe(true);
});

// Мост в main: отметки «Не нравится» и скрытых артистов
function fakeExclusions(tracks: object[] = [], artists: object[] = []) {
    const bridge = { load: vi.fn(async () => ({ tracks, artists })), set: vi.fn(async () => true) };
    Object.assign(window, { soundcloudAPI: { waveExclusions: bridge } });
    return bridge;
}
const song: WaveTrack = {
    id: 555, kind: 'track', title: 'Song', duration: 200000, user_id: 900,
    user: { id: 900, username: 'Art', permalink_url: 'https://soundcloud.com/art' }, permalink_url: 'https://soundcloud.com/art/song',
};
const artistTracks = Array.from({ length: 6 }, (_, i): WaveTrack => ({ id: 9001 + i, kind: 'track', title: 'Own ' + i, duration: 200000, user_id: 900 }));
const siteExtra: Extra = (name, path, query) => {
    if (name === 'resolve') return query.url === 'https://soundcloud.com/art/song' ? song : query.url === 'https://soundcloud.com/art' ? { kind: 'user', id: 900, username: 'Art', permalink_url: 'https://soundcloud.com/art' } : null;
    if (name === 'userToptracks' && path.id === 900) return { collection: artistTracks };
    return undefined;
};
function listRow(): HTMLElement {
    const row = document.createElement('li');
    row.className = 'soundList__item';
    row.innerHTML = '<div class="sound"><div class="soundTitle"><a class="soundTitle__username" href="/art">Art</a><a class="soundTitle__title" href="/art/song">Song</a></div></div>';
    document.body.append(row);
    return row;
}
function rightClick(node: Element): MouseEvent {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 });
    node.dispatchEvent(event);
    return event;
}
const menuActs = (): string[] => [...document.querySelectorAll<HTMLElement>('.scw-menu [data-menu]')].map((item) => item.dataset.menu ?? '');
const choose = (act: string): void => document.querySelector<HTMLElement>('.scw-menu [data-menu="' + act + '"]')!.click();

it('ПКМ по треку в списке: меню и волна от этого трека, крестик возвращает обычную', async () => {
    const site = fakeSite(relatedTracks, siteExtra);
    fakeExclusions();
    const row = listRow();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const input = document.createElement('input');
    document.body.append(input);
    expect(rightClick(input).defaultPrevented).toBe(false);

    const event = rightClick(row.querySelector('.soundTitle__title')!);
    expect(event.defaultPrevented).toBe(true);
    expect(menuActs()).toEqual(['wave-track', 'wave-artist', 'dislike', 'hide-artist']);
    choose('wave-track');
    expect(document.querySelector('.scw-menu')).toBeNull();
    await vi.advanceTimersByTimeAsync(100);
    const queued = site.player.replaceQueue.mock.calls[site.player.replaceQueue.mock.calls.length - 1][0] as FakeItem[];
    expect(queued[0].sound.id).toBe(555);
    // Похожие на трек, дальше похожие на них: волна едет от выбранного трека
    expect(queued.slice(1).every((item) => String(item.sound.id).startsWith('555'))).toBe(true);
    expect(queued.slice(1).some((item) => Math.floor(item.sound.id / 1000) === 555)).toBe(true);
    const section = document.getElementById('sc-wave')!;
    expect(section.querySelector('.scw-hint')?.textContent).toBe('Wave from Song');
    expect(section.querySelector('.scw-why')?.textContent).toBe('Your wave starts here');

    section.querySelector<HTMLElement>('[data-act="clear-seed"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(section.querySelector('.scw-hint')?.textContent).toBe('Similar to what you play and like');
});

it('волна по треку, который уже играет: он доигрывает, волна встаёт за ним', async () => {
    const site = fakeSite(relatedTracks, siteExtra);
    fakeExclusions();
    const row = listRow();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    site.setItems([{ sound: { id: 555 } }], 0);
    rightClick(row.querySelector('.soundTitle__title')!);
    choose('wave-track');
    await vi.advanceTimersByTimeAsync(100);
    expect(site.player.replaceQueue).not.toHaveBeenCalled();
    const ids = site.player.getQueue().slice().map((item) => item.sound.id);
    expect(ids[0]).toBe(555);
    expect(ids.length).toBeGreaterThan(1);
    expect(site.player.getCurrentSound()?.id).toBe(555);
    await vi.advanceTimersByTimeAsync(5000);
    expect(site.states.fallbackEnabled).toBe(false);
});

it('ПКМ по артисту: волна от его треков, его треки в подборке', async () => {
    const site = fakeSite(relatedTracks, siteExtra);
    fakeExclusions();
    const row = listRow();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    rightClick(row.querySelector('.soundTitle__username')!);
    expect(menuActs()).toEqual(['wave-artist', 'hide-artist']);
    choose('wave-artist');
    await vi.advanceTimersByTimeAsync(100);
    expect(site.api.callEndpoint).toHaveBeenCalledWith('userToptracks', { id: 900 }, { limit: 20 });
    const queued = site.player.replaceQueue.mock.calls[site.player.replaceQueue.mock.calls.length - 1][0] as FakeItem[];
    expect(queued.some((item) => item.sound.id > 9000 && item.sound.id < 9010)).toBe(true);
    expect(queued.some((item) => item.sound.id > 9000000)).toBe(true);
    expect(document.querySelector('#sc-wave .scw-hint')?.textContent).toBe('Wave from artist Art');
});

// Замкнутый круг, как у «Steel Lullaby»: похожие это четыре трека того же артиста, похожие на них снова они же
const closedCircle = (seed: number): WaveTrack[] =>
    seed >= 555 && seed < 560 ? [556, 557, 558, 559].filter((id) => id !== seed).map((id): WaveTrack => ({ id, kind: 'track', user_id: 900, duration: 200000, title: 'Circle ' + id })) : [];
const stationExtra: Extra = (name, path, query) => {
    if (name === 'resolve' && String(query.url).startsWith('https://soundcloud.com/discover/sets/track-stations:'))
        return { kind: 'system-playlist', tracks: Array.from({ length: 30 }, (_, i) => ({ id: 7000 + i })) };
    if (name === 'trackBatch')
        return String(query.ids).split(',').map((id): WaveTrack => ({ id: Number(id), kind: 'track', user_id: 3000 + (Number(id) % 20), duration: 200000, title: 'Station ' + id }));
    return siteExtra(name, path, query);
};

it('волна по треку из замкнутого круга похожих идёт дальше по станции трека', async () => {
    const site = fakeSite(closedCircle, stationExtra);
    fakeExclusions();
    const row = listRow();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    rightClick(row.querySelector('.soundTitle__title')!);
    choose('wave-track');
    await vi.advanceTimersByTimeAsync(100);
    expect(site.api.callEndpoint).toHaveBeenCalledWith('resolve', {}, { url: 'https://soundcloud.com/discover/sets/track-stations:555' });
    const queued = site.player.replaceQueue.mock.calls[site.player.replaceQueue.mock.calls.length - 1][0] as FakeItem[];
    expect(queued[0].sound.id).toBe(555);
    expect(queued).toHaveLength(11);
    expect(queued.filter((item) => item.sound.id >= 7000).length).toBeGreaterThan(0);
});

it('исчерпанная подборка перед последним треком возвращает автоплей сайта', async () => {
    const few = (seed: number): WaveTrack[] => [0, 1].map((i) => ({ id: seed * 1000 + i, kind: 'track', user_id: seed * 10 + i, duration: 200000, title: 'Few ' + seed + '-' + i }));
    const site = fakeSite(few);
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    document.querySelector<HTMLButtonElement>('#sc-wave .scw-play')!.click();
    await vi.advanceTimersByTimeAsync(100);
    const queued = site.player.replaceQueue.mock.calls[0][0] as FakeItem[];
    expect(queued).toHaveLength(6);
    expect(site.states.fallbackEnabled).toBe(false);
    site.setItems(queued, 4);
    await vi.advanceTimersByTimeAsync(1100);
    expect(site.states.fallbackEnabled).toBe(false);
    site.setItems(queued, 5);
    await vi.advanceTimersByTimeAsync(1100);
    // После последнего трека волны играет автоплей SoundCloud, а не тишина
    expect(site.states.fallbackEnabled).toBe(true);
});

it('«Не нравится» уводит трек из очереди, играющий сменяется следующим, отметка уходит в main', async () => {
    const site = fakeSite(relatedTracks);
    const bridge = fakeExclusions();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const section = document.getElementById('sc-wave')!;
    section.querySelector<HTMLButtonElement>('.scw-play')!.click();
    await vi.advanceTimersByTimeAsync(100);
    const tile = section.querySelector<HTMLElement>('.scw-tile[data-track]')!;
    const disliked = Number(tile.dataset.track);
    rightClick(tile);
    choose('dislike');
    await vi.advanceTimersByTimeAsync(100);
    expect(bridge.set).toHaveBeenCalledWith(77, 'track', expect.objectContaining({ id: disliked }), true);
    expect(site.player.getQueue().slice().some((item) => item.sound.id === disliked)).toBe(false);
    expect(document.querySelector('.scw-toast')?.textContent).toBe('This track won’t play in My Wave');

    const playing = site.player.getCurrentSound()!.id;
    rightClick(section.querySelector('.scw-track')!);
    choose('dislike');
    await vi.advanceTimersByTimeAsync(100);
    expect(site.player.getCurrentSound()!.id).not.toBe(playing);
    const index = site.player.getQueueState().currentIndex;
    expect(site.player.getQueue().slice(index).some((item) => item.sound.id === playing)).toBe(false);
});

it('отмеченное раньше не попадает в подборку, F1 заставляет перечитать отметки', async () => {
    const few = (seed: number): WaveTrack[] => [0, 1].map((i) => ({ id: seed * 1000 + i, kind: 'track', user_id: seed * 10 + i, duration: 200000, title: 'Few ' + seed + '-' + i }));
    fakeSite(few);
    const bridge = fakeExclusions([{ id: 1000 }, { id: 2000 }, { id: 3000 }], [{ id: 11 }]);
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const ids = [...document.querySelectorAll<HTMLElement>('#sc-wave .scw-tile[data-track]')].map((tile) => Number(tile.dataset.track));
    expect(ids.sort()).toEqual([2001, 3001]);
    (window as unknown as { __scWaveExclusionsChanged: () => void }).__scWaveExclusionsChanged();
    await vi.advanceTimersByTimeAsync(10);
    expect(bridge.load).toHaveBeenCalledTimes(2);
});

it('несколько жанров через запятую: подбор по каждому', async () => {
    const site = fakeSite(relatedTracks);
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const section = document.getElementById('sc-wave')!;
    section.querySelector<HTMLElement>('[data-act="genre"]')!.click();
    const input = section.querySelector<HTMLInputElement>('[data-role="genre-input"]')!;
    input.value = 'Techno, dark techno';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    section.querySelector<HTMLInputElement>('[data-role="genre-input"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);
    const tags = site.api.callEndpoint.mock.calls.filter(([name]) => name === 'recentTracks').map(([, path]) => (path as { tag?: string }).tag);
    expect(tags).toEqual(expect.arrayContaining(['techno', 'dark techno']));
    expect(section.querySelector('.scw-genre .scw-label')?.textContent).toBe('techno / dark techno');
    expect(section.querySelector('.scw-hint')?.textContent).toBe('Similar to what you play and like, in techno / dark techno');
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
