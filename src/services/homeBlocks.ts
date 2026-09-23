// Блоки главной, которые скрываются в F1. Значение настройки true значит «показан»
export const HOME_BLOCK_KEYS = [
    'homeWave',
    'homeMore',
    'homeRecent',
    'homeMixed',
    'homeStations',
    'homeTrending',
    'homeMade',
    'homeCurated',
    'homeAlbums',
    'homeLiked',
    'homeBuzzing',
    'homeNewTracks',
    'homeFollow',
    'homeLikes',
    'homeHistory',
    'homeMobile',
] as const;
export type HomeBlockKey = (typeof HOME_BLOCK_KEYS)[number];

// Полки слева метит скрипт страницы по заголовку, блоки справа узнаются по классу
const HOME_BLOCK_TARGETS: Record<HomeBlockKey, { shown: boolean; selectors: string[] }> = {
    homeWave: { shown: true, selectors: ['#sc-wave'] },
    homeMore: { shown: false, selectors: ['[data-sc-shelf="more"]'] },
    homeRecent: { shown: true, selectors: ['[data-sc-shelf="recent"]'] },
    homeMixed: { shown: false, selectors: ['[data-sc-shelf="mixed"]'] },
    homeStations: { shown: false, selectors: ['[data-sc-shelf="stations"]'] },
    homeTrending: { shown: true, selectors: ['[data-sc-shelf="trending"]'] },
    homeMade: { shown: true, selectors: ['[data-sc-shelf="made"]'] },
    homeCurated: { shown: true, selectors: ['[data-sc-shelf="curated"]'] },
    homeAlbums: { shown: true, selectors: ['[data-sc-shelf="albums"]'] },
    homeLiked: { shown: true, selectors: ['[data-sc-shelf="liked"]'] },
    homeBuzzing: { shown: true, selectors: ['[data-sc-shelf="buzzing"]'] },
    homeNewTracks: { shown: false, selectors: ['.l-sidebar-right .artistShortcutsModule'] },
    homeFollow: { shown: false, selectors: ['.l-sidebar-right .whoToFollowModule'] },
    homeLikes: { shown: true, selectors: ['.l-sidebar-right .likesModule'] },
    homeHistory: { shown: true, selectors: ['.l-sidebar-right .historyModule'] },
    homeMobile: { shown: false, selectors: ['.l-sidebar-right .mobileApps', '.l-sidebar-right .l-footer'] },
};

export const homeBlockDefaults = Object.fromEntries(
    HOME_BLOCK_KEYS.map((key) => [key, HOME_BLOCK_TARGETS[key].shown]),
) as Record<HomeBlockKey, boolean>;

export function isHomeBlockKey(key: unknown): key is HomeBlockKey {
    return typeof key === 'string' && (HOME_BLOCK_KEYS as readonly string[]).includes(key);
}

// Правая колонка такая же в ленте, поэтому правила действуют только под меткой главной
export function homeBlocksCss(isShown: (key: HomeBlockKey) => boolean): string {
    const hidden = HOME_BLOCK_KEYS.filter((key) => !isShown(key)).flatMap((key) => HOME_BLOCK_TARGETS[key].selectors.map((selector) => 'html[data-sc-home] ' + selector));
    return hidden.length ? hidden.join(',') + '{display:none!important}' : '';
}

interface HomeWindow extends Window {
    __disposeHomePage?: () => void;
    __scSiteTranslation?: { language?: string };
}

