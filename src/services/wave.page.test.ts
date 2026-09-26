/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://soundcloud.com/discover" }
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { localDay, waveScript, type WaveTrack, type WaveWindow } from './wave';
import type { PlaybackSnapshot } from './playbackStore';

// Поддельный сайт: плеер, API и модель трека через тот же webpackJsonp, что у SoundCloud
interface FakeItem { sound: { id: number; currentTime?(): number; getMediaDuration?(): number }; explicit?: boolean; sourceInfo?: { type: string } }
// Позиция играющего трека, мс: тест двигает её сам
let position = 0;
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
        attributes: WaveTrack;
        constructor(json: WaveTrack) {
            this.id = json.id;
            this.attributes = json;
        }
        isSnippetized(): boolean { return false; }
        isBlocked(): boolean { return false; }
        isPlayable(): boolean { return true; }
        seek(value: number): void { position = value; }
        getMediaDuration(): number { return 200000; }
        currentTime(): number { return position; }
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
            const body = await extra(name, path, query);
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
    position = 0;
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
    vi.restoreAllMocks();
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
    expect(document.querySelector('#sc-wave .scw-track')?.textContent).toBe('The SoundCloud player is not ready yet');
    expect(document.querySelector<HTMLButtonElement>('#sc-wave .scw-play')?.disabled).toBe(true);
});

