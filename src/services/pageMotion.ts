// Плавность сайта: обложки со средним цветом вместо пастельных градиентов, «подъём» новой страницы,
// статичный skeleton вместо спиннеров, кривые без перелёта. Разбор: maket-plavnosti/issledovanie.md

export type SkeletonKind = 'tiles' | 'shelf' | 'stream' | 'compact' | 'block';

export interface PageMotionConfig {
    css: string;
    frameCss: string;
    reduce: boolean;
    // Ключ и предел кэша цветов идут в конфиге: экспорт модуля на странице читался бы как exports.X
    colorsKey: string;
    colorsLimit: number;
}

export const COVER_COLORS_KEY = 'scm-cover-colors';
export const COVER_COLORS_LIMIT = 3000;

// Вид skeleton по списку, где сайт показал спиннер
export function skeletonKind(loading: Element): SkeletonKind {
    if (loading.closest('.webiEmbeddedModule, .sidebarModule')) return 'block';
    if (loading.closest('.modular-home-mixed-selection')) return 'shelf';
    if (loading.closest('.badgeList')) return 'tiles';
    if (loading.closest('.stream__list, .userStream, .searchList, .historicalPlays, .soundList')) return 'stream';
    return 'compact';
}

// Средний цвет по пикселям RGBA; прозрачные не считаются
export function averageColor(data: ArrayLike<number>): string {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i + 3 < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n++;
    }
    if (!n) return '';
    const hex = (value: number): string => Math.round(value / n).toString(16).padStart(2, '0');
    return '#' + hex(r) + hex(g) + hex(b);
}

// Кэш цветов с вытеснением самых старых
export function rememberColor(cache: Map<string, string>, key: string, color: string, limit: number): void {
    cache.delete(key);
    cache.set(key, color);
    while (cache.size > limit) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
    }
}

// Картинка без размера: t50x50 и t200x200 одной обложки считаются одной картинкой
export function imageBase(url: string): string {
    return url.split('?')[0].replace(/-[a-z0-9]+\.(jpe?g|png|webp)$/i, '');
}

