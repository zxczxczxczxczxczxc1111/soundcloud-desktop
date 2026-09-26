// Меню по правому клику на странице и в iframe того же сайта: цель под курсором, пункты, открытие, выбор пункта;
// здесь же волна от трека, артиста или плейлиста, которую запускает меню. Раздел страницы волны: installMenu уходит
// на страницу текстом вместе с волной (pageHelpers в wave.ts) и зовёт помощников по голому имени, поэтому импорт
// через пространство имён и разбор в константы. Открытое меню и слушатели iframe раздел держит сам; отметки, очередь
// и старт подборки приходят от ядра объектом core
import * as waveLinks from '../waveLinks';
import * as wavePicks from '../wavePicks';
import type { Excluded, MarkKind, MenuTarget, Seed, WaveCandidate, WaveLinkKind, WaveState, WaveTexts, WaveTrack } from '../waveTypes';
import type { SitePlayer } from '../wave';

const { canonicalUrl, classifyLink } = waveLinks;
const { shuffleInPlace, trackArtist } = wavePicks;

export interface MenuCore {
    texts: WaveTexts;
    state(): WaveState;
    disposed(): boolean;
    player(): SitePlayer | null;
    /** API сайта найден: без него меню не открывается */
    api(): boolean;
    /** Номер последнего запуска подборки: запуск, начатый позже, отменяет прежний */
    seedRequest(): number;
    nextSeedRequest(): number;
    /** Треки, известные волне: отданные сайту и подбор до запуска */
    known: Map<number, WaveCandidate>;
    preview(): WaveCandidate[];
    /** Трек разделов по номеру: подборки, радар, «Моя музыка» */
    sectionTrack(id: number): WaveTrack | undefined;
    currentCandidate(): WaveCandidate | null;
    fromTrack(track: WaveTrack): MenuTarget;
    /** Отметки: «Не нравится», скрытые артисты, «Не сейчас», «Больше такого» */
    excludedTracks: Map<number, Excluded>;
    excludedArtists: Map<number, Excluded>;
    laterTracks: Map<number, Excluded>;
    laterArtists: Map<number, Excluded>;
    moreTracks: Map<number, Excluded>;
    marked(map: Map<number, Excluded>, id: number): boolean;
    familyHidden(target: MenuTarget): boolean;
    setExcluded(kind: MarkKind, target: MenuTarget, excluded: boolean): Promise<void>;
    setFamily(target: MenuTarget, hide: boolean): Promise<void>;
    /** Трек в очередь сайта: следующим или в конец */
    addTrack(track: WaveTrack, next: boolean): void;
    /** Набор треков из меню: место трека в нём и добавить или убрать */
    pickedIndex(target: MenuTarget): number;
    pick(target: MenuTarget, add: boolean): Promise<void>;
    openVersions(target: MenuTarget): Promise<void>;
    trackOf(target: MenuTarget): Promise<WaveTrack | null>;
    artistOf(target: MenuTarget): Promise<{ id: number; username: string; url: string } | null>;
    artistOwnTracks(id: number): Promise<WaveTrack[]>;
    playlistTracks(body: unknown): Promise<WaveTrack[]>;
    resolveUrl(url: string): Promise<unknown>;
    beginSeed(request: number, loaded: { seed: Seed; first: WaveTrack | null }): Promise<void>;
    ensureProfile(): Promise<unknown>;
    ensureExclusions(): Promise<void>;
    ensureStyle(): void;
    showToast(text: string): void;
    /** Прокрутка страницы или iframe: меню и подсказка закрываются */
    onScroll(): void;
    el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K];
}
/** Что раздел отдаёт ядру: слушатели страницы, закрытие меню, слежение за iframe */
export interface MenuSection {
    onPageMenu(event: MouseEvent): void;
    onOutside(event: Event): void;
    onDocumentKey(event: KeyboardEvent): void;
    closeMenu(): void;
    /** iframe того же сайта: в каждый документ те же слушатели, ушедшие документы забываются */
    watchFrames(): void;
    /** Снять слушатели со всех документов iframe */
    dispose(): void;
}