it('часы в блоке открывают историю, даже когда волна не работает', async () => {
    const openHistory = vi.fn();
    Object.assign(window, { webpackJsonp: [], soundcloudAPI: { openHistory } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(21000);
    const history = document.querySelector<HTMLButtonElement>('#sc-wave [data-act="history"]')!;
    expect(history.getAttribute('aria-label')).toBe('History, Ctrl+H');
    history.click();
    expect(openHistory).toHaveBeenCalledOnce();
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
    expect(menuActs()).toEqual(['wave-track', 'wave-artist', 'queue-next', 'queue-last', 'pick', 'more', 'later', 'dislike', 'versions', 'hide-family', 'hide-artist']);
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

it('меню мышью без фокуса на пункте, стрелки и Shift+F10 ведут по пунктам', async () => {
    fakeSite(relatedTracks, siteExtra);
    fakeExclusions();
    const row = listRow();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const title = row.querySelector('.soundTitle__title')!;
    rightClick(title);
    const menu = document.querySelector<HTMLElement>('.scw-menu')!;
    // Фокус на пункте после ПКМ сайт обводит синей рамкой
    expect(document.activeElement).toBe(menu);
    expect(menu.style.transformOrigin).toMatch(/px top$/);
    const key = (name: string): void => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
    key('ArrowUp');
    expect((document.activeElement as HTMLElement).dataset.menu).toBe('hide-artist');
    key('ArrowDown');
    expect((document.activeElement as HTMLElement).dataset.menu).toBe('wave-track');
    key('Escape');
    expect(document.querySelector('.scw-menu')).toBeNull();

    // Клавиша меню или Shift+F10: координат нет, фокус сразу на первом пункте
    title.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect((document.activeElement as HTMLElement).dataset.menu).toBe('wave-track');
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
    // Свои 6 треков тасуются с 21 похожим: без закреплённой случайности в первые 10 они не попадают в ~4% прогонов
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const site = fakeSite(relatedTracks, siteExtra);
    fakeExclusions();
    const row = listRow();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    rightClick(row.querySelector('.soundTitle__username')!);
    expect(menuActs()).toEqual(['wave-artist', 'later-artist', 'hide-artist']);
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

// Случай «кровью» 24.09.2026: артиста пропустили в обычной волне, потом волна от его трека играла один этот трек
it('пропуск артиста в прошлой волне не мешает новой волне от его трека', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    // У каждого зерна среди похожих есть трек артиста 900, как у песни из списка
    const withArtist = (seed: number): WaveTrack[] => [...relatedTracks(seed), { id: seed * 1000 + 900, kind: 'track', user_id: 900, duration: 200000, title: 'Art ' + seed }];
    const site = fakeSite(withArtist, siteExtra);
    fakeExclusions();
    const row = listRow();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    document.querySelector<HTMLButtonElement>('#sc-wave .scw-play')!.click();
    await vi.advanceTimersByTimeAsync(1100);
    const queued = site.player.replaceQueue.mock.calls[0][0] as FakeItem[];
    const at = queued.findIndex((item) => item.sound.id % 1000 === 900);
    expect(at).toBeGreaterThan(0);
    // Трек артиста 900 заиграл и пропущен кнопкой сайта на первых секундах
    site.setItems(queued, at);
    await vi.advanceTimersByTimeAsync(1100);
    site.setItems(queued, at + 1);
    await vi.advanceTimersByTimeAsync(1100);

    rightClick(row.querySelector('.soundTitle__title')!);
    choose('wave-track');
    await vi.advanceTimersByTimeAsync(100);
    const seeded = site.player.replaceQueue.mock.calls[site.player.replaceQueue.mock.calls.length - 1][0] as FakeItem[];
    expect(seeded[0].sound.id).toBe(555);
    expect(seeded.length).toBeGreaterThan(1);
    expect(document.querySelectorAll('#sc-wave .scw-tile[data-track]').length).toBeGreaterThan(0);
    // Пропуск убирает артиста только из той волны, где он был: в новой его треки снова возможны
    expect(seeded.some((item) => item.sound.id === 555900)).toBe(true);
});

it('A07: ранний пропуск кнопкой убирает версию, а не весь сборный канал', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    // Сборный канал 900 выложил по пять разных песен рядом с каждым зерном
    const withChannel = (seed: number): WaveTrack[] => [
        ...relatedTracks(seed),
        ...Array.from({ length: 5 }, (_, i) => ({ id: seed * 1000 + 900 + i, kind: 'track', user_id: 900, duration: 200000, title: 'Channel Song ' + seed + '-' + i })),
    ];
    const site = fakeSite(withChannel);
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    document.querySelector<HTMLButtonElement>('#sc-wave .scw-play')!.click();
    await vi.advanceTimersByTimeAsync(1100);
    const queued = site.player.replaceQueue.mock.calls[0][0] as FakeItem[];
    const at = queued.findIndex((item) => item.sound.id % 1000 >= 900);
    expect(at).toBeGreaterThanOrEqual(0);
    site.setItems(queued, at);
    await vi.advanceTimersByTimeAsync(1100);
    // «Дальше» в нижнем плеере на первых секундах песни канала
    const next = document.createElement('button');
    next.className = 'playControls skipControl__next';
    document.body.append(next);
    next.click();
    site.setItems(queued, at + 1);
    await vi.advanceTimersByTimeAsync(1100);
    // Ближе к концу очереди волна догружает хвост из пула: другие песни канала там остались
    site.setItems(site.player.getQueue().slice(), queued.length - 2);
    await vi.advanceTimersByTimeAsync(1100);
    const added = site.player.getQueue().slice(queued.length).map((item) => item.sound.id);
    expect(added.length).toBeGreaterThan(0);
    expect(added.some((id) => id % 1000 >= 900)).toBe(true);
    next.remove();
});

it('волна от трека скрытого артиста подбирает похожих, сам артист в неё не попадает', async () => {
    const site = fakeSite((seed) => [...relatedTracks(seed), { id: seed * 1000 + 900, kind: 'track', user_id: 900, duration: 200000, title: 'Art ' + seed }], siteExtra);
    fakeExclusions([], [{ id: 900, title: 'Art', url: 'https://soundcloud.com/art' }]);
    const row = listRow();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    rightClick(row.querySelector('.soundTitle__title')!);
    choose('wave-track');
    await vi.advanceTimersByTimeAsync(100);
    const queued = site.player.replaceQueue.mock.calls[site.player.replaceQueue.mock.calls.length - 1][0] as FakeItem[];
    expect(queued[0].sound.id).toBe(555);
    expect(queued.length).toBeGreaterThan(1);
    expect(queued.slice(1).some((item) => Math.floor(item.sound.id / 1000) === 555)).toBe(true);
    expect(queued.slice(1).some((item) => item.sound.id % 1000 === 900)).toBe(false);
});

it('трек без похожих и без станции: волна идёт по другим трекам его артиста', async () => {
    const site = fakeSite((seed) => (seed === 555 ? [] : relatedTracks(seed)), siteExtra);
    fakeExclusions();
    const row = listRow();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    rightClick(row.querySelector('.soundTitle__title')!);
    choose('wave-track');
    await vi.advanceTimersByTimeAsync(100);
    const queued = site.player.replaceQueue.mock.calls[site.player.replaceQueue.mock.calls.length - 1][0] as FakeItem[];
    expect(queued[0].sound.id).toBe(555);
    expect(queued.slice(1).every((item) => item.sound.id > 9000 && item.sound.id < 9010)).toBe(true);
    expect(queued.length).toBe(7);
    expect(document.querySelector('#sc-wave .scw-tile .scw-t3')?.textContent).toBe('By Art');
});

it('трек без жанра, все похожие отсеяны: волна идёт по самым частым тегам похожих', async () => {
    // Похожие на песню это уже слышанные треки истории с жанром Phonk, других треков у артиста нет
    const heardPhonk = (seed: number): WaveTrack[] =>
        seed === 555 ? [1, 2, 3].map((id): WaveTrack => ({ id, kind: 'track', user_id: 100 + id, duration: 180000, title: 'Seed ' + id, genre: 'Phonk', tag_list: 'drift "dark phonk"' })) : relatedTracks(seed);
    const phonk = Array.from({ length: 6 }, (_, i): WaveTrack => ({ id: 8800 + i, kind: 'track', user_id: 880 + i, duration: 200000, title: 'Phonk ' + i, genre: 'Phonk' }));
    const site = fakeSite(heardPhonk, (name, path, query) => {
        if (name === 'userToptracks') return { collection: [] };
        if (name === 'recentTracks') return path.tag === 'phonk' ? { collection: phonk } : { collection: [] };
        return siteExtra(name, path, query);
    });
    fakeExclusions();
    const row = listRow();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    rightClick(row.querySelector('.soundTitle__title')!);
    choose('wave-track');
    await vi.advanceTimersByTimeAsync(100);
    const queued = site.player.replaceQueue.mock.calls[site.player.replaceQueue.mock.calls.length - 1][0] as FakeItem[];
    expect(queued[0].sound.id).toBe(555);
    expect(queued.slice(1).map((item) => item.sound.id).sort()).toEqual(phonk.map((track) => track.id));
    expect(site.api.callEndpoint).toHaveBeenCalledWith('recentTracks', { tag: 'phonk' }, { limit: 50 });
    expect(document.querySelector('#sc-wave .scw-tile .scw-t3')?.textContent).toBe('In the vibe of Song: phonk');
});

it('волна от трека, к которому нечего подобрать, не играет его одного и говорит об этом', async () => {
    const site = fakeSite((seed) => (seed === 555 ? [] : relatedTracks(seed)), (name, path, query) => (name === 'userToptracks' ? { collection: [] } : siteExtra(name, path, query)));
    fakeExclusions();
    const report = vi.fn();
    Object.assign((window as unknown as { soundcloudAPI: object }).soundcloudAPI, { reportWaveEmpty: report });
    const row = listRow();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    rightClick(row.querySelector('.soundTitle__title')!);
    choose('wave-track');
    await vi.advanceTimersByTimeAsync(100);
    expect(site.player.replaceQueue).not.toHaveBeenCalled();
    expect(document.querySelector('.scw-toast')?.textContent).toBe('No similar tracks found');
    expect(report).toHaveBeenCalledWith({ seen: 0, artistTracks: 0, moodTags: 0 });
    expect(document.querySelector('#sc-wave .scw-hint')?.textContent).toBe('Similar to what you play and like');
});

it('ссылка из Discord: трек открывается и сразу играет, мусор и неготовый сайт не ломают', async () => {
    type Host = { __scOpenTrack: (path: string) => Promise<string> };
    Object.assign(window, { webpackJsonp: [] });
    window.eval(waveScript());
    // Модули сайта ещё не найдены: main спросит позже
    expect(await (window as unknown as Host).__scOpenTrack('/art/song')).toBe('not-ready');
    window.dispatchEvent(new Event('pagehide'));

    const site = fakeSite(relatedTracks, siteExtra);
    fakeExclusions();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const open = (window as unknown as Host).__scOpenTrack;
    expect(await open('/../evil')).toBe('unavailable');
    expect(site.player.replaceQueue).not.toHaveBeenCalled();
    expect(await open('/art/song')).toBe('played');
    expect(site.api.callEndpoint).toHaveBeenCalledWith('resolve', {}, { url: 'https://soundcloud.com/art/song' });
    const queued = site.player.replaceQueue.mock.calls[0][0] as FakeItem[];
    expect(queued.map((item) => item.sound.id)).toEqual([555]);
    expect(queued[0].sourceInfo?.type).toBe('single');
    expect(site.player.playCurrent).toHaveBeenCalled();
});

it('ссылка из Discord на трек, который уже играет: открывается его страница, очередь и волна остаются', async () => {
    type Host = { __scOpenTrack: (path: string) => Promise<string> };
    const site = fakeSite((seed) => relatedTracks(seed).map((track) => ({ ...track, permalink_url: 'https://soundcloud.com/art/rel-' + track.id })));
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    document.querySelector<HTMLButtonElement>('#sc-wave .scw-play')!.click();
    await vi.advanceTimersByTimeAsync(100);
    const playing = site.player.getCurrentSound()!;
    const opened: (string | null)[] = [];
    const onLink = (event: MouseEvent): void => {
        if (!(event.target instanceof HTMLAnchorElement)) return;
        opened.push(event.target.getAttribute('href'));
        event.preventDefault();
    };
    document.addEventListener('click', onLink);
    try {
        expect(await (window as unknown as Host).__scOpenTrack('/art/rel-' + playing.id)).toBe('played');
    } finally {
        document.removeEventListener('click', onLink);
    }
    expect(opened).toEqual(['/art/rel-' + playing.id]);
    expect(site.player.replaceQueue).toHaveBeenCalledTimes(1);
    expect(site.api.callEndpoint).not.toHaveBeenCalledWith('resolve', expect.anything(), expect.anything());
    await vi.advanceTimersByTimeAsync(5000);
    expect(site.player.getCurrentSound()!.id).toBe(playing.id);
    expect(site.states.fallbackEnabled).toBe(false);
    expect(document.querySelector('#sc-wave .scw-up-h')?.textContent).toBe('Next up');
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

it('профиль вкуса из main доходит до подборки: трек с сильным минусом не встаёт в очередь', async () => {
    const site = fakeSite(relatedTracks);
    const load = vi.fn(async () => ({ artists: [[10, 2]], tags: [], tracks: [[1001, -2], [2001, -2], [3001, -2]] }));
    Object.assign(window, { soundcloudAPI: { waveTaste: { load } } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    document.querySelector<HTMLButtonElement>('#sc-wave .scw-play')!.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(load).toHaveBeenCalledWith(77);
    const ids = site.player.getQueue().slice().map((item) => item.sound.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.some((id) => id % 1000 === 1)).toBe(false);
});

it('«Не сейчас» у играющего трека ставит следующий, «Больше такого» уходит в main с артистом и метками', async () => {
    const site = fakeSite((seed) => relatedTracks(seed).map((track) => ({ ...track, genre: 'Techno', tag_list: 'berlin' })));
    const bridge = fakeExclusions();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const section = document.getElementById('sc-wave')!;
    section.querySelector<HTMLButtonElement>('.scw-play')!.click();
    await vi.advanceTimersByTimeAsync(100);

    const playing = site.player.getCurrentSound()!;
    section.querySelector<HTMLButtonElement>('[data-act="later"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(bridge.set).toHaveBeenCalledWith(77, 'later-track', expect.objectContaining({ id: playing.id }), true);
    expect(site.player.getCurrentSound()!.id).not.toBe(playing.id);
    expect(document.querySelector('.scw-toast')?.textContent).toBe('This track won’t play in My Wave for a week');

    const next = site.player.getCurrentSound()!.id;
    section.querySelector<HTMLButtonElement>('[data-act="more"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(bridge.set).toHaveBeenLastCalledWith(77, 'more', expect.objectContaining({ id: next, artistId: next % 1000 + Math.floor(next / 1000) * 10, genre: 'Techno', tags: 'berlin' }), true);
    expect(section.querySelector('[data-act="more"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(site.player.getCurrentSound()!.id).toBe(next);
});

it('лайк в блоке или в плеере сайта зажигает сердце, а не соседние кнопки', async () => {
    fakeSite(relatedTracks);
    document.body.insertAdjacentHTML('beforeend', '<div class="playControls"><button class="playbackSoundBadge__like"></button></div>');
    const siteLike = document.querySelector<HTMLButtonElement>('.playbackSoundBadge__like')!;
    siteLike.addEventListener('click', () => siteLike.classList.toggle('sc-button-selected'));
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const section = document.getElementById('sc-wave')!;
    section.querySelector<HTMLButtonElement>('.scw-play')!.click();
    await vi.advanceTimersByTimeAsync(100);

    section.querySelector<HTMLButtonElement>('[data-act="like"]')!.click();
    await vi.advanceTimersByTimeAsync(500);
    expect(siteLike.classList.contains('sc-button-selected')).toBe(true);
    expect(section.querySelector('[data-act="like"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(section.querySelector('[data-act="later"]')?.getAttribute('aria-pressed')).not.toBe('true');
    expect(section.querySelector('[data-act="more"]')?.getAttribute('aria-pressed')).toBe('false');

    siteLike.click();
    await vi.advanceTimersByTimeAsync(1100);
    expect(section.querySelector('[data-act="like"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(section.querySelector('[data-act="later"]')?.getAttribute('aria-pressed')).not.toBe('true');
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

// Мост в main: журнал сигналов и сведения о треке для Discord
function fakeBridge() {
    const bridge = { waveSignals: { add: vi.fn() }, sendTrackMeta: vi.fn() };
    Object.assign(window, { soundcloudAPI: bridge });
    return bridge;
}
async function playFor(ms: number): Promise<void> {
    for (let passed = 0; passed < ms; passed += 1000) {
        position += 1000;
        await vi.advanceTimersByTimeAsync(1000);
    }
}

it('журнал сигналов: где ушёл, сколько прозвучало, откуда трек; дослушанный отмечен', async () => {
    const site = fakeSite(relatedTracks);
    const bridge = fakeBridge();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    document.querySelector<HTMLButtonElement>('#sc-wave .scw-play')!.click();
    await vi.advanceTimersByTimeAsync(1000);
    await playFor(40000);
    // Перемотка вперёд не считается прослушанным
    position += 60000;
    await vi.advanceTimersByTimeAsync(1000);
    const queued = site.player.replaceQueue.mock.calls[0][0] as FakeItem[];
    position = 0;
    site.setItems(queued, 1);
    await vi.advanceTimersByTimeAsync(1000);
    // Трек не из волны: тип очереди сайта, дослушан до конца
    site.setItems([{ sound: { id: 5, currentTime: () => position, getMediaDuration: () => 200000 }, sourceInfo: { type: 'playlist' } }], 0);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(6000);
    const signals = bridge.waveSignals.add.mock.calls.flatMap(([userId, list]) => (userId === 77 ? list : []));
    expect(signals[0]).toEqual(expect.objectContaining({
        id: queued[0].sound.id, end: 'skip', source: 'wave:similar', why: 'similar', dur: 200000, liked: false, disliked: false,
        v: 3, tz: -new Date().getTimezoneOffset(), title: expect.stringMatching(/^Rel /), path: '',
        // Трек сменил не человек: кнопок и клавиш за 4 секунды до смены не было. Кнопка «играть» блока трек не выбирает
        endedBy: 'auto', picked: false,
    }));
    expect(signals[0].heard).toBeGreaterThanOrEqual(39000);
    expect(signals[0].heard).toBeLessThanOrEqual(41000);
    expect(signals[0].pos).toBeGreaterThanOrEqual(100000);
    // Перемотка на 60 секунд в участки не попала
    expect(signals[0].spans).toHaveLength(1);
    expect(signals[0].spans[0][1] - signals[0].spans[0][0]).toBe(signals[0].heard);
    // Второй трек сменили, не дав ему прозвучать секунду: сигнала нет
    expect(signals.some((signal: { id: number }) => signal.id === queued[1].sound.id)).toBe(false);

    position = 0;
    await playFor(190000);
    site.setItems([{ sound: { id: 6 } }], 0);
    await vi.advanceTimersByTimeAsync(7000);
    const later = bridge.waveSignals.add.mock.calls.flatMap(([, list]) => list);
    expect(later.find((signal: { id: number }) => signal.id === 5)).toEqual(expect.objectContaining({ end: 'done', source: 'site:playlist', why: '' }));
});

it('A21: повтор одного места не растит покрытие, смену кнопкой плеера отличает от смены самим сайтом', async () => {
    const site = fakeSite(relatedTracks);
    const bridge = fakeBridge();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const item = (id: number): FakeItem => ({ sound: { id, currentTime: () => position, getMediaDuration: () => 200000 }, sourceInfo: { type: 'playlist' } });
    site.player.playCurrent();
    position = 0;
    site.setItems([item(5)], 0);
    await vi.advanceTimersByTimeAsync(1000);
    await playFor(20000);
    // Перемотка вперёд и дважды один и тот же кусок
    position = 100000;
    await vi.advanceTimersByTimeAsync(1000);
    await playFor(10000);
    position = 100000;
    await vi.advanceTimersByTimeAsync(1000);
    await playFor(10000);
    // «Дальше» в нижнем плеере: так же жмут медиаклавиши и горячие клавиши клиента
    const next = document.createElement('button');
    next.className = 'playControls skipControl__next';
    document.body.append(next);
    next.click();
    position = 0;
    site.setItems([item(6)], 0);
    await vi.advanceTimersByTimeAsync(1000);
    await playFor(5000);
    await vi.advanceTimersByTimeAsync(5000);
    // Сайт сам перешёл дальше (ошибка воспроизведения): действий человека не было
    position = 0;
    site.setItems([item(7)], 0);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(6000);
    const signals = bridge.waveSignals.add.mock.calls.flatMap(([, list]) => list) as Array<{ id: number; heard: number; spans: Array<[number, number]>; endedBy: string; picked: boolean; end: string }>;
    const five = signals.find((signal) => signal.id === 5);
    expect(five).toEqual(expect.objectContaining({ v: 3, end: 'skip', endedBy: 'user', picked: false, spans: [[0, 20000], [100000, 110000]] }));
    expect(five?.heard).toBe(40000);
    expect(signals.find((signal) => signal.id === 6)).toEqual(expect.objectContaining({ end: 'skip', endedBy: 'auto', heard: 5000 }));
    next.remove();
});

it('выход из приложения: main забирает текущее прослушивание, закрытие страницы его не дублирует', async () => {
    const site = fakeSite(relatedTracks);
    const bridge = fakeBridge();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    document.querySelector<HTMLButtonElement>('#sc-wave .scw-play')!.click();
    await vi.advanceTimersByTimeAsync(1000);
    await playFor(30000);
    const take = (window as unknown as { __scWaveTakeSignals: () => { userId: number; signals: Array<{ id: number; end: string; heard: number }> } }).__scWaveTakeSignals;
    const out = take();
    expect(out.userId).toBe(77);
    expect(out.signals).toEqual([expect.objectContaining({ id: site.player.getCurrentSound()?.id, end: 'stop' })]);
    expect(out.signals[0].heard).toBeGreaterThanOrEqual(29000);
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(6000);
    expect(bridge.waveSignals.add).not.toHaveBeenCalled();
});

it('сведения о треке для Discord: жанр, счётчики и подпись волны', async () => {
    const tracks = (seed: number): WaveTrack[] => relatedTracks(seed).map((track) => ({ ...track, genre: 'Techno', playback_count: 1500, likes_count: 3 } as WaveTrack));
    fakeSite(tracks);
    const bridge = fakeBridge();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    document.querySelector<HTMLButtonElement>('#sc-wave .scw-play')!.click();
    await vi.advanceTimersByTimeAsync(1100);
    expect(bridge.sendTrackMeta).toHaveBeenLastCalledWith(expect.objectContaining({ genre: 'Techno', plays: 1500, likes: 3, wave: 'My Wave · Similar' }));
    const calls = bridge.sendTrackMeta.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    // Без изменений повторно не шлётся
    expect(bridge.sendTrackMeta.mock.calls.length).toBe(calls);
});

it('«Встряхнуть»: впереди другие треки, играющий не прерывается', async () => {
    const site = fakeSite(relatedTracks);
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const section = document.getElementById('sc-wave')!;
    section.querySelector<HTMLButtonElement>('.scw-play')!.click();
    await vi.advanceTimersByTimeAsync(1100);
    const current = site.player.getCurrentSound()?.id;
    const ahead = (): number[] => site.player.getQueue().slice(site.player.getQueueState().currentIndex + 1).map((item) => item.sound.id);
    const before = ahead();
    const shake = section.querySelector<HTMLButtonElement>('[data-act="shake"]')!;
    expect(shake.getAttribute('aria-label')).toBe('Shake up');
    shake.click();
    await vi.advanceTimersByTimeAsync(1100);
    const after = ahead();
    expect(site.player.getCurrentSound()?.id).toBe(current);
    expect(after.length).toBeGreaterThan(0);
    expect(after.filter((id) => before.includes(id))).toEqual([]);
    expect(site.player.replaceQueue).toHaveBeenCalledTimes(1);
});

it('«Встряхнуть» не возвращает перезалив показанного или сыгранного трека', async () => {
    // Четыре мелодии каждое зерно приносит перезаливом с другого аккаунта (та же версия, та же длина),
    // остальные похожие у зёрен разные. Другая версия (slowed, ремикс) вернуться может: это отдельная запись (A02)
    const versions = (seed: number): WaveTrack[] => Array.from({ length: 8 }, (_, i) => i < 4
        ? { id: seed * 1000 + i, kind: 'track', user_id: 300 + seed * 10 + i, duration: 200000, title: 'Band - Tune ' + i }
        : { id: seed * 1000 + i, kind: 'track', user_id: seed * 10 + i, duration: 200000, title: 'Rel ' + seed + '-' + i });
    const site = fakeSite(versions);
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const section = document.getElementById('sc-wave')!;
    section.querySelector<HTMLButtonElement>('.scw-play')!.click();
    await vi.advanceTimersByTimeAsync(1100);
    const tune = (item: FakeItem): string => (item.sound as unknown as { attributes: WaveTrack }).attributes.title ?? '';
    // Играющий и вся очередь впереди: всё это пользователь уже видел
    const heard = site.player.getQueue().slice().map(tune);
    section.querySelector<HTMLButtonElement>('[data-act="shake"]')!.click();
    await vi.advanceTimersByTimeAsync(1100);
    const after = site.player.getQueue().slice(site.player.getQueueState().currentIndex + 1).map(tune);
    expect(after.length).toBeGreaterThan(0);
    expect(heard.some((title) => title.includes('Tune'))).toBe(true);
    expect(after.filter((title) => title.includes('Tune') && heard.includes(title))).toEqual([]);
});

it('ожидание рисует заготовки плиток; обложка берёт цвет из кэша плавности и проявляется поверх', async () => {
    const withArt = (seed: number): WaveTrack[] => relatedTracks(seed).map((track) => ({
        ...track, permalink_url: 'https://soundcloud.com/a/t' + track.id, artwork_url: 'https://i1.sndcdn.com/artworks-' + track.id + '-large.jpg',
    }));
    fakeSite(withArt);
    const learned: string[] = [];
    const scope = window as unknown as Record<string, unknown>;
    const originalImage = scope.Image;
    // Картинка «загружается» сразу, цвет знает кэш плавности сайта
    scope.Image = class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    };
    Object.assign(window, { __scmCoverColor: (key: string) => (key.startsWith('/a/t') ? '#123456' : undefined), __scmLearnCover: (key: string) => learned.push(key) });
    try {
        window.eval(waveScript());
        const waiting = document.querySelector<HTMLElement>('#sc-wave .scw-tiles');
        expect(waiting?.classList.contains('wait')).toBe(true);
        expect(waiting?.querySelectorAll('.scw-tile')).toHaveLength(5);
        expect(waiting?.style.getPropertyValue('--scw-wait-delay')).toBe('150ms');
        await vi.advanceTimersByTimeAsync(100);
        const tiles = document.querySelector('#sc-wave .scw-tiles');
        expect(tiles?.classList.contains('wait')).toBe(false);
        const arts = [...document.querySelectorAll<HTMLElement>('#sc-wave .scw-tile[data-track] .scw-art')];
        expect(arts).toHaveLength(5);
        expect(arts.every((art) => art.style.backgroundColor === 'rgb(18, 52, 86)')).toBe(true);
        expect(arts.every((art) => art.querySelector('.scw-img.on')?.getAttribute('style')?.includes('-t300x300.jpg'))).toBe(true);
        expect(learned).toEqual(expect.arrayContaining(arts.map((art) => '/a/t' + art.closest<HTMLElement>('.scw-tile')?.dataset.track)));
    } finally {
        scope.Image = originalImage;
        delete scope.__scmCoverColor;
        delete scope.__scmLearnCover;
    }
});

// Треки по id для trackBatch: из списка, остальные заготовкой
const batchOf = (list: WaveTrack[]) => (query: Record<string, unknown>): WaveTrack[] =>
    String(query.ids).split(',').map((id) => list.find((track) => track.id === Number(id)) ?? { id: Number(id), kind: 'track', user_id: 700, duration: 200000, title: 'Seed ' + id });

it('ошибка подборок видна, повтор восстанавливает полку без перезагрузки страницы', async () => {
    fakeSite(relatedTracks);
    const snapshot = { day: localDay(Date.now()), v: 3, cards: [{ kind: 'group', title: 'Techno', sub: '', ids: [51], seeds: [], keys: ['techno'], art: [] }] };
    const load = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ snapshot, recent: [] });
    Object.assign(window, { soundcloudAPI: { waveShelf: { load, save: vi.fn(async () => true) } } });
    window.eval(waveScript()); await vi.advanceTimersByTimeAsync(100);
    expect(document.querySelector('.scw-shelf-error')?.textContent).toContain('Could not load mixes');
    document.querySelector<HTMLButtonElement>('[data-act="shelf-retry"]')!.click(); await vi.advanceTimersByTimeAsync(100);
    expect(document.querySelector('.scw-shelf-error')).toBeNull();
    expect(document.querySelector('.scw-card .scw-t1')?.textContent).toBe('Techno');
});

it('полка показывает все жанры одной сеткой, неполный ряд не прячется', async () => {
    fakeSite(relatedTracks);
    const art = ['https://i1.sndcdn.com/artworks-0-t300x300.jpg'];
    const group = (i: number) => ({ kind: 'group', title: 'Genre ' + i, sub: '', ids: [5200 + i], seeds: [], keys: ['g' + i], art });
    const snapshot = {
        day: localDay(Date.now()), v: 3,
        cards: [
            { kind: 'daily', title: '', sub: '', ids: [5101], seeds: [], keys: [], art },
            { kind: 'forgotten', title: '', sub: '', ids: [5102], seeds: [], keys: [], art },
            ...[0, 1, 2, 3, 4].map(group),
        ],
    };
    const shelf = { load: vi.fn(async () => ({ snapshot, recent: [] })), save: vi.fn(async () => true) };
    Object.assign(window, { soundcloudAPI: { waveShelf: shelf } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const cards = [...document.querySelectorAll<HTMLElement>('#sc-wave .scw-shelf > .scw-card[data-card]')];
    expect(cards).toHaveLength(7);
    expect(cards.map((card) => card.querySelector('.scw-t1')?.textContent).slice(2)).toEqual(['Genre 0', 'Genre 1', 'Genre 2', 'Genre 3', 'Genre 4']);
    expect(document.querySelector('[class*="scw-over"]')).toBeNull();
    expect(document.getElementById('sc-wave-style')?.textContent ?? '').not.toContain('scw-over');
    expect(shelf.save).not.toHaveBeenCalled();
});

it('полка из снимка дня: находки играют первыми по порядку, карточка отмечена, режим скрыт', async () => {
    const finds = Array.from({ length: 12 }, (_, i): WaveTrack => ({ id: 5001 + i, kind: 'track', user_id: 600 + i, duration: 200000, title: 'Find ' + i }));
    const site = fakeSite(relatedTracks, (name, _path, query) => (name === 'trackBatch' ? batchOf(finds)(query) : undefined));
    const art = [0, 1, 2, 3].map((i) => 'https://i1.sndcdn.com/artworks-' + i + '-t300x300.jpg');
    const snapshot = {
        day: localDay(Date.now()), v: 3,
        cards: [
            { kind: 'daily', title: '', sub: '', ids: finds.map((track) => track.id), seeds: [1], keys: [], art },
            { kind: 'group', title: 'Techno and Industrial', sub: 'A, B', ids: [5101, 5102], seeds: [], keys: ['techno'], art: art.slice(0, 1) },
        ],
    };
    const shelf = { load: vi.fn(async () => ({ snapshot, recent: [] })), save: vi.fn(async () => true) };
    Object.assign(window, { soundcloudAPI: { waveShelf: shelf } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const section = document.getElementById('sc-wave')!;
    expect(shelf.load).toHaveBeenCalledWith(77);
    expect(section.querySelector('.scw-shelf-h')?.textContent).toBe('Mixes');
    const cards = section.querySelectorAll<HTMLButtonElement>('.scw-card[data-card]');
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('.scw-t1')?.textContent).toBe('Daily finds');
    expect(cards[0].querySelector('.scw-t2')?.textContent).toBe('12 tracks');
    expect(cards[0].querySelector('.scw-art')?.classList.contains('scw-tone-personal')).toBe(true);
    expect(cards[1].querySelector('.scw-art')?.classList.contains('scw-tone-genre')).toBe(true);
    expect(cards[1].querySelector('.scw-face b')?.textContent).toBe('Techno and Industrial');
    // На лице только название, без значков
    expect(section.querySelectorAll('.scw-face svg')).toHaveLength(0);
    expect(cards[0].querySelector('.scw-stamp')).toBeNull();
    expect(cards[0].querySelectorAll('.scw-quad > span')).toHaveLength(4);
    expect(cards[1].querySelector('.scw-t2')?.textContent).toBe('A, B');
    expect(section.querySelector('.scw-seg')).not.toBeNull();

    section.querySelector<HTMLButtonElement>('[data-act="shelf-play"][data-card="0"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    const queued = site.player.replaceQueue.mock.calls[site.player.replaceQueue.mock.calls.length - 1][0] as FakeItem[];
    expect(queued.map((item) => item.sound.id)).toEqual(finds.slice(0, 10).map((track) => track.id));
    expect(section.querySelector('.scw-hint')?.textContent).toBe('Daily finds: tracks you haven’t played yet, until midnight');
    expect(section.querySelector('.scw-why')?.textContent).toBe('Daily find: not played by you yet');
    expect(section.querySelector('[data-act="shelf-play"][data-card="0"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(section.querySelector('.scw-seg')).toBeNull();
    expect(shelf.save).not.toHaveBeenCalled();

    // Вкус: свои лайки через один с похожими на них
    section.querySelector<HTMLButtonElement>('[data-act="shelf-play"][data-card="1"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    const mixed = (site.player.replaceQueue.mock.calls[site.player.replaceQueue.mock.calls.length - 1][0] as FakeItem[]).map((item) => item.sound.id);
    expect([mixed[0], mixed[2]].sort()).toEqual([5101, 5102]);
    expect(mixed[1]).toBeGreaterThan(5000000);
    expect(section.querySelector('.scw-hint')?.textContent).toBe('Your taste: Techno and Industrial');
    expect(section.querySelector('[data-act="shelf-play"][data-card="1"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(section.querySelector('[data-act="shelf-play"][data-card="0"]')?.getAttribute('aria-pressed')).toBe('false');
});

it('раскрытая подборка: треки списком, трек из списка играет первым, дальше подборка по порядку, Esc сворачивает', async () => {
    const finds = Array.from({ length: 12 }, (_, i): WaveTrack => ({
        id: 5001 + i, kind: 'track', user_id: 600 + i, duration: 200000, title: 'Find ' + i, user: { id: 600 + i, username: 'Artist ' + i },
    }));
    const site = fakeSite(relatedTracks, (name, _path, query) => (name === 'trackBatch' ? batchOf(finds)(query) : undefined));
    const snapshot = { day: localDay(Date.now()), v: 3, cards: [{ kind: 'daily', title: '', sub: '', ids: finds.map((track) => track.id), seeds: [1], keys: [], art: [] }] };
    Object.assign(window, { soundcloudAPI: { waveShelf: { load: vi.fn(async () => ({ snapshot, recent: [] })), save: vi.fn(async () => true) } } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const section = document.getElementById('sc-wave')!;
    section.querySelector<HTMLButtonElement>('[data-act="shelf-open"][data-card="0"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    const rows = section.querySelectorAll<HTMLElement>('.scw-mix .scw-row[data-track]');
    expect(rows).toHaveLength(12);
    expect(rows[0].querySelector('.scw-row-t b')?.textContent).toBe('Find 0');
    expect(rows[0].querySelector('.scw-row-t span')?.textContent).toBe('Artist 0');
    expect(rows[0].querySelector('.scw-row-d')?.textContent).toBe('3:20');
    expect(section.querySelector('[data-act="shelf-open"][data-card="0"]')?.getAttribute('aria-expanded')).toBe('true');
    expect(site.player.replaceQueue).not.toHaveBeenCalled();

    rows[3].click();
    await vi.advanceTimersByTimeAsync(100);
    const queued = (site.player.replaceQueue.mock.calls[site.player.replaceQueue.mock.calls.length - 1][0] as FakeItem[]).map((item) => item.sound.id);
    expect(queued.slice(0, 4)).toEqual([5004, 5005, 5006, 5007]);
    expect(section.querySelector('.scw-row[aria-current="true"]')?.getAttribute('data-track')).toBe('5004');
    // Трек уже в очереди этой подборки: переход к нему без новой очереди
    const calls = site.player.replaceQueue.mock.calls.length;
    section.querySelector<HTMLElement>('.scw-row[data-track="5006"]')!.click();
    await vi.advanceTimersByTimeAsync(200);
    expect(site.player.replaceQueue.mock.calls.length).toBe(calls);
    expect(site.player.getCurrentSound()?.id).toBe(5006);

    section.querySelector('.scw-mix')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(section.querySelector('.scw-mix')).toBeNull();
    expect(document.activeElement?.getAttribute('data-act')).toBe('shelf-open');
});

it('ссылки в строках и шапке: название на трек, автор на профиль, без запуска; обложка и пустое место играют; приватный без ссылок', async () => {
    const finds = Array.from({ length: 12 }, (_, i): WaveTrack => ({
        id: 5001 + i, kind: 'track', user_id: 600 + i, duration: 200000, title: 'Find ' + i, user: { id: 600 + i, username: 'Artist ' + i },
        permalink_url: i === 1 ? 'https://soundcloud.com/artist-1/find-1/s-SeCrEt' : 'https://soundcloud.com/artist-' + i + '/find-' + i,
    }));
    const site = fakeSite(relatedTracks, (name, _path, query) => (name === 'trackBatch' ? batchOf(finds)(query) : undefined));
    const snapshot = { day: localDay(Date.now()), v: 3, cards: [{ kind: 'daily', title: '', sub: '', ids: finds.map((track) => track.id), seeds: [1], keys: [], art: [] }] };
    Object.assign(window, { soundcloudAPI: { waveShelf: { load: vi.fn(async () => ({ snapshot, recent: [] })), save: vi.fn(async () => true) } } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const section = document.getElementById('sc-wave')!;
    section.querySelector<HTMLButtonElement>('[data-act="shelf-open"][data-card="0"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    const row = (id: number): HTMLElement => section.querySelector<HTMLElement>('.scw-mix .scw-row[data-track="' + id + '"]')!;
    const hrefs = (root: Element): (string | null)[] => [...root.querySelectorAll('a.scw-link')].map((link) => link.getAttribute('href'));
    expect(hrefs(row(5001))).toEqual(['/artist-0/find-0', '/artist-0']);
    expect(hrefs(row(5002))).toEqual([]);
    expect(row(5002).querySelector('.scw-row-t b')?.textContent).toBe('Find 1');
    expect(row(5001).querySelector('button.scw-row-play')?.getAttribute('aria-label')).toBe('Play: Find 0');

    // Переход идёт через роутер сайта: ловим ссылку, которую страница кликает вне секции
    const opened: (string | null)[] = [];
    const onLink = (event: MouseEvent): void => {
        if (!(event.target instanceof HTMLAnchorElement) || section.contains(event.target)) return;
        opened.push(event.target.getAttribute('href'));
        event.preventDefault();
    };
    document.addEventListener('click', onLink);
    try {
        row(5003).querySelector<HTMLAnchorElement>('.scw-row-t b a')!.click();
        row(5003).querySelector<HTMLAnchorElement>('.scw-row-t span a')!.click();
    } finally {
        document.removeEventListener('click', onLink);
    }
    await vi.advanceTimersByTimeAsync(100);
    expect(opened).toEqual(['/artist-2/find-2', '/artist-2']);
    expect(site.player.replaceQueue).not.toHaveBeenCalled();

    row(5005).querySelector<HTMLButtonElement>('.scw-row-play')!.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(site.player.getCurrentSound()?.id).toBe(5005);
    row(5008).querySelector<HTMLElement>('.scw-row-e')!.click();
    await vi.advanceTimersByTimeAsync(200);
    expect(site.player.getCurrentSound()?.id).toBe(5008);
    expect(hrefs(section.querySelector('.scw-body')!)).toEqual(['/artist-7/find-7', '/artist-7']);

    // Фокус на ссылке автора переживает пересборку секции
    row(5010).querySelector<HTMLAnchorElement>('.scw-row-t span a')!.focus();
    row(5009).querySelector<HTMLElement>('.scw-row-e')!.click();
    await vi.advanceTimersByTimeAsync(200);
    expect(document.activeElement?.getAttribute('href')).toBe('/artist-9');
});

it('повторный запуск карточки играет её целиком: отданное сайту в прошлых подборках не отсекает её список', async () => {
    const finds = Array.from({ length: 12 }, (_, i): WaveTrack => ({ id: 5001 + i, kind: 'track', user_id: 600 + i, duration: 200000, title: 'Find ' + i }));
    const other = Array.from({ length: 12 }, (_, i): WaveTrack => ({ id: 6001 + i, kind: 'track', user_id: 650 + i, duration: 200000, title: 'Other ' + i }));
    const site = fakeSite(relatedTracks, (name, _path, query) => (name === 'trackBatch' ? batchOf([...finds, ...other])(query) : undefined));
    const snapshot = { day: localDay(Date.now()), v: 3, cards: [
        { kind: 'daily', title: '', sub: '', ids: finds.map((track) => track.id), seeds: [1], keys: [], art: [] },
        { kind: 'forgotten', title: '', sub: '', ids: other.map((track) => track.id), seeds: [], keys: [], art: [] },
    ] };
    Object.assign(window, { soundcloudAPI: { waveShelf: { load: vi.fn(async () => ({ snapshot, recent: [] })), save: vi.fn(async () => true) } } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const play = async (card: number): Promise<number[]> => {
        document.querySelector<HTMLButtonElement>('#sc-wave [data-act="shelf-play"][data-card="' + card + '"]')!.click();
        await vi.advanceTimersByTimeAsync(2000);
        return queuedIds(site);
    };
    expect((await play(0)).slice(0, 3)).toEqual([5001, 5002, 5003]);
    // «Давно не слушал» без выбранного трека перемешивается: важен состав, а не порядок
    expect((await play(1)).slice(0, 10).every((id) => id > 6000 && id < 6013)).toBe(true);
    expect((await play(0)).slice(0, 10)).toEqual(finds.slice(0, 10).map((track) => track.id));
});

it('«Назад» после перехода по ссылке: раскрытая подборка на месте, список на прежней прокрутке', async () => {
    const finds = Array.from({ length: 12 }, (_, i): WaveTrack => ({ id: 5001 + i, kind: 'track', user_id: 600 + i, duration: 200000, title: 'Find ' + i }));
    fakeSite(relatedTracks, (name, _path, query) => (name === 'trackBatch' ? batchOf(finds)(query) : undefined));
    const snapshot = { day: localDay(Date.now()), v: 3, cards: [{ kind: 'daily', title: '', sub: '', ids: finds.map((track) => track.id), seeds: [1], keys: [], art: [] }] };
    Object.assign(window, { soundcloudAPI: { waveShelf: { load: vi.fn(async () => ({ snapshot, recent: [] })), save: vi.fn(async () => true) } } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const section = document.getElementById('sc-wave')!;
    section.querySelector<HTMLButtonElement>('[data-act="shelf-open"][data-card="0"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    const list = section.querySelector<HTMLElement>('.scw-mix-rows')!;
    list.scrollTop = 120;
    list.dispatchEvent(new Event('scroll'));
    // Сайт уводит главную со страницы; отсоединённый список прокрутку не помнит
    const parent = section.parentElement!;
    const next = section.nextElementSibling;
    section.remove();
    list.scrollTop = 0;
    await vi.advanceTimersByTimeAsync(100);
    parent.insertBefore(document.createElement('div'), next);
    await vi.advanceTimersByTimeAsync(100);
    const back = document.getElementById('sc-wave')!;
    expect(back.isConnected).toBe(true);
    expect(back.querySelector('.scw-mix')).not.toBeNull();
    expect(back.querySelector<HTMLElement>('.scw-mix-rows')?.scrollTop).toBe(120);
});

it('снимок дня старого формата пересобирается из лайков: находки, давно не слушал, два вкуса, и сохраняется', async () => {
    const liked = Array.from({ length: 30 }, (_, i): WaveTrack => ({
        id: 2001 + i, kind: 'track', duration: 200000, title: 'Like ' + i,
        ...(i < 15 ? { user_id: 500 + (i % 5), genre: 'Techno', tag_list: 'industrial' } : { user_id: 510 + (i % 5), genre: 'Lo-Fi', tag_list: 'chill' }),
        user: { id: i < 15 ? 500 + (i % 5) : 510 + (i % 5), username: (i < 15 ? 'Tech' : 'Lo') + (i % 5) },
    }));
    fakeSite(relatedTracks, (name, _path, query) => {
        if (name === 'soundLikesIds') return { collection: liked.map((track) => track.id) };
        if (name === 'trackBatch') return batchOf(liked)(query);
        return undefined;
    });
    const stale = { day: localDay(Date.now()), v: 1, cards: [{ kind: 'group', title: 'Old', sub: '', ids: [51], seeds: [], keys: ['old'], art: [] }] };
    const shelf = { load: vi.fn(async () => ({ snapshot: stale, recent: [2001] })), save: vi.fn(async () => true) };
    Object.assign(window, { soundcloudAPI: { waveShelf: shelf } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    expect(shelf.save).toHaveBeenCalledOnce();
    const [userId, saved] = shelf.save.mock.calls[0] as unknown as [number, { day: string; v: number; cards: Array<{ kind: string; title: string; ids: number[] }> }];
    expect(userId).toBe(77);
    expect(saved.day).toBe(localDay(Date.now()));
    expect(saved.v).toBe(3);
    expect(saved.cards.map((card) => card.kind)).toEqual(['daily', 'forgotten', 'group', 'group']);
    expect(saved.cards[0].ids).toHaveLength(30);
    expect(saved.cards[0].ids.every((id) => id > 2000000)).toBe(true);
    expect(saved.cards[1].ids).not.toContain(2001);
    expect(saved.cards.slice(2).map((card) => card.title).sort()).toEqual(['Lo-Fi and Chill', 'Techno and Industrial']);
    expect(document.querySelectorAll('#sc-wave .scw-card[data-card]')).toHaveLength(4);
});

it('«Давно не слушал» не берёт лайки последних 30 дней, даже если в клиенте они не играли и во вкусе весят больше всех', async () => {
    const liked = Array.from({ length: 30 }, (_, i): WaveTrack => ({
        id: 2001 + i, kind: 'track', duration: 200000, title: 'Like ' + i, user_id: 500 + (i % 10), user: { id: 500 + (i % 10), username: 'Tech' + (i % 10) }, genre: 'Techno', tag_list: '',
    }));
    fakeSite(relatedTracks, (name, _path, query) => {
        if (name === 'soundLikesIds') return { collection: liked.map((track) => track.id) };
        if (name === 'trackBatch') return batchOf(liked)(query);
        return undefined;
    });
    const fresh = [2001, 2002, 2003];
    const shelf = { load: vi.fn(async () => ({ snapshot: null, recent: [], fresh })), save: vi.fn(async () => true) };
    const waveTaste = { load: vi.fn(async () => ({ artists: [[500, 1]], tags: [], tracks: fresh.map((id) => [id, 2]) })) };
    Object.assign(window, { soundcloudAPI: { waveShelf: shelf, waveTaste } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const [, saved] = shelf.save.mock.calls[0] as unknown as [number, { cards: Array<{ kind: string; ids: number[] }> }];
    const forgotten = saved.cards.find((card) => card.kind === 'forgotten')?.ids ?? [];
    expect(forgotten).toHaveLength(27);
    expect(forgotten.some((id) => fresh.includes(id))).toBe(false);
});

it('полка без модели вкуса (main не ответил) не хранится до полуночи и через 10 минут собирается заново', async () => {
    const liked = Array.from({ length: 30 }, (_, i): WaveTrack => ({
        id: 2001 + i, kind: 'track', duration: 200000, title: 'Like ' + i, user_id: 500 + (i % 5), user: { id: 500 + (i % 5), username: 'Tech' + (i % 5) }, genre: 'Techno', tag_list: 'industrial',
    }));
    fakeSite(relatedTracks, (name, _path, query) => {
        if (name === 'soundLikesIds') return { collection: liked.map((track) => track.id) };
        if (name === 'trackBatch') return batchOf(liked)(query);
        return undefined;
    });
    const shelf = { load: vi.fn(async () => ({ snapshot: null, recent: [] })), save: vi.fn(async () => true) };
    const profile = { artists: [[500, 1]], tags: [], tracks: [] };
    const waveTaste = { load: vi.fn(async (): Promise<unknown> => null) };
    Object.assign(window, { soundcloudAPI: { waveShelf: shelf, waveTaste } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    expect(document.querySelectorAll('#sc-wave .scw-card[data-card]').length).toBeGreaterThan(0);
    expect(shelf.save).not.toHaveBeenCalled();
    waveTaste.load.mockImplementation(async () => profile);
    await vi.advanceTimersByTimeAsync(10 * 60000);
    // Страница сайта меняется постоянно: следующая перестройка DOM зовёт сборку снова
    document.body.append(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(500);
    expect(shelf.save).toHaveBeenCalledOnce();
});

it('треки плейлистов идут в жанры полки своей долей напрямую, а не через тысячу весов вкуса', async () => {
    const liked = Array.from({ length: 16 }, (_, i): WaveTrack => ({
        id: 2001 + i, kind: 'track', duration: 200000, title: 'Like ' + i, user_id: 500 + (i % 8), user: { id: 500 + (i % 8), username: 'Tech' + (i % 8) }, genre: 'Techno', tag_list: '',
    }));
    const playlists = Array.from({ length: 10 }, (_, i) => ({ id: 3001 + i, artist: 700 + i, title: 'Jazz ' + i, artistName: 'Cat' + i, genre: 'Jazz', tags: '', path: '', artwork: '', dur: 200000, share: 0.3 }));
    fakeSite(relatedTracks, (name, _path, query) => {
        if (name === 'soundLikesIds') return { collection: liked.map((track) => track.id) };
        if (name === 'trackBatch') return batchOf(liked)(query);
        return undefined;
    });
    const shelf = { load: vi.fn(async () => ({ snapshot: null, recent: [], playlists })), save: vi.fn(async () => true) };
    Object.assign(window, { soundcloudAPI: { waveShelf: shelf } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const [, saved] = shelf.save.mock.calls[0] as unknown as [number, { cards: Array<{ kind: string; title: string; ids: number[] }> }];
    expect(saved.cards.find((card) => card.kind === 'group' && card.title === 'Jazz')?.ids).toHaveLength(10);
});

it('жанр полки: не больше 5 треков одного артиста, в подписи артисты, характерные именно для этого жанра', async () => {
    const make = (id: number, artist: number, name: string, genre: string, tags: string): WaveTrack => ({ id, kind: 'track', duration: 200000, title: 'Like ' + id, user_id: artist, user: { id: artist, username: name }, genre, tag_list: tags });
    const liked = [
        ...Array.from({ length: 15 }, (_, i) => make(2001 + i, 500 + (i % 5), 'Tech' + (i % 5), 'Techno', 'industrial')),
        ...Array.from({ length: 15 }, (_, i) => make(2101 + i, 510 + (i % 5), 'Lo' + (i % 5), 'Lo-Fi', 'chill')),
        // Любимый артист: 8 треков техно и 20 лоу-фая
        ...Array.from({ length: 8 }, (_, i) => make(2201 + i, 900, 'Star', 'Techno', 'industrial')),
        ...Array.from({ length: 20 }, (_, i) => make(2301 + i, 900, 'Star', 'Lo-Fi', 'chill')),
    ];
    fakeSite(relatedTracks, (name, _path, query) => {
        if (name === 'soundLikesIds') return { collection: liked.map((track) => track.id) };
        if (name === 'trackBatch') return batchOf(liked)(query);
        return undefined;
    });
    const shelf = { load: vi.fn(async () => ({ snapshot: null, recent: [] })), save: vi.fn(async () => true) };
    Object.assign(window, { soundcloudAPI: { waveShelf: shelf } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const [, saved] = shelf.save.mock.calls[0] as unknown as [number, { cards: Array<{ kind: string; title: string; sub: string; ids: number[] }> }];
    const card = (title: string) => saved.cards.find((entry) => entry.kind === 'group' && entry.title.startsWith(title))!;
    const stars = (ids: number[]): number => ids.filter((id) => id > 2200).length;
    expect(stars(card('Techno').ids)).toBe(5);
    expect(stars(card('Lo-Fi').ids)).toBe(5);
    expect(card('Techno').sub.split(', ')).not.toContain('Star');
    expect(card('Lo-Fi').sub.split(', ')[0]).toBe('Star');
});

it('набор через меню: трек в подборку, кнопка в шапке включает волну по набору и очищает его', async () => {
    const site = fakeSite(relatedTracks, siteExtra);
    fakeExclusions();
    const row = listRow();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    rightClick(row.querySelector('.soundTitle__title')!);
    choose('pick');
    await vi.advanceTimersByTimeAsync(100);
    expect(document.querySelector('.scw-toast')?.textContent).toBe('Picks: 1 track');
    const section = document.getElementById('sc-wave')!;
    expect(section.querySelector('[data-act="pick-start"]')?.textContent).toBe('1 track');
    rightClick(row.querySelector('.soundTitle__title')!);
    expect(menuActs()).toContain('unpick');
    document.querySelector<HTMLElement>('.scw-menu')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    section.querySelector<HTMLElement>('[data-act="pick-start"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    const queued = site.player.replaceQueue.mock.calls[site.player.replaceQueue.mock.calls.length - 1][0] as FakeItem[];
    expect(queued.length).toBeGreaterThan(1);
    expect(queued.some((item) => item.sound.id === 555)).toBe(false);
    expect(queued.some((item) => Math.floor(item.sound.id / 1000) === 555)).toBe(true);
    expect(section.querySelector('.scw-hint')?.textContent).toBe('Wave from picks: Song');
    expect(section.querySelector('[data-act="pick-start"]')).toBeNull();
});

it('подключает плеер, появившийся после первых двадцати попыток', async () => {
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(21000);
    expect(document.querySelector('#sc-wave')?.textContent).toContain('is not ready yet');
    const site = fakeSite(relatedTracks);
    window.dispatchEvent(new Event('online'));
    document.body.append(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(10000);
    expect(site.api.callEndpoint).toHaveBeenCalled();
    expect(document.querySelector<HTMLButtonElement>('#sc-wave .scw-play')?.disabled).toBe(false);
    expect(document.querySelector('#sc-wave [data-act="retry"]')).toBeNull();
});

it('повторяет загрузку профиля после временной ошибки сети', async () => {
    let offline = true;
    const site = fakeSite(relatedTracks, (name) => {
        if (offline && ['playHistoryTracks', 'soundLikesIds'].includes(name)) throw new Error('Temporary network failure');
    });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const initialCalls = site.api.callEndpoint.mock.calls.filter(([name]) => name === 'playHistoryTracks').length;
    expect(initialCalls).toBe(1);
    offline = false;
    window.dispatchEvent(new Event('online'));
    document.querySelector<HTMLButtonElement>('#sc-wave [data-act="shake"]')!.click();
    await vi.advanceTimersByTimeAsync(10000);
    expect(site.api.callEndpoint.mock.calls.filter(([name]) => name === 'playHistoryTracks')).toHaveLength(initialCalls + 1);
    expect(site.api.callEndpoint.mock.calls.some(([name]) => name === 'relatedSounds')).toBe(true);
    expect(document.querySelectorAll('#sc-wave .scw-tile[data-track]')).toHaveLength(5);
});

it('ответы старого режима не отбирают треки у нового', async () => {
    const pending: Array<() => void> = [];
    fakeSite(relatedTracks, (name, path) => {
        if (name === 'relatedSounds') return new Promise((resolve) => {
            pending.push(() => resolve({ collection: relatedTracks(Number(path.track_id)) }));
        });
        return undefined;
    });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    expect(pending).toHaveLength(3);
    document.querySelector<HTMLButtonElement>('#sc-wave [data-mode="fresh"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(pending).toHaveLength(6);
    for (const complete of pending.slice(0, 3)) complete();
    await vi.advanceTimersByTimeAsync(100);
    for (const complete of pending.slice(3, 6)) complete();
    await vi.advanceTimersByTimeAsync(100);
    expect(document.querySelectorAll('#sc-wave .scw-tile[data-track]')).toHaveLength(5);
    expect(document.querySelector<HTMLButtonElement>('#sc-wave .scw-play')?.disabled).toBe(false);
});

it('из истории играет последний выбранный трек независимо от порядка ответов', async () => {
    const pending = new Map<string, (track: WaveTrack) => void>();
    const site = fakeSite(relatedTracks, (name, _path, query) => {
        if (name === 'resolve') return new Promise((resolve) => { pending.set(String(query.url), resolve); });
        return undefined;
    });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const open = (window as unknown as { __scOpenTrack(path: string, go: boolean): Promise<string> }).__scOpenTrack;
    const first = open('/artist/first', false);
    const second = open('/artist/second', false);
    pending.get('https://soundcloud.com/artist/second')!({ id: 92, kind: 'track', title: 'Second' });
    await second;
    expect(site.player.getCurrentSound()?.id).toBe(92);
    pending.get('https://soundcloud.com/artist/first')!({ id: 91, kind: 'track', title: 'First' });
    await first;
    expect(site.player.getCurrentSound()?.id).toBe(92);
});

it('ошибка включения из истории возвращает failed', async () => {
    const site = fakeSite(relatedTracks, (name) => {
        if (name === 'resolve') throw new Error('HTTP 503');
    });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const open = (window as unknown as { __scOpenTrack(path: string, go: boolean): Promise<string> }).__scOpenTrack;
    expect(await open('/artist/unavailable', false)).toBe('failed');
    expect(site.player.playCurrent).not.toHaveBeenCalled();
    expect(site.player.getCurrentSound()).toBeNull();
});

it('распознанная ссылка помнится 10 минут, потом спрашивается снова', async () => {
    const site = fakeSite(relatedTracks, (name, _path, query) => {
        if (name === 'resolve') return { id: query.url === 'https://soundcloud.com/artist/first' ? 91 : 92, kind: 'track', title: 'Track' };
        return undefined;
    });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const open = (window as unknown as { __scOpenTrack(path: string, go: boolean): Promise<string> }).__scOpenTrack;
    const asked = (): number => site.api.callEndpoint.mock.calls.filter(([name, , query]) => name === 'resolve' && (query as { url?: string }).url === 'https://soundcloud.com/artist/first').length;
    // Между открытиями первой ссылки играет вторая, иначе «уже играет» обходит распознавание
    await open('/artist/first', false);
    await open('/artist/second', false);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    await open('/artist/first', false);
    expect(asked()).toBe(1);
    await open('/artist/second', false);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    await open('/artist/first', false);
    expect(asked()).toBe(2);
});

function savedLibrary(snapshot: PlaybackSnapshot | null = null) {
    const library = {
        loadSession: vi.fn(async () => snapshot), saveSession: vi.fn(async () => true),
        loadCatalog: vi.fn(async () => null), saveCatalog: vi.fn(async () => true),
        listMixes: vi.fn(async () => []), saveMix: vi.fn(), removeMix: vi.fn(async () => true),
    };
    Object.assign(window, { soundcloudAPI: { library } });
    return library;
}
it('восстанавливает источник волны, очередь, позицию и паузу', async () => {
    const tracks = relatedTracks(31).slice(0, 3);
    const saved: PlaybackSnapshot = { version: 1, at: Date.now(), items: tracks.map((track) => ({ track, wave: true, explicit: false })),
        index: 1, position: 43000, paused: true, active: true, mode: 'fresh', genre: null, seed: null, fallback: true };
    const site = fakeSite(relatedTracks, (name) => name === 'trackBatch' ? tracks : undefined);
    const library = savedLibrary(saved);
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    expect(site.player.getCurrentSound()?.id).toBe(tracks[1].id);
    expect(site.player.replaceQueue).toHaveBeenCalledWith(expect.any(Array), 1, { pause: true });
    expect(position).toBe(43000); expect(site.player.isPlaying()).toBe(false);
    expect(document.querySelector('#sc-wave')?.textContent).toContain(tracks[1].title);
    expect(site.states.fallbackEnabled).toBe(false);
    await (window as WaveWindow).__scSaveSession?.();
    expect(library.saveSession).toHaveBeenLastCalledWith(77, expect.objectContaining({ paused: true, active: true, mode: 'fresh', position: 43000 }));
});
// Случай владельца 26.09.2026: закрыл клиент во время громкой музыки, открыл через 5 минут, и она сразу заиграла
it('сессия, закрытая во время игры, после запуска клиента встаёт на паузу; после подъёма упавшей страницы играет дальше', async () => {
    const tracks = relatedTracks(31).slice(0, 3);
    const saved: PlaybackSnapshot = { version: 1, at: Date.now(), items: tracks.map((track) => ({ track, wave: true, explicit: false })),
        index: 1, position: 43000, paused: false, active: true, mode: 'fresh', genre: null, seed: null, fallback: true };
    const started = fakeSite(relatedTracks, (name) => name === 'trackBatch' ? tracks : undefined);
    savedLibrary(saved);
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    expect(started.player.getCurrentSound()?.id).toBe(tracks[1].id);
    expect(position).toBe(43000);
    expect(started.player.isPlaying()).toBe(false);
    expect(started.player.playCurrent).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pagehide'));

    // Музыка в этом запуске уже звучала, страница упала и поднялась: продолжает играть
    const reloaded = fakeSite(relatedTracks, (name) => name === 'trackBatch' ? tracks : undefined);
    savedLibrary(saved);
    window.eval(waveScript(true));
    await vi.advanceTimersByTimeAsync(100);
    expect(reloaded.player.getCurrentSound()?.id).toBe(tracks[1].id);
    expect(reloaded.player.isPlaying()).toBe(true);
});
it('сессия пишется по изменению: на паузе ни одной записи, при игре место раз в 30 секунд, смена трека сразу', async () => {
    const tracks = relatedTracks(31).slice(0, 3);
    const saved: PlaybackSnapshot = { version: 1, at: Date.now(), items: tracks.map((track) => ({ track, wave: true, explicit: false })),
        index: 0, position: 1000, paused: true, active: true, mode: 'similar', genre: null, seed: null, fallback: true };
    const site = fakeSite(relatedTracks, (name) => name === 'trackBatch' ? tracks : undefined);
    const library = savedLibrary(saved);
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(2000);
    library.saveSession.mockClear();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(library.saveSession).not.toHaveBeenCalled();

    site.player.playCurrent();
    await vi.advanceTimersByTimeAsync(1000);
    expect(library.saveSession).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(library.saveSession).toHaveBeenCalledTimes(3);

    site.player.setCurrentItem(site.player.getQueue().slice()[1]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(library.saveSession).toHaveBeenCalledTimes(4);
    expect(library.saveSession).toHaveBeenLastCalledWith(77, expect.objectContaining({ index: 1, paused: false }));
});
it('добавляет трек следующим и в конец без остановки текущего', async () => {
    const site = fakeSite(relatedTracks, siteExtra);
    window.eval(waveScript()); await vi.advanceTimersByTimeAsync(100);
    document.querySelector<HTMLButtonElement>('#sc-wave .scw-play')!.click(); await vi.advanceTimersByTimeAsync(100);
    const current = site.player.getCurrentSound()?.id;
    const row = listRow(); rightClick(row.querySelector('.soundTitle__title')!); choose('queue-next');
    await vi.advanceTimersByTimeAsync(100);
    expect(site.player.getQueue().slice()[1].sound.id).toBe(song.id);
    expect(site.player.getCurrentSound()?.id).toBe(current); expect(site.player.isPlaying()).toBe(true);
    rightClick(row.querySelector('.soundTitle__title')!); choose('queue-last'); await vi.advanceTimersByTimeAsync(100);
    expect(site.player.getQueue().slice(-1)[0]?.sound.id).toBe(song.id);
});
it('повторяет восстановление сессии после ошибки API без перезаписи сохранённой очереди', async () => {
    const tracks = relatedTracks(31).slice(0, 3);
    const saved: PlaybackSnapshot = { version: 1, at: Date.now(), items: tracks.map((track) => ({ track, wave: true, explicit: false })),
        index: 1, position: 43000, paused: true, active: true, mode: 'similar', genre: null, seed: null, fallback: true };
    let requests = 0;
    const site = fakeSite(relatedTracks, (name) => {
        if (name === 'trackBatch') { if (++requests === 1) throw new Error('HTTP 503'); return tracks; }
        return undefined;
    });
    const library = savedLibrary(saved); window.eval(waveScript()); await vi.advanceTimersByTimeAsync(100);
    expect(library.saveSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(6000);
    expect(site.player.getCurrentSound()?.id).toBe(tracks[1].id);
    expect(position).toBe(43000); expect(site.player.isPlaying()).toBe(false);
});
it('позднее возвращение сайтом того же трека не отменяет восстановление волны', async () => {
    const tracks = relatedTracks(31).slice(0, 3);
    const saved: PlaybackSnapshot = { version: 1, at: Date.now(), items: tracks.map((track) => ({ track, wave: true, explicit: false })),
        index: 1, position: 43000, paused: true, active: true, mode: 'similar', genre: null, seed: null, fallback: true };
    let complete: ((tracks: WaveTrack[]) => void) | undefined;
    const site = fakeSite(relatedTracks, (name) => name === 'trackBatch' ? new Promise<WaveTrack[]>((resolve) => { complete = resolve; }) : undefined);
    savedLibrary(saved); window.eval(waveScript()); await vi.advanceTimersByTimeAsync(100);
    site.setItems([{ sound: { id: tracks[1].id } }], 0);
    expect(complete).toBeDefined(); complete!(tracks);
    await vi.advanceTimersByTimeAsync(100);
    expect(site.player.getQueue().length).toBe(3); expect(position).toBe(43000);
    expect(document.querySelector('#sc-wave')?.textContent).toContain(tracks[1].title);
});
it('не прерывает первую подборку ожиданием следующих страниц лайков, затем охватывает их', async () => {
    const likes = Array.from({ length: 250 }, (_, i) => ({ id: 20000 + i, title: 'Like ' + i, user_id: 30000 + i, duration: 200000 }));
    let continuePage: ((body: unknown) => void) | undefined;
    fakeSite(relatedTracks, (name, _path, query) => {
        if (name === 'soundLikesIds') return query.cursor ? new Promise((resolve) => { continuePage = resolve; }) : { collection: likes.slice(0, 200).map((t) => t.id), next_href: 'https://api-v2.soundcloud.com/me/likes/ids?cursor=next' };
        if (name === 'trackBatch') return likes.filter((track) => String(query.ids).split(',').includes(String(track.id)));
        return undefined;
    });
    const library = savedLibrary(); window.eval(waveScript()); await vi.advanceTimersByTimeAsync(1000);
    expect(document.querySelectorAll('#sc-wave .scw-tile[data-track]')).toHaveLength(5);
    expect(continuePage).toBeDefined(); continuePage!({ collection: likes.slice(200).map((t) => t.id) });
    await vi.advanceTimersByTimeAsync(1000);
    expect(library.saveCatalog).toHaveBeenCalledWith(77, expect.arrayContaining([expect.objectContaining({ id: 20249 })]));
});

it('зёрна обычной волны от разных артистов: любимый артист в истории не даёт два-три зерна из трёх', async () => {
    const history = [
        ...Array.from({ length: 10 }, (_, i): WaveTrack => ({ id: 40001 + i, kind: 'track', title: 'Fav ' + i, user_id: 900, duration: 200000 })),
        { id: 40101, kind: 'track', title: 'A', user_id: 901, duration: 200000 }, { id: 40102, kind: 'track', title: 'B', user_id: 902, duration: 200000 },
    ];
    const site = fakeSite(relatedTracks, (name) => (name === 'playHistoryTracks' ? { collection: history.map((track) => ({ track })) } : undefined));
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(2000);
    const seeds = site.api.callEndpoint.mock.calls.filter(([name]) => name === 'relatedSounds').slice(0, 3).map(([, path]) => Number((path as { track_id?: unknown }).track_id));
    const artists = seeds.map((id) => history.find((track) => track.id === id)?.user_id);
    expect(seeds).toHaveLength(3);
    expect(new Set(artists).size).toBe(3);
});

it('обновление профиля раз в 30 минут не откатывает лайки к первой странице, снятый лайк уходит в конце листания', async () => {
    const likes = Array.from({ length: 250 }, (_, i) => ({ id: 20000 + i, title: 'Like ' + i, user_id: 30000 + i, duration: 200000 }));
    let unliked = false;
    let release: (() => void) | undefined;
    fakeSite(relatedTracks, (name, _path, query) => {
        if (name === 'soundLikesIds') {
            const ids = likes.map((track) => track.id).filter((id) => !(unliked && id === 20100));
            if (!query.cursor) return { collection: ids.slice(0, 200), next_href: 'https://api-v2.soundcloud.com/me/likes/ids?cursor=next' };
            if (!unliked) return { collection: ids.slice(200) };
            return new Promise((resolve) => { release = () => resolve({ collection: ids.slice(200) }); });
        }
        if (name === 'trackBatch') return likes.filter((track) => String(query.ids).split(',').includes(String(track.id)));
        return undefined;
    });
    Object.assign(window, { soundcloudAPI: { waveLibrary: libraryBridge() } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(2000);
    const count = (): string | undefined => libChip('likes').querySelector('.scw-chip-n')?.textContent ?? undefined;
    const toggleList = async (): Promise<void> => {
        document.querySelector<HTMLButtonElement>('#sc-wave [data-act="lib-list"]')!.click();
        await vi.advanceTimersByTimeAsync(2000);
    };
    await toggleList();
    expect(count()).toBe('250');
    // Через полчаса профиль обновляется, вторая страница лайков пока не пришла
    unliked = true;
    await vi.advanceTimersByTimeAsync(31 * 60000);
    await toggleList();
    await toggleList();
    // Список перерисован уже с новым профилем: без переноса тут было бы 200
    await toggleList();
    expect(release).toBeDefined();
    expect(count()).toBe('250');
    release!();
    await vi.advanceTimersByTimeAsync(1000);
    await toggleList();
    expect(count()).toBe('249');
});

it('P3: фоном обходит лайки с датами, подписки и плейлисты в хранилище; 429 оставляет лайки неполными без повторов', async () => {
    const calls: unknown[][] = [];
    let run = 0;
    const recommend = {
        syncState: vi.fn(async () => []),
        syncStart: vi.fn(async (_user: number, source: string) => { calls.push(['start', source]); return { run: ++run, cursor: null }; }),
        syncPage: vi.fn(async (_user: number, source: string, _run: number, items: unknown, cursor: unknown) => { calls.push(['page', source, items, cursor]); return true; }),
        syncFinish: vi.fn(async (_user: number, source: string, _run: number, status: string, error: string) => { calls.push(['finish', source, status, error]); return {}; }),
        recordUploads: vi.fn(async () => 1),
    };
    Object.assign(window, { soundcloudAPI: { recommend } });
    let likePages = 0;
    fakeSite(relatedTracks, (name, _path, query) => {
        if (name === 'userTrackLikes') {
            likePages++;
            if (query.offset === 'p2') return Promise.reject({ status: 429, headers: {} });
            return { collection: [{ created_at: '2026-09-20T10:00:00Z', track: { id: 41, title: 'Liked' } }], next_href: 'https://api-v2.soundcloud.com/users/77/track_likes?offset=p2&limit=200&client_id=secret' };
        }
        if (name === 'myFollowingsIds') return { collection: [5, 6] };
        if (name === 'userPlaylistsWithoutAlbums') return { collection: [{ id: 8, created_at: '2026-01-01T00:00:00Z' }] };
        if (name === 'playlistLikesIds') return { collection: [9] };
        return undefined;
    });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    // Обход ждёт, пока страница и волна разгрузятся
    expect(recommend.syncStart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000);
    expect(calls).toEqual([
        ['start', 'followings'], ['page', 'followings', [{ key: 'sc:user:5', added: 0 }, { key: 'sc:user:6', added: 0 }], null], ['finish', 'followings', 'complete', ''],
        ['start', 'likes'], ['page', 'likes', [{ key: 'sc:track:41', added: Date.parse('2026-09-20T10:00:00Z') }], { offset: 'p2', limit: '200' }], ['finish', 'likes', 'partial', 'rate 429'],
        ['start', 'playlists'], ['page', 'playlists', [{ key: 'sc:playlist:8', added: Date.parse('2026-01-01T00:00:00Z') }], null], ['finish', 'playlists', 'complete', ''],
        ['start', 'playlist-likes'], ['page', 'playlist-likes', [{ key: 'sc:playlist:9', added: 0 }], null], ['finish', 'playlist-likes', 'complete', ''],
    ]);
    expect(recommend.recordUploads).toHaveBeenCalledWith(77, [{ id: 41, title: 'Liked' }]);
    await vi.advanceTimersByTimeAsync(120000);
    expect(likePages).toBe(2);
});

it('Э6: треки своих и сохранённых плейлистов обходятся источником playlist:<id>, заготовки добираются, в хранилище полные треки по порядку', async () => {
    const calls: unknown[][] = [];
    let run = 0;
    const fresh = Date.now();
    const done = (source: string) => ({ source, status: 'complete', completed: fresh, updated: fresh });
    const recommend = {
        syncState: vi.fn(async () => ['followings', 'likes', 'playlists', 'playlist-likes'].map(done)),
        libraryMembers: vi.fn(async (_user: number, source: string) => (source === 'playlists' ? [{ key: 'sc:playlist:8' }] : [{ key: 'sc:playlist:9' }, { key: 'sc:playlist:8' }])),
        syncStart: vi.fn(async (_user: number, source: string) => { calls.push(['start', source]); return { run: ++run, cursor: null }; }),
        syncPage: vi.fn(async (_user: number, source: string, _run: number, items: unknown, cursor: unknown) => { calls.push(['page', source, items, cursor]); return true; }),
        syncFinish: vi.fn(async (_user: number, source: string, _run: number, status: string, error: string) => { calls.push(['finish', source, status, error]); return {}; }),
        recordUploads: vi.fn(async () => 1),
    };
    Object.assign(window, { soundcloudAPI: { recommend } });
    const batches: string[] = [];
    fakeSite(relatedTracks, (name, path, query) => {
        const id = Number((path as { id?: unknown }).id);
        if (name === 'playlist' && id === 8) return { id: 8, tracks: [{ id: 101, kind: 'track', title: 'A' }, { id: 102, kind: 'track', policy: 'ALLOW' }, { id: 103, kind: 'track' }] };
        if (name === 'playlist' && id === 9) return Promise.reject({ status: 404, headers: {} });
        if (name === 'trackBatch') {
            batches.push(String(query.ids));
            return [{ id: 102, kind: 'track', title: 'B' }];
        }
        return undefined;
    });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(60000);
    const own = calls.filter((call) => String(call[1]).startsWith('playlist:'));
    expect(own).toEqual([
        ['start', 'playlist:8'], ['page', 'playlist:8', [{ key: 'sc:track:101', added: 0 }, { key: 'sc:track:102', added: 0 }], null], ['finish', 'playlist:8', 'complete', ''],
        ['start', 'playlist:9'], ['finish', 'playlist:9', 'failed', 'missing 404'],
    ]);
    expect(batches).toContain('102,103');
    expect(recommend.recordUploads).toHaveBeenCalledWith(77, [{ id: 101, kind: 'track', title: 'A' }, { id: 102, kind: 'track', title: 'B' }]);
    // Списки плейлистов пройдены недавно: заново не обходятся
    expect(calls.some((call) => call[1] === 'playlists' || call[1] === 'likes')).toBe(false);
});

it('P3: текстовый поиск находит другие версии зерна у любых аккаунтов, версия идёт со своей причиной', async () => {
    const site = fakeSite(() => [], (name, _path, query) => {
        if (name !== 'searchCategory' || typeof query.q !== 'string' || !query.q.startsWith('Seed ')) return undefined;
        const n = Number(query.q.slice(5));
        return { collection: [
            { id: 7000 + n * 10, kind: 'track', title: 'Seed ' + n + ' (Slowed)', user_id: 100 + n, duration: 200000 },
            { id: 7001 + n * 10, kind: 'track', title: 'Other ' + n, user_id: 900 + n, duration: 200000 },
            { id: n, kind: 'track', title: 'Seed ' + n, user_id: 100 + n, duration: 180000 },
        ] };
    });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const searches = site.api.callEndpoint.mock.calls.filter((args) => args[0] === 'searchCategory');
    expect(searches.length).toBeGreaterThan(0);
    for (const args of searches) expect(args[2]).toEqual({ q: expect.stringMatching(/^Seed \d$/), limit: 50 });
    const why = [...document.querySelectorAll('#sc-wave .scw-t3')].map((node) => node.textContent);
    expect(why.some((text) => /^Another version of Seed \d$/.test(text ?? ''))).toBe(true);
    expect(why.some((text) => /^Similar to Seed \d$/.test(text ?? ''))).toBe(true);
    const ids = [...document.querySelectorAll<HTMLElement>('#sc-wave .scw-tile[data-track]')].map((tile) => Number(tile.dataset.track));
    expect(ids.every((id) => id >= 7000)).toBe(true);
});

type RadarCollect = (budgetMs: number, staleBefore: number) => Promise<unknown>;
const radarBridge = (plan: object[]) => ({
    syncState: vi.fn(async () => []),
    syncStart: vi.fn(async () => null),
    syncPage: vi.fn(async () => true),
    syncFinish: vi.fn(async () => ({})),
    recordUploads: vi.fn(async (_user: number, tracks: object[]) => tracks.length),
    radarPlan: vi.fn(async () => plan),
    catalogChecked: vi.fn(async () => true),
});

it('P6: сбор радара обходит несвежие источники фоном, листает каталог до старых загрузок, отказ отмечает отказом', async () => {
    const now = Date.now();
    const recommend = radarBridge([
        { key: 'user:5', kind: 'user', id: 5, q: '', label: '', checked: 0, status: '', weight: 1 },
        { key: 'user:6', kind: 'user', id: 6, q: '', label: 'Fresh', checked: now, status: 'ok', weight: 1 },
        { key: 'user:7', kind: 'user', id: 7, q: '', label: 'Seven', checked: 0, status: '', weight: 0.4 },
        { key: 'search:artistname', kind: 'search', id: 0, q: 'Artist Name', label: 'Artist Name', checked: 0, status: '', weight: 0.8 },
    ]);
    Object.assign(window, { soundcloudAPI: { recommend } });
    const iso = (at: number): string => new Date(at).toISOString();
    const site = fakeSite(relatedTracks, (name, path, query) => {
        const id = (path as { id?: number }).id;
        if (name === 'userTracks' && id === 5 && !query.offset) return {
            collection: [
                { id: 51, kind: 'track', title: 'New', user: { id: 5, username: 'Five' }, created_at: iso(now - 86400000) },
                { id: 52, kind: 'track', title: 'Older', user: { id: 5, username: 'Five' }, created_at: iso(now - 10 * 86400000) },
            ],
            next_href: 'https://api-v2.soundcloud.com/users/5/tracks?offset=2&limit=50&client_id=secret',
        };
        if (name === 'userTracks' && id === 5) return { collection: [{ id: 53, kind: 'track', title: 'Old', user: { id: 5, username: 'Five' }, created_at: iso(now - 60 * 86400000) }], next_href: 'https://api-v2.soundcloud.com/x?offset=3' };
        if (name === 'userTracks' && id === 7) return Promise.reject({ status: 404, headers: {} });
        // Поиск по имени находит и трек участника, и чужой трек, где имя просто есть в названии: пишется только первый
        if (name === 'searchCategory' && query['filter.created_at'] === 'last_week') return { collection: [
            { id: 61, kind: 'track', title: 'Artist Name - Fresh Find', user: { id: 9, username: 'Label' } },
            { id: 62, kind: 'track', title: 'Sweet Artist Name Vibes', user: { id: 10, username: 'Stranger' } },
            { id: 63, kind: 'track', title: 'Own Upload', user: { id: 11, username: 'Artist Name' } },
        ] };
        return undefined;
    });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const collect = (window as unknown as { __scRadarCollect: RadarCollect }).__scRadarCollect;
    const pending = collect(60000, now - 3600000);
    await vi.advanceTimersByTimeAsync(20000);
    expect(await pending).toEqual({ user: 77, checked: 3, remaining: 0, stopped: '' });
    const userTracks = site.api.callEndpoint.mock.calls.filter(([name]) => name === 'userTracks').map(([, path, query]) => [path, query]);
    expect(userTracks).toEqual([[{ id: 5 }, { limit: 50 }], [{ id: 5 }, { offset: '2', limit: '50' }], [{ id: 7 }, { limit: 50 }]]);
    expect(site.api.callEndpoint).toHaveBeenCalledWith('searchCategory', { category: 'tracks' }, { q: 'Artist Name', limit: 50, 'filter.created_at': 'last_week' });
    expect(recommend.recordUploads.mock.calls.map(([, tracks]) => tracks.map((track) => (track as { id: number }).id))).toEqual([[51, 52, 53], [61, 63]]);
    expect(recommend.catalogChecked.mock.calls).toEqual([
        [77, 'user:5', 'Five', 'ok', '', 3], [77, 'search:artistname', 'Artist Name', 'ok', '', 2], [77, 'user:7', 'Seven', 'gone', 'missing', 0],
    ]);
});

it('P6: сбор радара сначала догоняет обход подписок, даже если волна ещё не загружала профиль', async () => {
    const order: string[] = [];
    let run = 0;
    const recommend = {
        ...radarBridge([{ key: 'user:5', kind: 'user', id: 5, q: '', label: '', checked: 0, status: '', weight: 1 }]),
        syncStart: vi.fn(async (_user: number, source: string) => { order.push('start:' + source); return { run: ++run, cursor: null }; }),
        radarPlan: vi.fn(async () => { order.push('plan'); return [{ key: 'user:5', kind: 'user', id: 5, q: '', label: '', checked: 0, status: '', weight: 1 }]; }),
    };
    Object.assign(window, { soundcloudAPI: { recommend } });
    fakeSite(relatedTracks, (name) => (name === 'myFollowingsIds' ? { collection: [5, 6] } : undefined));
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const collect = (window as unknown as { __scRadarCollect: RadarCollect }).__scRadarCollect;
    const pending = collect(60000, Date.now());
    await vi.advanceTimersByTimeAsync(15000);
    await pending;
    expect(order.indexOf('start:followings')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('start:followings')).toBeLessThan(order.indexOf('plan'));
});

it('P6: сбор радара не пишет чужому аккаунту и останавливается при потере входа', async () => {
    const recommend = radarBridge([
        { key: 'user:5', kind: 'user', id: 5, q: '', label: '', checked: 0, status: '', weight: 1 },
        { key: 'user:8', kind: 'user', id: 8, q: '', label: '', checked: 0, status: '', weight: 0.5 },
    ]);
    Object.assign(window, { soundcloudAPI: { recommend } });
    let me = 77;
    fakeSite(relatedTracks, (name) => {
        if (name === 'me') return { id: me };
        if (name === 'userTracks') return Promise.reject({ status: 401, headers: {} });
        return undefined;
    });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const collect = (window as unknown as { __scRadarCollect: RadarCollect }).__scRadarCollect;
    me = 78;
    let pending = collect(60000, Date.now());
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ user: 77, checked: 0, remaining: 2, stopped: 'account-changed' });
    expect(recommend.catalogChecked).not.toHaveBeenCalled();
    me = 77;
    pending = collect(60000, Date.now());
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ user: 77, checked: 0, remaining: 2, stopped: 'auth' });
    expect(recommend.catalogChecked.mock.calls).toEqual([[77, 'user:5', '', 'failed', 'auth', 0]]);
});

// Выпуск радара как его отдаёт worker: позиции с причиной и отметкой «Уже слышал», новые загрузки отдельно
const radarCutoff = Date.UTC(2026, 8, 25, 6);
const radarItem = (id: number, extra: object = {}): object => ({
    key: 'sc:track:' + id, id, title: 'Fresh ' + id, artist: 'A', kind: 'release', at: radarCutoff - 1000, heard: false,
    score: 0.5, base: 0.5, bonus: 0, penalty: 0, direction: 'a', reason: { kind: 'taste' }, ...extra,
});
const radarEditionOf = (period: string, revision: number, cutoff: number): object => ({
    period, revision, created: cutoff, cutoff, status: 'partial', algorithm: 1, taste: 1,
    coverage: { accounts: 10, checked: 8, failed: 0, searches: 2, searchesDone: 2 },
    items: [
        radarItem(8001, { reason: { kind: 'artist', name: 'Alpha' } }),
        radarItem(8002, { heard: true, reason: { kind: 'follow', name: 'Beta' } }),
        radarItem(8003, { reason: { kind: 'tag', tag: 'techno' } }),
    ],
    uploads: [radarItem(8101, { kind: 'upload' })],
});
const radarTracks: WaveTrack[] = [8001, 8002, 8003, 8101, 8201].map((id) => ({
    id, kind: 'track', title: 'Fresh ' + id, duration: 200000, user_id: id, user: { id, username: 'Maker ' + id }, genre: id === 8003 ? 'Techno' : '',
}));
const radarEditions = [
    { period: '2026-09-25', revision: 1, created: radarCutoff, cutoff: radarCutoff, status: 'partial', manual: false, items: 3, uploads: 1 },
    { period: '2026-09-18', revision: 1, created: radarCutoff - 7 * 86400000, cutoff: radarCutoff - 7 * 86400000, status: 'complete', manual: false, items: 3, uploads: 1 },
];
const radarDay = (at: number): string => new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long' }).format(at);
const radarStamp = (at: number): string => new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(at);

it('P7: радар первым на полке, список с «Already heard», волна по порядку выпуска с причиной, пересборка и архив', async () => {
    let revision = 1;
    const radar = {
        view: vi.fn(async (_user: number, period?: string) => period === '2026-09-18'
            ? { edition: radarEditionOf('2026-09-18', 1, radarCutoff - 7 * 86400000), editions: radarEditions }
            : { edition: radarEditionOf('2026-09-25', revision, radarCutoff), editions: radarEditions }),
        found: vi.fn(async () => []),
        rebuild: vi.fn(async () => {
            revision = 2;
            return { published: true, waiting: false, edition: { revision: 2 } };
        }),
        state: vi.fn(async () => ({ phase: 'published', period: '2026-09-25', error: '', updated: 1 })),
    };
    Object.assign(window, { soundcloudAPI: { radar } });
    const site = fakeSite(relatedTracks, (name, _path, query) => (name === 'trackBatch' ? batchOf(radarTracks)(query) : undefined));
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const section = document.getElementById('sc-wave')!;
    expect(radar.view).toHaveBeenCalledWith(77, undefined, undefined);
    const cards = section.querySelectorAll<HTMLElement>('.scw-card[data-card]');
    expect([...cards].map((card) => card.dataset.card)).toEqual(['-10', '-11']);
    expect(cards[0].querySelector('.scw-t1')?.textContent).toBe('Release Radar');
    // Дата выпуска на обложке, подпись начинается с числа треков; лицо обложки повторяет название и скрыто от чтения
    expect(cards[0].querySelector('.scw-t2')?.textContent).toBe('3 tracks · incomplete');
    expect(cards[0].querySelector('.scw-stamp')?.textContent).toBe(radarStamp(radarCutoff));
    expect(cards[0].querySelector('.scw-art')?.classList.contains('scw-tone-release')).toBe(true);
    expect(cards[0].querySelector('.scw-face')?.getAttribute('aria-hidden')).toBe('true');
    expect(cards[0].querySelector('.scw-face b')?.textContent).toBe('Release Radar');
    expect(cards[1].querySelector('.scw-t2')?.textContent).toBe('1 track');
    expect(cards[1].querySelector('.scw-stamp')?.textContent).toBe(radarStamp(radarCutoff));

    section.querySelector<HTMLButtonElement>('[data-act="shelf-open"][data-card="-10"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    const rows = section.querySelectorAll<HTMLElement>('.scw-mix .scw-row[data-track]');
    expect([...rows].map((row) => row.dataset.track)).toEqual(['8001', '8002', '8003']);
    expect([...rows].map((row) => [...row.querySelectorAll('.scw-badge')].map((badge) => badge.textContent))).toEqual([[], ['Already heard'], []]);
    expect(section.querySelector('.scw-mix-title span')?.textContent).toBe('3 tracks · Sources checked: 10 of 12');
    expect([...section.querySelectorAll<HTMLOptionElement>('[data-role="radar-archive"] option')].map((option) => option.value)).toEqual(['2026-09-25|1', '2026-09-18|1']);
    expect(site.player.replaceQueue).not.toHaveBeenCalled();
    // Меню строки радара работает и до запуска выпуска: трек берётся из загруженных треков радара
    expect(rightClick(rows[0]).defaultPrevented).toBe(true);
    expect(menuActs()).toContain('pick');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    section.querySelector<HTMLButtonElement>('[data-act="mix-play"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    const queued = (site.player.replaceQueue.mock.calls[site.player.replaceQueue.mock.calls.length - 1][0] as FakeItem[]).map((item) => item.sound.id);
    expect(queued.slice(0, 3)).toEqual([8001, 8002, 8003]);
    expect(section.querySelector('.scw-why')?.textContent).toBe('New from Alpha');
    expect(section.querySelector('[data-act="shelf-play"][data-card="-10"]')?.getAttribute('aria-pressed')).toBe('true');

    // Причина тегом: слово как у самого трека
    section.querySelector<HTMLElement>('.scw-row[data-track="8003"]')!.click();
    await vi.advanceTimersByTimeAsync(200);
    expect(section.querySelector('.scw-why')?.textContent).toBe('Fresh techno');

    section.querySelector<HTMLButtonElement>('[data-act="radar-rebuild"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(radar.rebuild).toHaveBeenCalledWith(77);
    expect(document.querySelector('.scw-toast')?.textContent).toBe('Rebuilt, the previous edition is in the archive');
    expect(section.querySelector('.scw-mix-title span')?.textContent).toBe('3 tracks · Sources checked: 10 of 12 · rebuild 2');
    // Играет прежняя ревизия: карточка новой не отмечена играющей
    expect(section.querySelector('[data-act="shelf-play"][data-card="-10"]')?.getAttribute('aria-pressed')).toBe('false');

    const select = section.querySelector<HTMLSelectElement>('[data-role="radar-archive"]')!;
    select.value = '2026-09-18|1';
    select.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);
    expect(radar.view).toHaveBeenLastCalledWith(77, '2026-09-18', 1);
    expect(section.querySelector('.scw-mix-title b')?.textContent).toBe('Release Radar, ' + radarDay(radarCutoff - 7 * 86400000));
    // Архивный выпуск не пересобирается
    expect(section.querySelector('[data-act="radar-rebuild"]')).toBeNull();
});

it('группы радара: строка на исполнителя, метка EP из альбомов аккаунта, раскрытие в порядке альбома, трек группы и «Слушать все»', async () => {
    const edition = {
        period: '2026-09-25', revision: 1, created: radarCutoff, cutoff: radarCutoff, status: 'complete', algorithm: 3, taste: 1,
        coverage: { accounts: 10, checked: 10, failed: 0, searches: 2, searchesDone: 2 },
        items: [radarItem(8001, { group: [8001, 8004, 8006], reason: { kind: 'artist', name: 'Alpha' } }), radarItem(8002, { group: [8002, 8007] }), radarItem(8003)],
        uploads: [],
    };
    const radar = {
        view: vi.fn(async () => ({ edition, editions: radarEditions.slice(0, 1) })),
        found: vi.fn(async () => []),
        rebuild: vi.fn(async () => ({ published: false, waiting: true, edition: null })),
        state: vi.fn(async () => ({ phase: 'published', period: '2026-09-25', error: '', updated: 1 })),
    };
    Object.assign(window, { soundcloudAPI: { radar } });
    // 8004 и 8006 того же аккаунта, что 8001; альбом аккаунта ставит свой порядок
    const tracks: WaveTrack[] = [...radarTracks, ...[8004, 8006, 8007].map((id): WaveTrack => ({
        id, kind: 'track', title: 'Fresh ' + id, duration: 200000, user_id: id === 8007 ? 8002 : 8001, user: { id: id === 8007 ? 8002 : 8001, username: 'Maker' },
    }))];
    const albums: Array<[number, unknown]> = [];
    const site = fakeSite(relatedTracks, (name, path, query) => {
        if (name === 'trackBatch') return batchOf(tracks)(query);
        if (name === 'userAlbums') {
            albums.push([Number((path as { id?: unknown }).id), query]);
            return { collection: [{ set_type: 'ep', title: 'Fresh EP', track_count: 4, tracks: [{ id: 8006 }, { id: 8001 }, { id: 9999 }, { id: 8004 }] }] };
        }
        return undefined;
    });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const section = document.getElementById('sc-wave')!;
    section.querySelector<HTMLButtonElement>('[data-act="shelf-open"][data-card="-10"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    const rows = [...section.querySelectorAll<HTMLElement>('.scw-mix-rows > .scw-row[data-track]')];
    expect(rows.map((row) => row.dataset.track)).toEqual(['8001', '8002', '8003']);
    // Альбомы спрашиваются только у группы от трёх записей
    expect(albums).toEqual([[8001, { limit: 50 }]]);
    const badge = (id: number): HTMLButtonElement | null => section.querySelector<HTMLButtonElement>('.scw-row[data-track="' + id + '"] [data-act="radar-group"]');
    expect(badge(8001)?.textContent).toBe('EP · 4');
    expect(badge(8002)?.textContent).toBe('+1 track');
    expect(badge(8003)).toBeNull();

    // Метка раскрывает группу и трек не включает
    badge(8001)!.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(site.player.replaceQueue).not.toHaveBeenCalled();
    const box = section.querySelector<HTMLElement>('.scw-group-box')!;
    expect(box.querySelector('.scw-group-head b')?.textContent).toBe('Fresh EP');
    expect(box.querySelector('[data-act="radar-group-all"]')?.textContent).toBe('Play all 3');
    expect([...box.querySelectorAll<HTMLElement>('.scw-row[data-track]')].map((row) => row.dataset.track)).toEqual(['8006', '8001', '8004']);
    expect(badge(8001)?.getAttribute('aria-expanded')).toBe('true');

    // «Слушать» у выпуска играет по одному треку исполнителя; трек группы играет первым, дальше со следующего исполнителя
    box.querySelector<HTMLElement>('.scw-row[data-track="8006"] .scw-row-e')!.click();
    await vi.advanceTimersByTimeAsync(100);
    const queued = (site.player.replaceQueue.mock.calls[site.player.replaceQueue.mock.calls.length - 1][0] as FakeItem[]).map((item) => item.sound.id);
    expect(queued.slice(0, 4)).toEqual([8006, 8002, 8003, 8001]);

    // «Слушать все 3» во время игры: следующими встают только те, которых нет впереди
    section.querySelector<HTMLButtonElement>('[data-act="radar-group-all"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    const after = site.player.getQueue().slice().map((item) => item.sound.id);
    expect(after.slice(0, 2)).toEqual([8006, 8004]);
    expect(after.filter((id) => id === 8001)).toHaveLength(1);
    expect(site.player.getCurrentSound()?.id).toBe(8006);
    expect(document.querySelector('.scw-toast')?.textContent).toBe('Up next: 1 track');
});

it('выпуск до групп (алгоритм 2): страница склеивает строки одного исполнителя по загруженным трекам', async () => {
    const legacy = { ...(radarEditionOf('2026-09-25', 1, radarCutoff) as Record<string, unknown>), items: [radarItem(8001), radarItem(8002), radarItem(8004), radarItem(8003)] };
    const radar = {
        view: vi.fn(async () => ({ edition: legacy, editions: radarEditions.slice(0, 1) })),
        found: vi.fn(async () => []),
        rebuild: vi.fn(async () => ({ published: false, waiting: true, edition: null })),
        state: vi.fn(async () => ({ phase: 'published', period: '2026-09-25', error: '', updated: 1 })),
    };
    Object.assign(window, { soundcloudAPI: { radar } });
    const tracks: WaveTrack[] = [...radarTracks, { id: 8004, kind: 'track', title: 'Other', duration: 200000, user_id: 8001, user: { id: 8001, username: 'Maker 8001' }, created_at: '2026-09-20T10:00:00Z' }];
    const site = fakeSite(relatedTracks, (name, _path, query) => (name === 'trackBatch' ? batchOf(tracks)(query) : undefined));
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const section = document.getElementById('sc-wave')!;
    section.querySelector<HTMLButtonElement>('[data-act="shelf-open"][data-card="-10"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    expect([...section.querySelectorAll<HTMLElement>('.scw-mix-rows > .scw-row[data-track]')].map((row) => row.dataset.track)).toEqual(['8001', '8002', '8003']);
    expect(section.querySelector('.scw-row[data-track="8001"] [data-act="radar-group"]')?.textContent).toBe('+1 track');
    // Ничего не играет: «Слушать все» сразу включает группу по дате публикации
    section.querySelector<HTMLButtonElement>('.scw-row[data-track="8001"] [data-act="radar-group"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    expect([...section.querySelectorAll<HTMLElement>('.scw-group-box .scw-row[data-track]')].map((row) => row.dataset.track)).toEqual(['8001', '8004']);
    section.querySelector<HTMLButtonElement>('[data-act="radar-group-all"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(site.player.getCurrentSound()?.id).toBe(8001);
    expect(site.player.isPlaying()).toBe(true);
    expect(site.player.getQueue().slice().map((item) => item.sound.id).slice(0, 2)).toEqual([8001, 8004]);
});

it('P7: «Все найденные» с фильтрами вида и «Уже слышал», метки «После выпуска» и «Новая загрузка»', async () => {
    const radar = {
        view: vi.fn(async () => ({ edition: radarEditionOf('2026-09-25', 1, radarCutoff), editions: radarEditions.slice(0, 1) })),
        found: vi.fn(async () => [radarItem(8001), radarItem(8002, { heard: true }), radarItem(8201, { kind: 'upload', after: true })]),
        rebuild: vi.fn(async () => ({ published: false, waiting: true, edition: null })),
        state: vi.fn(async () => ({ phase: 'published', period: '2026-09-25', error: '', updated: 1 })),
    };
    Object.assign(window, { soundcloudAPI: { radar } });
    fakeSite(relatedTracks, (name, _path, query) => (name === 'trackBatch' ? batchOf(radarTracks)(query) : undefined));
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const section = document.getElementById('sc-wave')!;
    const shown = (): string[] => [...section.querySelectorAll<HTMLElement>('.scw-mix .scw-row[data-track]')].map((row) => row.dataset.track ?? '');
    section.querySelector<HTMLButtonElement>('[data-act="shelf-open"][data-card="-10"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    // Одного выпуска в архиве мало для выбора
    expect(section.querySelector('[data-role="radar-archive"]')).toBeNull();

    section.querySelector<HTMLButtonElement>('[data-act="radar-found"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(radar.found).toHaveBeenCalledWith(77, '2026-09-25', 1);
    expect(section.querySelector('[data-act="radar-found"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(shown()).toEqual(['8001', '8002', '8201']);
    expect([...section.querySelectorAll('.scw-row[data-track="8201"] .scw-badge')].map((badge) => badge.textContent)).toEqual(['After release', 'New upload']);

    section.querySelector<HTMLButtonElement>('[data-act="radar-kind"][data-kind="upload"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(shown()).toEqual(['8201']);
    section.querySelector<HTMLButtonElement>('[data-act="radar-kind"][data-kind="all"]')!.click();
    section.querySelector<HTMLButtonElement>('[data-act="radar-heard"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(shown()).toEqual(['8001', '8201']);
    section.querySelector<HTMLButtonElement>('[data-act="radar-kind"][data-kind="release"]')!.click();
    section.querySelector<HTMLButtonElement>('[data-act="radar-heard"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(shown()).toEqual(['8001', '8002']);

    // Обратно к выпуску; пересборка без готового каталога честно говорит, что выпуск позже
    section.querySelector<HTMLButtonElement>('[data-act="radar-found"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(shown()).toEqual(['8001', '8002', '8003']);
    section.querySelector<HTMLButtonElement>('[data-act="radar-rebuild"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(document.querySelector('.scw-toast')?.textContent).toBe('Still collecting, the radar will be ready later');
});

it('P7: радар без выпуска: заготовка, состояние сбора, «Собрать сейчас» закрыто на время сбора; публикация перечитывает выпуск', async () => {
    let release: (value: unknown) => void = () => undefined;
    let published = false;
    const radar = {
        view: vi.fn(() => published
            ? Promise.resolve({ edition: radarEditionOf('2026-09-25', 1, radarCutoff), editions: radarEditions.slice(0, 1) })
            : new Promise((resolve) => { release = resolve; })),
        found: vi.fn(async () => []),
        rebuild: vi.fn(async () => ({ published: false, waiting: true, edition: null })),
        state: vi.fn(async () => ({ phase: 'collecting', period: '2026-09-25', error: '', updated: 1 })),
    };
    Object.assign(window, { soundcloudAPI: { radar } });
    fakeSite(relatedTracks, (name, _path, query) => (name === 'trackBatch' ? batchOf(radarTracks)(query) : undefined));
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const section = document.getElementById('sc-wave')!;
    expect(section.querySelectorAll('.scw-card.scw-wait')).toHaveLength(1);
    release({ edition: null, editions: [] });
    await vi.advanceTimersByTimeAsync(100);
    const card = section.querySelector<HTMLElement>('.scw-card[data-card="-10"]')!;
    expect(card.querySelector('.scw-t2')?.textContent).toBe('Building the radar');
    expect(card.querySelector('[data-act="shelf-play"]')).toBeNull();
    section.querySelector<HTMLButtonElement>('[data-act="shelf-open"][data-card="-10"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    const build = section.querySelector<HTMLButtonElement>('[data-act="radar-rebuild"]')!;
    expect(build.textContent).toBe('Build now');
    expect(build.disabled).toBe(true);

    published = true;
    (window as unknown as { __scRadarChanged(state: object): void }).__scRadarChanged({ phase: 'published', period: '2026-09-25', error: '', updated: 2 });
    await vi.advanceTimersByTimeAsync(100);
    expect(section.querySelector('.scw-card[data-card="-10"] .scw-t2')?.textContent).toBe('3 tracks · incomplete');
    expect(section.querySelectorAll('.scw-mix .scw-row[data-track]')).toHaveLength(3);
});

it('P7: «Версии этого трека»: та же запись и другие версии с разных аккаунтов, играет точный id, решение уходит в хранилище', async () => {
    const copy: WaveTrack = { id: 556, kind: 'track', title: 'Art - Song', duration: 200000, user_id: 901, user: { id: 901, username: 'Mirror' }, permalink_url: 'https://soundcloud.com/mirror/song' };
    const slowed: WaveTrack = { id: 557, kind: 'track', title: 'Art - Song (Slowed)', duration: 260000, user_id: 902, user: { id: 902, username: 'Slow' }, permalink_url: 'https://soundcloud.com/slow/song-slowed' };
    const other: WaveTrack = { id: 558, kind: 'track', title: 'Other', duration: 200000, user_id: 903, user: { id: 903, username: 'Else' } };
    const site = fakeSite(relatedTracks, (name, path, query) => {
        if (name === 'searchCategory' && query.q === 'Song') return { collection: [song, copy, slowed, other] };
        if (name === 'resolve' && query.url === 'https://soundcloud.com/slow/song-slowed') return slowed;
        return siteExtra(name, path, query);
    });
    let links: object[] = [];
    const recommend = {
        ...radarBridge([]),
        recordingLinks: vi.fn(async () => links),
        setRecordingLink: vi.fn(async (_user: number, a: string, b: string, same: boolean) => {
            links = [{ a, b, same, source: 'user', at: 1 }];
            return true;
        }),
    };
    const exclusions = { load: vi.fn(async () => ({})), set: vi.fn(async () => true) };
    Object.assign(window, { soundcloudAPI: { waveExclusions: exclusions, recommend } });
    const row = listRow();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    rightClick(row.querySelector('.soundTitle__title')!);
    choose('versions');
    await vi.advanceTimersByTimeAsync(100);
    const dialog = document.querySelector<HTMLElement>('.scw-dialog')!;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.querySelector('#scw-versions-title')?.textContent).toBe('Versions: Song');
    expect([...dialog.querySelectorAll('.scw-dialog-h')].map((node) => node.textContent)).toEqual(['Same recording', 'Other versions']);
    const lists = dialog.querySelectorAll('.scw-vlist');
    const ids = (list: Element): string[] => [...list.querySelectorAll<HTMLElement>('[data-act="version-play"]')].map((node) => node.dataset.track ?? '');
    expect(ids(lists[0])).toEqual(['555', '556']);
    expect(ids(lists[1])).toEqual(['557']);
    expect([...lists[0].querySelectorAll('.scw-badge')].map((node) => node.textContent)).toEqual(['this track', 'likely a copy']);

    // Играет ровно выбранная загрузка, окно остаётся открытым
    dialog.querySelector<HTMLButtonElement>('[data-act="version-play"][data-track="557"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    const queued = site.player.replaceQueue.mock.calls[site.player.replaceQueue.mock.calls.length - 1][0] as FakeItem[];
    expect(queued.map((item) => item.sound.id)).toEqual([557]);
    expect(document.querySelector('.scw-dialog')).not.toBeNull();

    dialog.querySelector<HTMLButtonElement>('[data-act="version-link"][data-track="556"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(recommend.setRecordingLink).toHaveBeenCalledWith(77, 'sc:track:555', 'sc:track:556', true);
    expect(document.querySelector('.scw-toast')?.textContent).toBe('Marked as the same recording');
    expect([...document.querySelectorAll('.scw-dialog .scw-vlist')[0].querySelectorAll('.scw-badge')].map((node) => node.textContent)).toEqual(['this track', 'confirmed']);
    expect(document.querySelector('.scw-dialog [data-act="version-unlink"][data-track="556"]')?.textContent).toBe('Mark as different');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.scw-dialog')).toBeNull();
});

it('A20: очередь сайта, ручное добавление и «Версии этого трека» не режутся запретами подбора', async () => {
    const slowed: WaveTrack = { id: 557, kind: 'track', title: 'Art - Song (Slowed)', duration: 260000, user_id: 902, user: { id: 902, username: 'Slow' }, permalink_url: 'https://soundcloud.com/slow/song-slowed' };
    const site = fakeSite(relatedTracks, (name, path, query) => {
        if (name === 'searchCategory' && query.q === 'Song') return { collection: [song, slowed] };
        if (name === 'resolve' && query.url === 'https://soundcloud.com/slow/song-slowed') return slowed;
        return siteExtra(name, path, query);
    });
    // Slowed под «Не нравится», её аккаунт скрыт
    const exclusions = fakeExclusions([{ id: 557, title: 'Art - Song (Slowed)' }], [{ id: 902, title: 'Slow' }]);
    // Плейлист играет сайт, волна не запущена
    const playlist: FakeItem[] = [{ sound: { id: 555 } }, { sound: { id: 557 } }];
    site.setItems(playlist, 0);
    const row = listRow();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);

    rightClick(row.querySelector('.soundTitle__title')!);
    choose('dislike');
    await vi.advanceTimersByTimeAsync(100);
    expect(exclusions.set).toHaveBeenCalled();
    expect(site.player.getQueue().slice().map((item) => item.sound.id)).toEqual([555, 557]);

    // Ручное «Слушать следующим» ставит трек, даже если он под «Не нравится»
    rightClick(row.querySelector('.soundTitle__title')!);
    choose('queue-next');
    await vi.advanceTimersByTimeAsync(100);
    expect(site.player.getQueue().slice().map((item) => item.sound.id)).toEqual([555, 555, 557]);

    rightClick(row.querySelector('.soundTitle__title')!);
    choose('versions');
    await vi.advanceTimersByTimeAsync(100);
    const dialog = document.querySelector<HTMLElement>('.scw-dialog')!;
    const lists = dialog.querySelectorAll('.scw-vlist');
    const ids = (list: Element): string[] => [...list.querySelectorAll<HTMLElement>('[data-act="version-play"]')].map((node) => node.dataset.track ?? '');
    expect(ids(lists[0])).toEqual(['555']);
    expect(ids(lists[1])).toEqual(['557']);
    dialog.querySelector<HTMLButtonElement>('[data-act="version-play"][data-track="557"]')!.click();
    await vi.advanceTimersByTimeAsync(100);
    const queued = site.player.replaceQueue.mock.calls[site.player.replaceQueue.mock.calls.length - 1][0] as FakeItem[];
    expect(queued.map((item) => item.sound.id)).toEqual([557]);
});

it('P7: «Скрыть другие версии» пишет семью с загрузчиком, меню меняется на «Показывать другие версии» и снимает отметку', async () => {
    fakeSite(relatedTracks, siteExtra);
    const bridge = fakeExclusions();
    const row = listRow();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    rightClick(row.querySelector('.soundTitle__title')!);
    choose('hide-family');
    await vi.advanceTimersByTimeAsync(100);
    expect(bridge.set).toHaveBeenCalledWith(77, 'family', { id: 555, title: 'Song', artist: 'Art', url: 'https://soundcloud.com/art/song', artistId: 900 }, true);
    expect(document.querySelector('.scw-toast')?.textContent).toBe('Other versions of this song won’t play in My Wave or the radar');
    rightClick(row.querySelector('.soundTitle__title')!);
    expect(menuActs()).toContain('show-family');
    choose('show-family');
    await vi.advanceTimersByTimeAsync(100);
    expect(bridge.set).toHaveBeenLastCalledWith(77, 'family', { id: 555 }, false);
    rightClick(row.querySelector('.soundTitle__title')!);
    expect(menuActs()).toContain('hide-family');
});

// «Моя музыка» (Э7): 12 лайков новыми первыми (303 это микс на 40 минут), свой плейлист 8 с общим с лайками 302
// и заготовками, сохранённый плейлист 9; мост настроек и слышанного в клиенте
const libTrack = (id: number, extra: Partial<WaveTrack> = {}): WaveTrack => ({
    id, kind: 'track', title: 'L' + id, duration: 200000, user_id: 500 + id, user: { id: 500 + id, username: 'U' + id }, permalink_url: 'https://soundcloud.com/u' + id + '/l' + id, ...extra,
});
const libLikes = Array.from({ length: 12 }, (_, i) => libTrack(301 + i, i === 2 ? { duration: 40 * 60000 } : {}));
const libAll = [...libLikes, libTrack(351), libTrack(352), libTrack(361), libTrack(362)];
function libraryExtra(history: Array<{ id: number; at: number }> = []): Extra {
    return (name, path, query) => {
        const id = Number((path as { id?: unknown }).id);
        if (name === 'soundLikesIds') return { collection: libLikes.map((track) => track.id) };
        if (name === 'trackBatch') return libAll.filter((track) => String(query.ids).split(',').includes(String(track.id)));
        if (name === 'playHistoryTracks') return { collection: history.map((entry) => ({ played_at: entry.at, track: libTrack(entry.id) })) };
        if (name === 'userPlaylistsWithoutAlbums') return { collection: [{ id: 8, title: 'Mine', track_count: 3 }] };
        if (name === 'playlistLikesIds') return { collection: [9] };
        if (name === 'playlist' && id === 8) return { id: 8, title: 'Mine', tracks: [libTrack(302), { id: 351, kind: 'track' }, { id: 352, kind: 'track' }] };
        if (name === 'playlist' && id === 9) return { id: 9, title: 'Saved', track_count: 2, tracks: [libTrack(361), libTrack(362)] };
        return undefined;
    };
}
function libraryBridge(setting: object | null = null, heard: number[] = []) {
    return { load: vi.fn(async () => setting), save: vi.fn(async () => true), heard: vi.fn(async () => heard) };
}
// Мост сессии и каталога: сохранённый снимок читается из loadSession, записанный виден в saveSession
function sessionStore() {
    return {
        loadSession: vi.fn(async (): Promise<PlaybackSnapshot | null> => null), saveSession: vi.fn<(user: number, snapshot: unknown) => Promise<boolean>>(async () => true),
        loadCatalog: vi.fn(async () => null), saveCatalog: vi.fn(async () => true), listMixes: vi.fn(async () => []), saveMix: vi.fn(), removeMix: vi.fn(async () => true),
    };
}
const queuedIds = (site: ReturnType<typeof fakeSite>): number[] => site.player.getQueue().slice().map((item) => item.sound.id);
const libChip = (key: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>('#sc-wave [data-act="lib-source"][data-source="' + key + '"]')!;
const libMode = (mode: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>('#sc-wave [data-act="lib-mode"][data-lmode="' + mode + '"]')!;

it('Э7: раздел над подборками, выбор источников и режим в настройках, «По порядку» играет лайки от новых, плейлист по порядку и миксы', async () => {
    const site = fakeSite(relatedTracks, libraryExtra());
    const bridge = libraryBridge();
    Object.assign(window, { soundcloudAPI: { waveLibrary: bridge } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(2000);
    const box = document.querySelector('#sc-wave .scw-lib')!;
    expect(box.previousElementSibling?.textContent).toBe('My music');
    expect([...box.querySelectorAll<HTMLElement>('[data-act="lib-source"]')].map((node) => [node.dataset.source, node.textContent, node.getAttribute('aria-pressed')])).toEqual([
        ['likes', 'Likes12', 'true'], ['playlist:8', 'Mine3', 'false'], ['playlist:9', 'Saved2', 'false'],
    ]);
    expect(libMode('shuffle').getAttribute('aria-checked')).toBe('true');
    // Подсказка режима при наведении, без обрезки текста
    libMode('smart').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(400);
    expect(document.querySelector('.scw-tip.on')?.textContent).toBe('Like Shuffle, plus a similar track you don’t have yet after every three of yours');
    libChip('playlist:8').click();
    expect(bridge.save).toHaveBeenLastCalledWith({ mode: 'shuffle', pick: { 77: ['likes', 'playlist:8'] } });
    libMode('order').click();
    expect(bridge.save).toHaveBeenLastCalledWith({ mode: 'order', pick: { 77: ['likes', 'playlist:8'] } });
    document.querySelector<HTMLButtonElement>('#sc-wave [data-act="lib-play"]')!.click();
    await vi.advanceTimersByTimeAsync(2000);
    expect(queuedIds(site).slice(0, 10)).toEqual([301, 302, 303, 304, 305, 306, 307, 308, 309, 310]);
    // Дальше по очереди оставшиеся лайки, трек плейлиста без повтора 302, потом похожие от пула
    site.setItems(site.player.getQueue().slice(), 7);
    await vi.advanceTimersByTimeAsync(1100);
    const ids = queuedIds(site);
    expect(ids.slice(10, 14)).toEqual([311, 312, 351, 352]);
    expect(ids.slice(14).every((id) => id > 1000)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(document.querySelector('#sc-wave .scw-hint')?.textContent).toBe('My music: Likes, Mine');
    site.setItems(site.player.getQueue().slice(), 12);
    await vi.advanceTimersByTimeAsync(1100);
    expect(document.querySelector('#sc-wave .scw-why')?.textContent).toBe('From playlist Mine');
    expect(document.querySelector('#sc-wave [data-act="lib-play"]')?.getAttribute('aria-label')).toBe('Pause');
});

it('Э7: перемешивание без слышанного за 3 дня (клиент и история сайта) и без «Не нравится», артист не подряд', async () => {
    const now = Date.now();
    const site = fakeSite(relatedTracks, libraryExtra([{ id: 302, at: now - 3600000 }, { id: 311, at: now - 5 * 86400000 }]));
    const bridge = libraryBridge({ mode: 'shuffle', pick: { 77: ['likes', 'playlist:8'] } }, [301]);
    Object.assign(window, { soundcloudAPI: { waveLibrary: bridge, waveExclusions: { load: vi.fn(async () => ({ tracks: [{ id: 304, title: 'L304', artist: 'U304', url: '' }] })), set: vi.fn() } } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(2000);
    document.querySelector<HTMLButtonElement>('#sc-wave [data-act="lib-play"]')!.click();
    await vi.advanceTimersByTimeAsync(2000);
    expect(bridge.heard).toHaveBeenCalledWith(77);
    site.setItems(site.player.getQueue().slice(), 7);
    await vi.advanceTimersByTimeAsync(1100);
    // 301 слышан в клиенте, 302 на сайте час назад, 304 «Не нравится»; 311 слышан пять дней назад и играет
    const allowed = [303, 305, 306, 307, 308, 309, 310, 311, 312, 351, 352];
    const own = queuedIds(site).slice(0, allowed.length);
    expect([...own].sort((a, b) => a - b)).toEqual(allowed);
    const artists = own.map((id) => 500 + id);
    for (let i = 1; i < artists.length; i++) expect(artists[i]).not.toBe(artists[i - 1]);
});

it('Э7: если правило трёх дней выбило всё выбранное, перемешивание играет его целиком', async () => {
    fakeSite(relatedTracks, libraryExtra());
    const bridge = libraryBridge({ mode: 'shuffle', pick: { 77: ['likes', 'playlist:8'] } }, libAll.map((track) => track.id));
    Object.assign(window, { soundcloudAPI: { waveLibrary: bridge } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(2000);
    document.querySelector<HTMLButtonElement>('#sc-wave [data-act="lib-list"]')!.click();
    await vi.advanceTimersByTimeAsync(2000);
    expect(document.querySelector('#sc-wave .scw-lib .scw-mix-title span')?.textContent).toBe('14 tracks');
    expect(document.querySelectorAll('#sc-wave .scw-lib .scw-row')).toHaveLength(14);
});

it('Э7: «Умное перемешивание» ставит после каждых трёх своих похожий трек, которого нет в лайках', async () => {
    const site = fakeSite(relatedTracks, libraryExtra());
    Object.assign(window, { soundcloudAPI: { waveLibrary: libraryBridge({ mode: 'smart', pick: { 77: ['likes'] } }) } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(2000);
    document.querySelector<HTMLButtonElement>('#sc-wave [data-act="lib-play"]')!.click();
    await vi.advanceTimersByTimeAsync(2000);
    const ids = queuedIds(site).slice(0, 10);
    const liked = new Set(libLikes.map((track) => track.id));
    expect(ids.map((id) => liked.has(id))).toEqual([true, true, true, false, true, true, true, false, true, true]);
    site.setItems(site.player.getQueue().slice(), 3);
    await vi.advanceTimersByTimeAsync(1100);
    expect(document.querySelector('#sc-wave .scw-why')?.textContent).toMatch(/^Similar to L3\d\d$/);
});

it('Э7: сессия хранит выбор, режим и оставшиеся номера без треков; после перезапуска пул собирается заново и идёт с того же места', async () => {
    fakeSite(relatedTracks, libraryExtra());
    const store = sessionStore();
    Object.assign(window, { soundcloudAPI: { library: store, waveLibrary: libraryBridge({ mode: 'order', pick: { 77: ['likes', 'playlist:8'] } }) } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(2000);
    document.querySelector<HTMLButtonElement>('#sc-wave [data-act="lib-play"]')!.click();
    await vi.advanceTimersByTimeAsync(2000);
    await (window as WaveWindow).__scSaveSession?.();
    const saved = store.saveSession.mock.calls[store.saveSession.mock.calls.length - 1][1] as PlaybackSnapshot;
    expect(saved.seed).toMatchObject({ kind: 'library', tracks: [], own: [], order: 'fixed', library: { pick: ['likes', 'playlist:8'], mode: 'order', left: [311, 312, 351, 352] } });
    window.dispatchEvent(new Event('pagehide'));

    // Перезапуск: в очереди два трека, впереди в сессии 351 и 311
    const restored: PlaybackSnapshot = {
        version: 1, at: Date.now(), index: 0, position: 1000, paused: true, active: true, mode: 'similar', genre: null, fallback: true,
        items: [libTrack(301), libTrack(302)].map((track) => ({ track, wave: true, explicit: false, reason: { kind: 'library', name: '' } })),
        seed: { kind: 'library', title: 'Likes, Mine', tracks: [], own: [], order: 'fixed', mode: 'similar', library: { pick: ['likes', 'playlist:8'], mode: 'order', left: [351, 311] } },
    };
    const again = fakeSite(relatedTracks, libraryExtra());
    store.loadSession.mockResolvedValue(restored);
    Object.assign(window, { soundcloudAPI: { library: store, waveLibrary: libraryBridge({ mode: 'order', pick: { 77: ['likes', 'playlist:8'] } }) } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(3000);
    expect(queuedIds(again).slice(0, 4)).toEqual([301, 302, 351, 311]);
    expect(again.player.isPlaying()).toBe(false);
});

it('Э7: смена режима во время игры пересобирает очередь после текущего трека из несыгранного', async () => {
    const site = fakeSite(relatedTracks, libraryExtra());
    const store = sessionStore();
    Object.assign(window, { soundcloudAPI: { library: store, waveLibrary: libraryBridge({ mode: 'order', pick: { 77: ['likes', 'playlist:8'] } }) } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(2000);
    document.querySelector<HTMLButtonElement>('#sc-wave [data-act="lib-play"]')!.click();
    await vi.advanceTimersByTimeAsync(2000);
    site.setItems(site.player.getQueue().slice(), 1);
    await vi.advanceTimersByTimeAsync(1100);
    libMode('shuffle').click();
    await vi.advanceTimersByTimeAsync(2000);
    const ids = queuedIds(site);
    expect(ids.slice(0, 2)).toEqual([301, 302]);
    const pool = new Set([...libLikes.map((track) => track.id), 351, 352]);
    expect(ids.slice(2, 12).every((id) => pool.has(id) && id !== 301 && id !== 302)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    await (window as WaveWindow).__scSaveSession?.();
    const saved = store.saveSession.mock.calls[store.saveSession.mock.calls.length - 1][1] as PlaybackSnapshot;
    expect(saved.seed?.library?.mode).toBe('shuffle');
    expect(saved.seed?.library?.left).toHaveLength(2);
});

it('Э7: список пула со ссылками и меню по ПКМ до запуска, трек из списка играет первым, дальше план с него по кругу', async () => {
    const site = fakeSite(relatedTracks, libraryExtra());
    Object.assign(window, { soundcloudAPI: { waveLibrary: libraryBridge({ mode: 'order', pick: { 77: ['likes', 'playlist:8'] } }) } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(2000);
    document.querySelector<HTMLButtonElement>('#sc-wave [data-act="lib-list"]')!.click();
    await vi.advanceTimersByTimeAsync(2000);
    const rows = [...document.querySelectorAll<HTMLElement>('#sc-wave .scw-lib .scw-row')];
    expect(rows.map((row) => Number(row.dataset.track))).toEqual([301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 351, 352]);
    expect(rows[12].querySelector('a.scw-link')?.getAttribute('href')).toBe('/u351/l351');
    expect(document.querySelector('#sc-wave .scw-lib .scw-mix-title span')?.textContent).toBe('14 tracks');
    rightClick(rows[12].querySelector('b')!);
    expect(menuActs()).toContain('wave-track');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    rows[12].click();
    await vi.advanceTimersByTimeAsync(2000);
    expect(queuedIds(site).slice(0, 5)).toEqual([351, 352, 301, 302, 303]);
});

it('Э8: «Назад» после ссылки из «Моей музыки» возвращает прокрутку списка и страницы; заход на главную без «Назад» начинается сверху', async () => {
    fakeSite(relatedTracks, libraryExtra());
    Object.assign(window, { soundcloudAPI: { waveLibrary: libraryBridge({ mode: 'order', pick: { 77: ['likes'] } }) } });
    const scrolled: number[] = [];
    let pageAt = 900;
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(((_x: number, y: number) => { scrolled.push(y); pageAt = y; }) as typeof window.scrollTo);
    const pageY = Object.getOwnPropertyDescriptor(window, 'scrollY');
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => pageAt });
    const onLink = (event: MouseEvent): void => {
        if (event.target instanceof HTMLAnchorElement && !event.target.closest('#sc-wave')) event.preventDefault();
    };
    document.addEventListener('click', onLink);
    try {
        window.eval(waveScript());
        await vi.advanceTimersByTimeAsync(2000);
        document.querySelector<HTMLButtonElement>('#sc-wave [data-act="lib-list"]')!.click();
        await vi.advanceTimersByTimeAsync(2000);
        const leave = async (pop: boolean): Promise<HTMLElement> => {
            const list = document.querySelector<HTMLElement>('#sc-wave .scw-lib-rows')!;
            list.scrollTop = 150;
            list.dispatchEvent(new Event('scroll'));
            pageAt = 900;
            list.querySelector<HTMLAnchorElement>('a.scw-link')!.click();
            if (pop) window.dispatchEvent(new PopStateEvent('popstate'));
            // Сайт уводит главную и возвращает её наверху: отсоединённый список прокрутку тоже не помнит
            pageAt = 0;
            const section = document.getElementById('sc-wave')!;
            section.remove();
            list.scrollTop = 0;
            await vi.advanceTimersByTimeAsync(400);
            return document.querySelector<HTMLElement>('#sc-wave .scw-lib-rows')!;
        };
        expect((await leave(true)).scrollTop).toBe(150);
        expect(scrolled).toContain(900);
        await vi.advanceTimersByTimeAsync(6000);
        scrolled.length = 0;
        expect((await leave(false)).scrollTop).toBe(150);
        expect(scrolled).toEqual([]);
    } finally {
        document.removeEventListener('click', onLink);
        if (pageY) Object.defineProperty(window, 'scrollY', pageY);
        else Reflect.deleteProperty(window, 'scrollY');
        scrollTo.mockRestore();
    }
});

it('Э8: сыгранное волной раньше не выпадает из «Моей музыки» при новом запуске', async () => {
    const site = fakeSite(relatedTracks, libraryExtra());
    Object.assign(window, { soundcloudAPI: { waveLibrary: libraryBridge({ mode: 'order', pick: { 77: ['likes', 'playlist:8'] } }) } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(2000);
    document.querySelector<HTMLButtonElement>('#sc-wave [data-act="lib-play"]')!.click();
    await vi.advanceTimersByTimeAsync(2000);
    expect(queuedIds(site).slice(0, 3)).toEqual([301, 302, 303]);
    // Волна уже отдала сайту 301-310; запуск с трека из списка всё равно проходит пул целиком
    document.querySelector<HTMLButtonElement>('#sc-wave [data-act="lib-list"]')!.click();
    await vi.advanceTimersByTimeAsync(2000);
    document.querySelector<HTMLElement>('#sc-wave .scw-lib .scw-row[data-track="351"]')!.click();
    await vi.advanceTimersByTimeAsync(2000);
    expect(queuedIds(site).slice(0, 5)).toEqual([351, 352, 301, 302, 303]);
});

// Случай владельца 26.09.2026: играли лайки, выбор сменили на альбом, а кнопка снимала с паузы прежний пул
it('«Моя музыка»: после смены выбора кнопка и строка списка включают выбранное, а не продолжают прежний пул', async () => {
    const site = fakeSite(relatedTracks, libraryExtra());
    Object.assign(window, { soundcloudAPI: { waveLibrary: libraryBridge({ mode: 'order', pick: { 77: ['likes'] } }) } });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(2000);
    const play = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('#sc-wave [data-act="lib-play"]')!;
    play().click();
    await vi.advanceTimersByTimeAsync(2000);
    expect(queuedIds(site).slice(0, 3)).toEqual([301, 302, 303]);
    // Вместо лайков плейлист Mine, в нём тоже есть 302: строка 302 включает Mine, а не прыгает в очередь лайков
    libChip('likes').click();
    libChip('playlist:8').click();
    document.querySelector<HTMLButtonElement>('#sc-wave [data-act="lib-list"]')!.click();
    await vi.advanceTimersByTimeAsync(2000);
    expect([...document.querySelectorAll<HTMLElement>('#sc-wave .scw-lib .scw-row')].map((row) => Number(row.dataset.track))).toEqual([302, 351, 352]);
    document.querySelector<HTMLElement>('#sc-wave .scw-lib .scw-row[data-track="302"]')!.click();
    await vi.advanceTimersByTimeAsync(2000);
    expect(queuedIds(site).slice(0, 3)).toEqual([302, 351, 352]);
    expect(document.querySelector('#sc-wave .scw-hint')?.textContent).toBe('My music: Mine');
    // Играет Mine, выбран Saved: кнопка предлагает включить выбранное и включает его
    libChip('playlist:8').click();
    libChip('playlist:9').click();
    await vi.advanceTimersByTimeAsync(2000);
    expect(play().getAttribute('aria-label')).toBe('Play my music');
    play().click();
    await vi.advanceTimersByTimeAsync(2000);
    expect(queuedIds(site).slice(0, 2)).toEqual([361, 362]);
    expect(document.querySelector('#sc-wave .scw-hint')?.textContent).toBe('My music: Saved');
});