// Ключ цвета: путь ссылки, в которой стоит обложка, иначе заголовок строки списка.
// Кнопка Play в строке тоже ссылка, но с пустым адресом: он указывает на текущую страницу
export function coverKey(outer: Element): string {
    let link = outer.closest('a[href]');
    const row = link ? null : outer.closest('li, .trackItem, .soundBadge, .sound, .playableTile');
    if (row) {
        const depth = (a: Element): number => (a.getAttribute('href') ?? '').split('?')[0].split('/').filter(Boolean).length;
        const real = [...row.querySelectorAll('a[href]')].filter((a) => !/^(#|$)/.test(a.getAttribute('href') ?? ''));
        link = row.querySelector('a.soundTitle__title[href], a.trackItem__trackTitle[href]') ?? real.sort((a, b) => depth(b) - depth(a))[0] ?? null;
    }
    if (!link) return '';
    try {
        const url = new URL(link.getAttribute('href') ?? '', location.href);
        // Регистр как у ключей волны: пути SoundCloud от него не зависят
        return url.hostname === location.hostname ? url.pathname.replace(/\/+$/, '').toLowerCase().slice(0, 200) : '';
    } catch (error) {
        console.debug('Плавность: ссылка обложки не разобрана', error);
        return '';
    }
}

export function installPageMotion(config: PageMotionConfig): void {
    const host = window as unknown as Window & Record<string, unknown> & {
        __disposePageMotion?: () => void;
        __scmCoverColor?: (key: string) => string | undefined;
        __scmLearnCover?: (key: string, url: string) => void;
    };
    host.__disposePageMotion?.();
    let disposed = false;
    const root = document.documentElement;
    root.classList.toggle('scm-reduce', config.reduce);

    const style = document.createElement('style');
    style.id = 'scm-style';
    style.textContent = config.css;
    (document.head ?? root).append(style);

    // Цвета обложек: путь ссылки -> #rrggbb, общий с «Моей волной»; «-» у ключа с разными картинками
    const MIXED_COVER = '-';
    const colors = new Map<string, string>();
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(config.colorsKey) ?? '[]');
        if (Array.isArray(saved))
            for (const entry of saved)
                if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string' && (entry[1] === MIXED_COVER || /^#[0-9a-f]{6}$/.test(entry[1])))
                    rememberColor(colors, entry[0], entry[1], config.colorsLimit);
    } catch (error) {
        console.warn('Плавность: цвета обложек не прочитаны', error);
    }
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const save = (): void => {
        saveTimer = undefined;
        try {
            localStorage.setItem(config.colorsKey, JSON.stringify([...colors]));
        } catch (error) {
            console.warn('Плавность: цвета обложек не сохранены', error);
        }
    };
    const scheduleSave = (): void => {
        if (saveTimer === undefined) saveTimer = setTimeout(save, 3000);
    };

    // Холст 8×8: уменьшение до одного пикселя в Chromium берёт не среднее, а несколько точек
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 8;
    let pen: CanvasRenderingContext2D | null = null;
    try {
        pen = canvas.getContext('2d', { willReadFrequently: true });
    } catch (error) {
        console.debug('Плавность: холст недоступен', error);
    }
    const learning = new Set<string>();
    const sources = new Map<string, string>();
    function learn(key: string, url: string): void {
        if (!pen || !key || !/^https:\/\/[a-z0-9-]+\.sndcdn\.com\//.test(url)) return;
        // Под одной ссылкой разные картинки (круги «новых треков», подборки): такой ключ не красится
        const base = imageBase(url);
        const seen = sources.get(key);
        if (seen === undefined) {
            if (sources.size > 5000) sources.clear();
            sources.set(key, base);
        } else if (seen !== base) {
            if (colors.get(key) !== MIXED_COVER) {
                rememberColor(colors, key, MIXED_COVER, config.colorsLimit);
                scheduleSave();
            }
            return;
        }
        if (colors.has(key) || learning.has(key) || learning.size > 20) return;
        learning.add(key);
        const image = new Image();
        // CDN отдаёт Access-Control-Allow-Origin: *, картинка приходит из кэша без сети
        image.crossOrigin = 'anonymous';
        image.onload = () => {
            learning.delete(key);
            if (disposed || !pen) return;
            try {
                pen.clearRect(0, 0, 8, 8);
                pen.drawImage(image, 0, 0, 8, 8);
                const color = averageColor(pen.getImageData(0, 0, 8, 8).data);
                if (!color) return;
                rememberColor(colors, key, color, config.colorsLimit);
                scheduleSave();
            } catch (error) {
                console.debug('Плавность: цвет обложки не посчитан', error);
            }
        };
        image.onerror = () => learning.delete(key);
        image.src = url;
    }
    const colorOf = (key: string): string | undefined => {
        const color = colors.get(key);
        return color === MIXED_COVER ? undefined : color;
    };
    host.__scmCoverColor = colorOf;
    host.__scmLearnCover = learn;

    function paint(outer: HTMLElement): void {
        const color = colorOf(coverKey(outer));
        if (color) outer.style.setProperty('--scm-cover', color);
    }
    const imageUrl = (span: HTMLElement): string => /url\("?([^")]+)"?\)/.exec(span.style.backgroundImage)?.[1] ?? '';

    // Спиннер списка -> статичная заготовка той же формы; строки, пришедшие вместо неё, проявляются
    const fading = new Map<Element, number>();
    function block(parent: Element, className: string): HTMLElement {
        const node = document.createElement('div');
        node.className = className;
        parent.append(node);
        return node;
    }
    function skeleton(loading: HTMLElement): void {
        if (loading.classList.contains('scm-skel') || !loading.querySelector('svg')) return;
        // Подсказки поиска, меню и окна со своим спиннером не трогаются. Слот сверху правой колонки
        // (webiEmbeddedModule) сайт почти всегда оставляет пустым и прячет, заготовка там только мелькает
        if (loading.closest('.searchMenu, .dropdownMenu, .modal, .webiEmbeddedModule')) return;
        const kind = skeletonKind(loading);
        loading.classList.add('scm-skel', 'scm-skel-' + kind);
        const box = document.createElement('div');
        box.className = 'scm-sk';
        box.setAttribute('aria-hidden', 'true');
        if (kind === 'stream') {
            for (let i = 0; i < 2; i++) {
                const row = block(box, 'scm-sk-row');
                block(row, 'scm-sk-cover');
                const column = block(row, 'scm-sk-col');
                block(column, 'scm-sk-line s');
                block(column, 'scm-sk-line m');
                block(column, 'scm-sk-wave');
            }
        } else if (kind === 'compact') {
            for (let i = 0; i < 6; i++) {
                const row = block(box, 'scm-sk-crow');
                block(row, 'scm-sk-thumb');
                block(row, 'scm-sk-line m');
            }
        } else if (kind === 'block') {
            block(box, 'scm-sk-block');
        } else {
            if (kind === 'shelf') block(box, 'scm-sk-line title');
            const grid = block(box, 'scm-sk-grid');
            for (let i = 0; i < 6; i++) {
                const tile = block(grid, 'scm-sk-tile');
                block(tile, 'scm-sk-cover');
                block(tile, 'scm-sk-line m');
                block(tile, 'scm-sk-line s');
            }
        }
        loading.append(box);
        const list = loading.closest('.lazyLoadingList, .badgeList') ?? loading.parentElement;
        if (list) fading.set(list, Date.now() + 15000);
    }
    function fadeIn(record: MutationRecord): void {
        if (!fading.size || !(record.target instanceof Element)) return;
        const list = record.target.closest('.lazyLoadingList, .badgeList');
        const until = list ? fading.get(list) : undefined;
        if (!list || until === undefined) return;
        const now = Date.now();
        if (until < now) {
            fading.delete(list);
            return;
        }
        let added = false;
        for (const node of record.addedNodes)
            if (node instanceof HTMLLIElement) {
                node.classList.add('scm-in');
                added = true;
            }
        // Данные пришли: проявляются строки этой пачки, позже перерисованная строка сайта не мигает
        if (added && until > now + 500) fading.set(list, now + 500);
    }

    // Iframe того же сайта (новая вёрстка, врезки боковой панели): свои стили внутрь
    const frames = new Map<HTMLIFrameElement, () => void>();
    function attachFrame(frame: HTMLIFrameElement): void {
        if (frames.has(frame)) return;
        let inner: HTMLStyleElement | null = null;
        const apply = (): void => {
            inner?.remove();
            inner = null;
            let doc: Document | null = null;
            try {
                doc = frame.contentDocument;
            } catch (error) {
                console.debug('Плавность: iframe чужого сайта', error);
            }
            if (!doc?.head || doc.location.origin !== location.origin) return;
            inner = doc.createElement('style');
            inner.textContent = config.frameCss;
            doc.head.append(inner);
        };
        frame.addEventListener('load', apply);
        frames.set(frame, () => {
            frame.removeEventListener('load', apply);
            inner?.remove();
        });
        apply();
    }

    function visit(node: Element): void {
        if (node instanceof HTMLIFrameElement) attachFrame(node);
        if (node.matches('.image.sc-artwork')) paint(node as HTMLElement);
        else for (const outer of node.querySelectorAll<HTMLElement>('.image.sc-artwork')) paint(outer);
        if (node.matches('.loading')) skeleton(node as HTMLElement);
        else for (const loading of node.querySelectorAll<HTMLElement>('.loading')) skeleton(loading);
        for (const frame of node.querySelectorAll('iframe')) attachFrame(frame);
    }
    const observer = new MutationObserver((records) => {
        for (const record of records) {
            if (record.type === 'attributes') {
                // Сайт ставит адрес картинки, когда она загрузилась: в этот момент цвет и учится
                const span = record.target;
                if (!(span instanceof HTMLElement) || !span.classList.contains('sc-artwork') || !span.parentElement?.classList.contains('image')) continue;
                const url = imageUrl(span);
                if (url) learn(coverKey(span.parentElement), url);
                continue;
            }
            fadeIn(record);
            for (const node of record.addedNodes) if (node instanceof Element) visit(node);
        }
        for (const [frame, cleanup] of frames)
            if (!frame.isConnected) {
                cleanup();
                frames.delete(frame);
            }
    });
    if (document.body) visit(document.body);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });

    const dispose = (): void => {
        disposed = true;
        observer.disconnect();
        if (saveTimer !== undefined) {
            clearTimeout(saveTimer);
            save();
        }
        for (const cleanup of frames.values()) cleanup();
        frames.clear();
        for (const box of document.querySelectorAll('.scm-sk')) box.remove();
        for (const loading of document.querySelectorAll('.scm-skel')) loading.classList.remove('scm-skel', 'scm-skel-tiles', 'scm-skel-shelf', 'scm-skel-stream', 'scm-skel-compact', 'scm-skel-block');
        style.remove();
        root.classList.remove('scm-reduce');
        window.removeEventListener('pagehide', dispose);
        delete host.__disposePageMotion;
        delete host.__scmCoverColor;
        delete host.__scmLearnCover;
    };
    host.__disposePageMotion = dispose;
    window.addEventListener('pagehide', dispose, { once: true });
}

