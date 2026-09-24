/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://soundcloud.com/you/likes" }
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { averageColor, COVER_COLORS_KEY, coverKey, imageBase, pageMotionScript, rememberColor, skeletonKind } from './pageMotion';

interface MotionWindow {
    __disposePageMotion?: () => void;
    __scmCoverColor?: (key: string) => string | undefined;
    __scmLearnCover?: (key: string, url: string) => void;
    Image: unknown;
}
const host = window as unknown as MotionWindow;
const ORIGINAL_IMAGE = host.Image;
const ARTWORK = 'https://i1.sndcdn.com/artworks-abc-def-t200x200.jpg';

// Картинка «загружается» сразу; холст отдаёт один цвет на все пиксели
let loads: string[] = [];
let pixel = [16, 32, 48, 255];
class FakeImage {
    crossOrigin: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) {
        loads.push(value);
        queueMicrotask(() => this.onload?.());
    }
}
const pen = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: () => ({ data: Uint8ClampedArray.from({ length: 256 }, (_, i) => pixel[i % 4]) }),
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
function install(reduce = false): void {
    window.eval(pageMotionScript(reduce));
}
function cover(href: string, parent: Element = document.body): { outer: HTMLElement; span: HTMLElement } {
    const link = document.createElement('a');
    link.href = href;
    const outer = document.createElement('div');
    outer.className = 'image sc-artwork sc-artwork-placeholder-3';
    const span = document.createElement('span');
    span.className = 'sc-artwork image__full g-opacity-transition';
    outer.append(span);
    link.append(outer);
    parent.append(link);
    return { outer, span };
}
function spinner(parent: Element): HTMLElement {
    const loading = document.createElement('div');
    loading.className = 'loading regular m-padded';
    loading.innerHTML = '<div><svg></svg></div>';
    parent.append(loading);
    return loading;
}

