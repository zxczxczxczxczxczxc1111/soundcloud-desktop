// Пятничный радар: выпуск из worker, карточки на полке, архив, «Все найденные», пересборка и раскрытый выпуск под полкой.
// Раздел страницы волны: installRadar уходит на страницу текстом вместе с волной (pageHelpers в wave.ts) и зовёт
// помощников по голому имени, поэтому импорт через пространство имён и разбор в константы. Выпуск, архив, фильтры
// и треки радара раздел держит сам; всё, что он берёт у ядра волны, приходит объектом core
import * as identity from '../trackIdentity';
import * as waveGenres from '../waveGenres';
import * as waveLinks from '../waveLinks';
import * as wavePicks from '../wavePicks';
import * as waveTexts from '../waveTexts';
import type { RadarReason } from '../radar';
import type { RadarState } from '../radarSchedule';
import type { Profile, Seed, WaveTexts, WaveTrack } from '../waveTypes';
import type { SitePlayer, WaveWindow } from '../wave';

const { performerKey, trackCredits } = identity;
const { normalizeTag } = waveGenres;
const { coversOf, retryDelay } = waveLinks;
const { isWaveEligible } = wavePicks;
const { countText, fillText, formatTime } = waveTexts;

/** Карточка радара на полке: выпуск или «Новые загрузки»; wait это заготовка, пока выпуск читается */
export interface RadarCard { index: number; title: string; sub: string; art: string[]; playable: boolean; wait: boolean; stamp: string }

export interface RadarCore {
    texts: WaveTexts;
    /** Окно страницы; крючки для main (__scRadarChanged, __scRadarReload) раздел ставит и снимает сам */
    host: WaveWindow & Record<string, unknown>;
    /** Номера карточек радара на полке: отрицательные и не -1 */
    radarCard: number;
    uploadsCard: number;
    isRadarCard(index: number | null | undefined): boolean;
    active(): boolean;
    disposed(): boolean;
    player(): SitePlayer | null;
    seed(): Seed | null;
    /** Номер последнего запуска подборки: запуск, начатый позже, отменяет прежний */
    seedRequest(): number;
    nextSeedRequest(): number;
    /** Выпуск сменился: играющая волна больше не привязана к карточке радара (true) или подборки (false) */
    releaseCard(radar: boolean): void;
    /** Раскрытая под полкой карточка, общая для подборок и радара */
    openCard(): number | null;
    /** Раскрыть карточку под полкой или свернуть; раскрытая начинает список сверху */
    showCard(index: number | null): void;
    /** Треки следующими в очередь одной пересборкой; ответ это сколько встало */
    addMany(tracks: WaveTrack[], next: boolean): number;
    isExcluded(track: WaveTrack): boolean;
    artistName(track: WaveTrack): string;
    tracksByIds(ids: number[]): Promise<WaveTrack[]>;
    beginSeed(request: number, loaded: { seed: Seed; first: WaveTrack | null }): Promise<void>;
    ensureProfile(): Promise<Profile>;
    ensureExclusions(): Promise<void>;
    ensureUser(): Promise<number>;
    call(name: string, path: object, query: object): Promise<unknown>;
    render(): void;
    showToast(text: string): void;
    el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K];
    button(className: string, act: string, label: string, icon?: string): HTMLButtonElement;
    textButton(act: string, label: string): HTMLButtonElement;
    trackRow(track: WaveTrack, now: number): { row: HTMLDivElement; end: HTMLDivElement };
}
/** Что раздел отдаёт полке, блоку на главной, подбору и меню */
export interface RadarSection {
    cards(): RadarCard[];
    renderMix(index: number): HTMLElement;
    /** Нажатие на карточку радара: раскрыть выпуск под полкой или свернуть */
    toggle(index: number): void;
    /** Волна от выпуска; fromId это трек, с которого начать */
    start(index: number, fromId?: number): Promise<void>;
    click(control: HTMLElement): void;
    /** Выбор выпуска в архиве: значение option, период и ревизия через «|» */
    select(value: string): void;
    ensure(): void;
    /** Строка «почему» у позиции играющего радара */
    reason(id: number): string;
    track(id: number): WaveTrack | undefined;
    dispose(): void;
}

