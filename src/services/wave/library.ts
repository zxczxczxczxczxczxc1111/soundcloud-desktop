// «Моя музыка» (Э7): свои лайки и плейлисты целиком, три режима порядка, блок на главной с выбором источников.
// Раздел страницы волны: installLibrary уходит на страницу текстом вместе с волной (pageHelpers в wave.ts) и зовёт
// помощников по голому имени, поэтому импорт через пространство имён и разбор в константы. Выбор, план игры и
// плейлисты раздел держит сам; всё, что он берёт у ядра волны, приходит объектом core
import * as identity from '../trackIdentity';
import * as libraryMix from '../libraryMix';
import type { LibraryEntry, LibraryMode, MyMusicSetting } from '../libraryMix';
import * as wavePicks from '../wavePicks';
import * as waveTexts from '../waveTexts';
import type { Excluded, Profile, Seed, WaveState, WaveTexts, WaveTrack } from '../waveTypes';
import type { SitePlayer, SiteQueueItem, WaveWindow } from '../wave';

const { copyKey, copyKeys } = identity;
const { isLibraryMode, isLibrarySource, libraryOrder, libraryPool } = libraryMix;
const { shuffleInPlace, trackArtist } = wavePicks;
const { countText, fillText, formatTime } = waveTexts;

export interface LibraryCore {
    texts: WaveTexts;
    host: WaveWindow;
    userId(): number;
    state(): WaveState;
    active(): boolean;
    disposed(): boolean;
    player(): SitePlayer | null;
    profile(): Profile | null;
    seed(): Seed | null;
    /** Номер последнего запуска подборки: запуск, начатый позже, отменяет прежний */
    seedRequest(): number;
    nextSeedRequest(): number;
    ours: WeakSet<SiteQueueItem>;
    /** Трек снова доступен подбору: ушёл из очереди вместе со старым порядком */
    untake(id: number): void;
    /** Переход к треку сделал сам клиент: слежение не считает его пропуском */
    jumped(): void;
    /** Список «Моей музыки» открывается или закрывается: его прокрутка с начала */
    resetLibraryScroll(): void;
    queueView(): { items: SiteQueueItem[]; index: number };
    resetGeneration(): void;
    restartAhead(): Promise<void>;
    beginSeed(request: number, loaded: { seed: Seed; first: WaveTrack | null }): Promise<void>;
    ensureProfile(): Promise<Profile>;
    expandLibrary(current: Profile): Promise<void>;
    ensureExclusions(): Promise<void>;
    ensureUser(): Promise<number>;
    call(name: string, path: object, query: object): Promise<unknown>;
    collection(body: unknown): unknown[];
    nextQuery(body: unknown): Record<string, string> | null;
    asTrack(value: unknown): WaveTrack | null;
    libraryPlaylist(id: number, send: (name: string, path: object, query: object) => Promise<unknown>): Promise<{ title: string; collection: WaveTrack[] }>;
    disliked(): Set<number>;
    excludedArtists: Map<number, Excluded>;
    laterTracks: Map<number, Excluded>;
    laterArtists: Map<number, Excluded>;
    marked(map: Map<number, Excluded>, id: number): boolean;
    render(): void;
    showToast(text: string): void;
    el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K];
    button(className: string, act: string, label: string, icon?: string): HTMLButtonElement;
    textButton(act: string, label: string): HTMLButtonElement;
    trackRow(track: WaveTrack, now: number): { row: HTMLDivElement; end: HTMLDivElement };
}
/** Что раздел отдаёт ядру и блоку на главной */
export interface LibrarySection {
    render(): HTMLElement[];
    click(control: HTMLElement): void;
    rowClick(id: number): void;
    resume(current: Seed): Promise<void>;
    /** Плейлист, из которого трек пришёл в пул; пусто у лайков */
    sourceName(id: number): string;
    poolTrack(id: number): WaveTrack | undefined;
}