// Длительности и кривые из разбора: вход 200-250 мс с замедлением, уход быстрее с разгоном, сдвиг 8 px
export function pageMotionCss(): string {
    return [
        ':root{--scm-film:rgba(255,255,255,.06);--scm-ease:cubic-bezier(.2,0,0,1)}',
        // Обложка до загрузки: средний цвет из кэша или нейтральная подложка вместо пастельного градиента
        'html .sc-artwork[class*="sc-artwork-placeholder-"]{background-image:none;background-color:var(--scm-cover,var(--scm-film))}',
        'html .image .sc-artwork.g-opacity-transition{transition:opacity .2s var(--scm-ease)}',
        // Новая страница поднимается на 8 px; без заливки после конца, чтобы transform не держался
        '#content>div,body.crossfade-iframe-active iframe.webiIframe{animation:scm-rise .25s var(--scm-ease)}',
        '@keyframes scm-rise{from{opacity:0;transform:translateY(8px)}}',
        '@keyframes scm-fade{from{opacity:0}}',
        '.scm-in{animation:scm-fade .2s var(--scm-ease)}',
        // Заготовка вместо спиннера: появляется через 150 мс, быстрый ответ её не показывает
        'html .loading.scm-skel{display:block;padding:12px 0 0;height:auto;min-height:0}',
        'html .loading.scm-skel>:not(.scm-sk){display:none}',
        'html .webiEmbeddedModule>.loading{display:none}',
        '.scm-sk{animation:scm-fade .2s var(--scm-ease) .15s backwards;text-align:left}',
        '.scm-sk-line,.scm-sk-cover,.scm-sk-thumb,.scm-sk-wave,.scm-sk-block{background:var(--scm-film);border-radius:3px}',
        '.scm-sk-line{height:10px;margin:6px 0}',
        '.scm-sk-line.s{width:30%}',
        '.scm-sk-line.m{width:60%}',
        '.scm-sk-line.title{width:180px;height:14px;margin:0 0 14px}',
        '.scm-sk-row{display:flex;gap:16px;margin-bottom:30px}',
        '.scm-sk-row>.scm-sk-cover{width:160px;height:160px;flex:none}',
        '.scm-sk-col{flex:1;min-width:0;padding-top:4px}',
        '.scm-sk-wave{height:60px;margin-top:22px}',
        '.scm-sk-crow{display:flex;align-items:center;gap:12px;height:40px}',
        '.scm-sk-crow>.scm-sk-line{width:40%}',
        '.scm-sk-thumb{width:30px;height:30px;flex:none}',
        '.scm-sk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));grid-template-rows:auto;grid-auto-rows:0;overflow:hidden;column-gap:20px}',
        '.scm-sk-tile>.scm-sk-cover{aspect-ratio:1;margin-bottom:8px}',
        '.scm-sk-block{height:100px}',
        // Кривые сайта с перелётом и пружиной -> замедление без отскока; карусель вдвое быстрее
        'html .modal__header,html .modal__modal{transition-timing-function:var(--scm-ease)}',
        'html .modal.invisible .modal__header,html .modal.invisible .modal__modal{transition-timing-function:cubic-bezier(.8,0,1,1)}',
        'html .slide-down-outer,html .slide-up-outer{transition-timing-function:var(--scm-ease)}',
        'html .tileGallery.m-transitionsEnabled .tileGallery__sliderPanel{transition-duration:.3s;transition-timing-function:var(--scm-ease)}',
        'html .tileGallery .tileGallery__sliderPeekContainer{animation:none}',
        // Меньше анимаций: сдвигов нет, растворение остаётся
        'html.scm-reduce #content>div,html.scm-reduce body.crossfade-iframe-active iframe.webiIframe{animation-name:scm-fade}',
        '@media (prefers-reduced-motion:reduce){#content>div,body.crossfade-iframe-active iframe.webiIframe{animation-name:scm-fade}}',
    ].join('\n');
}

// Внутри iframe новой вёрстки: MUI-skeleton без пульсации, как и заготовки на сайте
export function pageMotionFrameCss(): string {
    return '.MuiSkeleton-root{animation:none!important}.MuiSkeleton-root::after{animation:none!important;display:none!important}';
}

const pageHelpers = [skeletonKind, averageColor, rememberColor, imageBase, coverKey];

export function pageMotionScript(reduce: boolean): string {
    const config: PageMotionConfig = { css: pageMotionCss(), frameCss: pageMotionFrameCss(), reduce, colorsKey: COVER_COLORS_KEY, colorsLimit: COVER_COLORS_LIMIT };
    return '(function(){\n' + pageHelpers.map((helper) => helper.toString()).join('\n') + '\n(' + installPageMotion.toString() + ')(' + JSON.stringify(config) + ');\n})();';
}
