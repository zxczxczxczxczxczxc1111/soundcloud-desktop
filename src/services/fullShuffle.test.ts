// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installFullShuffle, SHUFFLE_TEXTS } from './fullShuffle';

interface Item { id: number; explicit?: boolean }
type Listener = (value?: unknown) => void;

function fakePlayer(total: number, stallAt = total) {
    const listeners = new Map<string, Set<Listener>>();
    const items: Item[] = [];
    let loaded = 0;
    let shuffle = false;
    let current = -1;
    const emit = (event: string, value?: unknown): void => listeners.get(event)?.forEach((listener) => listener(value));
    const queue = {
        get length() { return items.length; },
        slice: (start?: number, end?: number) => items.slice(start, end),
        reset: (next: Item[]) => { items.splice(0, items.length, ...next); },
    };
    const player = {
        getQueue: () => queue,
        getQueueState: () => ({ currentIndex: current }),
        getState: (name: string) => name === 'shuffle' && shuffle,
        hasMoreAhead: () => loaded < total,
        hasFallback: () => false,
        pullNext: (count: number) => { for (let i = 0; i < count && loaded < stallAt; i++) items.push({ id: loaded++ }); },
        toggleShuffle: () => { shuffle = !shuffle; emit('state:shuffle', shuffle); },
        on: (event: string, listener: Listener) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); },
        off: (event: string, listener: Listener) => { listeners.get(event)?.delete(listener); },
    };
    return {
        player, items, emit, listeners,
        start(count: number) { items.splice(0); loaded = 0; player.pullNext(count); current = 0; },
        newSource(count: number, nextTotal: number) { total = nextTotal; stallAt = nextTotal; items.splice(0); loaded = 0; current = -1; emit('queueReset'); player.pullNext(count); current = 0; },
    };
}

let fake: ReturnType<typeof fakePlayer>;
function provide(player: object): void {
    const jsonp: unknown[] = [];
    jsonp.push = (chunk: unknown) => {
        const [, modules, entries] = chunk as [unknown, Record<string, (m: unknown, e: unknown, r: unknown) => void>, string[][]];
        const id = entries[0][0];
        modules[id]({}, {}, { c: { '20': { exports: player }, '185': { exports: { QUEUE_RESET: 'queueReset' } } } });
        return 0;
    };
    Object.assign(window, { webpackJsonp: jsonp });
}
beforeEach(() => {
    vi.useFakeTimers();
    fake = fakePlayer(600);
    provide(fake.player);
});
afterEach(() => {
    window.dispatchEvent(new Event('pagehide'));
    vi.useRealTimers();
    document.body.innerHTML = '';
});
const ids = (items: Item[]) => items.map((item) => item.id);

it('догружает всю очередь и перемешивает всё после текущего трека, ручные треки не трогает', async () => {
    fake.start(21);
    fake.items[1].explicit = true;
    installFullShuffle(true, SHUFFLE_TEXTS);
    fake.player.toggleShuffle();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fake.items).toHaveLength(600);
    expect(ids(fake.items.slice(0, 2))).toEqual([0, 1]);
    const rest = ids(fake.items.slice(2));
    expect([...rest].sort((a, b) => a - b)).toEqual(Array.from({ length: 598 }, (_, i) => i + 2));
    expect(rest).not.toEqual([...rest].sort((a, b) => a - b));
});

it('если сайт перестал отдавать треки, говорит об этом на языке сайта и перемешивает загруженное', async () => {
    for (const [language, text] of [['ru', 'Сайт перестал отдавать треки, перемешаны загруженные: 300'], ['en', 'The site stopped sending tracks, shuffled the loaded ones: 300']]) {
        fake = fakePlayer(600, 300);
        provide(fake.player);
        fake.start(21);
        // Русский сайт помечает перевод сам (preload), у английского пометки нет
        if (language === 'ru') Object.assign(window, { __scSiteTranslation: { language: 'ru' } });
        else Reflect.deleteProperty(window, '__scSiteTranslation');
        installFullShuffle(true, SHUFFLE_TEXTS);
        fake.player.toggleShuffle();
        await vi.advanceTimersByTimeAsync(20000);
        expect(fake.items).toHaveLength(300);
        expect(document.querySelector('[role="status"]')?.textContent).toBe(text);
    }
    Reflect.deleteProperty(window, '__scSiteTranslation');
});

it('новая очередь при включённом перемешивании тоже догружается целиком', async () => {
    fake = fakePlayer(21);
    provide(fake.player);
    fake.start(21);
    installFullShuffle(true, SHUFFLE_TEXTS);
    fake.player.toggleShuffle();
    fake.newSource(21, 500);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fake.items).toHaveLength(500);
});

it('выключение снимает подписки', () => {
    installFullShuffle(true, SHUFFLE_TEXTS);
    expect(fake.listeners.get('state:shuffle')?.size).toBe(1);
    installFullShuffle(false, SHUFFLE_TEXTS);
    expect([...fake.listeners.values()].every((set) => set.size === 0)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
});