export function installMenu(core: MenuCore): MenuSection {
    const {
        texts: T, known, excludedTracks, excludedArtists, laterTracks, laterArtists, moreTracks, marked, familyHidden, setExcluded, setFamily, addTrack, currentCandidate,
        fromTrack, trackOf, artistOf, artistOwnTracks, playlistTracks, resolveUrl, beginSeed, ensureProfile, ensureExclusions, ensureStyle, showToast, onScroll, el,
    } = core;
    const MENU_ICON: Record<string, string> = {
        wave: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 6.5h1.5v3H1zM4 4.5h1.5v7H4zM7 2h1.5v12H7zM10 5h1.5v6H10zM13 7h1.5v2H13z"/></svg>',
        artist: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5a3.25 3.25 0 1 1 0 6.5 3.25 3.25 0 0 1 0-6.5zM2 14.5c0-3 2.7-5 6-5s6 2 6 5z"/></svg>',
        block: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm4.3 10.2A5.5 5.5 0 0 0 4.8 3.7zM3.7 4.8a5.5 5.5 0 0 0 7.5 7.5z"/></svg>',
        hide: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 1.5a3.25 3.25 0 1 1 0 6.5 3.25 3.25 0 0 1 0-6.5zM.5 14.5c0-3 2.7-5 6-5 1.1 0 2.2.2 3 .7v4.3zM10.5 11h5v1.5h-5z"/></svg>',
        undo: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.6 3.4 5.7 4.5 4.1 6H10a4.5 4.5 0 0 1 0 9H6v-1.5h4a3 3 0 0 0 0-6H4.1l1.6 1.5-1.1 1.1L1.2 6.75z"/></svg>',
        more: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.25 2h1.5v5.25H14v1.5H8.75V14h-1.5V8.75H2v-1.5h5.25z"/></svg>',
        later: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.34 2.02C6.59 1.82 2 6.42 2 12c0 5.52 4.48 10 10 10 3.71 0 6.93-2.02 8.66-5.02-7.51-.25-12.09-8.43-8.32-14.96z"/></svg>',
        // Стопка слоёв: версии одной песни
        versions: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.2 15 5 8 8.8 1 5zM2.7 7.4 8 10.3l5.3-2.9L15 8.3 8 12.1 1 8.3zm0 3.3L8 13.6l5.3-2.9 1.7.9L8 15.4 1 11.6z"/></svg>',
        // Список с плюсом: трек в набор
        pick:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 2.5h10V4H1zM1 6.25h10v1.5H1zM1 10h6v1.5H1zM11.25 9h1.5v2.25H15v1.5h-2.25V15h-1.5v-2.25H9v-1.5h2.25z"/></svg>',
    };
    // Зёрна: сам трек; топ артиста (он же идёт в подборку); треки плейлиста
    async function loadSeed(kind: WaveLinkKind, target: MenuTarget): Promise<{ seed: Seed; first: WaveTrack | null } | null> {
        if (kind === 'track') {
            const track = await trackOf(target);
            return track ? { seed: { kind, title: (track.title ?? '').trim() || '…', tracks: [track], own: [] }, first: track } : null;
        }
        if (kind === 'artist') {
            const artist = await artistOf(target);
            if (!artist) return null;
            const own = await artistOwnTracks(artist.id);
            return { seed: { kind, title: artist.username || '…', tracks: shuffleInPlace(own.slice()), own }, first: null };
        }
        const body = (await resolveUrl(target.url)) as { title?: unknown } | null;
        const tracks = await playlistTracks(body);
        return { seed: { kind, title: (typeof body?.title === 'string' ? body.title.trim() : '') || '…', tracks: shuffleInPlace(tracks), own: [] }, first: null };
    }
    async function startSeed(kind: WaveLinkKind, target: MenuTarget): Promise<void> {
        const request = core.nextSeedRequest();
        try {
            await Promise.all([ensureProfile(), ensureExclusions()]);
            const loaded = await loadSeed(kind, target);
            if (request !== core.seedRequest() || core.disposed()) return;
            if (!loaded?.seed.tracks.length) {
                showToast(T.toastEmpty);
                return;
            }
            await beginSeed(request, loaded);
        } catch (error) {
            if (request !== core.seedRequest()) return;
            console.warn('Волна: не удалось начать волну', error);
            showToast(T.toastFailed);
        }
    }
    // Элементы списков сайта и их главные ссылки: проверено на ленте, лайках, истории, поиске, плейлисте, главной
    const ITEM_SELECTOR = '.soundList__item, .searchItem__trackItem, .historicalPlays__item, .userStreamItem, .trackItem, .compactTrackList__item, .playableTile, .soundBadge, .playbackSoundBadge, .userBadgeListItem, .userBadge, .sound';
    const PRIMARY_SELECTOR = 'a.soundTitle__title, a.trackItem__trackTitle, a.playbackSoundBadge__titleLink, a.playableTile__mainHeading, a.playableTile__heading, a.sound__coverArt, a.playableTile__artworkLink, a.userBadge__usernameLink, a.userBadgeListItem__heading';
    const USER_SELECTOR = 'a.soundTitle__username, a.trackItem__username, a.playbackSoundBadge__lightLink, a.playableTile__usernameHeading, .playableTile a.sc-link-secondary';
    const HERO_SELECTOR = '.fullHero, .listenHero, .profileHeader, .systemPlaylistHero, .l-listen-hero';
    function menuTarget(node: Element): MenuTarget | null {
        if (node.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return null;
        const inWave = node.closest('#sc-wave');
        if (inWave) {
            const tile = node.closest<HTMLElement>('.scw-tile[data-track], .scw-row[data-track]');
            const id = tile ? Number(tile.dataset.track) : 0;
            const track = id
                ? known.get(id)?.track ?? core.preview().find((item) => item.track.id === id)?.track ?? core.sectionTrack(id)
                : node.closest('.scw-body') ? currentCandidate()?.track : undefined;
            return track ? fromTrack(track) : null;
        }
        const item = node.closest(ITEM_SELECTOR);
        const anchor = node.closest<HTMLAnchorElement>('a[href]');
        let link = anchor ? classifyLink(anchor.getAttribute('href') ?? '', location.href) : null;
        if (!link && item) {
            const primary = item.querySelector<HTMLAnchorElement>(PRIMARY_SELECTOR);
            link = primary ? classifyLink(primary.getAttribute('href') ?? '', location.href) : null;
        }
        // Незнакомая разметка строки: первая ссылка на трек или плейлист внутри
        if (!link && item)
            for (const other of item.querySelectorAll<HTMLAnchorElement>('a[href]')) {
                const found = classifyLink(other.getAttribute('href') ?? '', location.href);
                if (found && found.kind !== 'artist') { link = found; break; }
            }
        if (!link && !item && node.closest(HERO_SELECTOR)) link = classifyLink(location.pathname, location.href);
        if (!link) return null;
        const target = link;
        const user = target.kind === 'track' && item ? item.querySelector<HTMLAnchorElement>(USER_SELECTOR) : null;
        const artist = user ? classifyLink(user.getAttribute('href') ?? '', location.href) : null;
        const knownTrack = [...known.values()].find((candidate) => canonicalUrl(candidate.track.permalink_url) === canonicalUrl(target.url));
        return { kind: target.kind, url: target.url, artistUrl: artist?.kind === 'artist' ? artist.url : '', track: knownTrack?.track };
    }
    // Новая вёрстка SoundCloud (страница трека и не только) живёт в iframe того же сайта по адресу /n/...
    // Классы там от MUI и меняются от сборки к сборке, поэтому опора на ссылки и заголовок h1.
    // Строка списка это самый широкий предок, где ссылка на трек или плейлист ровно одна
    function frameMenuTarget(node: Element): MenuTarget | null {
        if (node.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return null;
        const doc = node.ownerDocument;
        const path = doc.location.pathname.replace(/^\/n(?=\/)/, '');
        const base = location.origin + path;
        const linkOf = (anchor: Element): { kind: WaveLinkKind; url: string } | null => classifyLink(anchor.getAttribute('href') ?? '', base);
        const artistIn = (root: Element | null): string => {
            for (const anchor of root ? root.querySelectorAll('a[href]') : []) {
                const found = linkOf(anchor);
                if (found?.kind === 'artist') return found.url;
            }
            return '';
        };
        const rowOf = (from: Element): { link: { kind: WaveLinkKind; url: string }; row: Element } | null => {
            let best: { link: { kind: WaveLinkKind; url: string }; row: Element } | null = null;
            for (let row: Element | null = from, depth = 0; row && depth < 12 && row !== doc.body && row.tagName !== 'MAIN'; row = row.parentElement, depth++) {
                const urls = new Map<string, { kind: WaveLinkKind; url: string }>();
                for (const anchor of row.querySelectorAll('a[href]')) {
                    const found = linkOf(anchor);
                    if (found && found.kind !== 'artist') urls.set(found.url, found);
                }
                if (urls.size > 1) break;
                if (urls.size === 1) best = { link: [...urls.values()][0], row };
            }
            return best;
        };
        const anchor = node.closest('a[href]');
        let link: { kind: WaveLinkKind; url: string } | null = null;
        let artistUrl = '';
        if (anchor) {
            // Ссылка не на трек, артиста или плейлист (теги, подписчики): меню сайта
            link = linkOf(anchor);
            if (!link) return null;
            if (link.kind === 'track') artistUrl = artistIn(rowOf(anchor)?.row ?? null);
        } else {
            const hero = node.closest('section');
            if (node.closest('h1') || hero?.querySelector('h1')) {
                // Шапка страницы: заголовок без ссылки, это сама страница
                link = classifyLink(path, location.origin + '/');
                if (link?.kind === 'track') artistUrl = artistIn(hero);
            } else {
                const row = rowOf(node);
                if (row) {
                    link = row.link;
                    if (link.kind === 'track') artistUrl = artistIn(row.row);
                }
            }
        }
        if (!link) return null;
        const target = link;
        const knownTrack = [...known.values()].find((candidate) => canonicalUrl(candidate.track.permalink_url) === canonicalUrl(target.url));
        return { kind: target.kind, url: target.url, artistUrl, track: knownTrack?.track };
    }
    // Отметка у цели меню: по id, если трек известен, иначе по ссылке; истёкшее «Не сейчас» не считается
    function trackMarked(map: Map<number, Excluded>, target: MenuTarget): boolean {
        if (target.track) return marked(map, target.track.id);
        const key = canonicalUrl(target.url);
        return !!key && [...map.values()].some((entry) => entry.url === key && marked(map, entry.id));
    }
    function artistMarked(map: Map<number, Excluded>, target: MenuTarget): boolean {
        const id = target.kind !== 'artist' && target.track ? trackArtist(target.track) : 0;
        if (id) return marked(map, id);
        const key = canonicalUrl(target.kind === 'artist' ? target.url : target.artistUrl);
        return !!key && [...map.values()].some((entry) => entry.url === key && marked(map, entry.id));
    }
    const trackExcluded = (target: MenuTarget): boolean => trackMarked(excludedTracks, target);
    const artistExcluded = (target: MenuTarget): boolean => artistMarked(excludedArtists, target);
    function menuItems(target: MenuTarget): Array<[string, string, string]> {
        const items: Array<[string, string, string]> = [];
        const hasArtist = target.kind === 'artist' || !!target.artistUrl || !!target.track;
        if (target.kind === 'track') items.push(['wave-track', T.menuWaveTrack, 'wave']);
        if (target.kind === 'playlist') items.push(['wave-playlist', T.menuWavePlaylist, 'wave']);
        if (hasArtist) items.push(['wave-artist', T.menuWaveArtist, target.kind === 'artist' ? 'wave' : 'artist']);
        if (target.kind === 'track') {
            items.push(['queue-next', T.lang === 'ru' ? 'Слушать следующим' : 'Play next', 'pick']);
            items.push(['queue-last', T.lang === 'ru' ? 'В конец очереди' : 'Add to queue', 'pick']);
            items.push(core.pickedIndex(target) >= 0 ? ['unpick', T.menuUnpick, 'undo'] : ['pick', T.menuPick, 'pick']);
            items.push(trackMarked(moreTracks, target) ? ['unmore', T.menuUnmore, 'undo'] : ['more', T.more, 'more']);
            items.push(trackMarked(laterTracks, target) ? ['unlater', T.menuUnlater, 'undo'] : ['later', T.later, 'later']);
            items.push(trackExcluded(target) ? ['undislike', T.menuUndislike, 'undo'] : ['dislike', T.menuDislike, 'block']);
            items.push(['versions', T.menuVersions, 'versions']);
            items.push(familyHidden(target) ? ['show-family', T.menuShowFamily, 'undo'] : ['hide-family', T.menuHideFamily, 'block']);
        }
        if (target.kind === 'artist') items.push(artistMarked(laterArtists, target) ? ['unlater-artist', T.menuUnlater, 'undo'] : ['later-artist', T.later, 'later']);
        if (hasArtist) items.push(artistExcluded(target) ? ['show-artist', T.menuShowArtist, 'undo'] : ['hide-artist', T.menuHideArtist, 'hide']);
        return items;
    }
    function runMenu(act: string, target: MenuTarget): void {
        switch (act) {
            case 'queue-next':
            case 'queue-last':
                void trackOf(target).then((track) => { if (track && !core.disposed()) addTrack(track, act === 'queue-next'); }).catch((error: unknown) => { console.warn('Очередь: трек не добавлен', error); showToast(T.toastFailed); });
                return;
            case 'wave-track': void startSeed('track', target); return;
            case 'wave-artist': void startSeed('artist', target); return;
            case 'wave-playlist': void startSeed('playlist', target); return;
            case 'pick':
            case 'unpick': void core.pick(target, act === 'pick'); return;
            case 'dislike':
            case 'undislike': void setExcluded('track', target, act === 'dislike'); return;
            case 'hide-artist':
            case 'show-artist': void setExcluded('artist', target, act === 'hide-artist'); return;
            case 'more':
            case 'unmore': void setExcluded('more', target, act === 'more'); return;
            case 'later':
            case 'unlater': void setExcluded('later-track', target, act === 'later'); return;
            case 'later-artist':
            case 'unlater-artist': void setExcluded('later-artist', target, act === 'later-artist'); return;
            case 'versions': void core.openVersions(target); return;
            case 'hide-family':
            case 'show-family': void setFamily(target, act === 'hide-family'); return;
        }
    }

    let menu: HTMLElement | null = null;
    let menuFor: MenuTarget | null = null;
    function closeMenu(): void {
        menu?.remove();
        menu = null;
        menuFor = null;
    }
    function openMenu(target: MenuTarget, x: number, y: number, byKeyboard: boolean): void {
        closeMenu();
        ensureStyle();
        const root = el('div', 'dropdownMenu g-z-index-overlay scw-menu');
        root.setAttribute('role', 'menu');
        root.tabIndex = -1;
        root.style.position = 'fixed';
        const list = el('div', 'moreActions sc-list-nostyle sc-border-box sc-pt-1x sc-pb-1x');
        const group = el('div', 'moreActions__group');
        for (const [act, label, icon] of menuItems(target)) {
            const item = el('button', 'sc-button moreActions__button sc-button-medium sc-button-tertiary scw-mi');
            item.type = 'button';
            item.setAttribute('role', 'menuitem');
            item.dataset.menu = act;
            const glyph = el('div', '');
            glyph.insertAdjacentHTML('beforeend', MENU_ICON[icon]);
            item.append(glyph, el('span', '', label));
            group.append(item);
        }
        list.append(group);
        root.append(list);
        root.addEventListener('click', (event) => {
            const item = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-menu]') : null;
            const chosen = menuFor;
            closeMenu();
            if (item?.dataset.menu && chosen) runMenu(item.dataset.menu, chosen);
        });
        root.addEventListener('keydown', (event) => {
            const buttons = [...root.querySelectorAll<HTMLElement>('[data-menu]')];
            const at = buttons.indexOf(document.activeElement as HTMLElement);
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const down = event.key === 'ArrowDown';
                // Открыто мышью: фокус на самом меню, первая стрелка встаёт на крайний пункт
                const next = at < 0 ? (down ? 0 : buttons.length - 1) : (at + (down ? 1 : -1) + buttons.length) % buttons.length;
                buttons[next]?.focus();
            } else if (event.key === 'Escape' || event.key === 'Tab') {
                event.preventDefault();
                closeMenu();
            }
        });
        document.body.append(root);
        const left = Math.max(8, Math.min(x, window.innerWidth - root.offsetWidth - 8));
        const above = y + root.offsetHeight > window.innerHeight - 8;
        root.style.left = left + 'px';
        root.style.top = Math.max(8, above ? y - root.offsetHeight : y) + 'px';
        // Раскрывается из точки клика
        root.style.transformOrigin = Math.max(0, x - left) + 'px ' + (above ? 'bottom' : 'top');
        menu = root;
        menuFor = target;
        // Фокус на пункте после ПКМ Chrome считает видимым, и сайт рисует ему синюю рамку
        if (byKeyboard) root.querySelector<HTMLElement>('[data-menu]')?.focus();
        else root.focus({ preventScroll: true });
    }
    // Узел из iframe принадлежит другому окну, и instanceof Element для него ложен
    const asElement = (value: unknown): Element | null =>
        value && typeof value === 'object' && (value as Node).nodeType === 1 ? (value as Element) : null;
    function onContextMenu(event: MouseEvent, frame?: HTMLIFrameElement): void {
        closeMenu();
        if (!core.player() || !core.api() || core.disposed() || core.state() === 'unavailable') return;
        const node = asElement(event.target);
        const target = node ? (frame ? frameMenuTarget(node) : menuTarget(node)) : null;
        if (!node || !target) return;
        event.preventDefault();
        let { clientX: x, clientY: y } = event;
        // С клавиатуры (Shift+F10) координат нет: меню встаёт под элементом
        const byKeyboard = !x && !y;
        if (byKeyboard) {
            const rect = node.getBoundingClientRect();
            x = rect.left;
            y = rect.bottom;
        }
        // Координаты iframe отсчитываются от его угла, меню живёт в странице
        if (frame) {
            const box = frame.getBoundingClientRect();
            x += box.left;
            y += box.top;
        }
        openMenu(target, x, y, byKeyboard);
        void ensureExclusions();
        // Ссылку распознаём заранее, пока выбирают пункт
        if (!target.track && target.url) void resolveUrl(target.url).catch((error: unknown) => console.debug('Волна: ссылка не распознана', error));
    }
    const onOutside = (event: Event): void => {
        if (menu && !(event.target instanceof Node && menu.contains(event.target))) closeMenu();
    };
    const onDocumentKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' && menu) closeMenu();
    };
    const onPageMenu = (event: MouseEvent): void => onContextMenu(event);

    // Документы iframe того же сайта: в каждый ставятся те же слушатели, что и в страницу.
    // После перехода внутри iframe документ новый, его подхватывает событие load
    const frameCleanups = new Map<Document, () => void>();
    const watchedFrames = new WeakSet<HTMLIFrameElement>();
    function frameDocument(frame: HTMLIFrameElement): Document | null {
        try {
            const doc = frame.contentDocument;
            return doc && doc.defaultView && doc.location.origin === location.origin ? doc : null;
        } catch {
            return null;
        }
    }
    function attachFrame(frame: HTMLIFrameElement): void {
        if (!watchedFrames.has(frame)) {
            watchedFrames.add(frame);
            frame.addEventListener('load', () => {
                if (!core.disposed()) attachFrame(frame);
            });
        }
        const doc = frameDocument(frame);
        if (!doc || frameCleanups.has(doc)) return;
        const onMenu = (event: MouseEvent): void => onContextMenu(event, frame);
        doc.addEventListener('contextmenu', onMenu);
        doc.addEventListener('mousedown', onOutside, true);
        doc.addEventListener('keydown', onDocumentKey);
        doc.addEventListener('scroll', onScroll, true);
        frameCleanups.set(doc, () => {
            doc.removeEventListener('contextmenu', onMenu);
            doc.removeEventListener('mousedown', onOutside, true);
            doc.removeEventListener('keydown', onDocumentKey);
            doc.removeEventListener('scroll', onScroll, true);
        });
    }
    function watchFrames(): void {
        for (const frame of document.querySelectorAll('iframe')) attachFrame(frame);
        // Ушедшие документы iframe: слушатели снимать уже не с кого, запись только занимает память
        for (const doc of [...frameCleanups.keys()]) if (!doc.defaultView) frameCleanups.delete(doc);
    }
    return {
        onPageMenu,
        onOutside,
        onDocumentKey,
        closeMenu,
        watchFrames,
        dispose: () => {
            for (const cleanup of frameCleanups.values()) cleanup();
            frameCleanups.clear();
        },
    };
}
