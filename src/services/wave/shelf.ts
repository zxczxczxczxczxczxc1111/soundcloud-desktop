// Подборки на полке: находки дня, «Давно не слушал», жанры из вкуса; набор треков из меню. Здесь же полка на главной:
// карточки подборок и радара, раскрытый список подборки. Раздел страницы волны: installShelf уходит на страницу текстом
// вместе с волной (pageHelpers в wave.ts) и зовёт помощников по голому имени, поэтому импорт через пространство имён
// и разбор в константы. Снимок полки, её треки и набор раздел держит сам; всё, что он берёт у ядра, приходит объектом core
import * as identity from '../trackIdentity';
import * as waveLinks from '../waveLinks';
import * as wavePicks from '../wavePicks';
import * as waveTaste from '../waveTaste';
import * as waveTexts from '../waveTexts';
import * as sourcesModule from './sources';
import type { RadarCard } from './radar';
import type { ScMix } from './sources';
import type { MenuTarget, Profile, Seed, TasteMaps, WaveReason, WaveState, WaveTexts, WaveTrack } from '../waveTypes';
import type { SitePlayer, WaveWindow } from '../wave';

const { confirmedCopies } = identity;
const { canonicalUrl, coversOf, retryDelay } = waveLinks;
const { capPerArtist, daySample, forgottenPicks, isWaveEligible, shuffleInPlace } = wavePicks;
const { pickFinds, tasteGroups, tasteOrder, tasteScore } = waveTaste;
const { countText, fillText, formatTime, localDay } = waveTexts;
const { interleaveMixes, likedOwner } = sourcesModule;

export interface ShelfCore {
    texts: WaveTexts;
    host: WaveWindow;
    /** Номер карточки «Новые загрузки» радара: у неё свой тон */
    uploadsCard: number;
    isRadarCard(index: number | null | undefined): boolean;
    state(): WaveState;
    active(): boolean;
    disposed(): boolean;
    player(): SitePlayer | null;
    seed(): Seed | null;
    /** Номер последнего запуска подборки: запуск, начатый позже, отменяет прежний */
    seedRequest(): number;
    nextSeedRequest(): number;
    /** Полка сменилась: играющая волна больше не привязана к карточке подборки (false) или радара (true) */
    releaseCard(radar: boolean): void;
    /** Раскрытая под полкой карточка, общая для подборок и радара */
    openCard(): number | null;
    /** Раскрыть карточку под полкой или свернуть; раскрытая начинает список сверху */
    showCard(index: number | null): void;
    copyGroups(): Map<string, string>;
    /** Профиль вкуса из main и отказ его получить */
    taste(): TasteMaps | null;
    tasteFailed(): boolean;
    /** Карточки радара и его раскрытый выпуск: полка рисует их рядом с подборками */
    radarCards(): RadarCard[];
    radarMix(index: number): HTMLElement;
    isExcluded(track: WaveTrack): boolean;
    artistName(track: WaveTrack): string;
    paintArt(node: HTMLElement, url: string, key: string): void;
    tracksOf(body: unknown): WaveTrack[];
    trackOf(target: MenuTarget): Promise<WaveTrack | null>;
    beginSeed(request: number, loaded: { seed: Seed; first: WaveTrack | null }): Promise<void>;
    ensureProfile(): Promise<Profile>;
    expandLibrary(current: Profile): Promise<void>;
    ensureExclusions(): Promise<void>;
    ensureTaste(): Promise<void>;
    ensureUser(): Promise<number>;
    call(name: string, path: object, query: object): Promise<unknown>;
    /** Подборки SoundCloud на сегодня; пусто, если сайт не ответил */
    scMixes(): Promise<ScMix[]>;
    /** Свежие лайки соседей по вкусу из кэша; fresh зовётся, когда первый обход соседей нашёл лайки (П14) */
    neighbors(seeds: number[], fresh: () => void): Promise<Array<{ id: number; count: number }>>;
    render(): void;
    showToast(text: string): void;
    el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K];
    button(className: string, act: string, label: string, icon?: string): HTMLButtonElement;
    textButton(act: string, label: string): HTMLButtonElement;
    trackRow(track: WaveTrack, now: number): { row: HTMLDivElement; end: HTMLDivElement };
}
/** Что раздел отдаёт ядру, блоку на главной, радару и меню */
export interface ShelfSection {
    render(): HTMLElement[];
    /** Снимок дня или новая сборка; soon: страница снова видна, повтор не раньше 30 с от сбоя */
    ensure(soon?: boolean): void;
    /** Сборка упала и ждёт повтора */
    failed(): boolean;
    /** Повтор без паузы: нажали «Повторить» или страница восстановилась */
    resetFailures(): void;
    /** Нажатие на карточку подборки: раскрыть список под полкой или свернуть */
    toggle(index: number): void;
    /** Волна от карточки; fromId это трек из раскрытого списка, с которого начать */
    start(index: number, fromId?: number): Promise<void>;
    /** Трек сыгран: из «Давно не слушал» он запоминается на сутки, повторный запуск начнёт дальше (П11) */
    notePlayed(id: number): void;
    /** Треки по номерам через trackBatch с кэшем полки */
    tracksByIds(ids: number[]): Promise<WaveTrack[]>;
    track(id: number): WaveTrack | undefined;
    /** Жанры карточки полки по её номеру через запятую; пусто у находок, «Давно не слушал» и радара */
    genreOf(index: number): string;
    /** Набор из меню: треки, место трека в нём, добавить или убрать, волна по набору, очистка */
    picks(): readonly WaveTrack[];
    pickedIndex(target: MenuTarget): number;
    pick(target: MenuTarget, add: boolean): Promise<void>;
    startPicks(): void;
    clearPicks(): void;
}