export function installRadar(core: RadarCore): RadarSection {
    const {
        texts: T, host, radarCard: RADAR_CARD, uploadsCard: UPLOADS_CARD, isRadarCard, addMany, isExcluded, artistName, tracksByIds, beginSeed, ensureProfile,
        ensureExclusions, ensureUser, call, render, showToast, el, button, textButton, trackRow,
    } = core;
    const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
    // group: все записи группы исполнителя по дате, включая эту; пусто, если запись одна
    interface RadarRow { id: number; title: string; artist: string; kind: 'release' | 'upload'; heard: boolean; reason: RadarReason; after: boolean; group: number[] }
    interface RadarEditionView {
        period: string; revision: number; cutoff: number; status: 'complete' | 'partial'; checked: number; total: number; algorithm: number; items: RadarRow[]; uploads: RadarRow[];
    }
    // Релиз аккаунта из userAlbums: вид (album, ep, single, compilation), число треков и их порядок
    interface RadarAlbum { kind: string; title: string; count: number; ids: number[] }
    interface RadarArchiveEntry { period: string; revision: number; cutoff: number; manual: boolean }
    let radarEdition: RadarEditionView | null = null;
    let radarArchive: RadarArchiveEntry[] = [];
    let radarState: RadarState | null = null;
    let radarLoaded = false;
    let radarPromise: Promise<void> | null = null;
    let radarFailedAt = 0;
    let radarFailures = 0;
    let radarRequest = 0;
    // Выпуск, выбранный в архиве; null это последний
    let radarPinned: { period: string; revision: number } | null = null;
    let radarFound: { key: string; rows: RadarRow[] | 'loading' | 'failed' } | null = null;
    let radarShowFound = false;
    let radarKind: 'all' | 'release' | 'upload' = 'all';
    let radarHideHeard = false;
    let radarBusy = false;
    const radarArt = new Map<number, string[]>();
    // Треки радара отдельно от полки: полка чистит свой кэш при пересборке в полночь
    const radarTracks = new Map<number, WaveTrack>();
    // Причины позиций играющего радара для строки «почему» у плеера
    const radarReasons = new Map<number, string>();
    // Раскрытая группа исполнителя в списке радара: номер ведущей записи, 0 если ни одной
    let radarGroupOpen = 0;
    // Альбомы аккаунтов для меток групп, по id аккаунта; спрашиваются только у групп от трёх записей
    const radarAlbums = new Map<number, RadarAlbum[] | 'loading' | 'failed'>();
    const RADAR_ALBUM_FROM = 3;
    // Треки раскрытых карточек радара по номеру карточки; у подборок полки свой такой же список
    const mixLists = new Map<number, WaveTrack[] | 'loading' | 'failed'>();
    // Ответ main уже проверен там; здесь только форма, чтобы не упасть на чужом
    function asRadarRows(list: unknown): RadarRow[] {
        if (!Array.isArray(list)) return [];
        const text = (value: unknown): string => (typeof value === 'string' ? value : '');
        return list.flatMap((value): RadarRow[] => {
            const item = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
            if (!item || !isId(item.id)) return [];
            const source = item.reason && typeof item.reason === 'object' ? (item.reason as Record<string, unknown>) : {};
            const reason: RadarReason = source.kind === 'artist' || source.kind === 'follow'
                ? { kind: source.kind, name: text(source.name) }
                : source.kind === 'tag' ? { kind: 'tag', tag: text(source.tag) } : { kind: 'taste' };
            const group = Array.isArray(item.group) ? item.group.filter(isId) : [];
            return [{
                id: item.id, title: text(item.title), artist: text(item.artist), kind: item.kind === 'upload' ? 'upload' : 'release', heard: item.heard === true, reason,
                after: item.after === true, group: group.length > 1 && group.includes(item.id) ? group : [],
            }];
        });
    }
    function asRadarState(value: unknown): RadarState | null {
        const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
        const phases = ['idle', 'offline', 'no-session', 'collecting', 'published', 'error'];
        if (!source || typeof source.phase !== 'string' || !phases.includes(source.phase)) return null;
        return {
            phase: source.phase as RadarState['phase'], period: typeof source.period === 'string' ? source.period : '',
            error: typeof source.error === 'string' ? source.error : '', updated: typeof source.updated === 'number' ? source.updated : 0,
        };
    }
    const radarKey = (edition: RadarEditionView): string => edition.period + '|' + edition.revision;
    function applyRadarView(value: unknown): void {
        const source = value && typeof value === 'object' ? (value as { edition?: unknown; editions?: unknown }) : {};
        const edition = source.edition && typeof source.edition === 'object' ? (source.edition as Record<string, unknown>) : null;
        const number = (item: unknown): number => (typeof item === 'number' && Number.isFinite(item) ? item : 0);
        const coverage = edition?.coverage && typeof edition.coverage === 'object' ? (edition.coverage as Record<string, unknown>) : {};
        const next: RadarEditionView | null = edition && typeof edition.period === 'string' ? {
            period: edition.period, revision: number(edition.revision), cutoff: number(edition.cutoff), status: edition.status === 'complete' ? 'complete' : 'partial',
            checked: number(coverage.checked) + number(coverage.searchesDone), total: number(coverage.accounts) + number(coverage.searches),
            algorithm: number(edition.algorithm), items: asRadarRows(edition.items), uploads: asRadarRows(edition.uploads),
        } : null;
        const same = !!next && !!radarEdition && radarKey(next) === radarKey(radarEdition);
        // Играет прежний выпуск: карточка нового больше не «играющая»
        if (!same && radarEdition) core.releaseCard(true);
        radarEdition = next;
        radarArchive = (Array.isArray(source.editions) ? source.editions : []).flatMap((item): RadarArchiveEntry[] => {
            const entry = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
            return entry && typeof entry.period === 'string' && isId(entry.revision)
                ? [{ period: entry.period, revision: entry.revision, cutoff: number(entry.cutoff), manual: entry.manual === true }]
                : [];
        });
        // Тот же выпуск перечитан ради отметок «Уже слышал»: раскрытый список и найденное остаются
        if (same) return;
        mixLists.delete(RADAR_CARD);
        mixLists.delete(UPLOADS_CARD);
        radarFound = null;
        radarShowFound = false;
        radarGroupOpen = 0;
        radarArt.clear();
        void loadRadarArt();
        const open = core.openCard();
        if (isRadarCard(open) && open !== null) loadRadarTracks(open);
    }
    // Выпуск и состояние сбора; пока открыт архивный выпуск, перечитывается он же
    function loadRadar(): void {
        const bridge = host.soundcloudAPI?.radar;
        if (!bridge || core.disposed()) return;
        const request = ++radarRequest;
        const pinned = radarPinned;
        radarPromise = (async () => {
            const id = await ensureUser();
            if (!id) throw new Error('Пользователь не определён');
            const [state, view] = await Promise.all([bridge.state(), bridge.view(id, pinned?.period, pinned?.revision)]);
            if (request !== radarRequest || core.disposed()) return;
            radarState = asRadarState(state) ?? radarState;
            applyRadarView(view);
            radarLoaded = true;
            radarFailedAt = 0;
            radarFailures = 0;
        })().catch((error: unknown) => {
            if (request === radarRequest) { radarFailedAt = Date.now(); radarFailures++; }
            console.warn('Радар: выпуск не загружен', error);
        }).finally(() => {
            if (request === radarRequest) radarPromise = null;
            render();
        });
    }
    function ensureRadar(): void {
        if (!host.soundcloudAPI?.radar || radarPromise || radarLoaded || Date.now() - radarFailedAt < retryDelay(radarFailures)) return;
        loadRadar();
    }
    // main сообщает о каждом проходе планировщика: выпуск перечитывается только после новой публикации
    host.__scRadarChanged = (value: unknown): void => {
        const next = asRadarState(value);
        if (!next || core.disposed()) return;
        const before = radarState;
        radarState = next;
        const published = next.phase === 'published' && (!radarEdition || before?.phase !== 'published' || before.period !== next.period);
        if (published && !radarPinned && radarLoaded) loadRadar();
        else render();
    };
    // Восстановили резервную копию: в архиве могли появиться выпуски, открытый перечитывается на месте
    host.__scRadarReload = (): void => {
        if (!core.disposed() && radarLoaded) loadRadar();
    };
    async function radarTracksOf(ids: number[]): Promise<WaveTrack[]> {
        const missing = ids.filter((id) => !radarTracks.has(id));
        if (missing.length) for (const track of await tracksByIds(missing)) radarTracks.set(track.id, track);
        return ids.map((id) => radarTracks.get(id)).filter((track): track is WaveTrack => !!track);
    }
    async function loadRadarArt(): Promise<void> {
        const edition = radarEdition;
        if (!edition) return;
        try {
            await radarTracksOf([...edition.items.slice(0, 4), ...edition.uploads.slice(0, 4)].map((row) => row.id));
            if (radarEdition !== edition) return;
            const covers = (rows: RadarRow[]): string[] => coversOf(rows.slice(0, 4).map((row) => radarTracks.get(row.id)).filter((track): track is WaveTrack => !!track));
            radarArt.set(RADAR_CARD, covers(edition.items));
            radarArt.set(UPLOADS_CARD, covers(edition.uploads));
            render();
        } catch (error) {
            console.warn('Радар: обложки не загружены', error);
        }
    }
    // Позиции карточки: выпуск, «Новые загрузки» или «Все найденные» с фильтрами
    function radarRows(index: number): RadarRow[] {
        const edition = radarEdition;
        if (!edition) return [];
        if (index === UPLOADS_CARD) return legacyGroups(edition, edition.uploads);
        if (!radarShowFound) return legacyGroups(edition, edition.items);
        const found = radarFound?.key === radarKey(edition) && Array.isArray(radarFound.rows) ? radarFound.rows : [];
        return found.filter((row) => (radarKind === 'all' || row.kind === radarKind) && !(radarHideHeard && row.heard));
    }
    // Выпуск до групп (алгоритм 2) страница склеивает сама, когда треки загружены: строка на исполнителя, ведёт первая
    // по порядку выпуска, в группе все записи по дате публикации. «Все найденные» worker всегда отдаёт группами
    function legacyGroups(edition: RadarEditionView, rows: RadarRow[]): RadarRow[] {
        if (edition.algorithm >= 3 || !rows.every((row) => radarTracks.has(row.id))) return rows;
        const heads = new Map<string, RadarRow>();
        const members = new Map<RadarRow, WaveTrack[]>();
        for (const row of rows) {
            const track = radarTracks.get(row.id);
            if (!track) continue;
            const key = row.kind + '|' + performerKey(track.user_id ?? 0, track.user?.username, trackCredits(track));
            const head = heads.get(key);
            if (head) members.get(head)?.push(track);
            else {
                heads.set(key, row);
                members.set(row, [track]);
            }
        }
        const published = (track: WaveTrack): number => Date.parse(track.display_date || track.created_at || '') || 0;
        return [...heads.values()].map((row) => {
            const list = members.get(row) ?? [];
            return list.length > 1 ? { ...row, group: list.slice().sort((a, b) => published(a) - published(b) || a.id - b.id).map((track) => track.id) } : row;
        });
    }
    function loadRadarTracks(index: number): void {
        // Старый выпуск склеивается по загруженным трекам: грузятся все его строки, а не только уже склеенные
        const edition = radarEdition;
        const all = edition && index === UPLOADS_CARD ? edition.uploads : edition && !radarShowFound ? edition.items : radarRows(index);
        const ids = all.map((row) => row.id);
        const shown = (): WaveTrack[] => radarRows(index).map((row) => radarTracks.get(row.id)).filter((track): track is WaveTrack => !!track && isWaveEligible(track));
        if (ids.every((id) => radarTracks.has(id))) {
            mixLists.set(index, shown());
            loadRadarAlbums(radarRows(index));
            return;
        }
        mixLists.set(index, 'loading');
        const key = radarEdition ? radarKey(radarEdition) : '';
        void radarTracksOf(ids).then(() => {
            if (!radarEdition || radarKey(radarEdition) !== key) return;
            mixLists.set(index, shown());
            loadRadarAlbums(radarRows(index));
        }, (error: unknown) => {
            console.warn('Радар: треки выпуска не загружены', error);
            if (radarEdition && radarKey(radarEdition) === key) mixLists.set(index, 'failed');
        }).finally(render);
    }
    // Альбомы аккаунтов, у которых группа от трёх записей: одним запросом userAlbums, треки альбома приходят в нём же по порядку
    function loadRadarAlbums(rows: RadarRow[]): void {
        const accounts = new Set<number>();
        for (const row of rows) {
            const account = row.group.length >= RADAR_ALBUM_FROM ? radarTracks.get(row.id)?.user_id : undefined;
            if (account && isId(account) && !radarAlbums.has(account)) accounts.add(account);
        }
        for (const account of accounts) {
            radarAlbums.set(account, 'loading');
            void call('userAlbums', { id: account }, { limit: 50 }).then((body) => {
                radarAlbums.set(account, albumsOf(body));
            }, (error: unknown) => {
                console.warn('Радар: альбомы аккаунта не загружены', error);
                radarAlbums.set(account, 'failed');
            }).finally(render);
        }
    }
    function albumsOf(body: unknown): RadarAlbum[] {
        const list = body && typeof body === 'object' ? (body as { collection?: unknown }).collection : null;
        if (!Array.isArray(list)) return [];
        return list.flatMap((value): RadarAlbum[] => {
            const album = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
            if (!album || !Array.isArray(album.tracks)) return [];
            const ids = album.tracks.map((track: unknown) => (track && typeof track === 'object' ? (track as { id?: unknown }).id : 0)).filter(isId);
            return [{
                kind: typeof album.set_type === 'string' ? album.set_type : '', title: typeof album.title === 'string' ? album.title : '',
                count: isId(album.track_count) ? album.track_count : ids.length, ids,
            }];
        });
    }
    // Альбом группы подтверждён сайтом, если в нём ведущая запись и хотя бы ещё одна из группы
    function radarAlbum(row: RadarRow): RadarAlbum | null {
        const account = radarTracks.get(row.id)?.user_id;
        const albums = account ? radarAlbums.get(account) : undefined;
        if (!Array.isArray(albums)) return null;
        return albums.find((album) => album.ids.includes(row.id) && row.group.some((id) => id !== row.id && album.ids.includes(id))) ?? null;
    }
    function groupLabel(row: RadarRow): string {
        const album = radarAlbum(row);
        if (!album) return '+' + countText(row.group.length - 1, T.tracksCount, T.lang);
        const kind = album.kind === 'ep' ? T.radarEp : album.kind === 'single' ? T.radarSingle : album.kind === 'compilation' ? T.radarCompilation : T.radarAlbum;
        return fillText(kind, { n: String(album.count) });
    }
    // Порядок раскрытой группы: записи альбома в его порядке, остальные по дате
    function groupOrder(row: RadarRow): number[] {
        const album = radarAlbum(row);
        if (!album) return row.group;
        const inAlbum = album.ids.filter((id) => row.group.includes(id));
        return [...inAlbum, ...row.group.filter((id) => !inAlbum.includes(id))];
    }
    function toggleGroup(id: number): void {
        radarGroupOpen = radarGroupOpen === id ? 0 : id;
        const open = core.openCard();
        const row = open !== null ? radarRows(open).find((item) => item.id === id) : undefined;
        if (radarGroupOpen && row && !row.group.every((member) => radarTracks.has(member)))
            void radarTracksOf(row.group).catch((error: unknown) => console.warn('Радар: треки группы не загружены', error)).finally(render);
        render();
    }
    // «Слушать все N»: треки группы следующими в очередь одной пересборкой; если ничего не играет, группа сразу играет
    async function queueGroup(id: number): Promise<void> {
        const open = core.openCard();
        const row = open !== null ? radarRows(open).find((item) => item.id === id) : undefined;
        const player = core.player();
        if (!row || !player) return;
        try {
            await ensureExclusions();
            const tracks = (await radarTracksOf(groupOrder(row))).filter((track) => isWaveEligible(track) && !isExcluded(track));
            if (core.disposed()) return;
            const idle = !player.isPlaying();
            const added = addMany(tracks, true);
            if (!added) {
                showToast(T.toastEmpty);
                return;
            }
            if (idle) {
                const next = player.getQueue().slice().find((entry) => entry.sound?.id === tracks[0]?.id && entry.explicit);
                if (next) {
                    player.setCurrentItem(next, {});
                    player.playCurrent({ userInitiated: true });
                }
            } else showToast(fillText(T.radarGroupQueued, { count: countText(added, T.tracksCount, T.lang) }));
        } catch (error) {
            console.warn('Радар: группа не поставлена в очередь', error);
            showToast(T.toastFailed);
        }
    }
    function toggleRadar(index: number): void {
        if (core.openCard() === index) {
            core.showCard(null);
            render();
            return;
        }
        core.showCard(index);
        if (!radarLoaded) loadRadar();
        else if (radarEdition) {
            loadRadarTracks(index);
            // Отметки «Уже слышал» на сейчас: тот же выпуск перечитывается тихо
            loadRadar();
        }
        render();
    }
    function toggleFound(): void {
        const edition = radarEdition;
        const bridge = host.soundcloudAPI?.radar;
        if (!edition || !bridge) return;
        radarShowFound = !radarShowFound;
        const key = radarKey(edition);
        if (radarShowFound && radarFound?.key !== key) {
            radarFound = { key, rows: 'loading' };
            void (async () => {
                const id = await ensureUser();
                const rows = asRadarRows(await bridge.found(id, edition.period, edition.revision));
                if (radarFound?.key === key) radarFound = { key, rows };
                if (core.openCard() === RADAR_CARD && radarShowFound) loadRadarTracks(RADAR_CARD);
            })().catch((error: unknown) => {
                console.warn('Радар: найденное не загружено', error);
                if (radarFound?.key === key) radarFound = { key, rows: 'failed' };
            }).finally(render);
        } else loadRadarTracks(RADAR_CARD);
        render();
    }
    function selectRadarEdition(value: string): void {
        const [period, revision] = value.split('|');
        const latest = radarArchive[0];
        radarPinned = latest && latest.period === period && String(latest.revision) === revision ? null : { period, revision: Number(revision) };
        loadRadar();
    }
    // Ручная пересборка: новая ревизия того же периода, прежняя остаётся в архиве и в играющей очереди
    async function rebuildRadar(): Promise<void> {
        const bridge = host.soundcloudAPI?.radar;
        if (!bridge || radarBusy) return;
        radarBusy = true;
        render();
        try {
            const id = await ensureUser();
            if (!id) throw new Error('Пользователь не определён');
            const outcome = (await bridge.rebuild(id)) as { published?: unknown; edition?: { revision?: unknown } | null } | null;
            if (outcome?.published === true) {
                radarPinned = null;
                showToast(typeof outcome.edition?.revision === 'number' && outcome.edition.revision > 1 ? T.radarRebuilt : T.radarBuilt);
                loadRadar();
            } else showToast(T.radarWaiting);
        } catch (error) {
            console.warn('Радар: пересборка не удалась', error);
            showToast(T.toastFailed);
        } finally {
            radarBusy = false;
            render();
        }
    }
    const radarDate = (at: number): string => new Intl.DateTimeFormat(T.lang, { day: 'numeric', month: 'long' }).format(at);
    // Дата выпуска на обложке карточки: коротко, месяц сокращённо
    const radarStamp = (at: number): string => new Intl.DateTimeFormat(T.lang, { day: 'numeric', month: 'short' }).format(at);
    // Причина позиции: тег показывается так, как он написан у самого трека
    function radarWhy(row: RadarRow): string {
        const reason = row.reason;
        if (reason.kind === 'artist') return fillText(T.whyRadarArtist, { name: reason.name });
        if (reason.kind === 'follow') return fillText(T.whyRadarFollow, { name: reason.name });
        if (reason.kind === 'tag') {
            const track = radarTracks.get(row.id);
            const labels = track ? [track.genre ?? '', ...Array.from((track.tag_list ?? '').matchAll(/"([^"]+)"|(\S+)/g), (match) => match[1] ?? match[2] ?? '')] : [];
            const label = labels.find((item) => normalizeTag(item) === reason.tag);
            return fillText(T.whyRadarTag, { tag: (label ?? reason.tag).trim().toLowerCase() });
        }
        return T.whyRadarTaste;
    }
    function radarStateText(): string {
        if (!radarLoaded && radarFailedAt) return T.radarFailed;
        switch (radarState?.phase) {
            case 'collecting': return T.radarCollecting;
            case 'no-session': return T.radarNoSession;
            case 'offline': return T.radarOffline;
            case 'error': return T.radarError;
            default: return T.radarSoon;
        }
    }
    function radarCardList(): RadarCard[] {
        if (!host.soundcloudAPI?.radar) return [];
        if (!radarLoaded) {
            if (radarPromise) return [{ index: RADAR_CARD, title: '', sub: '', art: [], playable: false, wait: true, stamp: '' }];
            return radarFailedAt ? [{ index: RADAR_CARD, title: T.radar, sub: T.radarFailed, art: [], playable: false, wait: false, stamp: '' }] : [];
        }
        const edition = radarEdition;
        if (!edition) return [{ index: RADAR_CARD, title: T.radar, sub: radarStateText(), art: [], playable: false, wait: false, stamp: '' }];
        // Дата выпуска стоит на обложке, поэтому подпись начинается с числа треков и не обрезает его
        const sub = edition.items.length
            ? [countText(edition.items.length, T.tracksCount, T.lang), ...(edition.status === 'partial' ? [T.radarPartial] : [])].join(' · ')
            : T.radarEmptyWeek;
        const stamp = radarStamp(edition.cutoff);
        const cards: RadarCard[] = [{ index: RADAR_CARD, title: T.radar, sub, art: radarArt.get(RADAR_CARD) ?? [], playable: edition.items.length > 0, wait: false, stamp }];
        if (edition.uploads.length)
            cards.push({ index: UPLOADS_CARD, title: T.radarUploads, sub: countText(edition.uploads.length, T.tracksCount, T.lang), art: radarArt.get(UPLOADS_CARD) ?? [], playable: true, wait: false, stamp });
        return cards;
    }
    // Подпись под названием раскрытого радара: число, полнота обхода, ревизия, идущий сбор новой недели
    function radarStatusLine(index: number, edition: RadarEditionView): string {
        if (index === UPLOADS_CARD) return countText(edition.uploads.length, T.tracksCount, T.lang);
        const parts = [countText(edition.items.length, T.tracksCount, T.lang)];
        parts.push(edition.status === 'complete' ? T.radarComplete : fillText(T.radarCoverage, { checked: String(edition.checked), total: String(edition.total) }));
        if (edition.revision > 1) parts.push(fillText(T.radarRevision, { n: String(edition.revision) }));
        if (radarState?.phase === 'collecting' && radarState.period !== edition.period) parts.push(T.radarCollecting);
        return parts.join(' · ');
    }
    // Волна от выпуска: позиции по порядку впереди похожего; запреты и доступность проверяются перед запуском
    async function startRadar(index: number, fromId = 0): Promise<void> {
        const edition = radarEdition;
        const rows = radarRows(index);
        if (!edition || !rows.length) return;
        const request = core.nextSeedRequest();
        try {
            await Promise.all([ensureProfile(), ensureExclusions()]);
            // Трек из раскрытой группы играет первым, дальше выпуск со следующего исполнителя после его группы
            const lead = fromId ? rows.find((row) => row.id !== fromId && row.group.includes(fromId)) : undefined;
            const tracks = await radarTracksOf([...rows.map((row) => row.id), ...(lead ? [fromId] : [])]);
            if (request !== core.seedRequest() || core.disposed()) return;
            const usable = (track: WaveTrack): boolean => isWaveEligible(track) && !isExcluded(track);
            let own = tracks.filter((track) => usable(track) && track.id !== (lead ? fromId : 0));
            if (!own.length) {
                showToast(T.toastEmpty);
                return;
            }
            const at = fromId ? own.findIndex((track) => track.id === (lead?.id ?? fromId)) : -1;
            const member = lead ? radarTracks.get(fromId) : undefined;
            const first = member && usable(member) ? member : at >= 0 && !lead ? own[at] : null;
            if (at >= 0) own = lead ? [...own.slice(at + 1), ...own.slice(0, at + 1)] : [...own.slice(at + 1), ...own.slice(0, at)];
            radarReasons.clear();
            for (const row of rows) radarReasons.set(row.id, radarWhy(row));
            const title = index === UPLOADS_CARD ? T.radarUploads : T.radar + ', ' + radarDate(edition.cutoff);
            await beginSeed(request, { seed: { kind: 'radar', title, own, tracks: own.slice(), order: 'fixed', mode: 'similar', card: index }, first });
        } catch (error) {
            if (request !== core.seedRequest()) return;
            console.warn('Радар: выпуск не запустился', error);
            showToast(T.toastFailed);
        }
    }
    // Раскрытый радар: шапка со статусом и архивом, фильтры «Всех найденных», метки у строк
    function renderRadarMix(index: number): HTMLElement {
        const edition = radarEdition;
        const uploads = index === UPLOADS_CARD;
        const title = uploads ? T.radarUploads : edition ? T.radar + ', ' + radarDate(edition.cutoff) : T.radar;
        const box = el('div', 'scw-mix');
        box.setAttribute('role', 'region');
        box.setAttribute('aria-label', title);
        const head = el('div', 'scw-mix-head');
        const rows = radarRows(index);
        const loaded = mixLists.get(index);
        if (edition && rows.length) {
            const current = core.seed();
            const playing = !!current && current.card === index && core.active() && !!core.player()?.isPlaying();
            const play = button('scw-mix-play', 'mix-play', playing ? T.pause : T.mixPlay, playing ? 'pause' : 'play');
            play.title = playing ? T.pause : T.mixPlay;
            head.append(play);
        }
        const titles = el('div', 'scw-mix-title');
        const status = el('span', '', edition ? radarStatusLine(index, edition) : radarStateText());
        status.setAttribute('role', 'status');
        titles.append(el('b', '', title), status);
        head.append(titles);
        if (!uploads) {
            const tools = el('div', 'scw-mix-tools');
            if (radarArchive.length > 1) {
                const select = el('select', 'scw-select');
                select.dataset.role = 'radar-archive';
                select.setAttribute('aria-label', T.radarArchive);
                select.title = T.radarArchive;
                for (const entry of radarArchive) {
                    const option = el('option', '', radarDate(entry.cutoff) + (entry.revision > 1 ? ' · ' + fillText(T.radarRevision, { n: String(entry.revision) }) : ''));
                    option.value = entry.period + '|' + entry.revision;
                    option.selected = !!edition && option.value === radarKey(edition);
                    select.append(option);
                }
                tools.append(select);
            }
            if (edition) {
                const found = el('button', 'scw-chip', T.radarFound);
                found.type = 'button';
                found.dataset.act = 'radar-found';
                found.setAttribute('aria-pressed', String(radarShowFound));
                tools.append(found);
            }
            // Пересобирается только последний выпуск; из архива сначала вернуться к нему
            if (!radarPinned) {
                const rebuild = textButton('radar-rebuild', edition ? T.radarRebuild : T.radarBuildNow);
                rebuild.disabled = radarBusy || radarState?.phase === 'collecting';
                tools.append(rebuild);
            }
            head.append(tools);
        }
        const close = button('scw-icon', 'mix-close', T.mixClose, 'x');
        close.title = T.mixClose;
        head.append(close);
        box.append(head);
        if (uploads) box.append(el('div', 'scw-hint', T.radarUploadsHint));
        if (!uploads && radarShowFound) {
            const chips = el('div', 'scw-mix-tools scw-filters');
            const kinds: Array<[typeof radarKind, string]> = [['all', T.radarAll], ['release', T.radarReleases], ['upload', T.radarPosts]];
            for (const [kind, label] of kinds) {
                const chip = el('button', 'scw-chip', label);
                chip.type = 'button';
                chip.dataset.act = 'radar-kind';
                chip.dataset.kind = kind;
                chip.setAttribute('aria-pressed', String(radarKind === kind));
                chips.append(chip);
            }
            const heard = el('button', 'scw-chip', T.radarHideHeard);
            heard.type = 'button';
            heard.dataset.act = 'radar-heard';
            heard.setAttribute('aria-pressed', String(radarHideHeard));
            chips.append(heard);
            box.append(chips);
        }
        const hint = (text: string): HTMLElement => {
            const line = el('div', 'scw-hint', text);
            line.setAttribute('role', 'status');
            return line;
        };
        if (!edition) return box;
        const foundRows = radarShowFound && radarFound?.key === radarKey(edition) ? radarFound.rows : null;
        if (radarShowFound && !Array.isArray(foundRows)) {
            box.append(hint(foundRows === 'failed' ? T.mixFailed : T.mixLoading));
            return box;
        }
        if (!rows.length) {
            box.append(hint(radarShowFound ? (foundRows?.length ? T.radarNoMatch : T.radarFoundEmpty) : T.radarEmptyWeek));
            return box;
        }
        if (!Array.isArray(loaded)) {
            box.append(hint(loaded === 'failed' ? T.mixFailed : T.mixLoading));
            return box;
        }
        const tracks = loaded.filter((track) => !isExcluded(track));
        if (!tracks.length) {
            box.append(hint(T.mixEmpty));
            return box;
        }
        const byId = new Map(rows.map((row) => [row.id, row]));
        const list = el('div', 'scw-mix-rows');
        const now = core.active() ? core.player()?.getCurrentSound()?.id ?? 0 : 0;
        const duration = (track: WaveTrack): HTMLElement => el('span', 'scw-row-d', formatTime(track.full_duration || track.duration || 0));
        for (const track of tracks) {
            const item = byId.get(track.id);
            const { row, end } = trackRow(track, now);
            if (item?.after) end.append(el('span', 'scw-badge', T.radarAfter));
            if (item?.kind === 'upload' && !uploads) end.append(el('span', 'scw-badge', T.radarPost));
            if (item?.heard) end.append(el('span', 'scw-badge', T.radarHeard));
            // Группа исполнителя: метка альбома или «+N» раскрывает остальные записи под строкой
            const open = !!item && item.group.length > 1 && radarGroupOpen === item.id;
            if (item && item.group.length > 1) {
                const toggle = el('button', 'scw-badge scw-group', groupLabel(item));
                toggle.type = 'button';
                toggle.dataset.act = 'radar-group';
                toggle.dataset.track = String(item.id);
                toggle.setAttribute('aria-expanded', String(open));
                end.append(toggle);
            }
            end.append(duration(track));
            list.append(row);
            if (!open || !item) continue;
            const group = el('div', 'scw-group-box');
            group.setAttribute('role', 'group');
            const album = radarAlbum(item);
            const head = el('div', 'scw-group-head');
            const all = textButton('radar-group-all', fillText(T.radarGroupAll, { n: String(item.group.length) }));
            all.dataset.track = String(item.id);
            head.append(el('b', '', album?.title || artistName(track)), all);
            group.append(head);
            const members = groupOrder(item).map((id) => radarTracks.get(id));
            if (members.some((member) => !member)) group.append(hint(T.mixLoading));
            else {
                const inner = el('div', 'scw-group-rows');
                for (const member of members) {
                    if (!member || !isWaveEligible(member) || isExcluded(member)) continue;
                    const line = trackRow(member, now);
                    line.end.append(duration(member));
                    inner.append(line.row);
                }
                group.append(inner);
            }
            list.append(group);
        }
        box.append(list);
        return box;
    }
    // Кнопки раскрытого выпуска: «Все найденные», группы исполнителя, пересборка и фильтры
    function radarClick(control: HTMLElement): void {
        switch (control.dataset.act) {
            case 'radar-found':
                toggleFound();
                return;
            case 'radar-group':
                toggleGroup(Number(control.dataset.track));
                return;
            case 'radar-group-all':
                void queueGroup(Number(control.dataset.track));
                return;
            case 'radar-rebuild':
                void rebuildRadar();
                return;
            case 'radar-kind':
            case 'radar-heard':
                if (control.dataset.act === 'radar-heard') radarHideHeard = !radarHideHeard;
                else radarKind = control.dataset.kind === 'release' || control.dataset.kind === 'upload' ? control.dataset.kind : 'all';
                loadRadarTracks(RADAR_CARD);
                render();
                return;
        }
    }
    return {
        cards: radarCardList,
        renderMix: renderRadarMix,
        toggle: toggleRadar,
        start: startRadar,
        click: radarClick,
        select: selectRadarEdition,
        ensure: ensureRadar,
        reason: (id) => radarReasons.get(id) ?? '',
        track: (id) => radarTracks.get(id),
        dispose: () => {
            delete host.__scRadarChanged;
            delete host.__scRadarReload;
            radarRequest++;
        },
    };
}