export function installLibrary(core: LibraryCore): LibrarySection {
    const {
        texts: T, host, ours, excludedArtists, laterTracks, laterArtists, queueView, resetGeneration, restartAhead, beginSeed, ensureProfile, expandLibrary,
        ensureExclusions, ensureUser, call, collection, nextQuery, asTrack, libraryPlaylist, disliked, marked, render, showToast, el, button, textButton, trackRow,
    } = core;
    const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
    // «Моя музыка» (Э7): выбор и режим из настроек, плейлисты аккаунта для выбора, план игры (пул в порядке режима,
    // key это выбор и режим) и откуда пришёл каждый трек пула. Плейлисты кешируются на 10 минут: «По порядку»
    // берёт порядок у сайта в момент запуска
    let myMusic: MyMusicSetting = { mode: 'shuffle', pick: {} };
    let myMusicPromise: Promise<void> | null = null;
    interface LibraryPlaylist { id: number; title: string; count: number; own: boolean }
    let librarySources: LibraryPlaylist[] | 'loading' | 'failed' | null = null;
    let libraryPlan: { key: string; at: number; used: boolean; pool: LibraryEntry<WaveTrack>[]; entries: LibraryEntry<WaveTrack>[] } | null = null;
    let libraryPlanPromise: Promise<void> | null = null;
    let libraryPlanFailed = false;
    let libraryListOpen = false;
    let librarySourcesOpen = false;
    let libraryShown = 100;
    let libraryRetryAt = 0;
    // Пересборка играющей «Моей музыки» после смены выбора или режима: запрос, начатый позже, отменяет прежний;
    // несколько щелчков по источникам подряд дают одну пересборку
    let rebuildRequest = 0;
    let rebuilding = false;
    let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
    const libraryFrom = new Map<number, string>();
    // Ключ источника трека пула ('likes' или 'playlist:<id>'): отметка «сейчас играет отсюда» в выборе
    const librarySourceOf = new Map<number, string>();
    const playlistCache = new Map<number, { at: number; title: string; tracks: WaveTrack[] }>();
    const LIBRARY_TTL = 10 * 60000;
    const pickedSources = (): string[] => (core.userId() ? myMusic.pick[String(core.userId())] : undefined) ?? ['likes'];
    const planKey = (pick: string[], mode: LibraryMode): string => pick.join(',') + '|' + mode;
    // Выбор и режим из настроек, main их уже проверил. Не прочитались: лайки и «Перемешать» до перезагрузки страницы
    function ensureMyMusic(): Promise<void> {
        myMusicPromise ??= (async () => {
            const loaded = (await host.soundcloudAPI?.waveLibrary?.load()) as { mode?: unknown; pick?: unknown } | null | undefined;
            if (!loaded || !isLibraryMode(loaded.mode) || !loaded.pick || typeof loaded.pick !== 'object') return;
            const pick: Record<string, string[]> = {};
            for (const [user, list] of Object.entries(loaded.pick as Record<string, unknown>)) if (Array.isArray(list)) pick[user] = list.filter(isLibrarySource);
            myMusic = { mode: loaded.mode, pick };
        })().catch((error: unknown) => console.warn('Моя музыка: выбор не прочитан', error)).finally(render);
        return myMusicPromise;
    }
    function saveMyMusic(): void {
        const bridge = host.soundcloudAPI?.waveLibrary;
        if (!bridge) return;
        bridge.save(myMusic).then((saved) => {
            if (saved !== true) console.warn('Моя музыка: выбор не сохранён');
        }, (error: unknown) => console.warn('Моя музыка: выбор не сохранён', error));
    }
    // Источник в выбор или из выбора; порядок выбора это порядок «По порядку». Аккаунтов в настройке не больше 20
    function toggleLibrarySource(key: string): void {
        const userId = core.userId();
        if (!userId || !isLibrarySource(key)) return;
        const list = pickedSources();
        const next = list.includes(key) ? list.filter((item) => item !== key) : [...list, key].slice(0, 100);
        const others = Object.entries(myMusic.pick).filter(([user]) => user !== String(userId)).slice(0, 19);
        myMusic = { mode: myMusic.mode, pick: { ...Object.fromEntries(others), [String(userId)]: next } };
        saveMyMusic();
        if (playingLibrary()) {
            clearTimeout(rebuildTimer);
            rebuildTimer = setTimeout(() => void rebuildLibrary(), 400);
        } else if (libraryListOpen && next.length) void ensureLibraryPlan(false);
        render();
    }
    function setLibraryMode(next: LibraryMode): void {
        if (next === myMusic.mode) return;
        myMusic = { mode: next, pick: myMusic.pick };
        saveMyMusic();
        if (playingLibrary()) void rebuildLibrary();
        else if (libraryListOpen) void ensureLibraryPlan(false);
        render();
    }
    const sourceName = (key: string): string => (key === 'likes' ? T.libraryLikes : playlistName(Number(key.slice('playlist:'.length))));
    // Название выбора: два источника по именам, больше двух счётом («Лайки и 3 плейлиста», «5 плейлистов»)
    function libraryTitle(pick: string[]): string {
        const names = pick.map(sourceName).filter(Boolean);
        if (names.length < 3) return names.length === 2 ? fillText(T.groupAnd, { a: names[0], b: names[1] }) : names.join('');
        const playlists = pick.filter((key) => key !== 'likes').length;
        const counted = countText(playlists, T.libraryPlaylists, T.lang);
        return pick.includes('likes') ? fillText(T.groupAnd, { a: T.libraryLikes, b: counted }) : counted;
    }
    // Плейлисты аккаунта для выбора: свои без альбомов и сохранённые (альбомы среди них), названия у сайта на сессию
    function ensureLibrarySources(): void {
        if (librarySources !== null) return;
        librarySources = 'loading';
        void (async () => {
            const user = await ensureUser();
            if (!user) throw new Error('Пользователь не определён');
            const lists: LibraryPlaylist[] = [];
            const info = (value: unknown, own: boolean): void => {
                const item = value && typeof value === 'object' ? (value as { id?: unknown; title?: unknown; track_count?: unknown; tracks?: unknown }) : null;
                if (!item || !isId(item.id) || lists.some((list) => list.id === item.id)) return;
                const count = typeof item.track_count === 'number' ? item.track_count : Array.isArray(item.tracks) ? item.tracks.length : 0;
                lists.push({ id: item.id, title: (typeof item.title === 'string' ? item.title.trim() : '') || '…', count, own });
            };
            let query: Record<string, string | number> | null = { limit: 50 };
            for (let page = 0; query && page < 10 && !core.disposed(); page++) {
                const body = await call('userPlaylistsWithoutAlbums', { id: user }, query);
                for (const item of collection(body)) info(item, true);
                query = nextQuery(body);
            }
            const saved: number[] = [];
            query = { limit: 200 };
            for (let page = 0; query && page < 5 && !core.disposed(); page++) {
                const body = await call('playlistLikesIds', {}, query);
                for (const value of collection(body)) {
                    const id = typeof value === 'number' ? value : (value as { id?: unknown } | null)?.id;
                    if (isId(id) && !saved.includes(id)) saved.push(id);
                }
                query = nextQuery(body);
            }
            // Сохранённый плейлист, которого сайт не отдал (удалён или закрыт), в выбор не попадает
            const bodies = await Promise.all(saved.slice(0, 50).map((id) => call('playlist', { id }, {}).catch((error: unknown) => {
                console.warn('Моя музыка: сохранённый плейлист не загружен', error);
                return null;
            })));
            for (const body of bodies) info(body, false);
            librarySources = lists;
        })().catch((error: unknown) => {
            librarySources = 'failed';
            console.warn('Моя музыка: плейлисты не загружены', error);
        }).finally(render);
    }
    const playlistName = (id: number): string =>
        (Array.isArray(librarySources) ? librarySources.find((list) => list.id === id)?.title : undefined) ?? playlistCache.get(id)?.title ?? '';
    // Слышанное за 3 дня для перемешивания: прослушивания в клиенте от 30 секунд и история сайта, туда попадает и телефон.
    // История не ответила: правило держится на журнале клиента
    let libraryHeardCache: { at: number; ids: Set<number> } | null = null;
    async function libraryHeard(): Promise<Set<number>> {
        if (libraryHeardCache && Date.now() - libraryHeardCache.at < 5 * 60000) return libraryHeardCache.ids;
        const since = Date.now() - 3 * 86400000;
        const ids = new Set<number>();
        const user = await ensureUser();
        try {
            const client = user ? await host.soundcloudAPI?.waveLibrary?.heard(user) : [];
            if (Array.isArray(client)) for (const id of client) if (isId(id)) ids.add(id);
        } catch (error) {
            console.warn('Моя музыка: слышанное в клиенте не прочитано', error);
        }
        try {
            let query: Record<string, string | number> | null = { limit: 200 };
            for (let page = 0; query && page < 5 && !core.disposed(); page++) {
                const body = await call('playHistoryTracks', {}, query);
                // Без played_at возраст записей не узнать: хватит первой страницы
                let older = false;
                let dated = false;
                for (const value of collection(body)) {
                    const entry = value as { played_at?: unknown; track?: unknown } | null;
                    const track = asTrack(entry?.track);
                    const at = typeof entry?.played_at === 'number' ? entry.played_at : 0;
                    if (at) dated = true;
                    if (at && at < since) older = true;
                    else if (track) ids.add(track.id);
                }
                query = older || !dated ? null : nextQuery(body);
            }
        } catch (error) {
            console.warn('Моя музыка: история сайта не загружена', error);
        }
        libraryHeardCache = { at: Date.now(), ids };
        return ids;
    }
    // Трек пула: всё, что можно послушать. «Не нравится», скрытые аккаунты и «Не сейчас» отсекаются, скрытые версии
    // семьи нет (свою библиотеку человек собрал сам), миксы длиннее 15 минут остаются, в отличие от волны
    const libraryKeeps = (track: WaveTrack): boolean =>
        (track.kind === undefined || track.kind === 'track') && track.streamable !== false && track.policy !== 'SNIP' && track.policy !== 'BLOCK' &&
        !disliked().has(track.id) && !excludedArtists.has(trackArtist(track)) && !marked(laterTracks, track.id) && !marked(laterArtists, trackArtist(track));
    // Пул по выбору целиком: весь каталог лайков от новых к старым и плейлисты в порядке сайта
    async function collectLibrary(pick: string[]): Promise<LibraryEntry<WaveTrack>[]> {
        const p = await ensureProfile();
        await ensureExclusions();
        const sources: Array<{ key: string; name: string; tracks: WaveTrack[] }> = [];
        for (const key of pick) {
            if (core.disposed()) break;
            if (key === 'likes') {
                try {
                    await expandLibrary(p);
                } catch (error) {
                    // Каталог собран, но не сохранился на диск: играем его. Не дошли страницы лайков: пул был бы неполным
                    if (p.likesCursor) throw error;
                    console.warn('Моя музыка: каталог лайков не сохранён', error);
                }
                const rank = new Map([...p.liked].map((id, index) => [id, index]));
                sources.push({ key, name: '', tracks: p.likedTracks.slice().sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)) });
                continue;
            }
            const id = Number(key.slice('playlist:'.length));
            let list = playlistCache.get(id);
            if (!list || Date.now() - list.at >= LIBRARY_TTL) {
                const loaded = await libraryPlaylist(id, call);
                list = { at: Date.now(), title: loaded.title, tracks: loaded.collection };
                playlistCache.set(id, list);
            }
            sources.push({ key, name: list.title || playlistName(id) || '…', tracks: list.tracks });
        }
        const pool = libraryPool(sources, libraryKeeps, copyKeys, copyKey, trackArtist);
        // Трек из нескольких источников пул берёт из первого по выбору, отметка тоже
        const keys = new Map<number, string>();
        for (const source of sources) for (const track of source.tracks) if (!keys.has(track.id)) keys.set(track.id, source.key);
        for (const entry of pool) {
            libraryFrom.set(entry.track.id, entry.from);
            librarySourceOf.set(entry.track.id, keys.get(entry.track.id) ?? '');
        }
        return pool;
    }
    async function orderLibrary(pool: LibraryEntry<WaveTrack>[], mode: LibraryMode): Promise<LibraryEntry<WaveTrack>[]> {
        const heard = mode === 'order' ? new Set<number>() : await libraryHeard();
        return libraryOrder(pool, mode, trackArtist, (track) => heard.has(track.id), Math.random);
    }
    // План игры для текущего выбора и режима. Собранный пул живёт 10 минут; fresh перемешивает заново уже сыгранный план
    function ensureLibraryPlan(fresh: boolean): Promise<void> {
        const pick = pickedSources();
        const mode = myMusic.mode;
        const key = planKey(pick, mode);
        const plan = libraryPlan;
        const alive = !!plan && Date.now() - plan.at < LIBRARY_TTL;
        if (plan && alive && plan.key === key && !(fresh && plan.used)) return Promise.resolve();
        if (libraryPlanPromise) return libraryPlanPromise;
        libraryPlanFailed = false;
        const run = (async () => {
            const samePool = !!plan && alive && plan.key.startsWith(pick.join(',') + '|');
            const pool = samePool && plan ? plan.pool : await collectLibrary(pick);
            const entries = await orderLibrary(pool, mode);
            // Выбор сменился, пока собирали: план для прежнего не нужен
            if (planKey(pickedSources(), myMusic.mode) !== key) return;
            libraryPlan = { key, at: samePool && plan ? plan.at : Date.now(), used: false, pool, entries };
            libraryShown = 100;
        })().catch((error: unknown) => {
            libraryPlanFailed = true;
            console.warn('Моя музыка: пул не собран', error);
        }).finally(() => {
            libraryPlanPromise = null;
            if (libraryListOpen && !libraryPlanFailed && libraryPlan?.key !== planKey(pickedSources(), myMusic.mode) && pickedSources().length) void ensureLibraryPlan(false);
            render();
        });
        libraryPlanPromise = run;
        render();
        return run;
    }
    // Волна от своей музыки: пул впереди похожего; fromId играет первым, дальше показанный план с него по кругу
    async function startLibrary(fromId = 0): Promise<void> {
        const pick = pickedSources();
        if (!pick.length) {
            showToast(T.libraryPick);
            return;
        }
        const request = core.nextSeedRequest();
        try {
            await Promise.all([ensureProfile(), ensureExclusions()]);
            await ensureLibraryPlan(!fromId);
            const plan = libraryPlan;
            const mode = myMusic.mode;
            if (request !== core.seedRequest() || core.disposed()) return;
            if (!plan || plan.key !== planKey(pick, mode)) {
                showToast(T.toastFailed);
                return;
            }
            const entries = plan.entries.filter((entry) => libraryKeeps(entry.track));
            if (!entries.length) {
                showToast(T.libraryEmpty);
                return;
            }
            const at = fromId ? entries.findIndex((entry) => entry.track.id === fromId) : -1;
            const first = at >= 0 ? entries[at].track : null;
            const own = (at >= 0 ? [...entries.slice(at + 1), ...entries.slice(0, at)] : entries).map((entry) => entry.track);
            plan.used = true;
            await beginSeed(request, {
                seed: { kind: 'library', title: libraryTitle(pick) || T.library, own, tracks: shuffleInPlace(plan.pool.map((entry) => entry.track)), order: mode === 'smart' ? 'smart' : 'fixed', mode: 'similar', library: { pick, mode } },
                first,
            });
        } catch (error) {
            if (request !== core.seedRequest()) return;
            console.warn('Моя музыка: не запустилась', error);
            showToast(T.toastFailed);
        }
    }
    // Сессия после перезапуска: пул собирается заново из каталога и плейлистов, дальше те же оставшиеся треки по порядку.
    // Не собрался: номера остаются в сессии, следующая попытка через 15 секунд
    async function resumeLibrary(current: Seed): Promise<void> {
        const library = current.library;
        if (!library?.left || Date.now() < libraryRetryAt) return;
        try {
            const pool = await collectLibrary(library.pick);
            if (core.seed() !== current || !library.left) return;
            const byId = new Map(pool.map((entry) => [entry.track.id, entry]));
            const rest = library.left.flatMap((id) => byId.get(id) ?? []);
            current.own = rest.map((entry) => entry.track);
            current.tracks = shuffleInPlace(pool.map((entry) => entry.track));
            delete library.left;
            libraryRetryAt = 0;
            // План играющей нужен смене выбора и режима; раньше его не было, если настройка разошлась с сессией,
            // и смена режима после перезапуска молча ничего не делала
            libraryPlan = { key: planKey(library.pick, library.mode), at: Date.now(), used: true, pool, entries: rest };
        } catch (error) {
            libraryRetryAt = Date.now() + 15000;
            console.warn('Моя музыка: пул из сессии не собран', error);
        }
    }
    const soundIds = (items: SiteQueueItem[]): number[] => items.flatMap((item) => (item.sound ? [item.sound.id] : []));
    // Смена выбора или режима во время игры: текущий трек доигрывает, впереди несыгранное из выбранного сейчас в новом
    // порядке, поставленное вручную остаётся. Пустой выбор очередь не трогает, пока не выбран новый источник
    async function rebuildLibrary(): Promise<void> {
        clearTimeout(rebuildTimer);
        const current = core.seed();
        const library = current?.library;
        const pick = pickedSources();
        const mode = myMusic.mode;
        if (!current || !library || !playingLibrary() || !pick.length) return;
        const request = ++rebuildRequest;
        rebuilding = true;
        render();
        try {
            const plan = libraryPlan;
            const samePool = !!plan && Date.now() - plan.at < LIBRARY_TTL && plan.key.startsWith(pick.join(',') + '|');
            const pool = samePool && plan ? plan.pool : await collectLibrary(pick);
            const ordered = await orderLibrary(pool, mode);
            if (request !== rebuildRequest || core.seed() !== current || !core.active()) return;
            // Очередь смотрим после ожидания: трек мог смениться, пока собирали
            const { items, index } = queueView();
            const played = new Set(soundIds(items.slice(0, index + 1)));
            const ahead = soundIds(items.slice(index + 1).filter((item) => ours.has(item)));
            const entries = ordered.filter((entry) => !played.has(entry.track.id));
            library.pick = pick;
            library.mode = mode;
            delete library.left;
            current.title = libraryTitle(pick) || T.library;
            current.order = mode === 'smart' ? 'smart' : 'fixed';
            current.own = entries.filter((entry) => libraryKeeps(entry.track)).map((entry) => entry.track);
            current.tracks = shuffleInPlace(pool.map((entry) => entry.track));
            libraryPlan = { key: planKey(pick, mode), at: samePool && plan ? plan.at : Date.now(), used: true, pool, entries };
            libraryShown = 100;
            resetGeneration();
            // Стоявшие впереди треки пула уходят из очереди вместе со старым выбором и снова доступны новому
            for (const id of ahead) core.untake(id);
            await restartAhead();
        } catch (error) {
            if (request !== rebuildRequest) return;
            console.warn('Моя музыка: очередь не пересобрана', error);
            showToast(T.toastFailed);
        } finally {
            if (request === rebuildRequest) {
                rebuilding = false;
                render();
            }
        }
    }
    // Играет «Моя музыка»: кнопка ставит её на паузу, выбор и режим меняют её на ходу
    function playingLibrary(): boolean {
        const seed = core.seed();
        return !!seed && seed.kind === 'library' && core.active() && !!seed.library;
    }
    // План, который показывает список: у играющей «Моей музыки» её собственный, иначе для текущего выбора и режима
    function shownPlan(): typeof libraryPlan {
        const library = playingLibrary() ? core.seed()?.library : undefined;
        const keys = [planKey(pickedSources(), myMusic.mode), ...(library ? [planKey(library.pick, library.mode)] : [])];
        return libraryPlan && keys.includes(libraryPlan.key) ? libraryPlan : null;
    }
    function libraryRowClick(id: number): void {
        const player = core.player();
        const item = player && playingLibrary() ? player.getQueue().slice().find((entry) => ours.has(entry) && entry.sound?.id === id) : undefined;
        if (item && player) {
            core.jumped();
            player.setCurrentItem(item, {});
            if (!player.isPlaying()) player.playCurrent({ userInitiated: true });
            setTimeout(render, 150);
        } else void startLibrary(id);
    }
    // Выбор источников: список в две колонки, выбранное подсвечено; точка у источника, из которого играет трек
    function sourcesPanel(pick: string[], mine: boolean): HTMLElement {
        const panel = el('div', 'scw-lib-pick');
        panel.setAttribute('role', 'group');
        panel.setAttribute('aria-label', T.librarySources);
        const current = mine ? core.player()?.getCurrentSound()?.id ?? 0 : 0;
        const here = current ? librarySourceOf.get(current) ?? '' : '';
        const option = (key: string, label: string, count: number): void => {
            const node = el('button', 'scw-lib-opt');
            node.type = 'button';
            node.dataset.act = 'lib-source';
            node.dataset.source = key;
            node.setAttribute('aria-pressed', String(pick.includes(key)));
            const name = el('span', 'scw-lib-name', label);
            if (key === here) {
                name.classList.add('scw-lib-here');
                name.title = T.libraryHere;
                node.setAttribute('aria-description', T.libraryHere);
            }
            node.append(name);
            if (count) node.append(el('span', 'scw-chip-n', String(count)));
            panel.append(node);
        };
        option('likes', T.libraryLikes, core.profile()?.liked.size ?? 0);
        if (Array.isArray(librarySources)) for (const list of librarySources) option('playlist:' + list.id, list.title, list.count);
        else if (librarySources === 'failed') panel.append(el('span', 'scw-hint', T.libraryFailed), textButton('lib-retry', T.retry));
        else panel.append(el('span', 'scw-hint', T.libraryLoading));
        return panel;
    }
    // «Моя музыка» над подборками одной строкой: «Слушать» или пауза, что выбрано, режим, источники и список пула
    function renderLibrary(): HTMLElement[] {
        const state = core.state();
        if (state === 'unavailable' || !host.soundcloudAPI?.waveLibrary) return [];
        void ensureMyMusic();
        // Плейлисты для выбора спрашиваются после первой подборки волны, чтобы не спорить с ней за ответы сайта
        if (librarySources === null && (state !== 'loading' || core.active())) ensureLibrarySources();
        const pick = pickedSources();
        const box = el('div', 'scw-lib');
        box.setAttribute('role', 'region');
        box.setAttribute('aria-label', T.library);
        const head = el('div', 'scw-mix-head');
        const mine = playingLibrary();
        const playing = mine && !!core.player()?.isPlaying();
        const play = button('scw-mix-play', 'lib-play', playing ? T.pause : T.libraryPlay, playing ? 'pause' : 'play');
        play.title = playing ? T.pause : T.libraryPlay;
        play.disabled = !pick.length && !mine;
        const titles = el('div', 'scw-mix-title');
        const plan = shownPlan();
        const count = plan ? countText(plan.entries.filter((entry) => libraryKeeps(entry.track)).length, T.tracksCount, T.lang) : '';
        const now = playing ? T.libraryPlaying : T.libraryPaused;
        const status = el('span', '', rebuilding || libraryPlanPromise ? T.libraryBuilding : mine ? (count ? now + ', ' + count : now) : count);
        status.setAttribute('role', 'status');
        // Все источники сняты во время игры: доигрывает прежний выбор, пока не выбран новый
        const title = pick.length ? libraryTitle(pick) : mine ? core.seed()?.title ?? '' : '';
        titles.append(el('b', '', title || T.libraryPick), status);
        const seg = el('div', 'scw-seg');
        seg.setAttribute('role', 'radiogroup');
        seg.setAttribute('aria-label', T.libraryModes);
        const modes: Array<[LibraryMode, string, string]> = [['order', T.libraryOrder, T.libraryOrderTip], ['shuffle', T.libraryShuffle, T.libraryShuffleTip], ['smart', T.librarySmart, T.librarySmartTip]];
        for (const [value, label, tip] of modes) {
            const option = el('button', '', label);
            option.type = 'button';
            option.setAttribute('role', 'radio');
            option.setAttribute('aria-checked', String(myMusic.mode === value));
            option.setAttribute('aria-description', tip);
            option.dataset.act = 'lib-mode';
            option.dataset.lmode = value;
            option.dataset.tip = tip;
            seg.append(option);
        }
        const sources = textButton('lib-sources', T.librarySources);
        sources.setAttribute('aria-expanded', String(librarySourcesOpen));
        const list = textButton('lib-list', T.libraryList);
        list.setAttribute('aria-expanded', String(libraryListOpen));
        head.append(play, titles, seg, sources, list);
        box.append(head);
        if (librarySourcesOpen) box.append(sourcesPanel(pick, mine));
        if (libraryListOpen) box.append(libraryRows(plan));
        return [el('div', 'scw-shelf-h', T.library), box];
    }
    function libraryRows(plan: typeof libraryPlan): HTMLElement {
        const hint = (text: string): HTMLElement => {
            const line = el('div', 'scw-hint', text);
            line.setAttribute('role', 'status');
            return line;
        };
        if (!pickedSources().length && !plan) return hint(T.libraryPick);
        if (!plan) {
            if (libraryPlanPromise || !libraryPlanFailed) return hint(T.libraryBuilding);
            const failed = el('div', 'scw-shelf-error');
            failed.append(hint(T.toastFailed), textButton('lib-rebuild', T.retry));
            return failed;
        }
        const entries = plan.entries.filter((entry) => libraryKeeps(entry.track));
        if (!entries.length) return hint(T.libraryEmpty);
        const rows = el('div', 'scw-lib-rows');
        const now = core.active() ? core.player()?.getCurrentSound()?.id ?? 0 : 0;
        for (const entry of entries.slice(0, libraryShown)) {
            const { row, end } = trackRow(entry.track, now);
            end.append(el('span', 'scw-row-d', formatTime(entry.track.full_duration || entry.track.duration || 0)));
            rows.append(row);
        }
        if (entries.length > libraryShown) {
            const more = textButton('lib-more', T.libraryMore);
            more.classList.add('scw-lib-more');
            rows.append(more);
        }
        return rows;
    }
    // Кнопки блока на главной: выбор источников, источник, режим, «Слушать», список, «Показать ещё» и повторы
    function libraryClick(control: HTMLElement): void {
        switch (control.dataset.act) {
            case 'lib-source':
                toggleLibrarySource(control.dataset.source ?? '');
                return;
            case 'lib-mode':
                if (isLibraryMode(control.dataset.lmode)) setLibraryMode(control.dataset.lmode);
                return;
            case 'lib-play': {
                const player = core.player();
                // Играющая «Моя музыка» из текущего выбора: пауза и продолжение, как большая кнопка
                if (playingLibrary() && player) {
                    if (player.isPlaying()) player.pauseCurrent({ userInitiated: true });
                    else player.playCurrent({ userInitiated: true });
                    setTimeout(render, 150);
                } else void startLibrary();
                return;
            }
            case 'lib-sources':
                librarySourcesOpen = !librarySourcesOpen;
                render();
                return;
            case 'lib-list':
                libraryListOpen = !libraryListOpen;
                core.resetLibraryScroll();
                if (libraryListOpen && pickedSources().length) void ensureLibraryPlan(false);
                render();
                return;
            case 'lib-more':
                libraryShown += 100;
                render();
                return;
            case 'lib-retry':
                librarySources = null;
                ensureLibrarySources();
                render();
                return;
            case 'lib-rebuild':
                void ensureLibraryPlan(false);
                return;
        }
    }
    return {
        render: renderLibrary,
        click: libraryClick,
        rowClick: libraryRowClick,
        resume: resumeLibrary,
        sourceName: (id) => libraryFrom.get(id) ?? '',
        poolTrack: (id) => libraryPlan?.pool.find((entry) => entry.track.id === id)?.track,
    };
}
