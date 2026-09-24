/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://soundcloud.com/discover" }
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waveScript, type WaveTrack } from './wave';

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
        seek(): void {}
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

it('смена темы на паузе перерисовывает форму волны цветом новой темы', async () => {
    const styles: string[] = [];
    const context = { scale: vi.fn(), fillRect: vi.fn(), set fillStyle(value: string) { styles.push(value); } };
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    for (const name of ['clientWidth', 'clientHeight']) Object.defineProperty(HTMLCanvasElement.prototype, name, { configurable: true, get: () => 300 });
    try {
        const site = fakeSite(relatedTracks);
        window.eval(waveScript());
        await vi.advanceTimersByTimeAsync(100);
        document.querySelector<HTMLButtonElement>('#sc-wave .scw-play')!.click();
        await vi.advanceTimersByTimeAsync(1100);
        site.player.pauseCurrent();
        await vi.advanceTimersByTimeAsync(1100);
        styles.length = 0;
        document.documentElement.classList.add('theme-light');
        await vi.advanceTimersByTimeAsync(300);
        expect(styles.some((style) => style.startsWith('rgba(0,0,0,'))).toBe(true);
    } finally {
        document.documentElement.classList.remove('theme-light');
        getContext.mockRestore();
        for (const name of ['clientWidth', 'clientHeight']) Reflect.deleteProperty(HTMLCanvasElement.prototype, name);
    }
});

it('без модулей сайта говорит, что волна не работает, и не падает', async () => {
    Object.assign(window, { webpackJsonp: [] });
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(21000);
    expect(document.querySelector('#sc-wave .scw-track')?.textContent).toBe('My Wave doesn’t work with this SoundCloud version');
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
    expect(menuActs()).toEqual(['wave-track', 'wave-artist', 'more', 'later', 'dislike', 'hide-artist']);
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
    type Host = { __scOpenTrack: (path: string) => Promise<boolean> };
    Object.assign(window, { webpackJsonp: [] });
    window.eval(waveScript());
    // Модули сайта ещё не найдены: main спросит позже
    expect(await (window as unknown as Host).__scOpenTrack('/art/song')).toBe(false);
    window.dispatchEvent(new Event('pagehide'));

    const site = fakeSite(relatedTracks, siteExtra);
    fakeExclusions();
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const open = (window as unknown as Host).__scOpenTrack;
    expect(await open('/../evil')).toBe(true);
    expect(site.player.replaceQueue).not.toHaveBeenCalled();
    expect(await open('/art/song')).toBe(true);
    expect(site.api.callEndpoint).toHaveBeenCalledWith('resolve', {}, { url: 'https://soundcloud.com/art/song' });
    const queued = site.player.replaceQueue.mock.calls[0][0] as FakeItem[];
    expect(queued.map((item) => item.sound.id)).toEqual([555]);
    expect(queued[0].sourceInfo?.type).toBe('single');
    expect(site.player.playCurrent).toHaveBeenCalled();
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
        v: 2, tz: -new Date().getTimezoneOffset(), title: expect.stringMatching(/^Rel /), path: '',
    }));
    expect(signals[0].heard).toBeGreaterThanOrEqual(39000);
    expect(signals[0].heard).toBeLessThanOrEqual(41000);
    expect(signals[0].pos).toBeGreaterThanOrEqual(100000);
    // Второй трек сменили, не дав ему прозвучать секунду: сигнала нет
    expect(signals.some((signal: { id: number }) => signal.id === queued[1].sound.id)).toBe(false);

    position = 0;
    await playFor(190000);
    site.setItems([{ sound: { id: 6 } }], 0);
    await vi.advanceTimersByTimeAsync(7000);
    const later = bridge.waveSignals.add.mock.calls.flatMap(([, list]) => list);
    expect(later.find((signal: { id: number }) => signal.id === 5)).toEqual(expect.objectContaining({ end: 'done', source: 'site:playlist', why: '' }));
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

it('«Встряхнуть» не возвращает другую версию показанного или сыгранного трека', async () => {
    // Четыре мелодии приходят от каждого зерна своей версией, остальные похожие у зёрен разные
    const versions = (seed: number): WaveTrack[] => Array.from({ length: 8 }, (_, i) => i < 4
        ? { id: seed * 1000 + i, kind: 'track', user_id: 200 + i, duration: 200000, title: 'Tune ' + i + ' (' + seed + ' mix)' }
        : { id: seed * 1000 + i, kind: 'track', user_id: seed * 10 + i, duration: 200000, title: 'Rel ' + seed + '-' + i });
    const site = fakeSite(versions);
    window.eval(waveScript());
    await vi.advanceTimersByTimeAsync(100);
    const section = document.getElementById('sc-wave')!;
    section.querySelector<HTMLButtonElement>('.scw-play')!.click();
    await vi.advanceTimersByTimeAsync(1100);
    const tune = (item: FakeItem): string => ((item.sound as unknown as { attributes: WaveTrack }).attributes.title ?? '').replace(/ \(.*\)$/, '');
    // Играющий и вся очередь впереди: всё это пользователь уже видел
    const heard = site.player.getQueue().slice().map(tune);
    section.querySelector<HTMLButtonElement>('[data-act="shake"]')!.click();
    await vi.advanceTimersByTimeAsync(1100);
    const after = site.player.getQueue().slice(site.player.getQueueState().currentIndex + 1).map(tune);
    expect(after.length).toBeGreaterThan(0);
    expect(after.filter((title) => title.startsWith('Tune') && heard.includes(title))).toEqual([]);
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