export function installShelf(core: ShelfCore): ShelfSection {
    const {
        texts: T, host, uploadsCard: UPLOADS_CARD, isRadarCard, radarCards, radarMix, isExcluded, artistName, paintArt, tracksOf, trackOf, beginSeed, ensureProfile,
        expandLibrary, ensureExclusions, ensureTaste, ensureUser, call, render, showToast, el, button, textButton, trackRow,
    } = core;
    const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
    // by у «Лайкнули твои артисты»: чей лайк у трека, по порядку ids; neighbors у находок: треки от соседей по вкусу
    interface ShelfCard {
        kind: 'daily' | 'forgotten' | 'liked' | 'group'; title: string; sub: string; ids: number[]; seeds: number[]; keys: string[]; art: string[]; by: string[]; neighbors: number[];
    }
    interface Shelf { day: string; v: number; cards: ShelfCard[] }
    // Формат сборки полки: 2 это жанры из всех лайков и прослушанного, до восьми, с поджанрами (26.09.2026);
    // 3 это группа по жанру трека, а не по меткам, и не больше SHELF_ARTIST_CAP треков артиста в карточке (26.09.2026);
    // 4 это выборка дня в «Давно не слушал» и жанрах (28.09.2026); 5 это вес любви в «Давно не слушал» и карточка
    // «Лайкнули твои артисты» (02.10.2026).
    // Снимок другого формата собирается заново сразу, а не в полночь
    const SHELF_FORMAT = 5;
    const SHELF_ARTIST_CAP = 5;
    // Прослушанное от 30 секунд из индекса истории: main отдаёт его вместе со снимком
    interface HeardTrack { id: number; artist: number; title: string; artistName: string; genre: string; tags: string; path: string; artwork: string; dur: number; share?: number }
    // Счётчики любви к треку за год из main (П11)
    type LovedTrack = HeardTrack & { done: number; early: number; loops: number };
    let shelf: Shelf | null = null;
    let shelfPromise: Promise<void> | null = null;
    let shelfFailedAt = 0;
    let shelfFailures = 0;
    // Полка собрана без модели вкуса (main не ответил): показана, но не сохранена и через 10 минут собирается заново
    let shelfRetryAt = 0;
    // Треки подборок по id: снимок хранит только номера, названия и обложки добирает trackBatch
    const shelfTracks = new Map<number, WaveTrack>();
    const picks: WaveTrack[] = [];
    const PICKS_MAX = 5;
    // Набор переживает перезагрузку страницы (F5, Ctrl+R), но не перезапуск клиента: он живёт в sessionStorage вкладки
    const PICKS_KEY = 'scDesktopWavePicks';
    try {
        const saved: unknown = JSON.parse(sessionStorage.getItem(PICKS_KEY) || '[]');
        if (Array.isArray(saved))
            for (const value of saved.slice(0, PICKS_MAX)) {
                const track = value && typeof value === 'object' && isId((value as { id?: unknown }).id) ? (value as WaveTrack) : null;
                if (track && isWaveEligible(track) && !picks.some((item) => item.id === track.id)) picks.push(track);
            }
    } catch (error) {
        console.warn('Волна: набор не прочитан', error);
    }
    // П11: сыгранное из «Давно не слушал» за сутки полки: повторный запуск начинает с первого несыгранного
    const PLAYED_KEY = 'scDesktopWaveForgottenPlayed';
    function forgottenPlayed(day: string): Set<number> {
        try {
            const saved: unknown = JSON.parse(localStorage.getItem(PLAYED_KEY) || 'null');
            const entry = saved && typeof saved === 'object' ? (saved as { day?: unknown; ids?: unknown }) : null;
            return entry?.day === day && Array.isArray(entry.ids) ? new Set(entry.ids.filter(isId).slice(0, 500)) : new Set();
        } catch (error) {
            console.warn('Волна: сыгранное из «Давно не слушал» не прочитано', error);
            return new Set();
        }
    }
    function saveForgottenPlayed(day: string, ids: Set<number>): void {
        try {
            if (ids.size) localStorage.setItem(PLAYED_KEY, JSON.stringify({ day, ids: [...ids].slice(-500) }));
            else localStorage.removeItem(PLAYED_KEY);
        } catch (error) {
            console.warn('Волна: сыгранное из «Давно не слушал» не сохранено', error);
        }
    }
    function notePlayed(id: number): void {
        const current = core.seed();
        const card = current?.card !== undefined ? shelf?.cards[current.card] : undefined;
        if (!shelf || current?.kind !== 'forgotten' || card?.kind !== 'forgotten' || !card.ids.includes(id)) return;
        const played = forgottenPlayed(shelf.day);
        if (played.has(id)) return;
        played.add(id);
        saveForgottenPlayed(shelf.day, played);
    }
    function savePicks(): void {
        try {
            if (picks.length) sessionStorage.setItem(PICKS_KEY, JSON.stringify(picks));
            else sessionStorage.removeItem(PICKS_KEY);
        } catch (error) {
            console.warn('Волна: набор не сохранён', error);
        }
    }
    // Треки раскрытых подборок по номеру карточки; у радара свой такой же список
    const mixLists = new Map<number, WaveTrack[] | 'loading' | 'failed'>();

    // Снимок из main уже проверен там; здесь только форма, чтобы не упасть на чужом
    function asShelf(value: unknown): Shelf | null {
        const source = value as { day?: unknown; cards?: unknown } | null;
        if (!source || typeof source.day !== 'string' || !Array.isArray(source.cards)) return null;
        const strings = (list: unknown): string[] => (Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []);
        const ids = (list: unknown): number[] => (Array.isArray(list) ? list.filter(isId) : []);
        const cards: ShelfCard[] = [];
        for (const item of source.cards as unknown[]) {
            const card = item as Record<string, unknown> | null;
            if (!card || (card.kind !== 'daily' && card.kind !== 'forgotten' && card.kind !== 'liked' && card.kind !== 'group')) continue;
            const entry: ShelfCard = {
                kind: card.kind, title: typeof card.title === 'string' ? card.title : '', sub: typeof card.sub === 'string' ? card.sub : '',
                ids: ids(card.ids), seeds: ids(card.seeds), keys: strings(card.keys), art: strings(card.art),
                // Имена идут парой к номерам: нестроку заменяет пустая, а не выбрасывает, иначе пары сдвинутся
                by: Array.isArray(card.by) ? card.by.map((name: unknown) => (typeof name === 'string' ? name : '')) : [],
                neighbors: ids(card.neighbors),
            };
            if (entry.ids.length) cards.push(entry);
        }
        return { day: source.day, v: typeof (source as { v?: unknown }).v === 'number' ? (source as { v: number }).v : 1, cards };
    }
    async function tracksByIds(ids: number[]): Promise<WaveTrack[]> {
        const missing = [...new Set(ids)].filter((id) => !shelfTracks.has(id));
        const parts: number[][] = [];
        for (let i = 0; i < missing.length; i += 50) parts.push(missing.slice(i, i + 50));
        let failed = 0;
        await Promise.all(parts.map((part) =>
            call('trackBatch', {}, { ids: part.join(',') }).then((body) => {
                for (const track of tracksOf(body)) shelfTracks.set(track.id, track);
            }).catch((error: unknown) => {
                failed++;
                console.warn('Волна: треки подборки не загружены', error);
            })));
        if (parts.length && failed === parts.length) throw new Error('Треки подборки не загружены');
        return ids.map((id) => shelfTracks.get(id)).filter((track): track is WaveTrack => !!track);
    }
    const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

    // Трек из индекса истории для жанров полки: доступность и обложку перепроверяет trackBatch при раскрытии карточки
    const heardTrack = (entry: HeardTrack): WaveTrack => ({
        id: entry.id, kind: 'track', title: entry.title, genre: entry.genre, tag_list: entry.tags, duration: entry.dur, full_duration: entry.dur,
        user_id: entry.artist || undefined, user: { id: entry.artist || undefined, username: entry.artistName },
        permalink_url: entry.path ? 'https://soundcloud.com' + entry.path : '', artwork_url: entry.artwork || null,
    });
    function asHeard(list: unknown): HeardTrack[] {
        if (!Array.isArray(list)) return [];
        const text = (value: unknown): string => (typeof value === 'string' ? value : '');
        return list.flatMap((value): HeardTrack[] => {
            const item = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
            if (!item || !isId(item.id)) return [];
            return [{ id: item.id, artist: isId(item.artist) ? item.artist : 0, title: text(item.title), artistName: text(item.artistName), genre: text(item.genre), tags: text(item.tags), path: text(item.path), artwork: text(item.artwork), dur: typeof item.dur === 'number' ? item.dur : 0,
                ...(typeof item.share === 'number' && item.share > 0 && item.share <= 1 ? { share: item.share } : {}) }];
        });
    }
    function asLove(list: unknown): LovedTrack[] {
        if (!Array.isArray(list)) return [];
        const count = (value: unknown): number => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0);
        const heard = new Map(asHeard(list).map((entry) => [entry.id, entry]));
        return list.flatMap((value): LovedTrack[] => {
            const item = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
            const entry = item && isId(item.id) ? heard.get(item.id) : undefined;
            return item && entry ? [{ ...entry, done: count(item.done), early: count(item.early), loops: count(item.loops) }] : [];
        });
    }
    // Подборки на сутки: все лайки из каталога, вкус из main, похожие на любимое.
    // recentMain это прослушанное за 30 дней по журналу клиента, история сайта помнит только последние 200;
    // heardMain это прослушанное от 30 секунд за 90 дней и треки плейлистов с жанром и тегами для жанров полки;
    // freshLikes это лайки за 30 дней по датам библиотеки
    async function buildShelf(day: string, recentMain: number[], heardMain: HeardTrack[], freshLikes: number[], loved: LovedTrack[] = []): Promise<Shelf> {
        const p = await ensureProfile();
        await expandLibrary(p);
        await Promise.all([ensureExclusions(), ensureTaste()]);
        const taste = core.taste();
        // Подборки SoundCloud грузятся, пока ищутся находки: им нужен свой запрос к сайту
        const mixesLoad = core.scMixes();
        shelfTracks.clear();
        // Каталог лайков полный после expandLibrary: сеть для подборок не нужна, выборки больше нет
        for (const track of p.likedTracks) shelfTracks.set(track.id, track);
        const liked = p.likedTracks.filter((track) => isWaveEligible(track) && !isExcluded(track));
        const cards: ShelfCard[] = [];
        const weights = taste?.tracks ?? null;

        // Находки дня: неслышанные записи из похожих на восемь любимых; знакомый аккаунт не исключается
        const seedPool = taste ? tasteOrder(liked.map((track) => ({ track })), taste).map((entry) => entry.track) : shuffleInPlace(liked.slice());
        // Восемь зёрен от восьми разных артистов, если столько набирается
        const distinct = capPerArtist(seedPool, 1);
        const daySeeds = [...distinct, ...seedPool.filter((track) => !distinct.includes(track))].slice(0, 8);
        const candidates: WaveTrack[] = [];
        await Promise.all(daySeeds.map((from) =>
            call('relatedSounds', { track_id: from.id }, { limit: 50 }).then((body) => {
                candidates.push(...tracksOf(body));
            }).catch((error: unknown) => console.warn('Волна: похожие для находок не загружены', error))));
        // Слышанное и лайкнутое вместе с подтверждёнными копиями: перезалив той же записи не находка
        const known = confirmedCopies([...p.heard, ...p.liked], core.copyGroups());
        // Соседи по вкусу (П14): до трети находок из свежих лайков тех, кто лайкает то же нишевое, что и ты. Больше соседей
        // с лайком выше, при равенстве вкус; не больше двух треков артиста. Обход идёт от лайков по вкусу и дослушанного
        // от двух раз; первый готовый обход пересобирает сегодняшнюю полку
        const lovedSeeds = loved.filter((entry) => entry.done >= 2 && !p.liked.has(entry.id)).sort((a, b) => b.done - a.done).slice(0, 50).map((entry) => entry.id);
        const neighborList = (await core.neighbors([...seedPool.slice(0, 100).map((track) => track.id), ...lovedSeeds], neighborsReady)).filter((entry) => !known.has(entry.id)).slice(0, 40);
        let fromNeighbors: WaveTrack[] = [];
        if (neighborList.length)
            try {
                const count = new Map(neighborList.map((entry) => [entry.id, entry.count]));
                const usable = (await tracksByIds(neighborList.map((entry) => entry.id))).filter((track) => isWaveEligible(track) && !isExcluded(track));
                const score = new Map(usable.map((track) => [track.id, taste ? tasteScore(track, taste).score : 0]));
                usable.sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0) || (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0));
                fromNeighbors = capPerArtist(usable, 2).slice(0, 10);
            } catch (error) {
                console.warn('Волна: лайки соседей для находок не загружены', error);
            }
        const neighborIds = new Set(fromNeighbors.map((track) => track.id));
        const related = pickFinds(candidates, (track) => isExcluded(track) || known.has(track.id) || neighborIds.has(track.id), taste, 30 - fromNeighbors.length);
        // Соседи встают каждым третьим: два из похожих, один от соседей; кончились одни, дальше другие
        const finds: WaveTrack[] = [];
        for (let i = 0, r = 0, n = 0; r < related.length || n < fromNeighbors.length; i++)
            finds.push((i % 3 === 2 && n < fromNeighbors.length) || r >= related.length ? fromNeighbors[n++] : related[r++]);
        for (const track of finds) shelfTracks.set(track.id, track);
        if (finds.length >= 10)
            cards.push({ kind: 'daily', title: '', sub: '', ids: finds.map((track) => track.id), seeds: daySeeds.map((track) => track.id), keys: [], art: coversOf(finds), by: [], neighbors: [...neighborIds] });

        // «Лайкнули твои артисты» (П13): подборки SoundCloud «<артист>'s Picks» по кругу, по треку от каждого, до 60.
        // Слышанное и лайкнутое, как у находок, не берётся: волна подборки идёт в режиме «Новое» и пропустила бы его.
        // Скрытое тоже; у трека запоминается, чей это лайк
        const likedOrder = interleaveMixes((await mixesLoad).filter((mix) => mix.kind === 'liked'), ['liked']).filter((entry) => !known.has(entry.id)).slice(0, 150);
        if (likedOrder.length >= 8)
            try {
                const byId = new Map((await tracksByIds(likedOrder.map((entry) => entry.id))).map((track) => [track.id, track]));
                const owners = new Map(likedOrder.map((entry) => [entry.id, likedOwner(entry.mix.title)]));
                const usable = likedOrder.flatMap((entry) => {
                    const track = byId.get(entry.id);
                    return track && isWaveEligible(track) && !isExcluded(track) ? [track] : [];
                });
                const picked = capPerArtist(usable, SHELF_ARTIST_CAP).slice(0, 60);
                if (picked.length >= 8) {
                    const by = picked.map((track) => owners.get(track.id) ?? '');
                    // Подпись: до трёх артистов, чьих лайков в карточке больше
                    const counts = new Map<string, number>();
                    for (const name of by) if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
                    const sub = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name).join(', ');
                    cards.push({ kind: 'liked', title: '', sub, ids: picked.map((track) => track.id), seeds: [], keys: [], art: coversOf(picked), by, neighbors: [] });
                }
            } catch (error) {
                console.warn('Волна: треки «Лайкнули твои артисты» не загружены', error);
            }

        // «Давно не слушал» по истории конкретной версии; другая загрузка засчитывается только подтверждённой связью.
        // Лайк за 30 дней не забыт: его слушали, когда лайкали, хоть и не в клиенте, а свежий лайк весит во вкусе
        // больше всех и иначе встал бы в начало подборки
        // Вес любви по счётчикам за год (П11); любимое без лайка от трёх дослушиваний тоже идёт
        const love = new Map(loved.map((entry) => [entry.id, entry]));
        const lovedTracks = loved.filter((entry) => entry.done >= 3 && !p.liked.has(entry.id)).map(heardTrack).filter((track) => isWaveEligible(track) && !isExcluded(track));
        const forgotten = forgottenPicks(liked, confirmedCopies([...p.recent, ...recentMain, ...freshLikes], core.copyGroups()), weights, 60, day, love, lovedTracks);
        for (const track of forgotten) if (!shelfTracks.has(track.id)) shelfTracks.set(track.id, track);
        if (forgotten.length >= 8) cards.push({ kind: 'forgotten', title: '', sub: '', ids: forgotten.map((track) => track.id), seeds: [], keys: [], art: coversOf(forgotten), by: [], neighbors: [] });

        // До 8 жанров, все видны (решение владельца 26.09.2026). Лайк весит 1 плюс вкус, прослушанное без лайка только
        // своим положительным весом во вкусе (трек плейлиста его получает из плейлиста): пропущенное туда не попадает
        const likedSet = new Set(liked.map((track) => track.id));
        const listened = heardMain.flatMap((entry) => {
            // Трек плейлиста весит своей долей лайка напрямую: вкус хранит тысячу самых весомых треков, слабые плейлистные
            // из него выпадают. Минус во вкусе (пропускал, не нравится) всё равно убирает трек
            const fromTaste = weights?.get(entry.id) ?? 0;
            const weight = fromTaste < 0 ? fromTaste : Math.max(fromTaste, entry.share ?? 0);
            if (weight <= 0 || likedSet.has(entry.id) || p.liked.has(entry.id)) return [];
            const track = heardTrack(entry);
            return isWaveEligible(track) && !isExcluded(track) ? [{ track, weight }] : [];
        });
        const tasted = [...liked.map((track) => ({ track, weight: 1 + Math.max(0, weights?.get(track.id) ?? 0) })), ...listened];
        const tastedWeight = new Map(tasted.map((entry) => [entry.track.id, entry.weight]));
        const groups = tasteGroups(tasted, 8, 8);
        const artistTotal = new Map<string, number>();
        for (const { track } of tasted) {
            const name = artistName(track).trim();
            if (name) artistTotal.set(name, (artistTotal.get(name) ?? 0) + 1);
        }
        for (const group of groups) {
            const [a, b] = group.labels.map(capital);
            const artists = new Map<string, number>();
            for (const track of group.tracks) {
                const name = artistName(track).trim();
                if (name) artists.set(name, (artists.get(name) ?? 0) + 1);
            }
            // В подписи те, кто характерен для жанра: треков здесь, помноженное на долю здесь от всех его треков, не меньше 1.
            // Самый лайкнутый артист, у которого тут 4 трека из 72, не лезет в подпись каждой карточки.
            // Артист с одним треком подпись не делает; никто не прошёл - подпись по числу треков, как раньше
            const typical = (name: string, count: number): number => (count * count) / (artistTotal.get(name) ?? count);
            const strong = [...artists].filter(([name, count]) => count >= 2 && typical(name, count) >= 1);
            const sub = (strong.length ? strong : [...artists]).sort((x, y) => typical(y[0], y[1]) - typical(x[0], x[1]) || y[1] - x[1]).slice(0, 3).map(([name]) => name);
            // Каждый день своя выборка жанра с весом по вкусу, а не одни и те же первые 60 (решение владельца 28.09.2026)
            const daily = daySample(group.tracks, (track) => track.id, (track) => tastedWeight.get(track.id) ?? 1, group.tracks.length, day + ':' + group.keys.join(','));
            const shown = capPerArtist(daily, SHELF_ARTIST_CAP).slice(0, 60);
            cards.push({
                kind: 'group',
                title: b ? fillText(T.groupAnd, { a, b }) : a,
                sub: sub.join(', '),
                ids: shown.map((track) => track.id),
                seeds: [],
                keys: group.keys,
                art: coversOf(shown),
                by: [],
                neighbors: [],
            });
        }
        return { day, v: SHELF_FORMAT, cards };
    }
    // Первый обход соседей по вкусу готов (П14): сегодняшняя полка собирается заново, чтобы находки получили их лайки
    // не завтра, а сразу. Играющие находки не трогаются
    function neighborsReady(): void {
        const current = core.seed();
        if (!shelf || shelf.day !== localDay(Date.now()) || (current?.kind === 'daily' && core.active())) return;
        shelfRetryAt = 1;
        ensureShelf();
    }
    // Снимок дня или новая сборка; после сбоя сохраняем видимую ошибку, повтор всё реже (retryDelay).
    // Скрытая страница не собирает: блок проверяет только себя, и в трее сборка повторялась бы впустую.
    // soon: страница снова видна, повтор не раньше 30 с от сбоя без долгой паузы
    function ensureShelf(soon = false): void {
        const bridge = host.soundcloudAPI?.waveShelf;
        const day = localDay(Date.now());
        if (!bridge || shelfPromise || document.visibilityState === 'hidden') return;
        if ((shelf && shelf.day === day && (!shelfRetryAt || Date.now() < shelfRetryAt)) || Date.now() - shelfFailedAt < (soon ? retryDelay(1) : retryDelay(shelfFailures))) return;
        // Полка прошлых суток сменилась: номер карточки у играющей волны больше ни на что не указывает
        // Карточки радара от полки не зависят и остаются как были
        const replace = (next: Shelf): void => {
            if (shelf) core.releaseCard(false);
            shelf = next;
            shelfFailedAt = 0;
            shelfFailures = 0;
            if (!isRadarCard(core.openCard())) core.showCard(null);
            for (const index of [...mixLists.keys()]) if (!isRadarCard(index)) mixLists.delete(index);
        };
        shelfPromise = (async () => {
            const id = await ensureUser();
            if (!id) throw new Error('Пользователь не определён');
            const loaded = (await bridge.load(id)) as { snapshot?: unknown; recent?: unknown; heard?: unknown; playlists?: unknown; fresh?: unknown; love?: unknown } | null;
            const saved = asShelf(loaded?.snapshot);
            if (saved && saved.day === day && saved.v === SHELF_FORMAT && !shelfRetryAt) {
                replace(saved);
                return;
            }
            const recent = Array.isArray(loaded?.recent) ? loaded.recent.filter(isId) : [];
            // Прослушанное и треки плейлистов одним списком без повторов: и то и другое идёт в жанры своим весом во вкусе
            const extra = new Map([...asHeard(loaded?.heard), ...asHeard(loaded?.playlists)].map((entry) => [entry.id, entry]));
            const fresh = Array.isArray(loaded?.fresh) ? loaded.fresh.filter(isId).slice(0, 5000) : [];
            const built = await buildShelf(day, recent, [...extra.values()], fresh, asLove(loaded?.love));
            if (core.disposed()) return;
            replace(built);
            // Без вкуса зёрна находок случайны, «Давно не слушал» идёт только по порядку лайков, жанры без прослушанного:
            // такую полку до полуночи не хранит
            const tasteless = core.taste() === null && core.tasteFailed();
            shelfRetryAt = tasteless ? Date.now() + 10 * 60000 : 0;
            // Пустую полку не хранит: лайки могли не загрузиться, следующий запуск соберёт заново
            if (built.cards.length && !tasteless && (await bridge.save(id, built)) !== true) console.warn('Волна: подборки не сохранены');
        })().catch((error: unknown) => {
            shelfFailedAt = Date.now();
            shelfFailures++;
            console.warn('Волна: подборки не собраны', error);
        }).finally(() => {
            shelfPromise = null;
            render();
        });
        render();
    }
    // Треки карточки для раскрытого списка; неудача не кешируется, повторное раскрытие спросит снова
    function toggleMix(index: number): void {
        if (core.openCard() === index) {
            core.showCard(null);
            render();
            return;
        }
        core.showCard(index);
        const card = shelf?.cards[index];
        const loaded = mixLists.get(index);
        if (card && !Array.isArray(loaded) && loaded !== 'loading') {
            const day = shelf?.day;
            mixLists.set(index, 'loading');
            void tracksByIds(card.ids).then((tracks) => {
                if (shelf?.day === day) mixLists.set(index, tracks.filter(isWaveEligible));
            }, (error: unknown) => {
                console.warn('Волна: треки подборки не загружены', error);
                if (shelf?.day === day) mixLists.set(index, 'failed');
            }).finally(render);
        }
        render();
    }
    // Волна от карточки: подборка впереди (находки, давно не слушал) или вперемешку с похожими (вкус).
    // fromId: трек из раскрытого списка играет первым, подборка по порядку идёт дальше за ним
    async function startShelf(index: number, fromId = 0): Promise<void> {
        const card = shelf?.cards[index];
        if (!card) return;
        const request = core.nextSeedRequest();
        try {
            await Promise.all([ensureProfile(), ensureExclusions()]);
            const tracks = await tracksByIds([...card.ids, ...card.seeds]);
            if (request !== core.seedRequest() || core.disposed()) return;
            const byId = new Map(tracks.map((track) => [track.id, track]));
            let own = card.ids.map((id) => byId.get(id)).filter((track): track is WaveTrack => !!track && isWaveEligible(track));
            const roots = card.seeds.map((id) => byId.get(id)).filter((track): track is WaveTrack => !!track);
            if (!own.length) {
                showToast(T.toastEmpty);
                return;
            }
            const at = fromId ? own.findIndex((track) => track.id === fromId) : -1;
            const first = at >= 0 ? own[at] : null;
            if (at >= 0) own = [...own.slice(at + 1), ...own.slice(0, at)];
            // «Давно не слушал» без выбранного трека продолжает с места (П11): сначала несыгранное за сутки по порядку
            // карточки, сыгранное после. Всё сыграно: круг заново
            if (card.kind === 'forgotten' && !first && shelf) {
                const played = forgottenPlayed(shelf.day);
                const fresh = own.filter((track) => !played.has(track.id));
                if (fresh.length) own = [...fresh, ...own.filter((track) => played.has(track.id))];
                else saveForgottenPlayed(shelf.day, new Set());
            }
            const title = cardTitle(card);
            // Вкус тасуется всегда
            const ordered = card.kind === 'group' ? shuffleInPlace(own.slice()) : own;
            const next: Seed = card.kind === 'daily'
                ? { kind: 'daily', title, own: ordered, tracks: shuffleInPlace([...roots, ...own]), order: 'fixed', mode: 'fresh', card: index,
                    reasons: new Map(card.neighbors.map((id): [number, WaveReason] => [id, { kind: 'neighbors' }])) }
                // «Лайкнули твои артисты» по порядку, за ними новое по похожим, как у находок
                : card.kind === 'liked'
                ? { kind: 'liked', title, own: ordered, tracks: shuffleInPlace(own.slice()), order: 'fixed', mode: 'fresh', card: index,
                    reasons: new Map(card.ids.map((id, at): [number, WaveReason] => [id, { kind: 'likedBy', artist: card.by[at] ?? '' }])) }
                : { kind: card.kind, title, own: ordered, tracks: shuffleInPlace(own.slice()), order: card.kind === 'forgotten' ? 'fixed' : 'blend', mode: 'similar', card: index };
            await beginSeed(request, { seed: next, first });
        } catch (error) {
            if (request !== core.seedRequest()) return;
            console.warn('Волна: подборка не запустилась', error);
            showToast(T.toastFailed);
        }
    }
    const pickedIndex = (target: MenuTarget): number =>
        target.track ? picks.findIndex((track) => track.id === target.track?.id) : picks.findIndex((track) => canonicalUrl(track.permalink_url) === canonicalUrl(target.url));
    async function pickTrack(target: MenuTarget, add: boolean): Promise<void> {
        if (!add) {
            const index = pickedIndex(target);
            if (index >= 0) picks.splice(index, 1);
            savePicks();
            showToast(T.toastUnpicked);
            render();
            return;
        }
        if (picks.length >= PICKS_MAX) {
            showToast(fillText(T.toastPickFull, { count: countText(picks.length, T.tracksCount, T.lang) }));
            return;
        }
        try {
            const track = await trackOf(target);
            if (!track || !isWaveEligible(track)) {
                showToast(T.toastFailed);
                return;
            }
            if (!picks.some((item) => item.id === track.id) && picks.length < PICKS_MAX) picks.push(track);
            savePicks();
            showToast(fillText(T.toastPicked, { count: countText(picks.length, T.tracksCount, T.lang) }));
            render();
        } catch (error) {
            console.warn('Волна: трек не добавлен в набор', error);
            showToast(T.toastFailed);
        }
    }
    // Волна по набору: похожие на все треки сразу, сами треки набора не играют. Набор после запуска очищается
    function startPicks(): void {
        if (!picks.length) return;
        const tracks = picks.splice(0);
        savePicks();
        const titles = tracks.map((track) => (track.title ?? '').trim()).filter(Boolean);
        const title = titles.length > 2 ? titles.slice(0, 2).join(', ') + ' +' + (titles.length - 2) : titles.join(', ');
        const request = core.nextSeedRequest();
        void beginSeed(request, { seed: { kind: 'tracks', title: title || '…', tracks, own: [] }, first: null }).catch((error: unknown) => {
            console.warn('Волна: волна по набору не запустилась', error);
            showToast(T.toastFailed);
        });
    }
    type CardKind = 'radar' | 'uploads' | 'daily' | 'forgotten' | 'liked' | 'group';
    // Тон карточки по группе: релизы, личные подборки, жанры
    type CardTone = 'release' | 'personal' | 'genre';
    const toneOf = (kind: CardKind): CardTone => (kind === 'radar' || kind === 'uploads' ? 'release' : kind === 'group' ? 'genre' : 'personal');
    const cardTitle = (card: ShelfCard): string => (card.kind === 'daily' ? T.shelfDaily : card.kind === 'forgotten' ? T.shelfForgotten : card.kind === 'liked' ? T.shelfLiked : card.title);
    // Полка подборок: коллаж обложек, название, число треков или главные артисты; играющая карточка с оранжевой кромкой.
    // Нажатие на карточку раскрывает её треки под полкой, кнопка на обложке сразу включает волну подборки
    // Карточка полки: общая для подборок и радара; кнопки «слушать» нет, пока слушать нечего.
    // Лицо обложки как у собственных подборок SoundCloud: название крупно поверх коллажа,
    // коллаж обесцвечен и залит тоном группы (радар оранжевым, личные подборки фиолетовым, жанры бирюзовым), дата выпуска на обложке
    function cardNode(index: number, title: string, sub: string, cover: string[], playable: boolean, kind: CardKind, stamp = ''): HTMLElement {
        const node = el('div', 'scw-card');
        const artBox = el('div', 'scw-art');
        const current = core.seed();
        const playing = !!current && current.card === index && core.active();
        const shown = playing && !!core.player()?.isPlaying();
        node.dataset.card = String(index);
        node.classList.toggle('on', playing);
        node.classList.toggle('open', core.openCard() === index);
        const open = el('button', 'scw-card-open');
        open.type = 'button';
        open.dataset.act = 'shelf-open';
        open.dataset.card = String(index);
        open.setAttribute('aria-expanded', String(core.openCard() === index));
        if (cover.length >= 4) {
            artBox.classList.add('scw-quad');
            for (const url of cover.slice(0, 4)) {
                const cell = el('span', '');
                paintArt(cell, url, '');
                artBox.append(cell);
            }
        } else if (cover[0]) paintArt(artBox, cover[0], '');
        else if (isRadarCard(index)) {
            // Выпуска ещё нет: вместо серой заготовки значок радара, как пустая обложка волны
            artBox.classList.add('scw-radar-art');
            artBox.setAttribute('aria-hidden', 'true');
            artBox.innerHTML = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="24" cy="24" r="3.5" fill="currentColor" stroke="none"/><path d="M15.5 32.5a12 12 0 0 1 0-17M32.5 15.5a12 12 0 0 1 0 17" opacity=".75"/><path d="M9.9 38.1a20 20 0 0 1 0-28.2M38.1 9.9a20 20 0 0 1 0 28.2" opacity=".4"/></svg>';
        }
        artBox.classList.add('scw-tone-' + toneOf(kind));
        if (cover.length) artBox.append(el('div', 'scw-tint'));
        else if (!isRadarCard(index)) artBox.classList.add('scw-blank');
        // Лицо повторяет название под обложкой, поэтому скрыто от чтения с экрана; дата выпуска читается.
        // Наложения блоками div: клетки коллажа это span, и правило сетки их не задевает
        const face = el('div', 'scw-face');
        face.setAttribute('aria-hidden', 'true');
        face.append(el('b', '', title));
        artBox.append(face);
        if (stamp) artBox.append(el('div', 'scw-stamp', stamp));
        open.append(artBox, el('div', 'scw-t1', title), el('div', 'scw-t2', sub));
        node.append(open);
        if (playable) {
            const over = el('div', 'scw-card-over');
            const play = button('scw-card-play', 'shelf-play', shown ? T.pause : T.mixPlay, shown ? 'pause' : 'play');
            play.dataset.card = String(index);
            play.setAttribute('aria-pressed', String(playing));
            // Кнопок «Слушать» на полке десяток: чтение с экрана называет, какую подборку она включит
            play.setAttribute('aria-label', (shown ? T.pause : T.mixPlay) + ': ' + title);
            over.append(play);
            node.append(over);
        }
        return node;
    }
    function waitCard(tone: CardTone): HTMLElement {
        const node = el('div', 'scw-card scw-wait');
        node.append(el('div', 'scw-art scw-blank scw-tone-' + tone),el('div', 'scw-t1', ' '), el('div', 'scw-t2', ' '));
        return node;
    }
    function renderShelf(): HTMLElement[] {
        if (core.state() === 'unavailable') return [];
        const openCard = core.openCard();
        const radar = radarCards();
        const shelfOn = !!host.soundcloudAPI?.waveShelf;
        const current = shelfOn ? shelf : null;
        const shelfWait = shelfOn && !current && !!shelfPromise;
        const shelfError = shelfOn && !current && !shelfPromise && !!shelfFailedAt;
        if (!radar.length && !current && !shelfWait && !shelfError) return [];
        const headline = el('div', 'scw-shelf-h', T.shelf);
        const error = el('div', 'scw-shelf-error');
        error.setAttribute('role', 'status');
        error.append(el('span', 'scw-hint', T.shelfFailed), textButton('shelf-retry', T.retry));
        const empty = !!current && !current.cards.length;
        // Без радара полка как прежде: ошибка или пустота вместо сетки
        if (!radar.length && shelfError) return [headline, error];
        if (!radar.length && empty) return [headline, el('div', 'scw-hint', T.shelfEmpty)];
        const grid = el('div', 'scw-tiles scw-shelf' + (!radar.length && shelfWait ? ' wait held' : ''));
        // Уголок раскрытого списка ставится под место карточки в сетке, а не под её номер
        let openAt = -1;
        const add = (node: HTMLElement, index: number | null): void => {
            if (index !== null && index === openCard) openAt = grid.childElementCount;
            grid.append(node);
        };
        for (const card of radar) add(card.wait ? waitCard('release') : cardNode(card.index, card.title, card.sub, card.art, card.playable, card.index === UPLOADS_CARD ? 'uploads' : 'radar', card.stamp), card.wait ? null : card.index);
        // Все жанры видны, последний ряд может быть неполным (решение владельца 26.09.2026)
        if (current)
            current.cards.forEach((card, index) => {
                add(cardNode(index, cardTitle(card), (card.kind === 'group' || card.kind === 'liked') && card.sub ? card.sub : countText(card.ids.length, T.tracksCount, T.lang), card.art, true, card.kind), index);
            });
        // Пока полка собирается: две личные подборки и два жанра, каждая заготовка в своём тоне
        else if (shelfWait) for (let i = 0; i < 4; i++) add(waitCard(i < 2 ? 'personal' : 'genre'), null);
        const parts: HTMLElement[] = [headline, grid];
        if (shelfError) parts.push(error);
        else if (empty) parts.push(el('div', 'scw-hint', T.shelfEmpty));
        // Список встаёт в сетку строкой сразу под карточкой: с радаром карточек больше шести, строк две.
        // Колонок 6 или 4 по ширине окна, поэтому строка и уголок заданы для обоих вариантов
        const list = openCard === null || openAt < 0 ? null : isRadarCard(openCard) ? radarMix(openCard) : renderMix(openCard);
        if (list) {
            for (const columns of [6, 4]) {
                list.style.setProperty('--scw-at' + columns, String(openAt % columns));
                list.style.setProperty('--scw-row' + columns, String(Math.floor(openAt / columns) + 2));
            }
            grid.append(list);
        }
        return parts;
    }
    // Треки раскрытой подборки: обложка, название, артист, длительность; играющий трек выделен
    function renderMix(index: number): HTMLElement | null {
        const card = shelf?.cards[index];
        if (!card) return null;
        const box = el('div', 'scw-mix');
        box.setAttribute('role', 'region');
        box.setAttribute('aria-label', cardTitle(card));
        const head = el('div', 'scw-mix-head');
        const current = core.seed();
        const playing = !!current && current.card === index && core.active() && !!core.player()?.isPlaying();
        const play = button('scw-mix-play', 'mix-play', playing ? T.pause : T.mixPlay, playing ? 'pause' : 'play');
        play.title = playing ? T.pause : T.mixPlay;
        const titles = el('div', 'scw-mix-title');
        const loaded = mixLists.get(index);
        const tracks = Array.isArray(loaded) ? loaded.filter((track) => !isExcluded(track)) : [];
        titles.append(el('b', '', cardTitle(card)), el('span', '', countText(Array.isArray(loaded) ? tracks.length : card.ids.length, T.tracksCount, T.lang)));
        const close = button('scw-icon', 'mix-close', T.mixClose, 'x');
        close.title = T.mixClose;
        head.append(play, titles, close);
        box.append(head);
        if (!Array.isArray(loaded)) {
            const line = el('div', 'scw-hint', loaded === 'failed' ? T.mixFailed : T.mixLoading);
            line.setAttribute('role', 'status');
            box.append(line);
            return box;
        }
        if (!tracks.length) {
            box.append(el('div', 'scw-hint', T.mixEmpty));
            return box;
        }
        const rows = el('div', 'scw-mix-rows');
        const now = core.active() ? core.player()?.getCurrentSound()?.id ?? 0 : 0;
        for (const track of tracks) {
            const { row, end } = trackRow(track, now);
            end.append(el('span', 'scw-row-d', formatTime(track.full_duration || track.duration || 0)));
            rows.append(row);
        }
        box.append(rows);
        return box;
    }
    return {
        render: renderShelf,
        ensure: ensureShelf,
        failed: () => shelfFailedAt !== 0,
        resetFailures: () => {
            shelfFailedAt = 0;
            shelfFailures = 0;
        },
        toggle: toggleMix,
        start: startShelf,
        notePlayed,
        tracksByIds,
        track: (id) => shelfTracks.get(id),
        genreOf: (index) => {
            const card = shelf?.cards[index];
            if (card?.kind !== 'group') return '';
            // Название «A и B» это два жанра: волна идёт по обоим
            return card.title.split(T.groupAnd.replace('{a}', '').replace('{b}', '')).join(', ');
        },
        picks: () => picks,
        pickedIndex,
        pick: pickTrack,
        startPicks,
        clearPicks: () => {
            picks.length = 0;
            savePicks();
            render();
        },
    };
}