beforeEach(() => {
    loads = [];
    pixel = [16, 32, 48, 255];
    localStorage.clear();
    host.Image = FakeImage;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(pen as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
    host.__disposePageMotion?.();
    host.Image = ORIGINAL_IMAGE;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

it('скрипт из сборки tsc не ссылается на exports: экспорт модуля на странице не определён', () => {
    // vitest собирает ESM, клиент получает CommonJS: там экспортированная константа читается как exports.X
    const source = readFileSync(join(process.cwd(), 'src/services/pageMotion.ts'), 'utf8');
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
    const compiled = { exports: {} as { pageMotionScript?: (reduce: boolean) => string } };
    runInNewContext(outputText, { module: compiled, exports: compiled.exports });
    const script = compiled.exports.pageMotionScript?.(false) ?? '';
    expect(script).toContain('function installPageMotion');
    expect(script).not.toMatch(/\bexports\b/);
});

it('вид заготовки по списку, где сайт показал спиннер', () => {
    document.body.innerHTML = [
        '<div class="badgeList"><div class="loading" id="a"></div></div>',
        '<div class="modular-home-mixed-selection"><div class="badgeList"><div class="loading" id="b"></div></div></div>',
        '<div class="soundList"><div class="loading" id="c"></div></div>',
        '<div class="systemPlaylistTrackList"><div class="loading" id="d"></div></div>',
        '<div class="webiEmbeddedModule"><div class="loading" id="e"></div></div>',
    ].join('');
    const kind = (id: string): string => skeletonKind(document.getElementById(id) as Element);
    expect([kind('a'), kind('b'), kind('c'), kind('d'), kind('e')]).toEqual(['tiles', 'shelf', 'stream', 'compact', 'block']);
});

it('средний цвет без прозрачных пикселей, кэш вытесняет самые старые', () => {
    expect(averageColor([255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 0])).toBe('#800080');
    expect(averageColor([1, 2, 3, 0])).toBe('');
    const cache = new Map<string, string>();
    rememberColor(cache, 'a', '#000001', 2);
    rememberColor(cache, 'b', '#000002', 2);
    rememberColor(cache, 'a', '#000003', 2);
    rememberColor(cache, 'c', '#000004', 2);
    expect([...cache]).toEqual([['a', '#000003'], ['c', '#000004']]);
});

it('ключ обложки: путь ссылки без регистра, строка списка, чужой сайт не считается', () => {
    const { outer } = cover('/Artist/Track/');
    expect(coverKey(outer)).toBe('/artist/track');
    document.body.innerHTML = '<li><div class="image sc-artwork" id="row"></div><a href="/a/b">b</a></li><a href="https://example.com/x"><div class="image sc-artwork" id="far"></div></a>';
    expect(coverKey(document.getElementById('row') as Element)).toBe('/a/b');
    expect(coverKey(document.getElementById('far') as Element)).toBe('');
    // Строка боковой панели: кнопка Play с пустым адресом идёт первой и указывала бы на текущую страницу
    document.body.innerHTML = '<li class="soundBadge"><div class="image sc-artwork" id="badge"></div><a href="">play</a><a href="/user">u</a><a href="/user/song">t</a></li>'
        + '<div class="sound"><div class="image sc-artwork" id="titled"></div><a href="/u2/set/x">deep</a><a class="soundTitle__title" href="/u2/song">t</a></div>';
    expect(coverKey(document.getElementById('badge') as Element)).toBe('/user/song');
    expect(coverKey(document.getElementById('titled') as Element)).toBe('/u2/song');
    expect(imageBase(ARTWORK)).toBe(imageBase('https://i1.sndcdn.com/artworks-abc-def-t50x50.jpg?1'));
});

it('обложка до загрузки берёт цвет из кэша прошлых заходов, испорченные записи не читаются', async () => {
    localStorage.setItem(COVER_COLORS_KEY, JSON.stringify([['/a/b', '#112233'], ['/bad', 'red'], ['/mixed', '-']]));
    install();
    const known = cover('/A/B');
    const mixed = cover('/mixed');
    await tick();
    expect(known.outer.style.getPropertyValue('--scm-cover')).toBe('#112233');
    expect(mixed.outer.style.getPropertyValue('--scm-cover')).toBe('');
    expect(host.__scmCoverColor?.('/bad')).toBeUndefined();
});

it('цвет учится, когда сайт ставит картинку, и сохраняется при уходе со страницы', async () => {
    install();
    const { span } = cover('/x/y');
    await tick();
    span.style.backgroundImage = 'url("' + ARTWORK + '")';
    await tick();
    await tick();
    expect(loads).toEqual([ARTWORK]);
    expect(host.__scmCoverColor?.('/x/y')).toBe('#102030');
    window.dispatchEvent(new Event('pagehide'));
    expect(JSON.parse(localStorage.getItem(COVER_COLORS_KEY) ?? '[]')).toEqual([['/x/y', '#102030']]);
});

it('под одной ссылкой разные картинки: ключ не красится; чужой адрес не загружается', async () => {
    install();
    host.__scmLearnCover?.('/feed', ARTWORK);
    await tick();
    host.__scmLearnCover?.('/feed', 'https://i1.sndcdn.com/artworks-abc-def-t500x500.jpg');
    host.__scmLearnCover?.('/feed', 'https://i1.sndcdn.com/artworks-other-t200x200.jpg');
    host.__scmLearnCover?.('/other', 'https://example.com/a.jpg');
    await tick();
    expect(loads).toEqual([ARTWORK]);
    expect(host.__scmCoverColor?.('/feed')).toBeUndefined();
    window.dispatchEvent(new Event('pagehide'));
    expect(JSON.parse(localStorage.getItem(COVER_COLORS_KEY) ?? '[]')).toEqual([['/feed', '-']]);
});

it('спиннер списка становится заготовкой, пришедшие строки проявляются; меню и поиск не трогаются', async () => {
    install();
    const list = document.createElement('ul');
    list.className = 'lazyLoadingList';
    const holder = document.createElement('div');
    holder.className = 'soundList';
    holder.append(list);
    document.body.append(holder);
    const menu = document.createElement('div');
    menu.className = 'searchMenu';
    document.body.append(menu);
    // Слот сверху правой колонки сайт оставляет пустым: заготовки там нет
    const slot = document.createElement('div');
    slot.className = 'webiEmbeddedModule';
    document.body.append(slot);
    const loading = spinner(list);
    const inMenu = spinner(menu);
    const inSlot = spinner(slot);
    await tick();
    expect(loading.className).toContain('scm-skel scm-skel-stream');
    expect(loading.querySelectorAll('.scm-sk .scm-sk-row')).toHaveLength(2);
    expect(inMenu.className).not.toContain('scm-skel');
    expect(inSlot.className).not.toContain('scm-skel');
    expect(document.getElementById('scm-style')?.textContent).toContain('.webiEmbeddedModule>.loading{display:none}');
    const row = document.createElement('li');
    list.append(row);
    await tick();
    expect(row.classList.contains('scm-in')).toBe(true);
});

it('«Меньше анимаций», повторная вставка и снятие', async () => {
    install(true);
    expect(document.documentElement.classList.contains('scm-reduce')).toBe(true);
    install(false);
    expect(document.documentElement.classList.contains('scm-reduce')).toBe(false);
    expect(document.querySelectorAll('#scm-style')).toHaveLength(1);
    const loading = spinner(document.body);
    await tick();
    expect(loading.querySelector('.scm-sk')).not.toBeNull();
    host.__disposePageMotion?.();
    expect(document.getElementById('scm-style')).toBeNull();
    expect(loading.querySelector('.scm-sk')).toBeNull();
    expect(loading.classList.contains('scm-skel')).toBe(false);
    expect(host.__scmCoverColor).toBeUndefined();
});