// Скрипт страницы: метка главной на html, метки полок по серверному заголовку и перевод серверных подписей полок
export function installHomePage(): void {
    const host = window as HomeWindow;
    host.__disposeHomePage?.();
    const translate = host.__scSiteTranslation?.language === 'ru';
    const root = document.documentElement;
    const who = (name: string | undefined): string => (!name ? '' : ' ' + (name.toLowerCase() === 'you' ? 'тебя' : name));
    // [полка, заголовок с сервера, русский заголовок]
    const shelves: Array<[string, RegExp, (tail?: string) => string]> = [
        ['more', /^More of what you like$/i, () => 'Больше того, что тебе нравится'],
        ['recent', /^Recently played$/i, () => 'Недавно играло'],
        ['mixed', /^Mixed for(?: (.+))?$/i, (tail) => 'Миксы для' + who(tail)],
        ['stations', /^Discover with Stations$/i, () => 'Станции'],
        ['trending', /^Trending by genre$/i, () => 'В тренде по жанрам'],
        ['made', /^Made for(?: (.+))?$/i, (tail) => 'Для' + who(tail)],
        ['curated', /^Curated by SoundCloud$/i, () => 'Подборки SoundCloud'],
        ['albums', /^Albums for(?: (.+))?$/i, (tail) => 'Альбомы для' + who(tail)],
        ['liked', /^Liked by$/i, () => 'Лайкнули'],
        ['buzzing', /^Artists to watch out for$/i, () => 'Артисты, за которыми стоит следить'],
    ];
    const captions: Record<string, string> = {
        'Artist station': 'Станция артиста',
        'Track station': 'Станция трека',
        Trending: 'В тренде',
        'New releases based on your taste. Updated every day': 'Новинки под твой вкус. Обновляется каждый день',
        'The best of SoundCloud just for you. Updated every Monday': 'Лучшее на SoundCloud для тебя. Обновляется по понедельникам',
    };
    const headings: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
        [/^(.+)'s Picks$/, (match) => 'Выбор ' + match[1]],
        [/^Related tracks: (.+)$/, (match) => 'Похожие на: ' + match[1]],
        [/^Your Mix (\d+)$/, (match) => 'Твой микс ' + match[1]],
    ];
    const clean = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim();
    // Меняются только текстовые узлы: в заголовке бывают ссылки и значки сайта
    const rewrite = (element: Element, change: (text: string) => string | null): void => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const node = walker.currentNode;
            const text = clean(node.nodeValue);
            const next = text ? change(text) : null;
            if (next !== null && next !== text && node.nodeValue) node.nodeValue = node.nodeValue.replace(text, next);
        }
    };
    const translateTitle = (text: string): string | null => {
        for (const [, pattern, russian] of shelves) {
            const match = pattern.exec(text);
            if (match) return russian(match[1]);
        }
        return null;
    };
    const translateHeading = (text: string): string | null => {
        for (const [pattern, russian] of headings) {
            const match = pattern.exec(text);
            if (match) return russian(match);
        }
        return null;
    };

    function update(): void {
        const home = location.pathname === '/discover' || location.pathname === '/';
        if (root.hasAttribute('data-sc-home') !== home) root.toggleAttribute('data-sc-home', home);
        if (!home) return;
        for (const item of document.querySelectorAll('li.mixedModularHome__item:not([data-sc-shelf])')) {
            const title = clean(item.querySelector('.mixedSelectionModule__titleText')?.textContent ?? null);
            const shelf = title && shelves.find(([, pattern]) => pattern.test(title));
            // Незнакомая полка остаётся без метки и всегда видна
            if (shelf) item.setAttribute('data-sc-shelf', shelf[0]);
        }
        if (!translate) return;
        for (const title of document.querySelectorAll('li.mixedModularHome__item .mixedSelectionModule__titleText')) rewrite(title, translateTitle);
        for (const caption of document.querySelectorAll('li.mixedModularHome__item .playableTile__usernameHeading'))
            rewrite(caption, (text) => (Object.prototype.hasOwnProperty.call(captions, text) ? captions[text] : null));
        for (const heading of document.querySelectorAll('li.mixedModularHome__item .playableTile__heading')) rewrite(heading, translateHeading);
    }

    let frame = 0;
    const schedule = (): void => {
        // Кадр анимации идёт до отрисовки, поэтому скрытая полка не мелькает
        if (!frame) frame = requestAnimationFrame(() => {
            frame = 0;
            try {
                update();
            } catch (error) {
                console.error('Главная: не удалось разметить блоки', error);
            }
        });
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('popstate', schedule);
    const dispose = (): void => {
        observer.disconnect();
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        window.removeEventListener('popstate', schedule);
        window.removeEventListener('pagehide', dispose);
        root.removeAttribute('data-sc-home');
        delete host.__disposeHomePage;
    };
    host.__disposeHomePage = dispose;
    window.addEventListener('pagehide', dispose, { once: true });
    update();
}

export function homePageScript(): string {
    return '(' + installHomePage.toString() + ')();';
}
