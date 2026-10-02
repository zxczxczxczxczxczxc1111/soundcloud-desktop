// «Моя волна»: подбор треков через API сайта и блок первым на главной.
// Функции ниже уходят на страницу текстом, поэтому они не ссылаются на импорты и константы модуля,
// только друг на друга по имени: waveScript кладёт их объявления в одну обёртку со скриптом.
import type { PlaySignal, TrackMeta } from '../types';
import type { PlaybackSnapshot, LocalMix, LibraryCatalog } from './playbackStore';
import { installPlaybackPage } from './playbackPage';
import { installPlaybackRecovery } from './playbackRecovery';
import * as identity from './trackIdentity';
import * as sources from './pageSources';
import type { SyncBridge } from './pageSources';
import type { RecordingLink } from './trackIdentity';
import type { RadarCollectResult } from './radarSchedule';
import * as libraryMix from './libraryMix';
import type { LibraryMode } from './libraryMix';
import * as siteModules from './siteModules';
import type { SiteState, WebpackRequire } from './siteModules';
import type { WaveTrack, WaveMode, OpenTrackResult, WaveReason, WaveCandidate, WaveFilter, WaveTexts, TasteMaps, TasteScore, SeriesTrait, MenuTarget, WavePin, Excluded, MarkKind, Profile, Seed, WaveState as State } from './waveTypes';
import { WAVE_TEXTS } from './waveTexts';
import * as waveTexts from './waveTexts';
import * as waveGenres from './waveGenres';
import * as waveLinks from './waveLinks';
import * as wavePicks from './wavePicks';
import * as waveTaste from './waveTaste';
import * as waveMood from './waveMood';
import type { WaveMood, MoodScores, ArtistMoods } from './waveMood';
import * as versionsSection from './wave/versions';
import * as librarySectionModule from './wave/library';
import * as radarSectionModule from './wave/radar';
import * as shelfSectionModule from './wave/shelf';
import * as menuSectionModule from './wave/menu';
import * as quietSectionModule from './wave/quiet';
import type { QuietOptions } from './wave/quiet';
import * as waveSourcesModule from './wave/sources';
import type { ScMix } from './wave/sources';

// Разбор версий, сеть подбора и пул «Моей музыки» живут в своих модулях. Функции страницы зовут их по голому имени: в Node имя
// берётся отсюда, на странице из объявлений identityHelpers и sourceHelpers в той же обёртке.
// Именованный импорт превратился бы в trackIdentity_1.copyKey и на странице не нашёлся
const { confirmedCopies, confirmedGroups, copyKey, copyKeys, familyKey, matchLevel, nameKey, performerKey, searchQueries, trackCredits, versionKey } = identity;
const { classifyFailure, createDispatcher, createSearchCache, likeItems, entityItems, syncSource } = sources;
const { siteRequires } = siteModules;
// Чистые функции волны разложены по файлам. Здесь они разбираются в константы по той же причине: installWave зовёт их по голому имени
const { fillText, reasonText, localDay, countText, formatTime, shapeSamples } = waveTexts;
const { normalizeTag, tagKeys, tagShares, trackLang, genreKeys, genreEnglish, genreCanon, genrePhrases, genreParts, genreMain, parseGenres, formatGenres, genreKeysFor, trackMatchesGenre, topGenres } = waveGenres;
const { classifyLink, classifyTag, canonicalUrl, trackPath, artworkUrl, coversOf, playEnd, siteSource, retryDelay } = waveLinks;
const { trackArtist, rememberRecent, isWaveEligible, freshEnough, acceptCandidate, pickSpaced, spacingKeys, spacingGap, shuffleInPlace, capPerArtist, forgottenPicks, daySample, artistNames, performerNames, sharedPerformer, isNewArtist, spreadBy } = wavePicks;
const { tasteMaps, tasteSlot, tasteForTime, sourceBias, trackTraits, seriesTrait, tasteScore, tasteOrder, tasteReason, applyTasteReasons, tasteGroups, moodTags, pickFinds } = waveTaste;
const { moodList, moodDictionary, trackMood, playlistMood, artistMoods, neighborMood, moodScore } = waveMood;
// Разделы страницы волны в wave/: объявления уходят на страницу рядом с installWave и зовутся по голому имени
const { installVersions } = versionsSection;
const { installLibrary } = librarySectionModule;
const { installRadar } = radarSectionModule;
const { installShelf } = shelfSectionModule;
const { installMenu } = menuSectionModule;
const { installQuiet, quietBounds } = quietSectionModule;
const { installSources, relatedArtistsOf, scMixesOf, likedOwner, likersOf, tasteNeighbors, likedTracksOf, neighborLikes, interleaveMixes } = waveSourcesModule;
// Прежние импорты из wave.ts остаются рабочими
export type { WaveTrack, WaveMode, OpenTrackResult, WaveReason, WaveCandidate, WaveFilter, WaveLinkKind, WaveTexts, TasteMaps, TasteScore, TasteGroup } from './waveTypes';
export { WAVE_TEXTS, fillText, reasonText, localDay, countText, formatTime, shapeSamples } from './waveTexts';
export { normalizeTag, tagKeys, tagShares, trackLang, genreKeys, genreEnglish, genreCanon, genrePhrases, genreParts, genreMain, parseGenres, formatGenres, genreKeysFor, trackMatchesGenre, topGenres } from './waveGenres';
export { classifyLink, classifyTag, canonicalUrl, trackPath, artworkUrl, playEnd, siteSource, retryDelay } from './waveLinks';
export { trackArtist, rememberRecent, isWaveEligible, freshEnough, acceptCandidate, pickSpaced, spacingKeys, spacingGap, shuffleInPlace, capPerArtist, forgottenPicks, daySample, artistNames, performerNames, sharedPerformer, isNewArtist, spreadBy } from './wavePicks';
export { tasteMaps, tasteSlot, tasteForTime, sourceBias, trackTraits, seriesTrait, tasteScore, tasteOrder, tasteReason, applyTasteReasons, tasteGroups, moodTags, pickFinds } from './waveTaste';
export { moodList, moodDictionary, trackMood, playlistMood, artistMoods, neighborMood, moodScore } from './waveMood';
export type { WaveMood, MoodScores, ArtistMoods } from './waveMood';

export interface SiteSound {
    id: number;
    attributes?: WaveTrack;
    isPlayable?(): boolean;
    isSnippetized?(): boolean;
    isBlocked?(): boolean;
    seek(ms: number): void;
    getMediaDuration?(): number;
    currentTime?(): number;
}
export interface SiteQueueItem {
    sound?: SiteSound;
    explicit?: boolean;
    /** Откуда сайт поставил трек в очередь: single, playlist, stream, history и другие */
    sourceInfo?: { type?: unknown };
    release?(): void;
}
type QueueItemCtor = new (attributes: object, options: object) => SiteQueueItem;
type SoundCtor = new (json: object, options: object) => SiteSound;
interface SiteQueue {
    readonly length: number;
    model?: QueueItemCtor;
    slice(start?: number, end?: number): SiteQueueItem[];
    add(items: SiteQueueItem[]): void;
    reset(items: SiteQueueItem[]): void;
}
export interface SitePlayer {
    getQueue(): SiteQueue;
    getQueueState(): { currentIndex: number };
    getCurrentQueueItem(): SiteQueueItem | null | undefined;
    getCurrentSound(): SiteSound | null | undefined;
    replaceQueue(items: SiteQueueItem[], index: number, options?: { pause?: boolean }): void;
    playCurrent(options?: object): void;
    pauseCurrent(options?: object): void;
    isPlaying(): boolean;
    setCurrentItem(item: SiteQueueItem, options: object): void;
    getState(name: string): unknown;
    toggleState(name: string, value: boolean): void;
}
interface SiteApi {
    callEndpoint(name: string, path: object, query: object): Promise<{ status?: number; body?: unknown }>;
}
interface WaveJournalApi {
    load(userId: number): Promise<unknown>;
    add(userId: number, ids: number[]): void;
}
interface WaveExclusionsApi {
    load(userId: number): Promise<unknown>;
    set(userId: number, kind: 'track' | 'artist' | 'later-track' | 'later-artist' | 'more' | 'family', entry: object, excluded: boolean): Promise<unknown>;
}
export interface WaveWindow extends Window {
    __disposeWave?: () => void;
    __scWaveExclusionsChanged?: () => void;
    __scWaveTakeSignals?: () => { userId: number; signals: PlaySignal[] };
    __scOpenTrack?: (path: string, navigate?: boolean) => Promise<OpenTrackResult>;
    __scNavigate?: (path: string) => boolean;
    __scResolveTracks?: (ids: unknown) => Promise<{ asked: number[]; tracks: object[] } | null>;
    __scWhoAmI?: () => Promise<number>;
    __scSaveSession?: () => Promise<void>;
    __scResume?: () => void;
    /** Настройки тихих краёв трека из F1 */
    __scQuietOptions?: (value: unknown) => void;
    __scQueue?: () => void;
    // Горячие клавиши волны из main: лайк, «Не сейчас», «Больше такого», «Встряхнуть»
    __scWaveKey?: (action: string) => boolean;
    // Кэш средних цветов обложек из плавности сайта (pageMotion), ключ это путь трека
    __scmCoverColor?: (key: string) => string | undefined;
    __scmLearnCover?: (key: string, url: string) => void;
    // Перевод сайта из preload: state.lingua ставится, когда модуль перевода сайта перехвачен
    __scSiteTranslation?: { language?: string; state?: { lingua?: boolean } };
    soundcloudAPI?: {
        library?: {
            loadSession(user: number): Promise<PlaybackSnapshot | null>;
            saveSession(user: number, snapshot: PlaybackSnapshot): Promise<boolean>;
            loadCatalog(user: number): Promise<LibraryCatalog | null>;
            saveCatalog(user: number, tracks: WaveTrack[]): Promise<boolean>;
            listMixes(user: number): Promise<LocalMix[]>;
            saveMix(user: number, title: string, tracks: WaveTrack[]): Promise<LocalMix>;
            removeMix(user: number, id: string): Promise<boolean>;
        };
        waveJournal?: WaveJournalApi;
        waveExclusions?: WaveExclusionsApi;
        waveTaste?: { load(userId: number): Promise<unknown> };
        waveSignals?: { add(userId: number, signals: PlaySignal[]): void };
        waveShelf?: { load(userId: number): Promise<unknown>; save(userId: number, snapshot: object): Promise<unknown> };
        // «Моя музыка»: выбор и режим в настройках, слышанное в клиенте за 3 дня; дослушанное за час для старта волны
        waveLibrary?: { load(): Promise<unknown>; save(value: object): Promise<unknown>; heard(userId: number): Promise<unknown>; recent?(userId: number): Promise<unknown> };
        // Хранилище рекомендаций в worker: обход библиотеки и загрузки с разбором версий
        recommend?: SyncBridge & {
            syncState(user: number): Promise<unknown>;
            libraryMembers?(user: number, source: string): Promise<unknown>;
            recordingLinks?(user: number): Promise<unknown>;
            radarPlan?(user: number): Promise<unknown>;
            catalogChecked?(user: number, key: string, label: string, status: string, error: string, found: number): Promise<unknown>;
            setRecordingLink?(user: number, a: string, b: string, same: boolean): Promise<unknown>;
        };
        radar?: {
            view(user: number, period?: string, revision?: number): Promise<unknown>;
            found(user: number, period: string, revision?: number): Promise<unknown>;
            rebuild(user: number): Promise<unknown>;
            state(): Promise<unknown>;
        };
        reportWaveEmpty?(counts: { seen: number; artistTracks: number; moodTags: number }): void;
        // Сайт поменялся: чего страница не нашла; после находки то же сообщение снимает отметку
        reportSite?(state: SiteState): void;
        sendTrackMeta?(meta: TrackMeta): void;
        openHistory?(): void;
    };
}
interface WaveConfig {
    texts: Record<'ru' | 'en', WaveTexts>;
    /** Музыка в этом запуске клиента уже звучала: сессия, сохранённая во время игры, продолжает играть (страница упала
     * или перезагружена). Сразу после запуска клиента сессия встаёт на паузу, чтобы не встречать громкой музыкой */
    resume: boolean;
    /** Тихое начало и конец трека, затухание громкого конца (Ф2): настройки F1, дальше приходят через __scQuietOptions */
    quiet: QuietOptions;
}

export function installWave(config: WaveConfig, createPlayback: typeof installPlaybackPage, createRecovery: typeof installPlaybackRecovery): void {
    const host = window as unknown as WaveWindow & Record<string, unknown>;
    host.__disposeWave?.();
    const T: WaveTexts = config.texts[host.__scSiteTranslation?.language === 'ru' ? 'ru' : 'en'];
    const BATCH = 10;
    const REFILL_AT = 4;
    const STORE_KEY = 'scDesktopWave';

    interface Cursor { query: Record<string, string | number> | null; done: boolean }

    let player: SitePlayer | null = null;
    let api: SiteApi | null = null;
    let SoundModel: SoundCtor | null = null;
    let disposed = false;
    // Громкость трека для дышащего фона блока (Ф3), от 0 до 1
    let breath = 0;
    let state: State = 'idle';
    let mode: WaveMode = 'similar';
    let genre: string | null = null;
    let recentGenres: string[] = [];
    // Пресет настроения (В3): null это «Всё»
    let preset: WaveMood | null = null;
    try {
        const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') as { mode?: unknown; genre?: unknown; recentGenres?: unknown; preset?: unknown };
        if (saved.mode === 'fresh') mode = 'fresh';
        if (typeof saved.genre === 'string') genre = formatGenres(parseGenres(saved.genre)) || null;
        if (Array.isArray(saved.recentGenres)) recentGenres = saved.recentGenres.filter((item): item is string => typeof item === 'string').slice(0, 6);
        preset = moodList().find((mood) => mood === saved.preset) ?? null;
    } catch (error) {
        console.warn('Волна: настройки не прочитаны', error);
    }
    const saveSettings = (): void => {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify({ mode, genre, recentGenres, preset }));
        } catch (error) {
            console.warn('Волна: настройки не сохранены', error);
        }
    };
    // Свой вкус в пресете: ранние пропуски внутри пресета копятся по аккаунту и тегам именно для него и переживают перезапуск
    const MOODS_KEY = 'scDesktopWaveMoods';
    type PresetMarks = { a: Record<string, number>; t: Record<string, number> };
    let presetMarks: Partial<Record<WaveMood, PresetMarks>> = {};
    try {
        const saved = JSON.parse(localStorage.getItem(MOODS_KEY) || '{}') as Record<string, unknown>;
        const numbers = (value: unknown): Record<string, number> => {
            const out: Record<string, number> = {};
            if (value && typeof value === 'object') for (const [key, count] of Object.entries(value).slice(0, 400)) if (typeof count === 'number' && Number.isFinite(count) && count > 0) out[key.slice(0, 80)] = Math.min(count, 10);
            return out;
        };
        for (const mood of moodList()) {
            const entry = saved[mood] as { a?: unknown; t?: unknown } | undefined;
            if (entry && typeof entry === 'object') presetMarks[mood] = { a: numbers(entry.a), t: numbers(entry.t) };
        }
    } catch (error) {
        console.warn('Волна: отметки пресетов не прочитаны', error);
        presetMarks = {};
    }
    // Закрепления главной (В5): плейлисты, артисты и жанры в быстром ряду под волной, до 12, переживают перезапуск
    const PINS_KEY = 'scDesktopWavePins';
    const PIN_LIMIT = 12;
    const pinKey = (kind: WavePin['kind'], url: string, title: string): string => kind + ':' + (kind === 'genre' ? genreCanon(normalizeTag(title)) : canonicalUrl(url));
    let pins: WavePin[] = [];
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(PINS_KEY) || '[]');
        const seen = new Set<string>();
        for (const entry of Array.isArray(saved) ? saved : []) {
            const item = entry as { kind?: unknown; url?: unknown; title?: unknown } | null;
            if (!item || typeof item.title !== 'string' || typeof item.url !== 'string') continue;
            const title = item.title.trim().slice(0, 120);
            let pin: WavePin | null = null;
            if (item.kind === 'genre') {
                const name = formatGenres(parseGenres(title));
                if (name) pin = { kind: 'genre', url: '', title: name };
            } else if ((item.kind === 'playlist' || item.kind === 'artist') && title) {
                const link = classifyLink(item.url, 'https://soundcloud.com/');
                if (link?.kind === item.kind) pin = { kind: item.kind, url: link.url, title };
            }
            if (!pin || seen.has(pinKey(pin.kind, pin.url, pin.title))) continue;
            seen.add(pinKey(pin.kind, pin.url, pin.title));
            pins.push(pin);
            if (pins.length >= PIN_LIMIT) break;
        }
    } catch (error) {
        console.warn('Волна: закрепления не прочитаны', error);
        pins = [];
    }
    const savePins = (): void => {
        try {
            localStorage.setItem(PINS_KEY, JSON.stringify(pins));
        } catch (error) {
            console.warn('Волна: закрепления не сохранены', error);
        }
    };

    let profile: Profile | null = null;
    let profilePromise: Promise<Profile> | null = null;
    let profileRetryAt = 0;
    // Всё, что относится к текущим режиму и жанру; смена режима начинает новое поколение
    let generation = 0;
    let pool: WaveCandidate[] = [];
    let preview: WaveCandidate[] = [];
    let exhausted = false;
    let gathering: Promise<void> | null = null;
    let autoRetries = 0;
    const usedSeeds = new Set<number>();
    const usedStations = new Set<number>();
    const cursors = new Map<string, Cursor>();
    // Ключи вероятных копий взятого в сессию: перезалив той же версии не играет второй раз, другая версия может
    const signatures = new Set<string>();
    // Семьи версий (familyKey) взятого в поколение: одно произведение не встаёт дважды разными версиями
    const families = new Set<string>();
    // Сессия волны
    let active = false;
    let startedAt = 0;
    let fallbackBefore: boolean | null = null;
    // Автоплей сайта возвращён, потому что подборка кончилась
    let autoplayReleased = false;
    const ours = new WeakSet<SiteQueueItem>();
    const known = new Map<number, WaveCandidate>();
    // Паспорт элемента очереди волны для журнала: поколение, место в выдаче и откуда волна в момент постановки.
    // Трек волны остаётся треком волны и после её конца, а не пишется историей сайта
    interface QueueTrace { gen: number; slot: number; source: string; mode: WaveMode; waveGenre: string; libMode?: LibraryMode; preset?: WaveMood }
    const itemTrace = new WeakMap<SiteQueueItem, QueueTrace>();
    let generationAt = Date.now();
    let givenInGeneration = 0;
    const taken = new Set<number>();
    // Отдано сайту с начала текущей подборки (радар, карточка, артист): её собственный список отсекает только это.
    // known копится всю жизнь страницы, и повторный запуск радара вечером терял бы всё, что ушло в очередь утром
    const seedGiven = new Set<number>();
    // Версии, рано пропущенные человеком в этой сессии: их копии не повторяются, остальной аккаунт играет дальше
    const skipped = new Set<string>();
    const likedSeeds: WaveTrack[] = [];
    // Ключи аккаунта и исполнителя последних поставленных треков для разнесения, старые первыми
    const recentKeys: string[][] = [];
    // Реакция в сессии волны (В2.2): ранний пропуск снижает аккаунт, теги и зерно трека до конца волны, лайк и «Больше
    // такого» поднимают. Поправка идёт к оценке вкуса при каждом пересчёте пула
    const sessionArtists = new Map<number, number>();
    const sessionTags = new Map<string, number>();
    const sessionSeeds = new Map<number, number>();
    // Поправка источников (П9): выборка заново на каждый проход подбора, источник с лучшим исходом чаще впереди
    let sourceShift = new Map<string, number>();
    // Ранние пропуски подряд: три пересобирают очередь впереди (В2.14)
    let skipRun = 0;
    // П7: треки текущей серии ранних пропусков и прижатые до конца волны общие признаки серий (-1 к оценке).
    // Дослушанный трек с признаком снимает прижим
    let skipSeries: WaveTrack[] = [];
    const sessionTraits = new Map<string, SeriesTrait>();
    // П8: ранние пропуски подряд быстрее 5 секунд и открытая развилка «Куда дальше?» (варианты разных направлений)
    let fastRun = 0;
    let fork: { at: number; options: Array<{ candidate: WaveCandidate; label: string }> } | null = null;
    // Взятое из найденного, а не из своей подборки: пересборка впереди возвращает в пул только его
    const pooled = new WeakSet<WaveCandidate>();
    // Слышанное в клиенте за 3 дня: «Похожее» его не повторяет, как историю сайта (В2.4)
    let clientRecent = new Set<number>();
    let itemIndex = 900000;
    let seed: Seed | null = null;
    // Три к одному в «Умном перемешивании»: сколько своих подряд уже встало, счёт идёт через порции очереди
    let ownRun = 0;
    // Подборка, которая играет впереди найденного или вперемешку с ним
    let ownQueue: WaveCandidate[] = [];
    let derivedSeeds: WaveTrack[] = [];
    let ownAdded = false;
    // Запасной путь, когда похожие и станция почти пусты: треки артиста зерна берутся один раз,
    // теги настроения считаются один раз, их страницы листаются дальше
    let artistFallbackDone = false;
    let fallbackMood: string[] | null = null;
    // Для журнала диагностики, если волна от трека окажется пустой: сколько пришло из похожих и станции, сколько треков у артиста
    let seenCount = 0;
    let artistCount = 0;
    let seedRequest = 0;
    // Копия отметок из main: «Не нравится» и скрытые артисты навсегда, «Не сейчас» до until,
    // «Больше такого» это локальный лайк: трек становится зерном, модель вкуса учится на нём
    interface MoreEntry extends Excluded { artistId: number; genre: string; tags: string }
    const excludedTracks = new Map<number, Excluded>();
    const excludedArtists = new Map<number, Excluded>();
    const laterTracks = new Map<number, Excluded>();
    const laterArtists = new Map<number, Excluded>();
    const moreTracks = new Map<number, MoreEntry>();
    // «Скрыть другие версии»: ключи семей по разбору названия отмеченной загрузки
    const excludedFamilies = new Map<string, Set<string>>();
    // Сами отметки семей по id отмеченной загрузки: «Показывать другие версии» снимает все отметки этой семьи
    const familyEntries = new Map<number, { key: string; version: string; url: string }>();
    // Подтверждённые связи записей (решение пользователя или ISRC той же версии): загрузка -> корень группы.
    // По ним «Не нравится» и «уже слышано» переходят на копии; вероятные копии так не переносятся
    let copyGroups = new Map<string, string>();
    // Связи как есть: «Версии этого трека» показывает по ним решение пользователя
    let recordingLinks: RecordingLink[] = [];
    let exclusionsRevision = 0;
    let exclusionsPromise: Promise<void> | null = null;
    // Профиль вкуса из main: порядок подборки и причины, живёт 30 минут. taste это профиль с поправками текущего
    // отрезка суток (П5), tasteBase как пришёл: полка дня строится по нему
    let taste: TasteMaps | null = null;
    let tasteBase: TasteMaps | null = null;
    let tasteSlotNow = -1;
    let tasteAt = 0;
    let tastePromise: Promise<void> | null = null;
    let tasteFailed = false;
    // Слежение за текущим треком: журнал, пропуски и лайки
    let currentId = 0;
    // Когда волна увидела текущий трек: смену после этого считает человеком, только если действие было позже
    let currentSince = 0;
    let currentPosition = 0;
    let currentDuration = 0;
    let currentLiked = false;
    let jumped = false;
    // Что сейчас нарисовано на кнопке блока: играет или пауза
    let shownPlaying = false;
    // В6: трек, обложка и цвет подложки в блоке сейчас; смена трека идёт переходом от них.
    // drawFrom: когда начала расти форма нового трека (0 - не растёт), drawFor - трек, чья форма ещё не пришла
    let shownTrack = 0;
    let shownCover = '';
    let shownTint = '';
    let drawFrom = 0;
    let drawFor = 0;
    // «Меньше анимаций» в F1 (класс от плавности сайта) или системная настройка
    const calm = (): boolean => document.documentElement.classList.contains('scm-reduce') || (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const recorded = new Set<number>();
    const pendingJournal: number[] = [];
    let userId = 0;
    let journalTimer: ReturnType<typeof setTimeout> | undefined;
    // Журнал сигналов: одно событие на прослушивание любого трека, не только из волны
    interface Play { signal: PlaySignal; lastPosition: number; likedAtStart: boolean; spans: Array<[number, number]> }
    let play: Play | null = null;
    // Последнее действие человека на странице: клик или клавиша. Медиаклавиши и горячие клавиши клиента тоже кликают
    // кнопки плеера. Выбор конкретного трека отмечается только в своих списках (плитки и строки волны, панель очереди):
    // классы кнопок сайта не сверены, а для треков сайта отметка на вкус не влияет
    let lastInput = { at: 0, pick: false };
    const onUserInput = (event: Event): void => {
        const target = event.target instanceof Element ? event.target : null;
        const pick = event.type === 'click' && !target?.closest('a.scw-link') && !!target?.closest('.scw-tile[data-track], .scw-tile[data-fork], .scw-row[data-track], #sc-desktop-queue .scq-name');
        lastInput = { at: Date.now(), pick };
    };
    // Трек сменился в течение 4 секунд после действия: сменил человек (опрос раз в секунду, плюс запас на загрузку)
    const recentInput = (): boolean => Date.now() - lastInput.at < 4000;
    const pendingSignals: PlaySignal[] = [];
    let signalsTimer: ReturnType<typeof setTimeout> | undefined;
    // Сведения о текущем треке для карточки Discord: уходят в main, только когда поменялись
    let sentMeta = '';
    // «Встряхнуть»: зёрна прошлой подборки не берутся, пока хватает других
    const staleSeeds = new Set<number>();
    // Очередь текстового поиска: зерно и цель запроса чередуются от прохода к проходу
    let searchTurn = 0;
    // Дослушанное за последний час (П2): из сигналов этой страницы, новые первыми; main добавляет своё раз в 2 минуты
    let doneRecently: Array<{ track: WaveTrack; at: number }> = [];
    let doneLoadedAt = 0;
    // Первый проход поколения обычной волны начинается с дослушанного и похожего артиста его автора (П2)
    let contextPending = true;
    // Сколько взято из найденного в поколении: места 1-3 только уверенные (П2)
    let pickedInGeneration = 0;
    // Любимые артисты по кругу и уже взятые в поколении похожие на них (П3)
    let favoriteTurn = 0;
    const usedNeighbors = new Set<number>();
    let artistNeighborsDone = false;
    // Номера подборок SoundCloud вперемешку, ещё не взятые в этом поколении (П4)
    let scQueue: Array<{ id: number; mix: ScMix }> | null = null;

    // Раскрытая под полкой карточка: подборка или радар
    let openCard: number | null = null;
    // Прокрутка списка раскрытой подборки: отсоединённый при уходе со страницы список её забывает, по «Назад» она берётся отсюда
    let keptRowsScroll = 0;
    // То же для списка «Моей музыки». Страницу сайт по «Назад» ставит наверх: её место запоминает переход по нашей ссылке
    let keptLibraryScroll = 0;
    let keptPageScroll: number | null = null;
    let poppedAt = 0;
    // Радар на полке: номера карточек отрицательные и не -1, -1 в обработчике кнопок значит «подборки нет»
    const RADAR_CARD = -10;
    const UPLOADS_CARD = -11;
    const FANS_CARD = -12;
    const isRadarCard = (index: number | null | undefined): boolean => index === RADAR_CARD || index === UPLOADS_CARD || index === FANS_CARD;

    const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
    // Играющая волна больше не привязана к карточке: радара (выпуск сменился) или подборки (полка пересобрана)
    function releaseCard(radar: boolean): void {
        if (seed && isRadarCard(seed.card) === radar) seed.card = undefined;
    }
    // Раскрыть карточку под полкой или свернуть; раскрытая начинает список сверху
    function showCard(index: number | null): void {
        openCard = index;
        if (index !== null) keptRowsScroll = 0;
    }
    // Раскрытый список встаёт строкой под карточкой и в маленьком окне уходит за нижний край: он прокручивается в вид
    // и забирает фокус, свёрнутый отдаёт их карточке. Пока треки грузятся, список растёт, и render докручивает его 3 с
    let revealUntil = 0;
    function revealMix(): void {
        const list = section?.querySelector<HTMLElement>('.scw-shelf .scw-mix');
        if (!list) return;
        list.querySelector<HTMLElement>('.scw-mix-head [data-act]')?.focus({ preventScroll: true });
        list.scrollIntoView({ block: 'nearest' });
        revealUntil = Date.now() + 3000;
    }
    function backToCard(index: number): void {
        revealUntil = 0;
        const open = section?.querySelector<HTMLElement>('[data-act="shelf-open"][data-card="' + index + '"]');
        open?.focus({ preventScroll: true });
        open?.closest('.scw-card')?.scrollIntoView({ block: 'nearest' });
    }
    // Разделы из wave/: сборка с ядром. Стоит до кода, который их зовёт; константы ядра ниже по тексту идут обёртками
    // Похожие артисты, лучшие треки артиста и подборки SoundCloud: раздел в wave/sources.ts
    const waveSources = installSources({ call, backgroundCall, ensureUser, tracksOf: (body) => tracksOf(body) });
    // «Версии этого трека»: раздел в wave/versions.ts
    const versions = installVersions({
        texts: T,
        host,
        copyGroups: () => copyGroups,
        recordingLinks: () => recordingLinks,
        linked: (groups) => {
            copyGroups = groups;
            exclusionsRevision++;
        },
        el,
        button,
        art: (node, track, size) => art(node, track, size),
        artistName: (track) => artistName(track),
        ensureStyle,
        trackOf,
        ensureExclusions,
        searchTracks,
        showToast,
        openTrack,
        ensureUser,
        loadCopyGroups,
        render: () => render(),
    });
    // «Моя музыка»: раздел в wave/library.ts
    const librarySection = installLibrary({
        texts: T,
        host,
        userId: () => userId,
        state: () => state,
        active: () => active,
        disposed: () => disposed,
        player: () => player,
        profile: () => profile,
        seed: () => seed,
        seedRequest: () => seedRequest,
        nextSeedRequest: () => ++seedRequest,
        ours,
        untake: (id) => {
            taken.delete(id);
        },
        jumped: () => {
            jumped = true;
        },
        resetLibraryScroll: () => {
            keptLibraryScroll = 0;
        },
        queueView,
        resetGeneration,
        restartAhead,
        beginSeed,
        ensureProfile,
        expandLibrary,
        ensureExclusions,
        ensureUser,
        call,
        collection: (body) => collection(body),
        nextQuery: (body) => nextQuery(body),
        asTrack: (value) => asTrack(value),
        libraryPlaylist,
        disliked: () => disliked(),
        excludedArtists,
        laterTracks,
        laterArtists,
        marked: (map, id) => marked(map, id),
        render: () => render(),
        showToast,
        el,
        button,
        textButton,
        trackRow,
    });
    // Пятничный радар: раздел в wave/radar.ts
    const radarSection = installRadar({
        texts: T,
        host,
        radarCard: RADAR_CARD,
        uploadsCard: UPLOADS_CARD,
        fansCard: FANS_CARD,
        isRadarCard,
        active: () => active,
        disposed: () => disposed,
        player: () => player,
        seed: () => seed,
        seedRequest: () => seedRequest,
        nextSeedRequest: () => ++seedRequest,
        releaseCard,
        openCard: () => openCard,
        showCard,
        addMany: (tracks, next) => queueControls.addMany(tracks, next),
        isExcluded: (track) => isExcluded(track),
        artistName: (track) => artistName(track),
        tracksByIds: (ids) => shelfSection.tracksByIds(ids),
        beginSeed,
        ensureProfile,
        ensureExclusions,
        ensureUser,
        call,
        render: () => render(),
        showToast,
        el,
        button,
        textButton,
        trackRow,
    });
    // Подборки на полке и набор треков из меню: раздел в wave/shelf.ts
    const shelfSection = installShelf({
        texts: T,
        host,
        uploadsCard: UPLOADS_CARD,
        isRadarCard,
        state: () => state,
        active: () => active,
        disposed: () => disposed,
        player: () => player,
        seed: () => seed,
        seedRequest: () => seedRequest,
        nextSeedRequest: () => ++seedRequest,
        releaseCard,
        openCard: () => openCard,
        showCard,
        copyGroups: () => copyGroups,
        taste: () => tasteBase,
        tasteFailed: () => tasteFailed,
        radarCards: radarSection.cards,
        radarMix: radarSection.renderMix,
        isExcluded: (track) => isExcluded(track),
        artistName: (track) => artistName(track),
        paintArt: (node, url, key) => paintArt(node, url, key),
        tracksOf: (body) => tracksOf(body),
        trackOf,
        beginSeed,
        ensureProfile,
        expandLibrary,
        ensureExclusions,
        ensureTaste,
        ensureUser,
        call,
        scMixes: () => waveSources.scMixes(),
        neighbors: (seeds, fresh) => waveSources.neighbors(seeds, fresh),
        render: () => render(),
        showToast,
        el,
        button,
        textButton,
        trackRow,
    });
    // Меню по правому клику и волна от трека, артиста, плейлиста: раздел в wave/menu.ts
    const menuSection = installMenu({
        texts: T,
        state: () => state,
        disposed: () => disposed,
        player: () => player,
        api: () => !!api,
        seedRequest: () => seedRequest,
        nextSeedRequest: () => ++seedRequest,
        known,
        preview: () => preview,
        sectionTrack: (id) => shelfSection.track(id) ?? radarSection.track(id) ?? librarySection.poolTrack(id),
        currentCandidate,
        fromTrack,
        excludedTracks,
        excludedArtists,
        laterTracks,
        laterArtists,
        moreTracks,
        marked: (map, id) => marked(map, id),
        familyHidden,
        setExcluded,
        setFamily,
        addTrack: (track, next) => queueControls.add(track, next),
        pickedIndex: shelfSection.pickedIndex,
        pick: shelfSection.pick,
        openVersions: versions.open,
        trackOf,
        artistOf,
        artistOwnTracks,
        artistCatalog,
        playlistTracks,
        resolveUrl,
        beginSeed,
        ensureProfile,
        ensureExclusions,
        ensureStyle,
        showToast,
        onScroll: () => onScroll(),
        el,
        pinned: (target) => pinIndex(target) >= 0,
        pin: (target, add) => pinTarget(target, add),
        playGenre: (label) => playGenre(label),
        cardGenre: (node) => {
            const card = node.closest<HTMLElement>('.scw-card[data-card]');
            const index = card ? Number(card.dataset.card) : -1;
            return Number.isInteger(index) && index >= 0 ? shelfSection.genreOf(index) : '';
        },
    });
    // Тихое начало и мягкий конец (Ф2): F1 меняет настройки без перезагрузки страницы
    let quietOptions: QuietOptions = { edges: config.quiet?.edges !== false, fade: config.quiet?.fade !== false };
    host.__scQuietOptions = (value: unknown) => {
        const next = value as Partial<Record<keyof QuietOptions, unknown>> | null;
        if (next && typeof next === 'object') quietOptions = { edges: next.edges !== false, fade: next.fade !== false };
    };
    const quietSection = installQuiet({ player: () => player, rawSamples: (track) => waveformOf(track)?.raw ?? null, options: () => quietOptions, disposed: () => disposed });

    const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    // Волна и действия пользователя идут сразу; фоновой обход ждёт их, держит шаг в секунду и паузу после 429.
    // Создаётся до первого возможного запроса: call зовут уже при установке очереди
    const dispatcher = createDispatcher({
        now: () => Date.now(),
        later: (run, ms) => setTimeout(run, ms),
        cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });
    const searchCache = createSearchCache<WaveTrack>({ now: () => Date.now() });
    // Модель трека сайта может оказаться без методов (чужой элемент очереди): тогда длительность и позиция нулевые
    const durationOf = (sound: SiteSound | null | undefined): number => (typeof sound?.getMediaDuration === 'function' ? sound.getMediaDuration() || 0 : 0);
    const positionOf = (sound: SiteSound | null | undefined): number => (typeof sound?.currentTime === 'function' ? sound.currentTime() || 0 : 0);

    function createQueueItem(track: WaveTrack): SiteQueueItem | null {
        const Item = player?.getQueue().model;
        if (!Item || !SoundModel) return null;
        const sound = new SoundModel(track, { parse: true });
        if ((sound.isPlayable && !sound.isPlayable()) || sound.isBlocked?.()) return null;
        const index = itemIndex++;
        const item = new Item({}, { sound, originalModel: sound, queryPosition: index, sourceInfo: { type: 'history' }, index });
        item.release?.(); return item;
    }
    function snapshot(): PlaybackSnapshot | null {
        const p = player; if (!p) return null;
        const { items, index } = queueView();
        if (index < 0 || !items[index]?.sound || items.length > 5000) return null;
        const saved = items.flatMap((item) => item.sound ? [{ track: { ...item.sound.attributes, id: item.sound.id }, explicit: item.explicit === true, wave: ours.has(item), reason: known.get(item.sound.id)?.reason }] : []);
        if (saved.length !== items.length) return null;
        return { version: 1, at: Date.now(), items: saved, index, position: positionOf(p.getCurrentSound()), paused: !p.isPlaying(),
            active, mode, genre, seed: savedSeed(), fallback: fallbackBefore ?? p.getState('fallbackEnabled') === true };
    }
    // «Моя музыка» кладёт в сессию выбор, режим и номера оставшихся треков, без самих треков: пул на тысячи треков
    // переписывался бы мегабайтами при каждой записи. После перезапуска он собирается заново и идёт с того же места
    function savedSeed(): Seed | null {
        // Свою причину трека подборки знает его место в очереди; таблица через мост не передаётся
        if (seed?.reasons) return { ...seed, reasons: undefined };
        if (seed?.kind !== 'library' || !seed.library) return seed;
        const left = seed.library.left ?? (ownAdded ? ownQueue.map((item) => item.track.id) : seed.own.map((track) => track.id));
        return { ...seed, tracks: [], own: [], library: { pick: seed.library.pick, mode: seed.library.mode, left: left.slice(0, 5000) } };
    }
    function restoreSnapshot(saved: PlaybackSnapshot, tracks: WaveTrack[]): boolean {
        const p = player; if (!p || disposed) return false;
        const byId = new Map(tracks.map((track) => [track.id, track]));
        const items: SiteQueueItem[] = [];
        let selected = -1;
        // Найденное волной после перезапуска снова пересобирается пропусками (В2.2); своё из подборки, зерно
        // и трек без сохранённой причины остаются на своих местах
        const ownKinds = new Set<WaveReason['kind']>(['library', 'daily', 'forgotten', 'likedBy', 'group', 'radar', 'seedTrack', 'restored']);
        for (let i = 0; i < saved.items.length; i++) {
            const stored = saved.items[i]; const track = byId.get(stored.track.id);
            const item = track ? createQueueItem(track) : null;
            if (!item) continue;
            if (selected < 0 && i >= saved.index) selected = items.length;
            item.explicit = stored.explicit;
            if (stored.wave && track) {
                ours.add(item);
                const candidate: WaveCandidate = { track, reason: stored.reason ?? { kind: 'restored' } };
                known.set(track.id, candidate);
                if (!ownKinds.has(candidate.reason.kind)) pooled.add(candidate);
            }
            items.push(item);
        }
        if (selected < 0) return false;
        openRequest++; seedRequest++; resetGeneration();
        active = saved.active; mode = saved.mode; genre = saved.genre; seed = saved.seed;
        // Место в выдаче после перезапуска неизвестно
        for (const item of items) if (ours.has(item)) itemTrace.set(item, queueTrace(0));
        // Сессия продолжает ту же подборку: уже стоявшее в очереди её список не повторяет
        seedGiven.clear();
        for (const item of items) if (ours.has(item) && item.sound) seedGiven.add(item.sound.id);
        fallbackBefore = active ? saved.fallback : null;
        p.toggleState('fallbackEnabled', active ? false : saved.fallback);
        startedAt = Date.now(); jumped = true;
        // SoundCloud по умолчанию запускает заменённую очередь через setCurrentItem. Пауза должна быть явной до её замены.
        p.replaceQueue(items, selected, { pause: true });
        const sound = items[selected].sound;
        if (sound?.id === saved.items[saved.index].track.id && saved.position > 0) sound.seek(saved.position);
        if (saved.paused || !config.resume) p.pauseCurrent({ userInitiated: true });
        else p.playCurrent({ userInitiated: true });
        state = active ? 'playing' : 'idle';
        render(); return true;
    }
    const queueControls = createPlayback({
        player: () => player, user: ensureUser, library: host.soundcloudAPI?.library, language: T.lang,
        snapshot, restore: restoreSnapshot, create: createQueueItem,
        state: () => [active, mode, genre, fallbackBefore, seed?.kind, seed?.title, seed?.card, seed?.order, seed?.mode, seed?.library?.pick.join(','), seed?.library?.mode].join('|'),
        resolve: async (ids) => {
            const tracks: WaveTrack[] = [];
            for (let i = 0; i < ids.length && !disposed; i += 100) {
                const parts = [ids.slice(i, i + 50), ids.slice(i + 50, i + 100)].filter((part) => part.length);
                const loaded = await Promise.all(parts.map((part) => call('trackBatch', {}, { ids: part.join(',') })));
                for (const body of loaded) tracks.push(...tracksOf(body));
            }
            return tracks;
        },
        changed: () => { openRequest++; tick(); render(); },
    });
    host.__scQueue = () => queueControls.toggle();
    host.__scSaveSession = () => queueControls.save();
    const recovery = createRecovery({ player: () => player, language: T.lang, checkpoint: () => queueControls.save(), refresh: () => {
        profileRetryAt = 0;
        shelfSection.resetFailures();
        if (isVisible()) shelfSection.ensure();
        if (profile) void expandLibrary(profile).catch((error: unknown) => console.warn('Библиотека не обновлена', error));
        if (profile) scheduleLibrarySync(20000);
        void queueControls.ready().catch((error: unknown) => console.warn('Сессия не восстановлена', error));
        if (active) void refill();
    } });
    host.__scResume = () => recovery.resume();

    function findRequire(): WebpackRequire[] {
        return siteRequires(host, '__scWave');
    }
    // Через минуту после запуска страница сообщает, чего не нашла у сайта: без этого смена модулей молча выключала
    // историю, сессию и радар. Отметку снимает то же сообщение после находки
    let siteReported = false;
    function reportSite(): void {
        const translation = host.__scSiteTranslation;
        const found: SiteState = { player: !!player, api: !!api, sound: !!SoundModel, translation: translation?.language !== 'ru' || translation.state?.lingua === true };
        const broken = !found.player || !found.api || !found.sound || !found.translation;
        if (broken || siteReported) host.soundcloudAPI?.reportSite?.(found);
        siteReported = broken;
    }
    const siteCheck = setTimeout(reportSite, 60000);
    function chainHas(fn: unknown, names: string[]): boolean {
        if (typeof fn !== 'function') return false;
        const seen = new Set<string>();
        try {
            for (let proto = (fn as { prototype?: object }).prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto) as object)
                for (const name of Object.getOwnPropertyNames(proto)) seen.add(name);
        } catch {
            return false;
        }
        return names.every((name) => seen.has(name));
    }
    // Модули сайта ищутся по набору имён: номера меняются от сборки к сборке
    function findModules(): boolean {
        const playerNames = ['replaceQueue', 'getQueue', 'getQueueState', 'playCurrent', 'pauseCurrent', 'getCurrentSound', 'getCurrentQueueItem', 'toggleState', 'getState', 'setCurrentItem', 'isPlaying'];
        for (const require of findRequire()) {
            for (const entry of Object.values(require.c ?? {})) {
                const exports = entry?.exports as Record<string, unknown> | undefined;
                if (!exports) continue;
                if (!player && typeof exports === 'object' && playerNames.every((name) => typeof exports[name] === 'function')) player = exports as unknown as SitePlayer;
                if (!api && typeof exports === 'object' && typeof exports.callEndpoint === 'function' && typeof exports.callEndpointByUrl === 'function') api = exports as unknown as SiteApi;
                if (!SoundModel && chainHas(exports, ['isSnippetized', 'isBlocked', 'isPlayable', 'seek', 'getMediaDuration'])) SoundModel = exports as unknown as SoundCtor;
            }
            if (player && api && SoundModel) return typeof player.getQueue().model === 'function';
        }
        return false;
    }

    async function request(name: string, path: object, query: object): Promise<unknown> {
        if (!api) throw new Error('API сайта не найден');
        const result = await Promise.race([api.callEndpoint(name, path, query), wait(15000).then(() => { throw new Error('Тайм-аут ' + name); })]);
        return result.body;
    }
    function call(name: string, path: object, query: object): Promise<unknown> {
        return dispatcher.user(() => request(name, path, query));
    }
    function backgroundCall(name: string, path: object, query: object): Promise<unknown> {
        return dispatcher.background(() => request(name, path, query));
    }
    const collection = (body: unknown): unknown[] => {
        const list = (body as { collection?: unknown } | null)?.collection;
        return Array.isArray(list) ? list : Array.isArray(body) ? body : [];
    };
    const nextQuery = (body: unknown): Record<string, string> | null => {
        const href = (body as { next_href?: unknown } | null)?.next_href;
        if (typeof href !== 'string') return null;
        try {
            const params = new URL(href).searchParams;
            for (const name of ['client_id', 'app_version', 'app_locale']) params.delete(name);
            return Object.fromEntries(params);
        } catch {
            return null;
        }
    };
    const asTrack = (value: unknown): WaveTrack | null =>
        value && typeof value === 'object' && typeof (value as WaveTrack).id === 'number' ? (value as WaveTrack) : null;

    async function ensureUser(): Promise<number> {
        if (!userId) {
            const me = (await call('me', {}, {})) as { id?: unknown } | null;
            userId = typeof me?.id === 'number' && me.id > 0 ? me.id : 0;
        }
        return userId;
    }
    async function loadProfile(): Promise<Profile> {
        const userId = await ensureUser();
        const history: WaveTrack[] = [];
        const liked = new Set<number>();
        let likedTracks: WaveTrack[] = [];
        let journal: number[] = [];
        let likesCursor: Record<string, string | number> | null = null;
        const failures: unknown[] = [];
        await Promise.all([
            call('playHistoryTracks', {}, { limit: 200 }).then((body) => {
                for (const entry of collection(body)) {
                    const track = asTrack((entry as { track?: unknown }).track);
                    if (track) history.push(track);
                }
            }).catch((error: unknown) => { failures.push(error); console.warn('Волна: история не загружена', error); }),
            (async () => {
                const body = await call('soundLikesIds', {}, { limit: 200 });
                for (const id of collection(body)) if (typeof id === 'number') liked.add(id);
                likesCursor = nextQuery(body);
                const first = [...liked].slice(0, 50);
                if (first.length) likedTracks = collection(await call('trackBatch', {}, { ids: first.join(',') })).map(asTrack).filter((track): track is WaveTrack => !!track);
            })().catch((error: unknown) => { failures.push(error); console.warn('Волна: лайки не загружены', error); }),
            (async () => {
                const loaded = userId ? await host.soundcloudAPI?.waveJournal?.load(userId) : [];
                if (Array.isArray(loaded)) journal = loaded.filter((id): id is number => typeof id === 'number');
            })().catch((error: unknown) => console.warn('Волна: журнал не загружен', error)),
            (async () => {
                const ids = userId ? await host.soundcloudAPI?.waveLibrary?.heard(userId) : [];
                if (Array.isArray(ids)) clientRecent = new Set(ids.filter(isId));
            })().catch((error: unknown) => console.warn('Волна: слышанное за 3 дня не загружено', error)),
        ]);
        if (failures.length) throw new Error('Профиль SoundCloud загружен не полностью', { cause: failures[0] });
        const recent = new Set(history.map((track) => track.id));
        const heard = new Set([...journal, ...recent]);
        const knownArtists = new Set([...history, ...likedTracks].map(trackArtist));
        const knownNames = artistNames([...history, ...likedTracks]);
        return { userId, history, recent, heard, liked, likedTracks, knownArtists, knownNames, loadedAt: Date.now(), likesCursor };
    }
    function ensureProfile(): Promise<Profile> {
        if (profile && (Date.now() - profile.loadedAt < 30 * 60000 || Date.now() < profileRetryAt)) return Promise.resolve(profile);
        profilePromise ??= loadProfile().then((loaded) => {
            // Прослушанное в этой сессии не теряется при обновлении профиля. Лайки тоже: новый профиль знает одну страницу,
            // и до конца листания «Новое» пропускало бы старые лайки, а знакомые артисты шли бы «новыми»
            const previous = profile;
            if (previous) {
                for (const id of previous.heard) loaded.heard.add(id);
                loaded.unconfirmed = new Set([...previous.liked].filter((id) => !loaded.liked.has(id)));
                for (const id of loaded.unconfirmed) loaded.liked.add(id);
                const have = new Set(loaded.likedTracks.map((track) => track.id));
                loaded.likedTracks.push(...previous.likedTracks.filter((track) => !have.has(track.id)));
                for (const artist of previous.knownArtists) loaded.knownArtists.add(artist);
                for (const name of previous.knownNames) loaded.knownNames.add(name);
            }
            profile = loaded;
            profileRetryAt = 0;
            void expandLibrary(loaded).catch((error: unknown) => console.warn('Волна: библиотека догрузится позже', error));
            // Полный обход библиотеки ждёт, пока страница и волна разгрузятся
            scheduleLibrarySync(20000);
            return loaded;
        }).catch((error: unknown) => {
            if (!profile) throw error;
            profileRetryAt = Date.now() + 15000;
            console.warn('Волна: используется последний загруженный профиль', error);
            return profile;
        }).finally(() => { profilePromise = null; });
        return profilePromise;
    }
    let expanding: Profile | null = null;
    let expansion: Promise<void> | null = null;
    function expandLibrary(current: Profile): Promise<void> {
        if (expanding === current && expansion) return expansion;
        expansion = expandLibraryData(current);
        return expansion;
    }
    async function expandLibraryData(current: Profile): Promise<void> {
        expanding = current;
        try {
            const cached = await host.soundcloudAPI?.library?.loadCatalog(current.userId);
            if (disposed || profile !== current) return;
            const byId = new Map(current.likedTracks.map((track) => [track.id, track]));
            if (cached) for (const track of cached.tracks) byId.set(track.id, track);
            // Имена дополняются только новыми треками: разбор всей библиотеки на каждой порции заморозил бы страницу
            const named = new Set([...current.history, ...current.likedTracks].map((track) => track.id));
            const publish = (): void => {
                current.likedTracks = [...byId.values()].filter((track) => current.liked.has(track.id));
                current.knownArtists = new Set([...current.history, ...current.likedTracks].map(trackArtist));
                const added = current.likedTracks.filter((track) => !named.has(track.id));
                for (const track of added) named.add(track.id);
                for (const name of artistNames(added)) current.knownNames.add(name);
            };
            const visited = new Set<string>();
            do {
                const missing = [...current.liked].filter((id) => !byId.has(id));
                for (let i = 0; i < missing.length && !disposed && profile === current; i += 100) {
                    await Promise.all([missing.slice(i, i + 50), missing.slice(i + 50, i + 100)].filter((part) => part.length).map(async (part) => {
                        for (const track of tracksOf(await call('trackBatch', {}, { ids: part.join(',') }))) byId.set(track.id, track);
                    }));
                    if (disposed || profile !== current) return;
                    publish();
                    await wait(100);
                }
                if (!current.likesCursor || disposed || profile !== current) break;
                const key = JSON.stringify(current.likesCursor);
                if (visited.has(key) || current.liked.size >= 100000) throw new Error('Зацикленная или слишком большая библиотека SoundCloud');
                visited.add(key);
                const body = await call('soundLikesIds', {}, current.likesCursor);
                if (disposed || profile !== current) return;
                for (const id of collection(body)) if (typeof id === 'number') {
                    current.liked.add(id);
                    current.unconfirmed?.delete(id);
                }
                current.likesCursor = nextQuery(body);
            } while (!disposed && profile === current);
            if (disposed || profile !== current) return;
            // Листание дошло до конца: лайки прошлого профиля, которых в нём не оказалось, сняты
            for (const id of current.unconfirmed ?? []) current.liked.delete(id);
            current.unconfirmed = undefined;
            publish();
            if (host.soundcloudAPI?.library && !await host.soundcloudAPI.library.saveCatalog(current.userId, current.likedTracks)) throw new Error('Каталог не сохранён');
        } finally {
            if (expanding === current) expanding = null;
        }
    }

    // Фоновой обход библиотеки в хранилище рекомендаций: лайки с датами, подписки, свои и сохранённые плейлисты.
    // Источник обходится заново через 12 часов после полного обхода, после сбоя не раньше чем через 10 минут.
    // Идёт фоном через диспетчер и музыке не мешает
    let librarySync: Promise<void> | null = null;
    let librarySyncTimer: ReturnType<typeof setTimeout> | undefined;
    function scheduleLibrarySync(delay: number): void {
        if (librarySyncTimer !== undefined || disposed || !host.soundcloudAPI?.recommend) return;
        librarySyncTimer = setTimeout(() => {
            librarySyncTimer = undefined;
            void syncLibrary();
        }, delay);
    }
    function syncLibrary(): Promise<void> {
        const bridge = host.soundcloudAPI?.recommend;
        if (!bridge || disposed) return Promise.resolve();
        librarySync ??= (async () => {
            const user = await ensureUser();
            if (!user || disposed) return;
            const loaded = await bridge.syncState(user);
            const states = Array.isArray(loaded) ? (loaded as Array<{ source?: unknown; status?: unknown; completed?: unknown; updated?: unknown; error?: unknown }>) : [];
            const due = (source: string): boolean => {
                const state = states.find((item) => item.source === source);
                if (!state) return true;
                const since = (value: unknown): number => Date.now() - (typeof value === 'number' ? value : 0);
                // Плейлиста больше нет (404, 410), а сайт держит его номер в сохранённых: проверка раз в неделю,
                // а не на каждом обходе, вдруг его откроют снова
                if (state.status === 'failed' && typeof state.error === 'string' && state.error.startsWith('missing')) return since(state.updated) > 7 * 86400000;
                return state.status === 'complete' ? since(state.completed) > 12 * 3600000 : since(state.updated) > 10 * 60000;
            };
            const bulk = new Set<string>();
            // Подписки первыми: это главный источник радара, и обходятся они одной страницей
            const plans: sources.SyncPlan[] = [
                { source: 'followings', first: { limit: 5000 }, fetch: (query) => backgroundCall('myFollowingsIds', { userId: user }, query), items: (body) => entityItems(body, 'user') },
                { source: 'likes', first: { limit: 200 }, fetch: (query) => backgroundCall('userTrackLikes', { id: user }, query), items: (body) => likeItems(body, bulk) },
                { source: 'playlists', first: { limit: 50 }, fetch: (query) => backgroundCall('userPlaylistsWithoutAlbums', { id: user }, query), items: (body) => entityItems(body, 'playlist') },
                { source: 'playlist-likes', first: { limit: 200 }, fetch: (query) => backgroundCall('playlistLikesIds', {}, query), items: (body) => entityItems(body, 'playlist') },
            ];
            for (const plan of plans) {
                if (disposed || !due(plan.source)) continue;
                const result = await syncSource({
                    user, plan, bridge, nextQuery, maxPages: 1000, now: () => Date.now(), stopped: () => disposed,
                    // Сайт мог сменить вход без перезагрузки: чужие ответы в библиотеку этого аккаунта не попадают
                    stillOwner: async () => ((await backgroundCall('me', {}, {})) as { id?: unknown } | null)?.id === user,
                });
                if (result.status !== 'complete') console.warn('Библиотека: обход ' + plan.source + ' ' + result.status + (result.error ? ': ' + result.error : ''));
                // Вход пропал или аккаунт сменился: остальные источники тоже не ответят этому аккаунту
                if (result.error.startsWith('auth') || result.error === 'account-changed') return;
            }
            // Треки своих и сохранённых плейлистов (Э6): источник playlist:<id> одной страницей, треки целиком уходят
            // в хранилище загрузок, иначе вкус и жанры полки не увидят жанр. Убранный из библиотеки плейлист не обходится,
            // и вкус его не читает (tasteLibrary берёт только плейлисты из текущих списков)
            if (disposed || !bridge.libraryMembers) return;
            const lists = await Promise.all(['playlists', 'playlist-likes'].map((source) => bridge.libraryMembers?.(user, source)));
            const playlists = [...new Set(lists.flatMap((list) => (Array.isArray(list) ? list : [])
                .map((member: unknown) => Number(String((member as { key?: unknown } | null)?.key ?? '').slice('sc:playlist:'.length)))
                .filter(isId)))];
            for (const id of playlists) {
                const source = 'playlist:' + id;
                if (disposed || !due(source)) continue;
                const result = await syncSource({
                    user, bridge, nextQuery: () => null, maxPages: 1, now: () => Date.now(), stopped: () => disposed,
                    stillOwner: async () => ((await backgroundCall('me', {}, {})) as { id?: unknown } | null)?.id === user,
                    plan: {
                        source, first: {}, fetch: () => libraryPlaylist(id),
                        items: (body) => tracksOf(body).map((track) => ({ key: 'sc:track:' + track.id, added: 0, track: track as object })),
                    },
                });
                if (result.status !== 'complete') console.warn('Библиотека: обход ' + source + ' ' + result.status + (result.error ? ': ' + result.error : ''));
                if (result.error.startsWith('auth') || result.error === 'account-changed') return;
            }
        })().catch((error: unknown) => console.warn('Библиотека: обход не завершён', error)).finally(() => { librarySync = null; });
        return librarySync;
    }
    // Плейлист целиком: сайт отдаёт все номера одним ответом (до 500), первые треки целиком, остальные заготовками
    // {id, kind, policy}; заготовки добираются trackBatch по 50, по два запроса сразу. Порядок плейлиста сохраняется,
    // трек, которого сайт не отдал (удалён или закрыт), в состав не входит. Обход идёт фоном, «Моя музыка» сразу
    async function libraryPlaylist(id: number, send: typeof call = backgroundCall): Promise<{ title: string; collection: WaveTrack[] }> {
        const body = (await send('playlist', { id }, {})) as { title?: unknown; tracks?: unknown } | null;
        const listed = Array.isArray(body?.tracks) ? body.tracks.map(asTrack).filter((track): track is WaveTrack => !!track) : null;
        if (!listed) throw new Error('Плейлист ' + id + ' пришёл без списка треков');
        const full = new Map(listed.filter((track) => typeof track.title === 'string').map((track) => [track.id, track]));
        const missing = listed.filter((track) => !full.has(track.id)).map((track) => track.id);
        for (let i = 0; i < missing.length && !disposed; i += 100)
            await Promise.all([missing.slice(i, i + 50), missing.slice(i + 50, i + 100)].filter((part) => part.length).map(async (part) => {
                for (const track of tracksOf(await send('trackBatch', {}, { ids: part.join(',') }))) full.set(track.id, track);
            }));
        return { title: typeof body?.title === 'string' ? body.title.trim() : '', collection: listed.map((track) => full.get(track.id)).filter((track): track is WaveTrack => !!track) };
    }

    // Сбор каталога для радара (раздел 8 плана): main зовёт по расписанию с бюджетом времени. Какие источники смотреть,
    // решает worker (подписки, кураторы и любимые участники из вкуса); страница только ходит на сайт фоном через
    // диспетчер и пишет найденное. Отказ источника отмечается отказом, а не пустым каталогом
    let radarCollect: Promise<RadarCollectResult> | null = null;
    host.__scRadarCollect = (budgetMs: unknown, staleBefore: unknown): Promise<RadarCollectResult> => {
        radarCollect ??= collectRadar(typeof budgetMs === 'number' ? budgetMs : 0, typeof staleBefore === 'number' ? staleBefore : 0)
            .finally(() => { radarCollect = null; });
        return radarCollect;
    };
    async function collectRadar(budgetMs: number, staleBefore: number): Promise<RadarCollectResult> {
        const bridge = host.soundcloudAPI?.recommend;
        const result: RadarCollectResult = { user: 0, checked: 0, remaining: 0, stopped: '' };
        if (!api || !bridge?.radarPlan || !bridge.catalogChecked || !bridge.recordUploads) return { ...result, stopped: 'no-api' };
        const deadline = Date.now() + Math.max(0, Math.min(budgetMs, 600000));
        const user = await ensureUser();
        result.user = user;
        if (!user) return { ...result, stopped: 'auth' };
        // Источники радара это подписки и вкус из лайков. Обход библиотеки запускается и после загрузки профиля волны,
        // но при восстановленной на паузе очереди профиль может не грузиться вовсе: без этого ожидания выпуск
        // собрался бы без подписок. Обход сам пропускает пройденное меньше 12 часов назад; дольше минуты
        // и половины своего времени радар не ждёт, остальное обход допишет фоном
        let syncWait: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([syncLibrary(), new Promise<void>((resolve) => { syncWait = setTimeout(resolve, Math.min(60000, Math.max(0, deadline - Date.now()) / 2)); })]);
        clearTimeout(syncWait);
        const loaded = await bridge.radarPlan(user);
        const plan = (Array.isArray(loaded) ? loaded : []).flatMap((value) => {
            const item = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
            const kind = item.kind === 'search' ? 'search' as const : 'user' as const;
            const id = typeof item.id === 'number' && Number.isSafeInteger(item.id) ? item.id : 0;
            const q = typeof item.q === 'string' ? item.q : '';
            if (typeof item.key !== 'string' || (kind === 'user' ? id <= 0 : !q)) return [];
            return [{
                key: item.key, kind, id, q, label: typeof item.label === 'string' ? item.label : '', status: item.status,
                checked: typeof item.checked === 'number' ? item.checked : 0, weight: typeof item.weight === 'number' ? item.weight : 0,
            }];
        });
        // Несвежие первыми самые давние; источник с отказом повторяется не чаще раза в 10 минут
        const retryBefore = Date.now() - 10 * 60000;
        const due = plan.filter((source) => source.checked < staleBefore || (source.status === 'failed' && source.checked < retryBefore))
            .sort((a, b) => a.checked - b.checked || b.weight - a.weight);
        result.remaining = due.length;
        if (!due.length) return result;
        // Сайт мог сменить вход без перезагрузки: чужой каталог в хранилище этого аккаунта не пишется
        try {
            if (((await backgroundCall('me', {}, {})) as { id?: unknown } | null)?.id !== user) return { ...result, stopped: 'account-changed' };
        } catch (error) {
            return { ...result, stopped: classifyFailure(error, Date.now()).kind === 'auth' ? 'auth' : '' };
        }
        // Окно радара 7 дней до слота, слот не старше недели: каталог листается до загрузок старше 14 дней
        const from = Date.now() - 14 * 86400000;
        for (const source of due) {
            if (disposed || Date.now() >= deadline) break;
            let label = source.label;
            try {
                const tracks = source.kind === 'user' ? await accountTracks(source.id, from) : await freshSearch(source.q);
                if (source.kind === 'user') label = tracks.find((track) => track.user?.id === source.id)?.user?.username ?? label;
                if (tracks.length && typeof await bridge.recordUploads(user, tracks) !== 'number') throw new Error('Загрузки радара не записаны');
                await bridge.catalogChecked(user, source.key, label, 'ok', '', tracks.length);
            } catch (error) {
                const failure = classifyFailure(error, Date.now());
                await bridge.catalogChecked(user, source.key, label, failure.kind === 'missing' ? 'gone' : 'failed', failure.kind, 0)
                    .catch((cause: unknown) => console.warn('Радар: отказ источника не записан', cause));
                if (failure.kind === 'auth') return { ...result, stopped: 'auth' };
            }
            result.checked++;
            result.remaining--;
        }
        return result;
    }
    // Каталог аккаунта от новых к старым по дате загрузки; старые записи тоже пишутся: по ним видно перезаливы
    async function accountTracks(id: number, from: number): Promise<WaveTrack[]> {
        const tracks: WaveTrack[] = [];
        let query: Record<string, string | number> | null = { limit: 50 };
        for (let page = 0; page < 4 && query && !disposed; page++) {
            const body = await backgroundCall('userTracks', { id }, query);
            const list = (body as { collection?: unknown } | null)?.collection;
            if (!Array.isArray(list)) throw new Error('Неожиданный ответ userTracks');
            const found = list.map(asTrack).filter((track): track is WaveTrack => !!track);
            tracks.push(...found);
            if (!found.length || Math.min(...found.map((track) => Date.parse(track.created_at ?? '') || 0)) < from) break;
            query = nextQuery(body);
        }
        return tracks;
    }
    // Свежее за неделю по имени любимого участника по всему каталогу, без привязки к аккаунту. Поиск текстовый:
    // по имени находится и всё, где это слово просто есть в названии, поэтому пишутся только треки, где участник
    // правда указан, загрузчиком или в титрах
    async function freshSearch(q: string): Promise<WaveTrack[]> {
        const body = await backgroundCall('searchCategory', { category: 'tracks' }, { q, limit: 50, 'filter.created_at': 'last_week' });
        const list = (body as { collection?: unknown } | null)?.collection;
        if (!Array.isArray(list)) throw new Error('Неожиданный ответ searchCategory');
        const wanted = nameKey(q);
        return list.map(asTrack).filter((track): track is WaveTrack => !!track
            && (nameKey(track.user?.username) === wanted || trackCredits(track).some((credit) => credit.key === wanted)));
    }

    // Текстовый поиск треков по всему каталогу, без привязки к аккаунту; ответ живёт в кэше, ошибка не кэшируется
    async function searchTracks(q: string): Promise<WaveTrack[]> {
        const key = q.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!key) return [];
        const cached = searchCache.get(key);
        if (cached) return cached;
        const tracks = tracksOf(await call('searchCategory', { category: 'tracks' }, { q, limit: 50 }));
        searchCache.set(key, tracks);
        return tracks;
    }

    function fillExcluded(map: Map<number, Excluded>, input: unknown): void {
        exclusionsRevision++;
        map.clear();
        if (!Array.isArray(input)) return;
        const text = (value: unknown): string => (typeof value === 'string' ? value : '');
        for (const value of input) {
            const entry = value as Partial<Record<keyof Excluded, unknown>> | null;
            if (!entry || typeof entry.id !== 'number' || entry.id <= 0) continue;
            const item: Excluded = { id: entry.id, title: text(entry.title), artist: text(entry.artist), url: text(entry.url) };
            if (typeof entry.until === 'number') item.until = entry.until;
            map.set(entry.id, item);
        }
    }
    function fillMore(input: unknown): void {
        moreTracks.clear();
        if (!Array.isArray(input)) return;
        const text = (value: unknown): string => (typeof value === 'string' ? value : '');
        for (const value of input) {
            const entry = value as Record<string, unknown> | null;
            if (!entry || typeof entry.id !== 'number' || entry.id <= 0) continue;
            moreTracks.set(entry.id, {
                id: entry.id, title: text(entry.title), artist: text(entry.artist), url: text(entry.url),
                artistId: typeof entry.artistId === 'number' ? entry.artistId : 0, genre: text(entry.genre), tags: text(entry.tags),
            });
        }
    }
    // Семья и оставленная версия считаются разбором названия записи из main: название, имя и id загрузчика
    function fillFamilies(input: unknown): void {
        familyEntries.clear();
        if (Array.isArray(input))
            for (const value of input) {
                const entry = value as Record<string, unknown> | null;
                if (!entry || typeof entry.id !== 'number' || typeof entry.title !== 'string') continue;
                const uploader = typeof entry.artistId === 'number' ? entry.artistId : undefined;
                const track: WaveTrack = { id: entry.id, title: entry.title, user_id: uploader, user: { id: uploader, username: typeof entry.artist === 'string' ? entry.artist : '' } };
                const key = familyKey(track);
                if (key) familyEntries.set(entry.id, { key, version: versionKey(track), url: typeof entry.url === 'string' ? entry.url : '' });
            }
        rebuildFamilies();
    }
    function rebuildFamilies(): void {
        excludedFamilies.clear();
        for (const entry of familyEntries.values()) {
            const kept = excludedFamilies.get(entry.key) ?? new Set<string>();
            kept.add(entry.version);
            excludedFamilies.set(entry.key, kept);
        }
    }
    // Связи из хранилища недоверенные: берутся только пары ключей загрузок с признаком и источником.
    // Хранилище отдаёт их от решений пользователя к свежим, поэтому лишнее отрезается с хвоста.
    // Не прочитались: работаем без переноса на копии, а не без волны
    async function loadCopyGroups(id: number): Promise<Map<string, string>> {
        const links: RecordingLink[] = [];
        try {
            const loaded = id ? await host.soundcloudAPI?.recommend?.recordingLinks?.(id) : null;
            if (Array.isArray(loaded))
                for (const value of loaded.slice(0, 20000)) {
                    const link = value as Partial<RecordingLink> | null;
                    if (!link || typeof link.a !== 'string' || typeof link.b !== 'string' || typeof link.same !== 'boolean') continue;
                    if (!/^sc:track:\d+$/.test(link.a) || !/^sc:track:\d+$/.test(link.b)) continue;
                    links.push({ a: link.a, b: link.b, same: link.same, source: link.source === 'user' ? 'user' : 'catalog', at: typeof link.at === 'number' ? link.at : 0 });
                }
        } catch (error) {
            console.warn('Волна: связи записей не загружены', error);
        }
        recordingLinks = links;
        return confirmedGroups(links);
    }
    // Отметки нужны до подбора и до меню. Не загрузились: следующий подбор попробует снова
    function ensureExclusions(): Promise<void> {
        exclusionsPromise ??= (async () => {
            const id = await ensureUser();
            const loaded = id ? await host.soundcloudAPI?.waveExclusions?.load(id) : null;
            const source = loaded && typeof loaded === 'object' ? (loaded as Record<string, unknown>) : {};
            fillExcluded(excludedTracks, source.tracks);
            fillExcluded(excludedArtists, source.artists);
            fillExcluded(laterTracks, source.laterTracks);
            fillExcluded(laterArtists, source.laterArtists);
            fillMore(source.more);
            fillFamilies(source.families);
            copyGroups = await loadCopyGroups(id);
        })().catch((error: unknown) => {
            exclusionsPromise = null;
            console.warn('Волна: исключения не загружены', error);
        });
        return exclusionsPromise;
    }
    function applyTasteTime(base: TasteMaps): void {
        const now = Date.now();
        tasteBase = base;
        tasteSlotNow = tasteSlot(now);
        taste = tasteForTime(base, now);
    }
    // Не загрузился: подборка идёт перемешиванием, следующий подбор попробует снова
    function ensureTaste(): Promise<void> {
        if (tasteBase && Date.now() - tasteAt < 30 * 60000) {
            // Сменился отрезок суток: вкус на сейчас пересчитывается без запроса в main
            if (tasteSlot(Date.now()) !== tasteSlotNow) applyTasteTime(tasteBase);
            return Promise.resolve();
        }
        tastePromise ??= (async () => {
            const id = await ensureUser();
            const bridge = host.soundcloudAPI?.waveTaste;
            const maps = tasteMaps(id && bridge ? await bridge.load(id) : null);
            if (maps) {
                applyTasteTime(maps);
                tasteAt = Date.now();
            }
            // Для известного пользователя main всегда отдаёт профиль, хотя бы пустой: null значит сбой модели
            tasteFailed = !maps && !!id && !!bridge;
        })().catch((error: unknown) => {
            tasteFailed = true;
            console.warn('Волна: вкус не загружен', error);
        }).finally(() => {
            tastePromise = null;
        });
        return tastePromise;
    }
    // «Не сейчас» кончается сам: клиент в трее живёт днями без перезагрузки страницы
    const marked = (map: Map<number, Excluded>, id: number): boolean => {
        const entry = map.get(id);
        return !!entry && (entry.until === undefined || entry.until > Date.now());
    };
    // «Не нравится» переходит только на подтверждённые копии версии: оригинал и другой ремикс остаются (A08).
    // Набор пересчитывается, когда меняются отметки (exclusionsRevision) или связи
    let dislikedCache: { groups: Map<string, string>; revision: number; ids: Set<number> } | null = null;
    const disliked = (): Set<number> => {
        if (!dislikedCache || dislikedCache.groups !== copyGroups || dislikedCache.revision !== exclusionsRevision)
            dislikedCache = { groups: copyGroups, revision: exclusionsRevision, ids: confirmedCopies(excludedTracks.keys(), copyGroups) };
        return dislikedCache.ids;
    };
    const isExcluded = (track: WaveTrack): boolean =>
        disliked().has(track.id) || excludedArtists.has(trackArtist(track)) || marked(laterTracks, track.id) || marked(laterArtists, trackArtist(track)) ||
        (excludedFamilies.size > 0 && !(excludedFamilies.get(familyKey(track))?.has(versionKey(track)) ?? true));
    const liveKeys = (map: Map<number, Excluded>): number[] => [...map.keys()].filter((id) => marked(map, id));
    // «Больше такого» как зерно волны: для похожих хватает id, для жанра и причины нужны название и метки
    const moreSeeds = (): WaveTrack[] =>
        [...moreTracks.values()].map((entry) => ({
            id: entry.id, kind: 'track', title: entry.title, genre: entry.genre, tag_list: entry.tags, permalink_url: entry.url,
            user_id: entry.artistId || undefined, user: { id: entry.artistId || undefined, username: entry.artist },
        }));
    // Исключённое уходит из подборки и из очереди впереди; играющий трек волны сразу сменяется следующим
    function purgeExcluded(): void {
        pool = pool.filter((item) => !isExcluded(item.track));
        ownQueue = ownQueue.filter((item) => !isExcluded(item.track));
        preview = preview.filter((item) => !isExcluded(item.track));
        const p = player;
        if (active && p) {
            const { items, index } = queueView();
            const bad = (item: SiteQueueItem | undefined): boolean => {
                const candidate = item && ours.has(item) && item.sound ? known.get(item.sound.id) : undefined;
                return !!candidate && isExcluded(candidate.track);
            };
            const kept = items.filter((item, i) => i <= index || !bad(item));
            if (kept.length !== items.length) p.getQueue().reset(kept);
            if (bad(items[index])) {
                const next = kept.slice(index + 1).find((item) => ours.has(item));
                if (next) {
                    jumped = true;
                    p.setCurrentItem(next, {});
                    p.playCurrent({ userInitiated: true });
                }
            }
            void refill();
        }
        render();
    }

    function currentFilter(): WaveFilter {
        const p = profile;
        const filterMode = seed?.mode ?? mode;
        return {
            mode: filterMode, taken, recent: new Set([...(p?.recent ?? []), ...clientRecent]),
            // «Новое»: уверенно слышанное аудио на другой загрузке тоже не новое, но только по подтверждённой связи
            heard: p ? (filterMode === 'fresh' ? confirmedCopies(p.heard, copyGroups) : p.heard) : new Set(),
            liked: p ? (filterMode === 'fresh' ? confirmedCopies(p.liked, copyGroups) : p.liked) : new Set(),
            skipped,
            excludedTracks: new Set([...disliked(), ...liveKeys(laterTracks)]),
            excludedArtists: new Set([...excludedArtists.keys(), ...liveKeys(laterArtists)]),
            excludedFamilies,
        };
    }
    // Зёрна с весом по вкусу (В2.10): дослушанное, переслушанное и лайкнутое встаёт вперёд чаще, трек с минусом во вкусе
    // зерном не становится. Без профиля вкуса перемешиванием
    function seedOrder(list: WaveTrack[]): WaveTrack[] {
        const current = taste;
        if (!current) return shuffleInPlace(list);
        return list
            .map((track) => ({ track, weight: current.tracks.get(track.id) ?? 0 }))
            .filter((entry) => entry.weight >= 0)
            .map((entry) => ({ track: entry.track, key: Math.log(Math.max(Math.random(), 1e-12)) / Math.exp(Math.min(3, entry.weight)) }))
            .sort((a, b) => b.key - a.key)
            .map((entry) => entry.track);
    }
    function seedsFor(keys: string[]): WaveTrack[] {
        const p = profile;
        if (!p) return [];
        const mixed: WaveTrack[] = [...likedSeeds];
        if (seed) mixed.push(...seed.tracks, ...derivedSeeds);
        else {
            const history = seedOrder(p.history.slice());
            // «Больше такого» идёт вперёд лайков сайта
            const likes = [...moreSeeds(), ...seedOrder(p.likedTracks.slice())];
            for (let i = 0; i < Math.max(history.length, likes.length); i++) {
                if (history[i]) mixed.push(history[i]);
                if (likes[i]) mixed.push(likes[i]);
            }
        }
        const seen = new Set<number>();
        // Трек, артист или плейлист выбраны руками: их треки остаются зёрнами, даже если артист пропущен или скрыт.
        // Отметки действуют на подборку, иначе волна от такого трека играла бы его одного
        const chosen = new Set(seed?.tracks.map((track) => track.id) ?? []);
        const eligible = mixed.filter((track) => {
            if (seen.has(track.id) || usedSeeds.has(track.id)) return false;
            if (!chosen.has(track.id) && (skipped.has(copyKey(track)) || isExcluded(track))) return false;
            seen.add(track.id);
            return true;
        });
        let list = seed ? eligible : eligible.filter((track) => trackMatchesGenre(track, keys, true));
        // Жанр без зёрен по полю жанра: зёрна по меткам (В2.13), иначе такой жанр играл бы одни страницы жанра
        if (!seed && keys.length && !list.length) list = eligible.filter((track) => trackMatchesGenre(track, keys));
        const fresh = list.filter((track) => !staleSeeds.has(track.id));
        // Встряхивали столько раз, что свежих зёрен не осталось: круг начинается заново
        if (fresh.length || !staleSeeds.size) return fresh;
        staleSeeds.clear();
        return list;
    }
    // seedId: зерно, от которого найден кандидат, для журнала
    // П6: в обычной волне кириллица от артиста, которого вкус не знает (ни аккаунт, ни участники), проходит только
    // от похожих артистов, из подборок SoundCloud и от соседей по вкусу. Волны от трека, артиста и подборок не трогаются
    function strangerCyrillic(candidate: WaveCandidate): boolean {
        if (seed || !taste || ['relatedArtist', 'scMix', 'neighbors'].includes(candidate.reason.kind)) return false;
        return trackLang(candidate.track) === 'cyr' && !tasteScore(candidate.track, taste).known;
    }
    function accept(list: WaveCandidate[], candidate: WaveCandidate, filter: WaveFilter, seedId = 0): boolean {
        if (!acceptCandidate(candidate.track, filter) || signatures.has(copyKey(candidate.track))) return false;
        if (list !== ownQueue && strangerCyrillic(candidate)) return false;
        // Одно произведение на поколение: оригинал, slowed и ремикс одной песни в найденном не встают вместе.
        // Версии зерна идут своей причиной, свои подборки (радар, «Давно не слушал») правило не трогает
        const family = list === ownQueue ? '' : familyKey(candidate.track);
        if (family && candidate.reason.kind !== 'version' && families.has(family)) return false;
        if (family) families.add(family);
        for (const key of copyKeys(candidate.track)) signatures.add(key);
        taken.add(candidate.track.id);
        if (!candidate.trace) candidate.trace = { origin: candidate.reason.kind, seed: seedId, score: null, known: false };
        list.push(candidate);
        return true;
    }
    // Оценка в журнал до замены причин: по ней меряется, угадывает ли вкус пропуски
    function traceScores(list: WaveCandidate[], current: TasteMaps): void {
        for (const candidate of list) {
            if (!candidate.trace) continue;
            const score = tasteScore(candidate.track, current);
            candidate.trace.score = Math.round(score.score * 100) / 100;
            candidate.trace.known = score.known;
            if (current.version) candidate.trace.tv = current.version;
        }
    }
    // Поправка сессии к оценке вкуса: аккаунт, теги долями, как во вкусе, зерно, от которого найден трек, и источник
    function sessionScore(candidate: WaveCandidate): number {
        const track = candidate.track;
        let delta = sessionArtists.get(trackArtist(track)) ?? 0;
        for (const [key, share] of tagShares(track.genre, track.tag_list, [track.user?.username])) delta += share * (sessionTags.get(key) ?? 0);
        delta += sourceShift.get(candidate.trace?.origin ?? candidate.reason.kind) ?? 0;
        if (sessionTraits.size) {
            const traits = trackTraits(track);
            for (const trait of sessionTraits.values()) if (traits.some((item) => item.kind === trait.kind && item.key === trait.key)) delta -= 1;
        }
        const from = candidate.trace?.seed ?? 0;
        return (from ? delta + (sessionSeeds.get(from) ?? 0) : delta) - presetPenalty(track);
    }
    // Пресет действует только у обычной волны: у волны от трека, артиста или подборки своё настроение
    const activePreset = (): WaveMood | null => (seed ? null : preset);
    // Настроение трека один раз на трек: словарь разбирается регулярными выражениями. Настроение по плейлистам
    // с треком (П12) добавляется как независимое свидетельство
    const moodCache = new Map<number, MoodScores>();
    function moodOf(track: WaveTrack): MoodScores {
        let scores = moodCache.get(track.id);
        if (!scores) {
            scores = trackMood(track);
            const listed = playlistMoods().get(track.id);
            if (listed) for (const mood of moodList()) scores[mood] = 1 - (1 - scores[mood]) * (1 - listed[mood]);
            if (moodCache.size > 5000) moodCache.clear();
            moodCache.set(track.id, scores);
        }
        return scores;
    }
    // П12: настроение по плейлистам с треком навсегда в localStorage, до 5000 треков, старые вытесняются; пустой ответ
    // тоже хранится (нули). Запись [id, happy, sad, aggressive, calm, energetic]
    const PLAYLIST_MOODS_KEY = 'scDesktopWavePlaylistMoods';
    let playlistMoodMap: Map<number, MoodScores> | null = null;
    const playlistMoodPending = new Set<number>();
    function playlistMoods(): Map<number, MoodScores> {
        if (playlistMoodMap) return playlistMoodMap;
        const map = new Map<number, MoodScores>();
        try {
            const saved: unknown = JSON.parse(localStorage.getItem(PLAYLIST_MOODS_KEY) || '[]');
            for (const row of Array.isArray(saved) ? saved.slice(-5000) : []) {
                if (!Array.isArray(row) || row.length !== 6 || !isId(row[0]) || !row.slice(1).every((value) => typeof value === 'number' && value >= 0 && value <= 1)) continue;
                const [id, happy, sad, aggressive, calm, energetic] = row as number[];
                map.set(id, { happy, sad, aggressive, calm, energetic });
            }
        } catch (error) {
            console.warn('Волна: настроение по плейлистам не прочитано', error);
        }
        playlistMoodMap = map;
        return map;
    }
    function savePlaylistMoods(): void {
        const map = playlistMoods();
        const round = (value: number): number => Math.round(value * 100) / 100;
        try {
            localStorage.setItem(PLAYLIST_MOODS_KEY, JSON.stringify([...map].slice(-5000).map(([id, s]) => [id, round(s.happy), round(s.sad), round(s.aggressive), round(s.calm), round(s.energetic)])));
        } catch (error) {
            console.warn('Волна: настроение по плейлистам не сохранено', error);
        }
    }
    // Фоном до 10 треков добивки пресета без жанра и меток: их плейлисты (до 20) разбираются словарём. Подошедшее
    // настроению после ответа уходит из добивки в пул
    function lookupPlaylistMoods(candidates: WaveCandidate[]): void {
        const map = playlistMoods();
        const list = candidates
            .filter((candidate) => !(candidate.track.genre ?? '').trim() && !(candidate.track.tag_list ?? '').trim() && !map.has(candidate.track.id) && !playlistMoodPending.has(candidate.track.id))
            .slice(0, 10);
        if (!list.length) return;
        const own = generation;
        for (const candidate of list) playlistMoodPending.add(candidate.track.id);
        void Promise.all(list.map(async (candidate) => {
            try {
                const body = await backgroundCall('playlistsWithoutAlbumsForTrack', { trackId: candidate.track.id }, { limit: 20 });
                const titles = collection(body).flatMap((item) => {
                    const title = item && typeof item === 'object' ? (item as { title?: unknown }).title : null;
                    return typeof title === 'string' && title.trim() ? [title.slice(0, 200)] : [];
                });
                map.delete(candidate.track.id);
                map.set(candidate.track.id, playlistMood(titles.slice(0, 20)));
                moodCache.delete(candidate.track.id);
            } catch (error) {
                console.warn('Волна: плейлисты трека не загружены', error);
            } finally {
                playlistMoodPending.delete(candidate.track.id);
            }
        })).then(() => {
            while (map.size > 5000) {
                const oldest = map.keys().next().value;
                if (oldest === undefined) break;
                map.delete(oldest);
            }
            savePlaylistMoods();
            artistMoodMap = null;
            if (disposed || own !== generation || !activePreset()) return;
            const ids = new Set(list.map((candidate) => candidate.track.id));
            const fit = moodReserve.filter((entry) => ids.has(entry.candidate.track.id) && presetScore(entry.candidate.track, null) >= 0.5);
            if (!fit.length) return;
            moodReserve = moodReserve.filter((entry) => !fit.includes(entry));
            pool.push(...fit.map((entry) => entry.candidate));
            rerankPool();
        });
    }
    // Перенос настроения от исполнителя: по лайкам, истории сайта и всему, что пришло из похожих в этой волне
    const moodSample: WaveTrack[] = [];
    const moodSampleIds = new Set<number>();
    let artistMoodMap: Map<number, ArtistMoods> | null = null;
    let artistMoodIds = new Set<number>();
    function noteMoodSample(tracks: WaveTrack[]): void {
        for (const track of tracks) {
            if (moodSampleIds.has(track.id) || moodSample.length >= 4000) continue;
            moodSampleIds.add(track.id);
            moodSample.push(track);
            artistMoodMap = null;
        }
    }
    // Насколько трек подходит пресету, 0-1; без пресета подходит всё
    function presetScore(track: WaveTrack, neighbors: MoodScores | null): number {
        const mood = activePreset();
        if (!mood) return 1;
        if (!artistMoodMap) {
            const sample = [...(profile?.likedTracks ?? []), ...(profile?.history ?? []), ...moodSample];
            artistMoodMap = artistMoods(sample, moodOf);
            artistMoodIds = new Set(sample.map((item) => item.id));
        }
        return moodScore(moodOf(track)[mood], artistMoodMap.get(trackArtist(track)), neighbors?.[mood] ?? 0, mood, artistMoodIds.has(track.id));
    }
    // Своё в пресете: аккаунт и теги, рано пропущенные внутри этого пресета, опускаются в нём и дальше
    function presetPenalty(track: WaveTrack): number {
        const mood = activePreset();
        const marks = mood ? presetMarks[mood] : undefined;
        if (!marks) return 0;
        let penalty = 0.5 * Math.min(2, marks.a[String(trackArtist(track))] ?? 0);
        for (const [key, share] of tagShares(track.genre, track.tag_list, [track.user?.username])) penalty += share * 0.5 * Math.min(2, marks.t[key] ?? 0);
        return penalty;
    }
    function notePresetSkip(track: WaveTrack): void {
        const mood = activePreset();
        if (!mood) return;
        const marks = presetMarks[mood] ?? { a: {}, t: {} };
        // Не больше 300 ключей: при переполнении уходят самые слабые
        const bumped = (map: Record<string, number>, key: string, value: number): Record<string, number> => {
            const next = { ...map, [key]: Math.min(10, (map[key] ?? 0) + value) };
            const entries = Object.entries(next);
            return entries.length > 300 ? Object.fromEntries(entries.sort((x, y) => y[1] - x[1]).slice(0, 300)) : next;
        };
        const artist = trackArtist(track);
        let a = marks.a;
        let t = marks.t;
        if (artist) a = bumped(a, String(artist), 1);
        for (const [key, share] of tagShares(track.genre, track.tag_list, [track.user?.username])) t = bumped(t, key, share);
        presetMarks = { ...presetMarks, [mood]: { a, t } };
        try {
            localStorage.setItem(MOODS_KEY, JSON.stringify(presetMarks));
        } catch (error) {
            console.warn('Волна: отметка пресета не сохранена', error);
        }
    }
    // Не подошедшее пресету: добивка ближайшими по настроению, когда подходящего мало (В3)
    let moodReserve: Array<{ candidate: WaveCandidate; score: number }> = [];
    let moodRounds = 0;
    let moodShort = false;
    // Найденное за проход делится на подходящее пресету и добивку. Соседи считаются по зерну, у поиска по меткам соседей нет
    function splitByMood(found: WaveCandidate[], observed: WaveTrack[], observedBy: Map<number, WaveTrack[]>): WaveCandidate[] {
        noteMoodSample(observed);
        const neighbors = new Map<number, MoodScores>();
        const matched: WaveCandidate[] = [];
        const reserve: WaveCandidate[] = [];
        for (const candidate of found) {
            const from = candidate.trace?.seed ?? 0;
            let near = neighbors.get(from);
            if (!near) {
                near = neighborMood(from ? observedBy.get(from) ?? [] : [], moodOf);
                neighbors.set(from, near);
            }
            const score = presetScore(candidate.track, near);
            if (score >= 0.5) matched.push(candidate);
            else {
                reserve.push(candidate);
                moodReserve.push({ candidate, score });
            }
        }
        if (taste) traceScores(reserve, taste);
        moodReserve.sort((a, b) => b.score - a.score);
        if (moodReserve.length > 300) moodReserve = moodReserve.slice(0, 300);
        return matched;
    }
    // Ранний пропуск (sign -1) или лайк и «Больше такого» (sign 1): аккаунт на единицу, теги на половину доли, зерно на половину
    function adjustSession(candidate: WaveCandidate, sign: 1 | -1): void {
        const track = candidate.track;
        const add = <K>(map: Map<K, number>, key: K, value: number): void => { map.set(key, (map.get(key) ?? 0) + sign * value); };
        const artist = trackArtist(track);
        if (artist) add(sessionArtists, artist, 1);
        for (const [key, share] of tagShares(track.genre, track.tag_list, [track.user?.username])) add(sessionTags, key, 0.5 * share);
        const from = candidate.trace?.seed ?? 0;
        if (from) add(sessionSeeds, from, 0.5);
    }
    const EMPTY_TASTE: TasteMaps = { version: 0, artists: new Map(), credits: new Map(), families: new Map(), tags: new Map(), markers: new Map(), tracks: new Map(), langs: new Map(), contexts: new Map(), sources: new Map() };
    // Пул заново по вкусу с поправками сессии: при каждой догрузке и после пропусков (В2.1, В2.2)
    function rerankPool(): void {
        if (pool.length > 1) pool = tasteOrder(pool, taste ?? EMPTY_TASTE, Math.random, sessionScore);
    }
    // Русское название жанра («рэп», «фонк») уходит на сайт по-английски: метки там почти все латиницей
    async function genrePage(source: 'recent' | 'search', label: string): Promise<WaveTrack[]> {
        const own = generation;
        const tag = genreEnglish(label);
        const cursor = cursors.get(source + ':' + tag) ?? { query: null, done: false };
        if (cursor.done) return [];
        const body = source === 'recent'
            ? await call('recentTracks', { tag }, cursor.query ?? { limit: 50 })
            : await call('searchCategory', { category: 'tracks' }, cursor.query ?? { q: '*', 'filter.genre_or_tag': tag, limit: 50 });
        if (disposed || own !== generation) return [];
        const next = nextQuery(body);
        cursors.set(source + ':' + tag, { query: next, done: !next });
        return collection(body).map(asTrack).filter((track): track is WaveTrack => !!track);
    }
    // Корни для станции трека: зёрна и найденное от них, ещё не использованные; выбранные руками зёрна отметки не отсекают
    const stationRoots = (): WaveTrack[] =>
        seed
            ? [
                ...seed.tracks.filter((track) => !usedStations.has(track.id)),
                ...derivedSeeds.filter((track) => !usedStations.has(track.id) && !isExcluded(track) && !skipped.has(copyKey(track))),
            ]
            : [];
    // Станция трека это системный плейлист, из него сайт берёт свой автоплей
    async function stationTracks(from: WaveTrack): Promise<WaveTrack[]> {
        return playlistTracks(await resolveUrl('https://soundcloud.com/discover/sets/track-stations:' + from.id));
    }
    // Дослушанное за час (П2). Сигнал страницы знает трек полнее, чем main: в начало списка без повторов
    const HOUR = 3600000;
    function noteDone(signal: PlaySignal): void {
        const track: WaveTrack = {
            id: signal.id, kind: 'track', title: signal.title ?? '', duration: signal.dur, genre: signal.genre, tag_list: signal.tags,
            user_id: signal.artist || undefined, user: { id: signal.artist || undefined, username: signal.artistName ?? '' },
            permalink_url: signal.path ? 'https://soundcloud.com' + signal.path : '',
        };
        doneRecently = [{ track, at: signal.at }, ...doneRecently.filter((entry) => entry.track.id !== signal.id && Date.now() - entry.at < HOUR)].slice(0, 50);
    }
    async function recentDone(): Promise<WaveTrack[]> {
        const bridge = host.soundcloudAPI?.waveLibrary;
        if (bridge?.recent && Date.now() - doneLoadedAt > 2 * 60000) {
            doneLoadedAt = Date.now();
            try {
                const id = await ensureUser();
                const loaded = id ? await Promise.race([bridge.recent(id), wait(5000).then(() => [])]) : [];
                const text = (value: unknown): string => (typeof value === 'string' ? value : '');
                for (const value of Array.isArray(loaded) ? loaded : []) {
                    const item = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
                    if (!item || !isId(item.id) || typeof item.at !== 'number' || doneRecently.some((entry) => entry.track.id === item.id)) continue;
                    const artist = isId(item.artist) ? item.artist : undefined;
                    doneRecently.push({
                        at: item.at,
                        track: {
                            id: item.id, kind: 'track', title: text(item.title), duration: typeof item.dur === 'number' ? item.dur : 0, genre: text(item.genre), tag_list: text(item.tags),
                            user_id: artist, user: { id: artist, username: text(item.artistName) }, permalink_url: text(item.path) ? 'https://soundcloud.com' + text(item.path) : '',
                        },
                    });
                }
                doneRecently.sort((a, b) => b.at - a.at);
            } catch (error) {
                console.warn('Волна: дослушанное за час не загружено', error);
            }
        }
        return doneRecently.filter((entry) => Date.now() - entry.at < HOUR).map((entry) => entry.track);
    }
    // Имя аккаунта по истории и лайкам: вкус хранит только номера
    function accountName(id: number, p: Profile): string {
        const track = p.history.find((item) => trackArtist(item) === id) ?? p.likedTracks.find((item) => trackArtist(item) === id);
        return (track?.user?.username ?? '').trim();
    }
    // Лучший трек похожего артиста (П2, П3): похожие на from по порядку SoundCloud, ещё не взятые в поколении, не скрытые;
    // у похожего первый неслышанный из топа, иначе первый из топа. null, если ничего не нашлось
    async function neighborTrack(from: number, p: Profile): Promise<WaveTrack | null> {
        const neighbors = (await waveSources.relatedArtists(from)).filter((artist) => !usedNeighbors.has(artist.id) && !excludedArtists.has(artist.id) && !marked(laterArtists, artist.id));
        for (const neighbor of neighbors.slice(0, 3)) {
            usedNeighbors.add(neighbor.id);
            const tops = (await waveSources.topTracks(neighbor.id)).filter((track) => !isExcluded(track) && !taken.has(track.id) && !usedSeeds.has(track.id) && !staleSeeds.has(track.id));
            const track = tops.find((item) => !p.heard.has(item.id)) ?? tops[0];
            if (track) return track;
        }
        return null;
    }
    // Начало обычной волны (П2): последнее дослушанное и лучший трек похожего артиста его автора. Пусто, если за час
    // ничего не дослушано
    async function contextSeeds(p: Profile): Promise<{ seeds: WaveTrack[]; neighbor: { track: WaveTrack; artist: string } | null }> {
        const done = await recentDone();
        const first = done.find((track) => !isExcluded(track) && !skipped.has(copyKey(track)) && !staleSeeds.has(track.id) && !usedSeeds.has(track.id));
        if (!first) return { seeds: [], neighbor: null };
        let neighbor: { track: WaveTrack; artist: string } | null = null;
        const author = trackArtist(first);
        if (author)
            try {
                const track = await neighborTrack(author, p);
                if (track) neighbor = { track, artist: artistName(first) || accountName(author, p) };
            } catch (error) {
                console.warn('Волна: похожие артисты для начала не загружены', error);
            }
        return { seeds: neighbor ? [first, neighbor.track] : [first], neighbor };
    }
    // Зерно за проход из похожего артиста любимого (П3): любимые по весу во вкусе по кругу, по три попытки
    async function favoriteNeighbor(p: Profile): Promise<{ track: WaveTrack; artist: string } | null> {
        const current = taste;
        if (!current) return null;
        const favorites = [...current.artists].filter(([id, weight]) => weight >= 1 && !excludedArtists.has(id) && !marked(laterArtists, id)).sort((a, b) => b[1] - a[1]).slice(0, 20);
        for (let attempt = 0; attempt < Math.min(3, favorites.length); attempt++) {
            const [id] = favorites[favoriteTurn++ % favorites.length];
            const name = accountName(id, p);
            if (!name) continue;
            const track = await neighborTrack(id, p);
            if (track) return { track, artist: name };
        }
        return null;
    }
    // Следующие треки подборок SoundCloud (П4): по 10 за проход вперемешку из всех подборок, треки добирает trackBatch
    async function scMixCandidates(): Promise<Array<{ track: WaveTrack; mix: ScMix }>> {
        if (!scQueue) scQueue = interleaveMixes(await waveSources.scMixes(), ['mix', 'daily', 'weekly', 'liked']);
        const next: Array<{ id: number; mix: ScMix }> = [];
        while (scQueue.length && next.length < 10) {
            const entry = scQueue.shift();
            if (entry && !taken.has(entry.id)) next.push(entry);
        }
        if (!next.length) return [];
        const byId = new Map((await waveSources.tracksByIds(next.map((entry) => entry.id))).map((track) => [track.id, track]));
        return next.flatMap((entry) => {
            const track = byId.get(entry.id);
            return track ? [{ track, mix: entry.mix }] : [];
        });
    }
    // Уверенный кандидат для мест 1-3 поколения (П2): похожий артист любимого или оценка вкуса с поправкой сессии от 1,5
    function confident(candidate: WaveCandidate): boolean {
        if ((candidate.trace?.origin ?? candidate.reason.kind) === 'relatedArtist') return true;
        const current = taste;
        return !!current && tasteScore(candidate.track, current).score + sessionScore(candidate) >= 1.5;
    }
    // Один проход по источникам: похожие на три зерна и, если выбраны жанры, свежее и популярное в каждом.
    // У волны от трека, артиста или плейлиста зёрна идут по порядку и жанр не действует
    async function gatherRound(): Promise<number> {
        const own = generation;
        const p = await ensureProfile();
        await Promise.all([ensureExclusions(), ensureTaste()]);
        if (own !== generation) return 0;
        sourceShift = sourceBias(taste?.sources ?? new Map<string, { done: number; early: number }>());
        // «Моя музыка» из сессии: пул собирается заново, иначе своё не встанет в очередь
        if (seed?.kind === 'library' && seed.library?.left) {
            await librarySection.resume(seed);
            if (own !== generation) return 0;
            if (seed?.library?.left) throw new Error('Пул «Моей музыки» не собран');
        }
        const found: WaveCandidate[] = [];
        const filter = currentFilter();
        // Подмешанное к своей музыке и похожее после неё новое для библиотеки: лайков там нет
        if (seed?.kind === 'library') for (const id of p.liked) filter.excludedTracks.add(id);
        if (seed && !ownAdded) {
            ownAdded = true;
            const current = seed;
            if (current.kind === 'library') {
                // Пул отфильтрован своим фильтром при сборке: миксы и недавно слышанное остаются, копии уже склеены.
                // Сыгранное волной раньше не отсекается: своя музыка играет целиком, стартовый трек в own и так не входит
                for (const track of current.own) {
                    taken.add(track.id);
                    for (const key of copyKeys(track)) signatures.add(key);
                    ownQueue.push({ track, reason: { kind: 'library', name: librarySection.sourceName(track.id) } });
                }
                if (current.order === 'fixed' && ownQueue.length >= BATCH) return ownQueue.length;
            } else if (current.order) {
                const reason: WaveReason = current.kind === 'daily' ? { kind: 'daily' } : current.kind === 'forgotten' ? { kind: 'forgotten' }
                    : current.kind === 'liked' ? { kind: 'likedBy', artist: '' }
                    : current.kind === 'artist' || current.kind === 'artistAll' ? { kind: 'artistTrack', artist: current.title } : { kind: 'group', name: current.title };
                // Радар играет выпуск целиком: «Уже слышал» и недавно игравшее в нём остаются, запреты проверены при запуске.
                // Волна от артиста так же: его лучшее звучит, даже если недавно играло (П3).
                // Свой список отсекает только отданное сайту в этой подборке, а не всё, что волна отдавала раньше
                const ownFilter: WaveFilter = { ...filter, taken: new Set(seedGiven), ...(current.kind === 'radar' || current.kind === 'artist' || current.kind === 'artistAll' ? { recent: new Set<number>() } : {}) };
                // «Все треки артиста» выбраны руками: сам артист звучит, даже если скрыт или отложен
                if (current.kind === 'artistAll') ownFilter.excludedArtists = new Set([...filter.excludedArtists].filter((id) => id !== current.artist));
                for (const track of current.own)
                    accept(ownQueue, {
                        track,
                        reason: current.reasons?.get(track.id) ?? (current.kind === 'radar' ? { kind: 'radar', why: radarSection.reason(track.id) } : reason),
                    }, ownFilter);
                // Подборка целиком впереди: похожие понадобятся, когда она кончится
                if (current.order === 'fixed' && ownQueue.length >= BATCH) return ownQueue.length;
            } else {
                const ownFilter: WaveFilter = { ...filter, taken: new Set(seedGiven) };
                for (const track of current.own) accept(found, { track, reason: { kind: 'artistTrack', artist: current.title } }, ownFilter);
            }
        }
        // «Все треки артиста»: только его каталог, похожих и найденного нет
        if (seed?.kind === 'artistAll') {
            exhausted = true;
            return ownQueue.length;
        }
        const tags = !seed && genre ? parseGenres(genre) : [];
        const keys = tags.length ? genreKeysFor(genre) : [];
        const mood = activePreset();
        // Пресет: зёрна с этим настроением идут первыми, остальные за ними; поиск SoundCloud по меткам настроения
        const moodSearch = mood ? moodDictionary()[mood].search : [];
        const listed = seedsFor(keys);
        const seeds = mood ? [...listed.filter((track) => presetScore(track, null) >= 0.5), ...listed.filter((track) => presetScore(track, null) < 0.5)] : listed;
        let picked: WaveTrack[];
        // Трек похожего артиста, который сам идёт кандидатом: у начала с контекста и у зерна от любимого (П2, П3)
        const neighbors: Array<{ track: WaveTrack; artist: string }> = [];
        // Набор из меню: похожие на каждый трек набора с первого же раза
        if (seed) picked = seeds.slice(0, seed.kind === 'tracks' ? 5 : 3);
        else {
            // Обычная волна без жанра и пресета в первом проходе поколения начинает с того, что ты только что дослушал
            const context = contextPending && !keys.length && !mood ? await contextSeeds(p) : { seeds: [], neighbor: null };
            contextPending = false;
            if (own !== generation) return 0;
            if (context.neighbor) neighbors.push(context.neighbor);
            picked = [...context.seeds, ...likedSeeds.filter((track) => seeds.includes(track) && !context.seeds.includes(track)).slice(0, 1)].slice(0, 3);
            const rest = seeds.filter((track) => !picked.includes(track));
            const near = shuffleInPlace(rest.slice(0, 12));
            // Одно зерно на артиста за проход: любимый артист в истории иначе часто даёт два-три зерна из трёх,
            // и похожие сходятся на его же каталог. Разных артистов не хватило - добор из ближних зёрен
            const artistOf = new Set(picked.map(trackArtist));
            for (const track of [...near, ...rest.slice(12)]) {
                if (picked.length >= 3) break;
                if (artistOf.has(trackArtist(track))) continue;
                artistOf.add(trackArtist(track));
                picked.push(track);
            }
            for (const track of near) if (picked.length < 3 && !picked.includes(track)) picked.push(track);
        }
        for (const track of picked) usedSeeds.add(track.id);
        // Всё, что пришло из похожих и станции, включая отсеянное: по нему считается настроение запасного пути
        const observed: WaveTrack[] = [];
        // Соседи по зерну: похожие на одно зерно голосуют за настроение друг друга
        const observedBy = new Map<number, WaveTrack[]>();
        // Похожее на from: причина по жанру или режиму; у волны от трека найденное становится зерном дальше.
        // station: трек со станции, в журнале и в долях источников он отдельно от похожих
        const take = (track: WaveTrack, from: WaveTrack, station = false): void => {
            observed.push(track);
            const near = observedBy.get(from.id);
            if (near) near.push(track);
            else observedBy.set(from.id, [track]);
            if (!trackMatchesGenre(track, keys)) return;
            const seedTitle = (from.title ?? '').trim() || '…';
            const matched = tags.find((tag) => trackMatchesGenre(track, genreKeys(tag)));
            const reason: WaveReason = matched
                ? { kind: 'genreSimilar', genre: matched, seed: seedTitle }
                : filter.mode === 'fresh' && isNewArtist(track, p.knownArtists, p.knownNames)
                    ? { kind: 'newArtist' }
                    : { kind: filter.mode === 'fresh' ? 'fresh' : 'similar', seed: seedTitle };
            const trace: WaveCandidate['trace'] = station ? { origin: 'station', seed: from.id, score: null, known: false } : undefined;
            if (accept(found, { track, reason, trace }, filter, from.id) && seed && derivedSeeds.length < 100) derivedSeeds.push(track);
        };
        let failures = 0;
        const similarTo = (from: WaveTrack): Promise<void> =>
            call('relatedSounds', { track_id: from.id }, { limit: 50 }).then((body) => {
                if (disposed || own !== generation) return;
                for (const value of collection(body)) {
                    const track = asTrack(value);
                    if (track) take(track, from);
                }
            }).catch((error: unknown) => {
                if (disposed || own !== generation) return;
                failures++;
                // Зерно без ответа можно взять в следующий раз
                usedSeeds.delete(from.id);
                console.warn('Волна: похожие не загружены', error);
            });
        // Трек похожего артиста сам кандидат: «Похож на ...»
        const neighborCandidate = (entry: { track: WaveTrack; artist: string }): void => {
            if (trackMatchesGenre(entry.track, keys)) accept(found, { track: entry.track, reason: { kind: 'relatedArtist', artist: entry.artist } }, filter);
        };
        for (const entry of neighbors) neighborCandidate(entry);
        const tasks: Promise<void>[] = picked.map(similarTo);
        // Обычная волна без жанра: за проход ещё одно зерно, лучший трек похожего артиста любимого (П3)
        if (!seed && !keys.length)
            tasks.push(favoriteNeighbor(p).then((entry) => {
                if (!entry || disposed || own !== generation) return;
                usedSeeds.add(entry.track.id);
                neighborCandidate(entry);
                return similarTo(entry.track);
            }).catch((error: unknown) => console.warn('Волна: похожий артист любимого не загружен', error)));
        // Волна от артиста: лучшее восьми его похожих артистов, по три трека, один раз за поколение (П3)
        const artistSeed = seed?.kind === 'artist' ? seed : null;
        if (artistSeed?.artist && !artistNeighborsDone) {
            artistNeighborsDone = true;
            const from = artistSeed.artist;
            tasks.push((async () => {
                const list = (await waveSources.relatedArtists(from)).filter((artist) => !excludedArtists.has(artist.id) && !marked(laterArtists, artist.id)).slice(0, 8);
                const tops = await Promise.all(list.map((artist) => waveSources.topTracks(artist.id).catch((error: unknown) => {
                    console.warn('Волна: треки похожего артиста не загружены', error);
                    return [];
                })));
                if (disposed || own !== generation) return;
                for (const top of tops) for (const track of top.slice(0, 3)) neighborCandidate({ track, artist: artistSeed.title });
            })().catch((error: unknown) => {
                if (own === generation) artistNeighborsDone = false;
                failures++;
                console.warn('Волна: похожие артисты не загружены', error);
            }));
        }
        // Обычная волна: до 10 треков подборок SoundCloud за проход, дальше их ставит вкус (П4)
        if (!seed)
            tasks.push(scMixCandidates().then((list) => {
                if (disposed || own !== generation) return;
                for (const { track, mix } of list) if (trackMatchesGenre(track, keys)) accept(found, { track, reason: { kind: 'scMix', name: mix.title } }, filter);
            }).catch((error: unknown) => {
                failures++;
                console.warn('Волна: треки подборок SoundCloud не загружены', error);
            }));
        for (const tag of tags)
            for (const source of ['recent', 'search'] as const)
                tasks.push(genrePage(source, tag).then((tracks) => {
                    if (disposed || own !== generation) return;
                    for (const track of tracks) {
                        if (source === 'recent' && !freshEnough(track)) continue;
                        accept(found, { track, reason: { kind: source === 'recent' ? 'genreFresh' : 'genrePopular', genre: tag } }, filter);
                    }
                }).catch((error: unknown) => { failures++; console.warn('Волна: жанр не загружен', error); }));
        // Метки настроения: популярное по каждой, свежее по первой. Выбранный жанр действует и здесь
        for (const [index, tag] of moodSearch.entries())
            for (const source of index === 0 ? (['recent', 'search'] as const) : (['search'] as const))
                tasks.push(genrePage(source, tag).then((tracks) => {
                    if (disposed || own !== generation) return;
                    for (const track of tracks) {
                        if ((source === 'recent' && !freshEnough(track)) || !trackMatchesGenre(track, keys)) continue;
                        accept(found, { track, reason: { kind: 'moodTag', tag } }, filter);
                    }
                }).catch((error: unknown) => { failures++; console.warn('Волна: метка настроения не загружена', error); }));
        // Текстовый поиск по одному зерну за проход, четверть запросов прохода: другие версии зерна и песни его
        // участников у любых аккаунтов, загрузчик запрос не ограничивает. Поиск сайта нечёткий и по названию отдаёт всё
        // с теми же словами (провал 01.10.2026: «реквием по мечте» увёл волну в чужие «реквиемы»), поэтому берутся
        // только версии зерна и песни того же исполнителя, и зёрнами дальше они не становятся
        const probe = picked.length ? picked[searchTurn % picked.length] : undefined;
        const queries = probe ? searchQueries(probe) : [];
        const query = queries.find((item) => item.purpose === (searchTurn % 2 === 0 ? 'versions' : 'songs')) ?? queries[0];
        searchTurn++;
        if (probe && query)
            tasks.push(searchTracks(query.q).then((tracks) => {
                if (disposed || own !== generation) return;
                for (const track of tracks) {
                    if (track.id === probe.id) continue;
                    const version = matchLevel(probe, track) !== 'none';
                    const performer = version ? '' : sharedPerformer(probe, track);
                    if (!version && !performer) continue;
                    observed.push(track);
                    if (!trackMatchesGenre(track, keys)) continue;
                    const reason: WaveReason = version ? { kind: 'version', seed: (probe.title ?? '').trim() || '…' } : { kind: 'artistTrack', artist: performer };
                    accept(found, { track, reason }, filter, probe.id);
                }
            }).catch((error: unknown) => { failures++; console.warn('Волна: поиск не ответил', error); }));
        await Promise.all(tasks);
        if (own !== generation) return 0;
        // У маленьких артистов похожие замкнуты на их же треки (замер 23.09.2026: «Steel Lullaby» дал 4 трека по кругу),
        // тогда волна идёт по станции трека: там десятки других артистов
        const root = seed && found.length < 3 ? stationRoots()[0] : undefined;
        if (root) {
            usedStations.add(root.id);
            try {
                const tracks = await stationTracks(root);
                if (disposed || own !== generation) return 0;
                for (const track of tracks) take(track, root, true);
            } catch (error) {
                if (own === generation) usedStations.delete(root.id);
                console.warn('Волна: станция трека не загружена', error);
            }
            if (own !== generation) return 0;
        }
        // Похожие и станция почти ничего не дали (трек без похожих или всё отсеяно):
        // другие треки артиста зерна, потом свежее и популярное в настроении зерна
        seenCount += observed.length;
        if (seed && found.length < 3) {
            const first = seed.tracks[0];
            if (seed.kind === 'track' && first && !artistFallbackDone) {
                artistFallbackDone = true;
                try {
                    const artist = trackArtist(first);
                    const tracks = artist ? await artistOwnTracks(artist) : [];
                    if (disposed || own !== generation) return 0;
                    artistCount = tracks.length;
                    for (const track of tracks) accept(found, { track, reason: { kind: 'artistTrack', artist: artistName(first) || seed!.title } }, filter);
                } catch (error) {
                    if (own === generation) artistFallbackDone = false;
                    console.warn('Волна: треки артиста не загружены', error);
                }
                if (own !== generation) return 0;
            }
            fallbackMood ??= moodTags(seed.tracks, observed, 2);
            const moodTasks = fallbackMood.flatMap((tag) => (['recent', 'search'] as const).map((source) =>
                genrePage(source, tag).then((tracks) => {
                    if (disposed || own !== generation) return;
                    for (const track of tracks) accept(found, { track, reason: { kind: 'mood', seed: seed?.title ?? '…', genre: tag } }, filter);
                }).catch((error: unknown) => console.warn('Волна: настроение не загружено', error))));
            await Promise.all(moodTasks);
            if (own !== generation) return 0;
        }
        if (tasks.length && failures === tasks.length && !found.length) throw new Error('Источники волны не ответили');
        // Пресет: в пул идёт подходящее настроению (от 0,5), остальное ждёт в добивке по убыванию оценки
        const matched = mood ? splitByMood(found, observed, observedBy) : found;
        if (mood) lookupPlaylistMoods(found.filter((candidate) => !matched.includes(candidate)));
        // По вкусу, если профиль есть; без него как раньше, перемешиванием
        const current = taste;
        if (current) {
            traceScores(matched, current);
            applyTasteReasons(matched, current);
            pool.push(...tasteOrder(matched, current, Math.random, sessionScore));
        } else pool.push(...shuffleInPlace(matched));
        const pagesLeft = (list: string[]): boolean => list.some((tag) => (['recent', 'search'] as const).some((source) => !cursors.get(source + ':' + genreEnglish(tag))?.done));
        const moodLeft = moodSearch.some((tag, index) => (index === 0 ? ['recent', 'search'] : ['search']).some((source) => !cursors.get(source + ':' + genreEnglish(tag))?.done));
        const sourcesLeft = seedsFor(keys).length > 0 || stationRoots().length > 0 || pagesLeft(tags) || pagesLeft(fallbackMood ?? []) || moodLeft || (!seed && (scQueue === null || scQueue.length > 0));
        if (mood) moodRounds++;
        if (!found.length && !sourcesLeft) exhausted = true;
        return found.length;
    }
    // Сколько треков можно взять сейчас: подборка вперемешку с найденным тратится не быстрее найденного
    // Добивка пресета засчитывается после двух проходов: подходящего не хватило, дальше сбор не гоняется впустую
    const ready = (): number => pool.length + (seed?.order === 'blend' ? Math.min(ownQueue.length, pool.length + 1)
        : seed?.order === 'smart' ? Math.min(ownQueue.length, 3 * (pool.length + 1)) : ownQueue.length)
        + (activePreset() && moodRounds >= 2 ? moodReserve.length : 0);
    function ensurePool(need: number): Promise<void> {
        if (ready() >= need || exhausted) return Promise.resolve();
        if (!gathering) {
            const own = generation;
            const run = (async () => {
                for (let round = 0; round < 4 && ready() < need && !exhausted && !disposed && own === generation; round++) await gatherRound();
            })();
            gathering = run;
            // Подбор старого режима не должен снять отметку с подбора нового
            const clear = (): void => {
                if (gathering === run) gathering = null;
            };
            run.then(clear, clear);
        }
        return gathering;
    }
    // Подборка идёт по своему порядку, найденное с разнесёнными артистами.
    // «Умное перемешивание»: после каждых трёх своих один найденный, пока найденное есть
    function takeFromPool(count: number): WaveCandidate[] {
        const picked: WaveCandidate[] = [];
        const blend = seed?.order === 'blend';
        const smart = seed?.order === 'smart';
        // Окно разнесения по пулу: маленький пул не растягивает одного артиста на всю очередь (В2.6)
        const gap = spacingGap(pool);
        while (picked.length < count && (ownQueue.length || pool.length)) {
            const fromOwn = ownQueue.length > 0 && (smart ? !pool.length || ownRun < 3 : !blend || !pool.length || picked.length % 2 === 0);
            if (smart) ownRun = fromOwn ? ownRun + 1 : 0;
            // Места 1-3 поколения из найденного только уверенные (П2): первые треки после запуска пропускались втрое чаще
            const sure = !fromOwn && pickedInGeneration < 3 ? pool.filter(confident) : [];
            const item = fromOwn ? ownQueue.shift() : pickSpaced(sure.length ? sure : pool, 1, recentKeys, gap)[0];
            if (!item) break;
            if (!fromOwn) {
                pool = pool.filter((entry) => entry !== item);
                pooled.add(item);
                pickedInGeneration++;
            }
            picked.push(item);
            recentKeys.push(spacingKeys(item.track));
            if (recentKeys.length > 6) recentKeys.shift();
        }
        // Подходящего пресету не хватило: ближайшие по настроению, и в шапке честная строка об этом
        while (picked.length < count && activePreset() && moodReserve.length) {
            const next = moodReserve.shift();
            if (!next) break;
            moodShort = true;
            pooled.add(next.candidate);
            picked.push(next.candidate);
            recentKeys.push(spacingKeys(next.candidate.track));
            if (recentKeys.length > 6) recentKeys.shift();
        }
        return picked;
    }
    function resetGeneration(): void {
        generation++;
        fork = null;
        generationAt = Date.now();
        givenInGeneration = 0;
        pool = [];
        ownQueue = [];
        preview = [];
        exhausted = false;
        gathering = null;
        ownAdded = false;
        ownRun = 0;
        artistFallbackDone = false;
        fallbackMood = null;
        moodReserve = [];
        moodRounds = 0;
        moodShort = false;
        seenCount = 0;
        artistCount = 0;
        contextPending = true;
        pickedInGeneration = 0;
        usedNeighbors.clear();
        artistNeighborsDone = false;
        scQueue = null;
        usedSeeds.clear();
        usedStations.clear();
        cursors.clear();
        signatures.clear();
        families.clear();
        taken.clear();
        for (const candidate of known.values()) taken.add(candidate.track.id);
    }

    function queueTrace(slot: number): QueueTrace {
        const mood = activePreset();
        return {
            gen: generationAt, slot, source: 'wave:' + (seed ? seed.kind : mode), mode: seed?.mode ?? mode, waveGenre: seed ? '' : genre ?? '',
            libMode: seed?.kind === 'library' ? seed.library?.mode : undefined, ...(mood ? { preset: mood } : {}),
        };
    }
    function makeItems(list: WaveCandidate[]): SiteQueueItem[] {
        const Item = player?.getQueue().model;
        if (!Item || !SoundModel) return [];
        const items: SiteQueueItem[] = [];
        for (const candidate of list) {
            const sound = new SoundModel(candidate.track, { parse: true });
            if ((sound.isPlayable && !sound.isPlayable()) || sound.isSnippetized?.() || sound.isBlocked?.()) continue;
            const index = itemIndex++;
            const item = new Item({}, { sound, originalModel: sound, queryPosition: index, sourceInfo: { type: 'history' }, index });
            item.release?.();
            ours.add(item);
            itemTrace.set(item, queueTrace(++givenInGeneration));
            known.set(candidate.track.id, candidate);
            seedGiven.add(candidate.track.id);
            items.push(item);
        }
        return items;
    }
    function queueView(): { items: SiteQueueItem[]; index: number } {
        const p = player;
        if (!p) return { items: [], index: -1 };
        return { items: p.getQueue().slice(), index: p.getQueueState().currentIndex };
    }
    function upcoming(count: number): WaveCandidate[] {
        if (!active) return preview.slice(0, count);
        const { items, index } = queueView();
        const list: WaveCandidate[] = [];
        for (const item of items.slice(index + 1)) {
            const candidate = item.sound ? known.get(item.sound.id) : undefined;
            if (candidate && ours.has(item)) list.push(candidate);
            if (list.length >= count) break;
        }
        return list;
    }

    async function preparePreview(): Promise<void> {
        const own = generation;
        state = 'loading';
        render();
        try {
            await ensurePool(BATCH);
            if (own !== generation) return;
            preview = takeFromPool(BATCH);
            state = preview.length ? 'idle' : 'empty';
            autoRetries = 0;
        } catch (error) {
            if (own !== generation) return;
            console.warn('Волна: подбор не удался', error);
            state = 'error';
            // Сбой сети или сайт ещё не готов при запуске клиента: два повтора сами, дальше кнопка
            if (autoRetries < 2) {
                autoRetries++;
                setTimeout(() => {
                    if (!disposed && own === generation && state === 'error' && !active) void preparePreview();
                }, 4000 * autoRetries);
            }
        }
        render();
        // Подборки собираются после первой подборки волны, чтобы не спорить с ней за ответы сайта
        if (!disposed && isVisible()) shelfSection.ensure();
    }
    // keepCurrent: играющий трек доигрывает, волна встаёт за ним (волна по треку, который уже играет)
    async function start(first?: WaveCandidate, keepCurrent = false): Promise<boolean> {
        const p = player;
        if (!p) return false;
        const own = generation;
        if (!preview.length) {
            state = 'loading';
            render();
            try {
                await ensurePool(BATCH);
            } catch (error) {
                console.warn('Волна: подбор не удался', error);
                if (own === generation) { state = 'error'; render(); }
                return false;
            }
            if (own !== generation) return false;
            preview = takeFromPool(BATCH);
        }
        // Один стартовый трек без подобранных за ним это не волна: очередь не трогается, startSeed скажет, что похожих нет
        if (first && !preview.some((item) => item.track.id !== first.track.id)) {
            state = 'empty';
            render();
            return false;
        }
        const batch = first ? [first, ...preview.filter((item) => item.track.id !== first.track.id)] : preview;
        preview = [];
        const items = makeItems(batch);
        if (!items.length) {
            state = 'empty';
            render();
            return false;
        }
        if (!active) fallbackBefore = p.getState('fallbackEnabled') === true;
        // Родной автоплей SoundCloud иначе включит свою станцию после волны
        p.toggleState('fallbackEnabled', false);
        autoplayReleased = false;
        active = true;
        startedAt = Date.now();
        jumped = !keepCurrent;
        if (keepCurrent) {
            const { items: queued, index } = queueView();
            const explicit = queued.slice(index + 1).filter((item) => item.explicit && !ours.has(item));
            p.getQueue().reset(queued.slice(0, index + 1).concat(explicit, items));
            if (!p.isPlaying()) p.playCurrent({ userInitiated: true });
        } else {
            p.replaceQueue(items, 0);
            p.playCurrent({ userInitiated: true });
        }
        state = 'playing';
        render();
        void refill();
        return true;
    }
    function end(): void {
        active = false;
        autoplayReleased = false;
        seed = null;
        derivedSeeds = [];
        skipped.clear();
        sessionArtists.clear();
        sessionTags.clear();
        sessionSeeds.clear();
        skipRun = 0;
        skipSeries = [];
        sessionTraits.clear();
        fastRun = 0;
        fork = null;
        const p = player;
        if (p && fallbackBefore !== null && p.getState('fallbackEnabled') === false) p.toggleState('fallbackEnabled', fallbackBefore);
        fallbackBefore = null;
        state = 'idle';
        resetGeneration();
        if (isVisible()) void preparePreview();
        else render();
    }
    // Подборка кончилась, а треков волны впереди нет: после последнего играет автоплей SoundCloud, если он был включён.
    // Его станция сменит очередь, и волна закончится сама. «Все треки артиста» автоплею не отдаются: там только он
    function releaseAutoplay(p: SitePlayer): void {
        if (autoplayReleased || !fallbackBefore) return;
        autoplayReleased = true;
        if (p.getState('fallbackEnabled') === false) p.toggleState('fallbackEnabled', true);
    }
    // Треки снова есть (сменили режим или жанр): автоплей опять ждёт конца волны
    function holdAutoplay(p: SitePlayer): void {
        if (!autoplayReleased) return;
        autoplayReleased = false;
        p.toggleState('fallbackEnabled', false);
    }
    const aheadOfCurrent = (): number => {
        const { items, index } = queueView();
        return items.slice(index + 1).filter((item) => ours.has(item)).length;
    };
    let refilling = false;
    async function refill(): Promise<void> {
        if (!active || refilling || !player) return;
        if (aheadOfCurrent() > REFILL_AT) return;
        refilling = true;
        const own = generation;
        try {
            await ensurePool(BATCH);
            if (!active || own !== generation || !ownsQueue()) return;
            rerankPool();
            const added = makeItems(takeFromPool(BATCH));
            if (added.length) {
                player.getQueue().add(added);
                holdAutoplay(player);
            } else if (exhausted && aheadOfCurrent() === 0 && seed?.kind !== 'artistAll') releaseAutoplay(player);
        } catch (error) {
            console.warn('Волна: догрузка не удалась', error);
        } finally {
            refilling = false;
        }
        render();
    }
    // Впереди стоящее из найденного возвращается в пул и берётся заново по вкусу с поправками сессии. Своё из подборки
    // встаёт обратно в свою очередь по порядку, поставленное руками остаётся (В2.2, В2.14)
    // fresh: найденное от зёрен с пропусками в пул не возвращается, его место занимает новое
    function rebuildAhead(fresh = false): void {
        const p = player;
        if (!p || !active || !ownsQueue()) return;
        const { items, index } = queueView();
        const kept: SiteQueueItem[] = [];
        const back: WaveCandidate[] = [];
        const own: WaveCandidate[] = [];
        for (const item of items.slice(index + 1)) {
            const candidate = ours.has(item) && !item.explicit && item.sound ? known.get(item.sound.id) : undefined;
            if (!candidate) kept.push(item);
            else if (pooled.has(candidate)) back.push(candidate);
            else own.push(candidate);
        }
        if (!back.length) return;
        pool.push(...(fresh ? back.filter(unskippedSeed) : back));
        ownQueue.unshift(...own);
        rerankPool();
        // Окно разнесения считается от того, что остаётся играть до новой части очереди
        recentKeys.length = 0;
        for (const item of items.slice(Math.max(0, index - 5), index + 1)) {
            const candidate = item.sound ? known.get(item.sound.id) : undefined;
            if (candidate) recentKeys.push(spacingKeys(candidate.track));
        }
        const added = makeItems(takeFromPool(back.length + own.length));
        p.getQueue().reset(items.slice(0, index + 1).concat(kept, added));
        render();
    }
    // Лайк и «Больше такого» действуют сразу (В2.9): похожие на трек запрашиваются тут же, два лучших по вкусу встают
    // первыми после поставленного руками, остальное уходит в пул. Подборка по порядку не перебивается
    async function boostSimilar(track: WaveTrack): Promise<void> {
        if (!active || seed?.order === 'fixed' || usedSeeds.has(track.id)) return;
        usedSeeds.add(track.id);
        const own = generation;
        try {
            const body = await call('relatedSounds', { track_id: track.id }, { limit: 50 });
            const p = player;
            if (disposed || own !== generation || !active || !p || !ownsQueue()) return;
            const filter = currentFilter();
            const keys = !seed && genre ? genreKeysFor(genre) : [];
            const seedTitle = (track.title ?? '').trim() || '…';
            const found: WaveCandidate[] = [];
            for (const value of collection(body)) {
                const item = asTrack(value);
                if (item && trackMatchesGenre(item, keys)) accept(found, { track: item, reason: { kind: filter.mode === 'fresh' ? 'fresh' : 'similar', seed: seedTitle } }, filter, track.id);
            }
            if (!found.length) return;
            const current = taste ?? EMPTY_TASTE;
            traceScores(found, current);
            const ordered = tasteOrder(found, current, Math.random, sessionScore);
            const front = pickSpaced(ordered, 2, recentKeys, spacingGap(ordered));
            pool.push(...ordered.filter((candidate) => !front.includes(candidate)));
            for (const candidate of front) pooled.add(candidate);
            const added = makeItems(front);
            if (!added.length) return;
            const { items, index } = queueView();
            let at = index + 1;
            while (at < items.length && items[at].explicit && !ours.has(items[at])) at++;
            p.getQueue().reset(items.slice(0, at).concat(added, items.slice(at)));
            holdAutoplay(p);
            render();
        } catch (error) {
            if (own === generation) usedSeeds.delete(track.id);
            console.warn('Волна: похожие на отмеченный трек не загружены', error);
        }
    }
    // Три ранних пропуска подряд (В2.14): подбор берёт новые зёрна, найденное от зёрен с пропусками уходит из пула,
    // очередь впереди собирается из нового. Нового не хватило: очередь не пустеет, остаётся пересчёт с поправками сессии
    const unskippedSeed = (candidate: WaveCandidate): boolean => (sessionSeeds.get(candidate.trace?.seed ?? 0) ?? 0) >= 0;
    // П7: на втором и третьем раннем пропуске подряд общий признак всей серии прижимается до конца волны, плашка его
    // называет. Признаки зерна и выбранный жанр не прижимаются: в этой волне они ничего не различают
    function pressTrait(): void {
        const skip = [...sessionTraits.keys()];
        if (seed?.tracks[0]) for (const trait of trackTraits(seed.tracks[0])) skip.push(trait.kind + ':' + trait.key);
        if (!seed && genre) for (const key of genreKeysFor(genre)) skip.push('genre:' + key);
        const trait = seriesTrait(skipSeries, skip);
        if (!trait) return;
        const key = trait.kind + ':' + trait.key;
        sessionTraits.set(key, trait);
        const text = trait.kind === 'lang' ? (trait.key === 'cyr' ? T.traitLessCyr : T.traitLessInst)
            : trait.kind === 'genre' ? fillText(T.traitLessGenre, { genre: trait.label })
            : trait.kind === 'marker' ? fillText(T.traitLessMarker, { marker: trait.label }) : T.traitLessForeign;
        showToast(text, () => {
            sessionTraits.delete(key);
            rebuildAhead();
        });
    }
    // П8: варианты разных направлений из найденного: любимый артист, похожий артист, подборка SoundCloud, спокойнее,
    // новый артист, соседи по вкусу. На направление лучший по вкусу с поправкой сессии, артисты не повторяются, до пяти;
    // меньше четырёх развилку не открывают. На время развилки варианты уходят из пула, чтобы не встать в очередь
    function openFork(): boolean {
        const current = taste ?? EMPTY_TASTE;
        const originOf = (candidate: WaveCandidate): string => candidate.trace?.origin ?? candidate.reason.kind;
        const artists = new Set<number>();
        const options: Array<{ candidate: WaveCandidate; label: string }> = [];
        const direction = (test: (candidate: WaveCandidate, score: TasteScore) => boolean, label: (candidate: WaveCandidate, score: TasteScore) => string): void => {
            if (options.length >= 5) return;
            let best: { candidate: WaveCandidate; score: TasteScore; value: number } | null = null;
            for (const candidate of pool) {
                if (artists.has(trackArtist(candidate.track))) continue;
                const score = tasteScore(candidate.track, current);
                if (!test(candidate, score)) continue;
                const value = score.score + sessionScore(candidate);
                if (!best || value > best.value) best = { candidate, score, value };
            }
            if (!best) return;
            artists.add(trackArtist(best.candidate.track));
            options.push({ candidate: best.candidate, label: label(best.candidate, best.score) });
        };
        const why = (candidate: WaveCandidate): string => reasonText(candidate.reason, T);
        direction((_, score) => score.artist >= 1 || score.creditBest >= 1, (candidate, score) => {
            const name = score.creditBest > score.artist && score.creditName ? score.creditName : (candidate.track.user?.username ?? '').trim();
            return name ? fillText(T.whyTasteArtist, { artist: name }) : why(candidate);
        });
        direction((candidate) => originOf(candidate) === 'relatedArtist', why);
        direction((candidate) => originOf(candidate) === 'scMix', why);
        direction((candidate) => moodOf(candidate.track).calm >= 0.5, () => T.forkCalm);
        direction((_, score) => !score.known, () => T.whyNewArtist);
        direction((candidate) => originOf(candidate) === 'neighbors', why);
        if (options.length < 4) return false;
        const chosen = new Set(options.map((option) => option.candidate));
        pool = pool.filter((candidate) => !chosen.has(candidate));
        fork = { at: Date.now(), options };
        if (!isVisible()) showToast(T.forkAway);
        return true;
    }
    // Крестик или две минуты без выбора: варианты возвращаются в пул, музыка идёт дальше как шла
    function closeFork(): void {
        if (!fork) return;
        pool.push(...fork.options.map((option) => option.candidate));
        fork = null;
        rerankPool();
        render();
    }
    // Выбор ставит трек следующим и играет его, направление поднимается в сессии, как «Больше такого», без отметки в main
    function pickFork(id: number): void {
        const current = fork;
        const option = current?.options.find((entry) => entry.candidate.track.id === id);
        if (!current || !option) return;
        pool.push(...current.options.filter((entry) => entry !== option).map((entry) => entry.candidate));
        fork = null;
        const p = player;
        const [item] = p && active && ownsQueue() ? makeItems([option.candidate]) : [];
        if (!p || !item) {
            rerankPool();
            render();
            return;
        }
        pooled.add(option.candidate);
        const { items, index } = queueView();
        p.getQueue().reset(items.slice(0, index + 1).concat(item, items.slice(index + 1)));
        jumped = true;
        p.setCurrentItem(item, {});
        if (!p.isPlaying()) p.playCurrent({ userInitiated: true });
        adjustSession(option.candidate, 1);
        rerankPool();
        void boostSimilar(option.candidate.track);
        render();
    }
    // Дослушанный трек с прижатым признаком снимает прижим: значит, дело было не в нём
    function releaseTraits(track: WaveTrack): void {
        if (!sessionTraits.size) return;
        for (const trait of trackTraits(track)) sessionTraits.delete(trait.kind + ':' + trait.key);
    }
    async function changeCourse(): Promise<void> {
        const own = generation;
        try {
            await ensurePool(ready() + BATCH);
        } catch (error) {
            console.warn('Волна: новые зёрна после пропусков не собраны', error);
        }
        if (own !== generation) return;
        const fresh = pool.filter(unskippedSeed);
        if (fresh.length >= BATCH) pool = fresh;
        rebuildAhead(fresh.length >= BATCH);
    }
    // Смена режима или жанра во время игры: текущий трек доигрывает, дальше новая подборка
    async function restartAhead(): Promise<void> {
        const p = player;
        if (!p) return;
        const own = generation;
        state = 'loading';
        render();
        try {
            await ensurePool(BATCH);
        } catch (error) {
            console.warn('Волна: подбор не удался', error);
        }
        if (own !== generation || !active || !ownsQueue()) return;
        const fresh = makeItems(takeFromPool(BATCH));
        if (!fresh.length) {
            state = 'empty';
            render();
            return;
        }
        const { items, index } = queueView();
        const head = items.slice(0, index + 1);
        const explicit = items.slice(index + 1).filter((item) => item.explicit && !ours.has(item));
        p.getQueue().reset(head.concat(explicit, fresh));
        holdAutoplay(p);
        state = 'playing';
        render();
    }
    // Режим, жанр и пресет действуют со следующего трека: текущий доигрывает, впереди новая подборка
    function applySettings(nextMode: WaveMode, nextGenre: string | null, nextPreset: WaveMood | null = preset): void {
        mode = nextMode;
        preset = nextPreset;
        genre = nextGenre ? formatGenres(parseGenres(nextGenre)) || null : null;
        if (genre) recentGenres = [genre, ...recentGenres.filter((item) => item !== genre)].slice(0, 6);
        saveSettings();
        popOpen = false;
        staleSeeds.clear();
        resetGeneration();
        if (active) void restartAhead();
        else void preparePreview();
    }
    // «Встряхнуть»: другие зёрна и новая подборка, текущий трек доигрывает.
    // Показанное до запуска не вернётся, страницы жанра идут дальше, а не с начала
    function shake(): void {
        if (state === 'loading' || state === 'unavailable') return;
        for (const id of usedSeeds) staleSeeds.add(id);
        const shown = preview.map((item) => item.track);
        const pages = new Map(cursors);
        popOpen = false;
        resetGeneration();
        for (const [key, cursor] of pages) cursors.set(key, cursor);
        for (const track of shown) taken.add(track.id);
        // Показанное и сыгранное не возвращается и перезаливом той же версии
        for (const track of [...shown, ...[...known.values()].map((candidate) => candidate.track)]) for (const key of copyKeys(track)) signatures.add(key);
        if (active) void restartAhead();
        else void preparePreview();
    }

    // Одна запись на трек за жизнь страницы; после 5000 треков забываются самые старые, а журнал не встаёт
    function journal(id: number): void {
        if (!id || !rememberRecent(recorded, id, 5000)) return;
        profile?.heard.add(id);
        pendingJournal.push(id);
        if (journalTimer === undefined) journalTimer = setTimeout(flushJournal, 5000);
    }
    // Журнал пишется по id пользователя SoundCloud: до ответа /me записи ждут в очереди
    function flushJournal(): void {
        journalTimer = undefined;
        if (!pendingJournal.length) return;
        if (!userId) {
            if (!disposed) void ensureUser().then(() => { if (userId) flushJournal(); }, (error: unknown) => console.warn('Волна: пользователь не определён', error));
            return;
        }
        const ids = pendingJournal.splice(0);
        try {
            host.soundcloudAPI?.waveJournal?.add(userId, ids);
        } catch (error) {
            console.warn('Волна: журнал не записан', error);
        }
    }

    const numberOf = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);
    const textOf = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');
    // Подпись волны для карточки Discord: режим и жанр или трек, артист, плейлист, от которых она идёт
    // Откуда волна: строка под заголовком блока, коротко (short) для карточки Discord
    function seedText(current: Seed, short: boolean): string {
        switch (current.kind) {
            case 'track': return fillText(T.seedTrack, { seed: current.title });
            case 'artist': return fillText(T.seedArtist, { seed: current.title });
            case 'artistAll': return fillText(T.seedArtistAll, { seed: current.title });
            case 'playlist': return fillText(T.seedPlaylist, { seed: current.title });
            case 'daily': return short ? T.shelfDaily : T.seedDaily;
            case 'forgotten': return short ? T.shelfForgotten : T.seedForgotten;
            case 'liked': return short ? T.shelfLiked : T.seedLiked;
            case 'group': return fillText(T.seedGroup, { seed: current.title });
            case 'tracks': return fillText(T.seedTracks, { seed: current.title });
            case 'radar': return current.title;
            case 'library': return short ? T.library : fillText(T.seedLibrary, { seed: current.title });
        }
    }
    function waveLabel(): string {
        if (seed) return seedText(seed, true);
        return [T.wave, mode === 'similar' ? T.similar : T.fresh, genre ?? ''].filter(Boolean).join(' · ');
    }
    function fromWave(item: SiteQueueItem | null | undefined): boolean {
        return active && !!item && ours.has(item);
    }
    function publishMeta(sound: SiteSound): void {
        const attrs = sound.attributes ?? { id: sound.id };
        const user = (attrs.user && typeof attrs.user === 'object' ? attrs.user : {}) as Record<string, unknown>;
        const meta: TrackMeta = {
            id: sound.id,
            url: textOf(attrs.permalink_url, 2048),
            genre: textOf(attrs.genre, 80),
            tags: textOf(attrs.tag_list, 500),
            plays: numberOf(attrs.playback_count),
            likes: numberOf(attrs.likes_count),
            artist: textOf(user.username, 200),
            avatar: textOf(user.avatar_url, 2048),
            artwork: textOf(attrs.artwork_url, 2048),
            wave: fromWave(player?.getCurrentQueueItem()) ? waveLabel() : '',
        };
        const json = JSON.stringify(meta);
        if (json === sentMeta) return;
        sentMeta = json;
        try {
            host.soundcloudAPI?.sendTrackMeta?.(meta);
        } catch (error) {
            console.warn('Волна: сведения о треке не отправлены', error);
        }
    }

    // Разбор выдачи для журнала (v4): поколение, место, исходная причина и зерно, оценка вкуса, режим
    function waveFields(candidate: WaveCandidate, trace: QueueTrace | undefined): Partial<PlaySignal> {
        // Трек из сессии до перезапуска без разбора: причина по вкусу уже заменила исходную, и исходная неизвестна
        const kind = candidate.reason.kind;
        const origin = candidate.trace?.origin ?? (kind === 'tasteArtist' || kind === 'tasteTag' ? undefined : kind);
        const fields: Partial<PlaySignal> = { seed: candidate.trace?.seed ?? 0, laterNow: false, moreNow: false };
        if (origin) fields.origin = origin;
        if (trace) Object.assign(fields, { gen: trace.gen, slot: trace.slot, mode: trace.mode });
        if (trace?.waveGenre) fields.waveGenre = trace.waveGenre;
        if (trace?.libMode) fields.libMode = trace.libMode;
        if (trace?.preset) fields.preset = trace.preset;
        if (candidate.trace && candidate.trace.score !== null) Object.assign(fields, { score: candidate.trace.score, known: candidate.trace.known });
        if (candidate.trace?.tv) fields.tv = candidate.trace.tv;
        return fields;
    }
    function beginPlay(sound: SiteSound, picked = false): void {
        const attrs = sound.attributes ?? { id: sound.id };
        const item = player?.getCurrentQueueItem();
        const candidate = known.get(sound.id);
        const trace = item && ours.has(item) ? itemTrace.get(item) : undefined;
        const waveItem = !!candidate && (fromWave(item) || !!trace);
        play = {
            signal: {
                at: Date.now(),
                id: sound.id,
                artist: numberOf(attrs.user_id) || numberOf((attrs.user as { id?: unknown } | undefined)?.id),
                dur: durationOf(sound) || numberOf(attrs.full_duration) || numberOf(attrs.duration),
                pos: 0,
                heard: 0,
                end: 'skip',
                source: waveItem ? trace?.source ?? 'wave:' + (seed ? seed.kind : mode) : siteSource(item?.sourceInfo?.type),
                why: waveItem && candidate ? candidate.reason.kind : '',
                liked: currentLiked,
                likedNow: false,
                disliked: false,
                hiddenArtist: false,
                genre: textOf(attrs.genre, 80),
                tags: textOf(attrs.tag_list, 300),
                v: 4,
                tz: -new Date().getTimezoneOffset(),
                title: textOf(attrs.title, 300),
                artistName: textOf((attrs.user as { username?: unknown } | undefined)?.username, 200),
                path: trackPath(attrs.permalink_url),
                artwork: textOf(attrs.artwork_url, 400),
                picked,
                ...(waveItem && candidate ? waveFields(candidate, trace) : {}),
            },
            lastPosition: positionOf(sound),
            likedAtStart: currentLiked,
            spans: [],
        };
    }
    // Слить пересекающиеся участки по порядку
    function mergeSpans(spans: Array<[number, number]>): Array<[number, number]> {
        const merged: Array<[number, number]> = [];
        for (const span of spans.slice().sort((a, b) => a[0] - b[0])) {
            const last = merged[merged.length - 1];
            if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
            else merged.push([span[0], span[1]]);
        }
        return merged;
    }
    // byUser: трек сменил человек; без него сменил сам сайт (ошибка, конец очереди), это не пропуск
    function finishPlay(end?: PlaySignal['end'], byUser = false): void {
        const current = play;
        play = null;
        if (!current) return;
        // Меньше секунды: сигнал только о смене человеком, это пропуск с порога. История и счётчики его не показывают
        if (current.signal.heard < 1000 && (!byUser || end === 'stop')) return;
        const signal = current.signal;
        signal.end = signal.heard < 1000 ? 'skip' : end ?? playEnd(signal.dur, signal.pos);
        signal.likedNow = signal.liked && !current.likedAtStart;
        signal.spans = mergeSpans(current.spans).map(([from, to]) => [Math.round(from), Math.round(to)]);
        if (signal.end !== 'stop') signal.endedBy = byUser ? 'user' : 'auto';
        const covered = signal.spans.reduce((sum, [from, to]) => sum + to - from, 0);
        if (!signal.looped && (signal.end === 'done' || (signal.dur > 0 && covered >= signal.dur * 0.8))) noteDone(signal);
        const heardTrack = known.get(signal.id)?.track;
        if (heardTrack && signal.dur > 0 && covered >= signal.dur * 0.8) releaseTraits(heardTrack);
        shelfSection.notePlayed(signal.id);
        pendingSignals.push(signal);
        if (pendingSignals.length > 1000) pendingSignals.splice(0, pendingSignals.length - 1000);
        if (signalsTimer === undefined) signalsTimer = setTimeout(flushSignals, 5000);
    }
    // Раз в секунду: сколько реально прозвучало (перемотка не считается), где сейчас и стоит ли лайк
    function trackPlay(sound: SiteSound, playing: boolean): void {
        const current = play;
        if (!current) return;
        const position = positionOf(sound);
        const signal = current.signal;
        if (!signal.dur) signal.dur = durationOf(sound);
        // Трек на повторе: позиция вернулась в начало после конца, это новое прослушивание с пометкой повтора
        if (signal.dur && current.lastPosition >= signal.dur - 5000 && position < 5000) {
            finishPlay('done');
            beginPlay(sound);
            if (play) play.signal.looped = true;
            return;
        }
        const delta = position - current.lastPosition;
        if (playing && delta > 0 && delta <= 3000) {
            signal.heard += delta;
            // Участок продолжается, пока нет перемотки; повтор того же места покрытия не прибавит
            const last = current.spans[current.spans.length - 1];
            if (last && last[1] === current.lastPosition) last[1] = position;
            else {
                if (current.spans.length >= 64) current.spans = mergeSpans(current.spans);
                // Предел журнала: при сотне перемоток покрытие занижается, а не выдумывается
                if (current.spans.length < 64) current.spans.push([current.lastPosition, position]);
            }
        }
        current.lastPosition = position;
        signal.pos = position;
        signal.liked = currentLiked;
    }
    function flushSignals(): void {
        signalsTimer = undefined;
        if (!pendingSignals.length) return;
        if (!userId) {
            if (!disposed) void ensureUser().then(() => { if (userId) flushSignals(); }, (error: unknown) => console.warn('Волна: пользователь не определён', error));
            return;
        }
        const signals = pendingSignals.splice(0);
        try {
            host.soundcloudAPI?.waveSignals?.add(userId, signals);
            // Лайк ушёл в журнал: main уже сбросил вкус, следующий подбор возьмёт новый профиль
            if (signals.some((signal) => signal.likedNow)) tasteAt = 0;
        } catch (error) {
            console.warn('Волна: сигналы не записаны', error);
        }
    }

    // Раз в секунду: журнал слышанного, пропуски, лайки, конец волны и догрузка
    function tick(): void {
        const p = player;
        if (!p || disposed) return;
        queueControls.tick();
        if (shelfSection.failed() && isVisible()) shelfSection.ensure();
        recovery.tick();
        if (fork && Date.now() - fork.at > 120000) closeFork();
        const sound = p.getCurrentSound();
        const id = sound?.id ?? 0;
        if (id !== currentId) {
            const previous = known.get(currentId);
            // Клик, которым трек поставили, его пропуском не считается: не загрузился и сайт сам ушёл дальше
            // (зашифрованный трек, сбой сети) сразу после клика, это не пропуск человеком
            const byUser = recentInput() && lastInput.at >= currentSince;
            // Ранний пропуск: трек волны сменил человек в первые 30 секунд, не кликом в блоке и не в конце. Снижается интерес
            // к этой версии: её вероятные копии в сессии больше не встают, остальные треки аккаунта играют (A07).
            // Смена самим сайтом (ошибка, конец очереди) пропуском не считается. Зерно выбрано руками, его пропуск ничего не убирает.
            // Пропуск ещё снижает аккаунт, теги и зерно трека до конца волны, и очередь впереди берётся заново (В2.2)
            const early = !!previous && active && byUser && previous.reason.kind !== 'seedTrack' && !jumped && currentPosition < 30000 && currentDuration - currentPosition > 10000;
            if (early && previous) {
                for (const key of copyKeys(previous.track)) skipped.add(key);
                const kept = (item: WaveCandidate): boolean => item.track.id === previous.track.id || !skipped.has(copyKey(item.track));
                pool = pool.filter(kept);
                ownQueue = ownQueue.filter(kept);
                adjustSession(previous, -1);
                notePresetSkip(previous.track);
                skipRun++;
                skipSeries.push(previous.track);
                fastRun = currentPosition < 5000 ? fastRun + 1 : 0;
            } else if (previous && currentPosition >= 30000) {
                skipRun = 0;
                skipSeries = [];
                fastRun = 0;
            }
            jumped = false;
            finishPlay(undefined, byUser);
            currentId = id;
            currentSince = Date.now();
            currentPosition = 0;
            currentDuration = durationOf(sound);
            currentLiked = likeButton()?.classList.contains('sc-button-selected') ?? false;
            if (sound) beginPlay(sound, byUser && lastInput.pick);
            if (early && skipRun >= 2) pressTrait();
            if (early && skipRun >= 3) {
                // Три быстрых пропуска подряд: человек ищет другое, развилка вместо пересборки вслепую (П8)
                const scanning = fastRun >= 3 && seed?.order !== 'fixed';
                skipRun = 0;
                skipSeries = [];
                fastRun = 0;
                if (scanning && openFork()) rebuildAhead();
                else void changeCourse();
            } else if (early) rebuildAhead();
            render();
        } else if (sound) {
            currentPosition = positionOf(sound);
            if (currentPosition >= 10000) journal(id);
            const liked = likeButton()?.classList.contains('sc-button-selected') ?? false;
            if (liked !== currentLiked) {
                currentLiked = liked;
                const candidate = known.get(id);
                if (liked && candidate && !likedSeeds.includes(candidate.track)) likedSeeds.unshift(candidate.track);
                // Лайк трека волны сразу поднимает его аккаунт и теги в сессии и ставит похожие ближе (В2.2, В2.9)
                if (liked && candidate && active && fromWave(p.getCurrentQueueItem())) {
                    adjustSession(candidate, 1);
                    void boostSimilar(candidate.track);
                }
                updateLike();
            }
            trackPlay(sound, p.isPlaying());
            tintLate();
        }
        if (sound) publishMeta(sound);
        // Пауза кнопкой сайта или медиаклавишей: иначе кнопка блока остаётся в старом состоянии
        if (section && (active && p.isPlaying()) !== shownPlaying) render();
        if (!active) return;
        // Сразу после запуска текущего элемента может ещё не быть, поэтому три секунды форы
        if (!ownsQueue()) {
            if (Date.now() - startedAt > 3000) end();
            return;
        }
        void refill();
    }
    // Очередь наша, пока в ней на текущем месте или дальше стоят треки волны; иначе пользователь включил своё
    function ownsQueue(): boolean {
        const p = player;
        if (!p) return false;
        const { items, index } = queueView();
        const current = p.getCurrentQueueItem();
        return (!!current && ours.has(current)) || items.slice(Math.max(0, index)).some((item) => ours.has(item));
    }

    // ===== Разбор ссылок, старт подборки, переход по ссылке, отметки «Не нравится» =====
    /** Что под курсором при ПКМ: ссылка, артист трека (если виден) и сам трек, если он уже известен волне */
    interface Artist { id: number; username: string; url: string }

    // Ответ живёт 10 минут: плейлист правят, станция трека меняется, а страница живёт сутками
    const resolved = new Map<string, { at: number; found: Promise<unknown> }>();
    function resolveUrl(url: string): Promise<unknown> {
        const key = canonicalUrl(url) || url;
        const kept = resolved.get(key);
        if (kept && Date.now() - kept.at < 10 * 60 * 1000) return kept.found;
        const found = call('resolve', {}, { url });
        resolved.delete(key);
        resolved.set(key, { at: Date.now(), found });
        if (resolved.size > 100) resolved.delete(resolved.keys().next().value as string);
        // Неудачный ответ не кешируется: следующий клик спросит снова
        void found.catch(() => {
            if (resolved.get(key)?.found === found) resolved.delete(key);
        });
        return found;
    }
    const tracksOf = (body: unknown): WaveTrack[] => collection(body).map(asTrack).filter((track): track is WaveTrack => !!track);
    const uniqueTracks = (list: WaveTrack[]): WaveTrack[] => {
        const seen = new Set<number>();
        return list.filter((track) => {
            if (seen.has(track.id)) return false;
            seen.add(track.id);
            return true;
        });
    };
    function asArtist(value: unknown, fallbackUrl: string): Artist | null {
        const user = value as { id?: unknown; username?: unknown; permalink_url?: unknown } | null;
        if (!user || typeof user.id !== 'number' || user.id <= 0) return null;
        return { id: user.id, username: typeof user.username === 'string' ? user.username : '', url: typeof user.permalink_url === 'string' ? user.permalink_url : fallbackUrl };
    }
    async function trackOf(target: MenuTarget): Promise<WaveTrack | null> {
        if (target.track) return target.track;
        const track = asTrack(await resolveUrl(target.url));
        return track && (!track.kind || track.kind === 'track') ? track : null;
    }
    async function artistOf(target: MenuTarget): Promise<Artist | null> {
        if (target.kind === 'artist') return asArtist(await resolveUrl(target.url), target.url);
        const track = await trackOf(target);
        const direct = asArtist(track?.user, target.artistUrl);
        if (direct) return direct;
        if (track?.user_id) return { id: track.user_id, username: track.user?.username ?? '', url: target.artistUrl };
        return target.artistUrl ? asArtist(await resolveUrl(target.artistUrl), target.artistUrl) : null;
    }
    // Треки плейлиста; у системных (станции, подборки) приходят заготовки без названий, их добирает trackBatch
    async function playlistTracks(body: unknown): Promise<WaveTrack[]> {
        const raw = (body as { tracks?: unknown } | null)?.tracks;
        const entries = Array.isArray(raw) ? raw.map(asTrack).filter((track): track is WaveTrack => !!track) : [];
        const full = entries.filter((track) => typeof track.title === 'string');
        const stubs = entries.filter((track) => typeof track.title !== 'string').map((track) => track.id).slice(0, 150);
        for (let i = 0; i < stubs.length; i += 50) full.push(...tracksOf(await call('trackBatch', {}, { ids: stubs.slice(i, i + 50).join(',') })));
        return uniqueTracks(full).filter(isWaveEligible);
    }
    // Лучшее артиста вперемешку с неслышанным из последних загрузок (П3): два из топа, одно новое, до 15.
    // Последние загрузки не ответили: только топ
    async function artistOwnTracks(id: number): Promise<WaveTrack[]> {
        const [top, latest] = await Promise.all([
            call('userToptracks', { id }, { limit: 20 }).then(tracksOf),
            call('userTracks', { id }, { limit: 30 }).then(tracksOf).catch((error: unknown) => {
                console.warn('Волна: последние загрузки артиста не загружены', error);
                return [];
            }),
        ]);
        const heard = profile?.heard ?? new Set<number>();
        const best = uniqueTracks(top).filter(isWaveEligible);
        const fresh = uniqueTracks(latest).filter((track) => isWaveEligible(track) && !heard.has(track.id) && !best.some((item) => item.id === track.id));
        const list: WaveTrack[] = [];
        while ((best.length || fresh.length) && list.length < 15) {
            const next = (list.length % 3 === 2 && fresh.length > 0) || !best.length ? fresh.shift() : best.shift();
            if (next) list.push(next);
        }
        return list;
    }
    // «Все треки артиста» (Ф1): загрузки его аккаунта (до 500) и найденное поиском по имени, где он исполнитель, ремиксер
    // или в титрах. Песня на чужом канале ведёт к исполнителю из названия, его аккаунт берётся из найденного: чаще всех
    // выложивший треки под тем же именем. Порядок перемешан, версии одной песни разнесены
    async function artistCatalog(target: MenuTarget): Promise<{ title: string; artist: number; tracks: WaveTrack[] } | null> {
        const uploader = await artistOf(target);
        const track = target.kind === 'artist' ? null : await trackOf(target);
        const credits = track ? trackCredits(track) : [];
        const performer = track ? performerKey(trackArtist(track), track.user?.username, credits) : '';
        const credit = performer.startsWith('a:') ? credits.find((item) => item.role === 'artist' && 'a:' + item.key === performer) : undefined;
        const name = (credit?.name ?? uploader?.username ?? '').trim();
        const key = nameKey(name);
        if (!key && !uploader) return null;
        const uploads = async (id: number): Promise<WaveTrack[]> => {
            const list: WaveTrack[] = [];
            let query: Record<string, string | number> | null = { limit: 50 };
            for (let page = 0; page < 10 && query && !disposed; page++) {
                let body: unknown;
                try {
                    body = await call('userTracks', { id }, query);
                } catch (error) {
                    // Первая страница обязана прийти, дальше играет то, что успело
                    if (!page) throw error;
                    console.warn('Волна: загрузки артиста догружены не до конца', error);
                    break;
                }
                const found = tracksOf(body);
                list.push(...found);
                if (!found.length) break;
                query = nextQuery(body);
            }
            return list;
        };
        const search = async (): Promise<WaveTrack[]> => {
            const list: WaveTrack[] = [];
            let query: Record<string, string | number> | null = { q: name, limit: 50 };
            for (let page = 0; page < 4 && query && !disposed; page++) {
                let body: unknown;
                try {
                    body = await call('searchCategory', { category: 'tracks' }, query);
                } catch (error) {
                    console.warn('Волна: поиск треков артиста не ответил', error);
                    break;
                }
                const found = tracksOf(body);
                list.push(...found.filter((item) => performerNames(item).has(key) || trackCredits(item).some((entry) => entry.key === key)));
                if (!found.length) break;
                query = nextQuery(body);
            }
            return list;
        };
        const direct = !credit && uploader ? uploader.id : 0;
        const [found, own] = await Promise.all([key ? search() : Promise.resolve([]), direct ? uploads(direct) : Promise.resolve([])]);
        let id = direct;
        let mine = own;
        if (!id) {
            const counts = new Map<number, number>();
            for (const item of found) if (nameKey(item.user?.username) === key) counts.set(trackArtist(item), (counts.get(trackArtist(item)) ?? 0) + 1);
            id = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
            if (id) mine = await uploads(id);
        }
        const list = uniqueTracks([...mine, ...found]).filter(isWaveEligible);
        return { title: name || '…', artist: id, tracks: spreadBy(shuffleInPlace(list), (item) => familyKey(item) || 'id:' + item.id, 3) };
    }
    // Новая волна от зёрен: прошлая подборка сбрасывается, волна сразу играет. Не вышло: тост и обычная волна
    async function beginSeed(request: number, loaded: { seed: Seed; first: WaveTrack | null }): Promise<void> {
        seed = loaded.seed;
        derivedSeeds = [];
        // Лайки прошлой волны тянули бы новую в сторону, её пропуски отсекали бы артистов новой
        likedSeeds.length = 0;
        skipped.clear();
        popOpen = false;
        staleSeeds.clear();
        resetGeneration();
        seedGiven.clear();
        const first = loaded.first;
        // Стартовый трек встанет первым или уже играет: станция и треки артиста не должны вернуть его ещё раз
        if (first) {
            taken.add(first.id);
            seedGiven.add(first.id);
            for (const key of copyKeys(first)) signatures.add(key);
            // Его произведение уже звучит: другие версии придут только причиной «Другая версия»
            const family = familyKey(first);
            if (family) families.add(family);
        }
        const keep = !!first && player?.getCurrentSound()?.id === first.id;
        if (first && keep) known.set(first.id, { track: first, reason: { kind: 'seedTrack' } });
        const started = await start(first && !keep ? { track: first, reason: { kind: 'seedTrack' } } : undefined, keep);
        if (started || request !== seedRequest) return;
        if (state === 'empty') {
            try {
                host.soundcloudAPI?.reportWaveEmpty?.({ seen: seenCount, artistTracks: artistCount, moodTags: fallbackMood?.length ?? 0 });
            } catch (error) {
                console.warn('Волна: пустая волна не записана в диагностику', error);
            }
        }
        showToast(state === 'error' ? T.toastFailed : T.toastEmpty);
        clearSeed();
    }

    // Переход внутри сайта без перезагрузки: клик по ссылке ловит роутер сайта.
    // Пути те же, что пропускает sitePagePath в main: пользователь, трек, плейлист и запрос после них
    function navigate(path: string): boolean {
        if (typeof path !== 'string' || !/^\/[a-z0-9_-]{1,100}(\/(sets\/)?[a-z0-9_-]{1,255})?(\?[A-Za-z0-9_.~%&=+/-]{1,500})?$/.test(path)) return false;
        if (location.pathname + location.search === path) return true;
        const link = document.createElement('a');
        link.href = path;
        document.body.append(link);
        link.click();
        link.remove();
        return true;
    }
    // Ссылка «открыть в клиенте» из Discord: переход на страницу трека внутри сайта без перезагрузки и сразу воспроизведение;
    // страница истории включает трек, не уводя сайт со своей страницы.
    let openRequest = 0;
    async function openTrack(path: string, go = true): Promise<OpenTrackResult> {
        const request = ++openRequest;
        if (!player || !SoundModel || !api) return 'not-ready';
        if (!/^\/[a-z0-9_-]{1,100}\/[a-z0-9_-]{1,255}$/.test(path)) return 'unavailable';
        const previous = player.getCurrentQueueItem();
        if (go) navigate(path);
        // Свой же трек из карточки Discord уже играет: страница открыта, очередь и волна остаются как есть
        const current = player.getCurrentSound();
        if (current && trackPath(current.attributes?.permalink_url) === path.toLowerCase()) {
            if (!player.isPlaying()) player.playCurrent({ userInitiated: true });
            return 'played';
        }
        let track: WaveTrack | null;
        try {
            track = asTrack(await resolveUrl('https://soundcloud.com' + path));
        } catch (error) {
            console.warn('Волна: трек по ссылке не найден', error);
            return request === openRequest ? 'failed' : 'superseded';
        }
        if (disposed || request !== openRequest || player.getCurrentQueueItem() !== previous) return 'superseded';
        const Item = player.getQueue().model;
        if (!track || (track.kind && track.kind !== 'track') || !Item) return 'unavailable';
        const sound = new SoundModel(track, { parse: true });
        if ((sound.isPlayable && !sound.isPlayable()) || sound.isBlocked?.()) return 'unavailable';
        const item = new Item({}, { sound, originalModel: sound, queryPosition: 0, sourceInfo: { type: 'single' }, index: 0 });
        item.release?.();
        player.replaceQueue([item], 0);
        player.playCurrent({ userInitiated: true });
        return 'played';
    }
    host.__scOpenTrack = openTrack;
    host.__scNavigate = navigate;
    // Страница истории: названия и обложки треков из старых записей журнала. null значит «сайт ещё не готов»;
    // asked это id из пачек, на которые сайт ответил, остальные main спросит позже. Ответ проверяет main
    host.__scResolveTracks = async (ids: unknown) => {
        if (!api || !Array.isArray(ids)) return null;
        const wanted = ids.filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0).slice(0, 200);
        const asked: number[] = [];
        const tracks: object[] = [];
        for (let i = 0; i < wanted.length; i += 50) {
            const part = wanted.slice(i, i + 50);
            try {
                for (const track of collection(await call('trackBatch', {}, { ids: part.join(',') })).map(asTrack)) {
                    if (!track) continue;
                    tracks.push({
                        id: track.id,
                        artist: trackArtist(track),
                        title: track.title ?? '',
                        artistName: track.user?.username ?? '',
                        path: trackPath(track.permalink_url),
                        artwork: track.artwork_url || track.user?.avatar_url || '',
                        genre: track.genre ?? '',
                        dur: track.full_duration ?? track.duration ?? 0,
                    });
                }
                asked.push(...part);
            } catch (error) {
                console.warn('История: треки не добраны', error);
            }
        }
        return { asked, tracks };
    };
    host.__scWhoAmI = async () => (api ? ensureUser() : 0);
    function clearSeed(): void {
        seedRequest++;
        seed = null;
        derivedSeeds = [];
        skipped.clear();
        staleSeeds.clear();
        resetGeneration();
        if (active) void restartAhead();
        else if (isVisible()) void preparePreview();
        else { state = 'idle'; render(); }
    }
    // Волна по жанру из меню или закрепления: жанр как из шапки, волна от зёрен сбрасывается, играет сразу
    function playGenre(label: string): void {
        const name = formatGenres(parseGenres(label));
        if (!name) return;
        seedRequest++;
        seed = null;
        derivedSeeds = [];
        skipped.clear();
        genre = name;
        recentGenres = [name, ...recentGenres.filter((item) => item !== name)].slice(0, 6);
        saveSettings();
        popOpen = false;
        staleSeeds.clear();
        resetGeneration();
        void start();
    }
    function pinIndex(target: MenuTarget): number {
        const kind = target.kind;
        if (kind !== 'playlist' && kind !== 'artist' && kind !== 'genre') return -1;
        const key = pinKey(kind, target.url, target.genre ?? '');
        return pins.findIndex((pin) => pinKey(pin.kind, pin.url, pin.title) === key);
    }
    function pinPlaying(pin: WavePin): boolean {
        if (!active) return false;
        if (pin.kind === 'genre') return !seed && genre === pin.title;
        return seed?.kind === pin.kind && seed.title === pin.title;
    }
    // Название и ссылка берутся у сайта: плейлист по адресу, артист по ссылке или по треку
    async function pinTarget(target: MenuTarget, add: boolean): Promise<void> {
        if (!add) {
            const index = pinIndex(target);
            if (index < 0) return;
            const [gone] = pins.splice(index, 1);
            savePins();
            showToast(fillText(T.toastUnpinned, { title: gone.title }));
            render();
            return;
        }
        if (pinIndex(target) >= 0) return;
        if (pins.length >= PIN_LIMIT) {
            showToast(fillText(T.toastPinFull, { count: String(PIN_LIMIT) }));
            return;
        }
        let pin: WavePin | null = null;
        try {
            if (target.kind === 'genre') {
                const name = formatGenres(parseGenres(target.genre ?? ''));
                if (name) pin = { kind: 'genre', url: '', title: name };
            } else if (target.kind === 'artist') {
                const artist = await artistOf(target);
                const link = artist ? classifyLink(artist.url || target.url, 'https://soundcloud.com/') : null;
                if (artist?.username && link?.kind === 'artist') pin = { kind: 'artist', url: link.url, title: artist.username.trim() };
            } else if (target.kind === 'playlist') {
                const body = (await resolveUrl(target.url)) as { title?: unknown; permalink_url?: unknown } | null;
                const link = classifyLink(typeof body?.permalink_url === 'string' ? body.permalink_url : target.url, 'https://soundcloud.com/');
                const title = typeof body?.title === 'string' ? body.title.trim() : '';
                if (title && link?.kind === 'playlist') pin = { kind: 'playlist', url: link.url, title };
            }
        } catch (error) {
            console.warn('Волна: закрепление не собрано', error);
        }
        if (!pin) {
            showToast(T.toastFailed);
            return;
        }
        // Пока ждали сайт, то же могли закрепить вторым кликом
        const key = pinKey(pin.kind, pin.url, pin.title);
        if (pins.some((item) => pinKey(item.kind, item.url, item.title) === key) || pins.length >= PIN_LIMIT) return;
        pins.push(pin);
        savePins();
        showToast(fillText(T.toastPinned, { title: pin.title }));
        render();
    }
    function playPin(index: number): void {
        const pin = pins[index];
        if (!pin) return;
        if (pinPlaying(pin) && player) {
            if (player.isPlaying()) player.pauseCurrent({ userInitiated: true });
            else player.playCurrent({ userInitiated: true });
            setTimeout(render, 150);
        } else if (pin.kind === 'genre') playGenre(pin.title);
        else menuSection.startLink(pin.kind, pin.url, pin.title);
    }

    async function setExcluded(kind: MarkKind, target: MenuTarget, excluded: boolean): Promise<void> {
        try {
            await ensureExclusions();
            let entry: MoreEntry | null = null;
            let marked: WaveTrack | null = null;
            if (kind === 'artist' || kind === 'later-artist') {
                const artist = await artistOf(target);
                if (artist) entry = { id: artist.id, title: artist.username, artist: '', url: canonicalUrl(artist.url) || canonicalUrl(target.kind === 'artist' ? target.url : target.artistUrl), artistId: 0, genre: '', tags: '' };
            } else {
                marked = await trackOf(target);
                if (marked) entry = {
                    id: marked.id, title: (marked.title ?? '').trim(), artist: artistName(marked), url: canonicalUrl(marked.permalink_url) || canonicalUrl(target.url),
                    artistId: trackArtist(marked), genre: (marked.genre ?? '').trim(), tags: (marked.tag_list ?? '').trim(),
                };
            }
            if (!entry) {
                showToast(T.toastFailed);
                return;
            }
            const id = await ensureUser();
            // Артист и метки трека уходят с любой отметкой трека: по ним модель вкуса учится и плюсом, и минусом
            const saved = id ? await host.soundcloudAPI?.waveExclusions?.set(id, kind, entry, excluded) : false;
            if (saved !== true) {
                showToast(T.toastNotSaved);
                return;
            }
            const maps: Record<MarkKind, Map<number, Excluded>> = { track: excludedTracks, artist: excludedArtists, 'later-track': laterTracks, 'later-artist': laterArtists, more: moreTracks };
            exclusionsRevision++;
            if (!excluded) maps[kind].delete(entry.id);
            else if (kind === 'more') {
                moreTracks.set(entry.id, entry);
                // Как в main: «Больше такого» и «Не нравится» или «Не сейчас» у одного трека вместе не живут
                excludedTracks.delete(entry.id);
                laterTracks.delete(entry.id);
            } else {
                maps[kind].set(entry.id, kind === 'later-track' || kind === 'later-artist' ? { ...entry, until: Date.now() + 7 * 86400000 } : entry);
                if (kind === 'track' || kind === 'later-track') moreTracks.delete(entry.id);
                if (kind === 'track') laterTracks.delete(entry.id);
            }
            // Отметка о том, что сейчас играет, уходит и в журнал сигналов
            if (play && kind === 'track' && play.signal.id === entry.id) play.signal.disliked = excluded;
            if (play && kind === 'artist' && play.signal.artist === entry.id) play.signal.hiddenArtist = excluded;
            if (play && ((kind === 'later-track' && play.signal.id === entry.id) || (kind === 'later-artist' && play.signal.artist === entry.id))) play.signal.laterNow = excluded;
            if (play && kind === 'more' && play.signal.id === entry.id) play.signal.moreNow = excluded;
            if (kind === 'more') {
                // Профиль вкуса пересчитается к следующему подбору, а сам трек сразу становится зерном, как лайк
                tasteAt = 0;
                if (excluded && marked && !likedSeeds.some((track) => track.id === entry.id)) likedSeeds.unshift(marked);
                // Как лайк: аккаунт и теги в сессии выше, похожие сразу ближе в очереди (В2.2, В2.9)
                if (excluded && marked && active) {
                    const candidate = known.get(marked.id);
                    if (candidate) adjustSession(candidate, 1);
                    void boostSimilar(marked);
                }
                if (!excluded) {
                    const index = likedSeeds.findIndex((track) => track.id === entry.id);
                    if (index >= 0 && !profile?.liked.has(entry.id)) likedSeeds.splice(index, 1);
                }
            }
            const toasts: Record<MarkKind, [string, string]> = {
                track: [T.toastDisliked, T.toastUndisliked],
                artist: [T.toastHidden, T.toastShown],
                'later-track': [T.toastLater, T.toastUnlater],
                'later-artist': [T.toastLaterArtist, T.toastUnlater],
                more: [T.toastMore, T.toastUnmore],
            };
            // «Не сейчас», «Не нравится» и скрытый аккаунт отменяются из плашки: убранный трек уже не вернётся на место, но снова может попасть в волну
            showToast(toasts[kind][excluded ? 0 : 1], excluded && kind !== 'more' ? () => void setExcluded(kind, target, false) : undefined);
            if (excluded && kind !== 'more') purgeExcluded();
            else render();
        } catch (error) {
            console.warn('Волна: отметка не поставлена', error);
            showToast(T.toastFailed);
        }
    }
    // Семья трека скрыта: по ключу семьи, а без названия по ссылке самой отмеченной загрузки
    function familyHidden(target: MenuTarget): boolean {
        const key = target.track ? familyKey(target.track) : '';
        if (key) return excludedFamilies.has(key);
        const url = canonicalUrl(target.url);
        return !!url && [...familyEntries.values()].some((entry) => entry.url === url);
    }
    // «Скрыть другие версии»: семья уходит из волны и радара, версия, на которой нажали, остаётся.
    // «Показывать другие версии» снимает все отметки этой семьи, с какой бы её версии их ни ставили
    async function setFamily(target: MenuTarget, hide: boolean): Promise<void> {
        try {
            await ensureExclusions();
            const marked = await trackOf(target);
            const key = marked ? familyKey(marked) : '';
            const id = await ensureUser();
            const bridge = host.soundcloudAPI?.waveExclusions;
            if (!marked || !key || !id || !bridge) {
                showToast(T.toastFailed);
                return;
            }
            const url = canonicalUrl(marked.permalink_url) || canonicalUrl(target.url);
            const ids = hide ? [marked.id] : [...familyEntries].filter(([, entry]) => entry.key === key).map(([entryId]) => entryId);
            for (const entryId of ids) {
                const payload = hide ? { id: entryId, title: (marked.title ?? '').trim(), artist: artistName(marked), url, artistId: trackArtist(marked) } : { id: entryId };
                if ((await bridge.set(id, 'family', payload, hide)) !== true) {
                    showToast(T.toastNotSaved);
                    rebuildFamilies();
                    return;
                }
                if (hide) familyEntries.set(entryId, { key, version: versionKey(marked), url });
                else familyEntries.delete(entryId);
            }
            rebuildFamilies();
            exclusionsRevision++;
            showToast(hide ? T.toastFamilyHidden : T.toastFamilyShown);
            if (hide) purgeExcluded();
            else render();
        } catch (error) {
            console.warn('Волна: отметка версий не поставлена', error);
            showToast(T.toastFailed);
        }
    }

    // ===== Блок на главной =====
    const ICON: Record<string, string> = {
        play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
        pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
        chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>',
        heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35 10.55 20C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09A6 6 0 0 1 16.5 3C19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z"/></svg>',
        x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4l5.6 5.6L5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6z"/></svg>',
        shake: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z"/></svg>',
        more: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
        dislike: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/></svg>',
        // Месяц: трек уснёт на неделю
        later: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.34 2.02C6.59 1.82 2 6.42 2 12c0 5.52 4.48 10 10 10 3.71 0 6.93-2.02 8.66-5.02-7.51-.25-12.09-8.43-8.32-14.96z"/></svg>',
        // Те же часы, что у кнопки истории в шапке
        history: '<svg class="scw-line" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.6 8a5.4 5.4 0 1 0 1.6-3.8"/><path d="M2.4 2.6v2.5h2.5"/><path d="M8 5v3.2l2.2 1.4"/></svg>',
    };
    const CSS = [
        '#sc-wave{--scw-surface:#303030;--scw-muted:#999;--scw-faint:#757575;--scw-film:rgba(255,255,255,.06);--scw-film-strong:rgba(255,255,255,.1);--scw-btn:#fff;--scw-btn-ink:#121212;--scw-tile:rgba(255,255,255,.06);position:relative;margin:0 0 48px 16px;font-size:14px;line-height:20px}',
        '#sc-wave button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}',
        '#sc-wave :focus-visible{outline:2px solid currentColor;outline-offset:2px}',
        '#sc-wave svg{display:block}',
        '.scw-head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:16px}',
        '.scw-title{font-size:22px;line-height:28px;font-weight:600;padding-top:8px}',
        '.scw-hint{color:var(--scw-muted)}',
        '.scw-controls{display:flex;gap:8px;padding-top:6px;flex:none}',
        '.scw-seg{display:flex;padding:2px;border-radius:6px;background:var(--scw-surface)}',
        '#sc-wave .scw-seg button{height:28px;padding:0 14px;border-radius:4px;font-weight:600;color:var(--scw-muted)}',
        '#sc-wave .scw-seg button[aria-checked="true"]{background:var(--scw-btn);color:var(--scw-btn-ink)}',
        '#sc-wave .scw-genre{height:32px;padding:0 10px 0 12px;border-radius:6px;background:var(--scw-surface);display:flex;align-items:center;gap:8px;font-weight:600;max-width:220px}',
        '.scw-genre span.scw-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.scw-genre svg{width:14px;height:14px;fill:currentColor;flex:none}',
        '#sc-wave .scw-genre.set{background:var(--scw-btn);color:var(--scw-btn-ink)}',
        '#sc-wave .scw-icon{width:32px;height:32px;border-radius:6px;background:var(--scw-surface);display:grid;place-items:center;flex:none}',
        '#sc-wave .scw-icon:hover{box-shadow:inset 0 0 0 32px var(--scw-film)}',
        '#sc-wave .scw-icon:disabled{opacity:.5;cursor:default;box-shadow:none}',
        '.scw-icon svg{width:16px;height:16px;fill:currentColor}',
        '.scw-icon svg.scw-line{fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round}',
        '.scw-genre .scw-x{width:18px;height:18px;margin-right:-4px;border-radius:3px;display:grid;place-items:center;flex:none}',
        '.scw-genre .scw-x:hover{background:rgba(127,127,127,.25)}',
        '.scw-pop{position:absolute;right:0;top:48px;z-index:30;width:280px;padding:8px;background:var(--scw-surface);border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.45)}',
        '.scw-pop input{width:100%;height:32px;padding:0 10px;border-radius:4px;border:1px solid var(--scw-film-strong);background:transparent;color:inherit;font:inherit;box-sizing:border-box}',
        '.scw-pop-label{font-size:12px;line-height:16px;color:var(--scw-muted);margin:10px 4px 4px}',
        '#sc-wave .scw-opt{display:block;width:100%;text-align:left;padding:6px 8px;border-radius:4px}',
        '#sc-wave .scw-opt:hover{background:var(--scw-film-strong)}',
        '#sc-wave .scw-opt[aria-selected="true"]{font-weight:600}',
        // Подложка блока в цвет обложки играющего трека (В6): без цвета прозрачна, отступы гасят поля, раскладка та же
        '.scw-body{position:relative;isolation:isolate;display:flex;gap:24px;margin:-12px;padding:12px;border-radius:8px;transition:background-color .3s cubic-bezier(.2,0,0,1)}',
        '.scw-body.tinted{background-color:color-mix(in srgb,var(--scw-cover) 18%,transparent)}',
        // Фон дышит (Ф3): тот же цвет поверх подложки ярче на громких местах трека, внутри границ блока
        '.scw-body.tinted::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;background:var(--scw-cover);opacity:calc(var(--scw-breath,0) * .16);transition:opacity .25s linear;pointer-events:none}',
        // Новый блок после смены трека начинает с прошлого цвета, строка названия и обложка проявляются
        '.scw-body.scw-tint-in{animation:scw-tint .3s cubic-bezier(.2,0,0,1)}',
        '@keyframes scw-tint{from{background-color:color-mix(in srgb,var(--scw-cover-from) 18%,transparent)}}',
        '.scw-swap{animation:scw-fade .25s cubic-bezier(.2,0,0,1)}',
        '.scw-cover.scw-cross .scw-img{transition-duration:.3s}',
        '.scw-info{flex:1;min-width:0;display:flex;flex-direction:column}',
        '.scw-top{display:flex;gap:16px;align-items:center}',
        '.scw-top>div{min-width:0}',
        '#sc-wave .scw-play{width:64px;height:64px;border-radius:50%;background:var(--scw-btn);display:grid;place-items:center;flex:none}',
        '.scw-play svg{width:28px;height:28px;fill:var(--scw-btn-ink)}',
        '#sc-wave .scw-play:disabled{opacity:.5;cursor:default}',
        '.scw-track{font-size:20px;line-height:26px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.scw-track.wrap{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
        '.scw-artist{color:var(--scw-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.scw-wf{display:block;width:100%;height:96px;margin-top:auto}',
        '.scw-wf.live{cursor:pointer}',
        '.scw-meta{display:flex;align-items:center;gap:16px;margin-top:8px;min-height:32px;flex-wrap:wrap}',
        '.scw-why{flex:1;min-width:0;color:var(--scw-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.scw-time{color:var(--scw-muted);font-size:12px;font-variant-numeric:tabular-nums;flex:none}',
        '#sc-wave .scw-like{width:32px;height:32px;display:grid;place-items:center;border-radius:4px;flex:none}',
        '.scw-like svg{width:18px;height:18px;fill:var(--scw-muted)}',
        '#sc-wave .scw-like:hover{background:var(--scw-film-strong)}',
        '.scw-like[aria-pressed="true"] svg{fill:#ff5500}',
        '#sc-wave .scw-btn{height:32px;padding:0 12px;border-radius:4px;background:var(--scw-surface);font-weight:600}',
        '.scw-cover{position:relative;width:200px;height:200px;flex:none;background:var(--scw-tile)}',
        '.scw-cover.scw-empty-cover{display:grid;place-items:center;overflow:hidden;background:radial-gradient(ellipse at 70% 20%,#ff550016,transparent 65%),#191919}',
        '.scw-empty-cover svg{width:100%;height:100%;color:#f50}',
        '.scw-cover.collage{display:grid;grid-template-columns:1fr 1fr}',
        '.scw-cover.collage>span{position:relative;background:var(--scw-tile)}',
        // Картинка проявляется поверх подложки со средним цветом обложки
        '.scw-img{position:absolute;inset:0;background:center/cover;opacity:0;transition:opacity .2s cubic-bezier(.2,0,0,1)}',
        '.scw-img.on{opacity:1}',
        // Очередь волны это часть блока, а не отдельная полка: мелкая подпись и компактные строки
        '.scw-up-h{color:var(--scw-muted);font-size:12px;line-height:16px;margin:24px 0 8px}',
        '.scw-tiles{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px}',
        // Ожидание: заготовки той же формы, полосы поверх строк, высота плиток не меняется
        '.scw-tiles.wait{pointer-events:none;animation:scw-fade .2s cubic-bezier(.2,0,0,1) var(--scw-wait-delay,150ms) backwards}',
        '.scw-tiles.wait.held{animation:none}',
        '@keyframes scw-fade{from{opacity:0}}',
        '.scw-tiles.wait .scw-t1,.scw-tiles.wait .scw-t2,.scw-tiles.wait .scw-t3{position:relative}',
        '.scw-tiles.wait .scw-t1::after,.scw-tiles.wait .scw-t2::after,.scw-tiles.wait .scw-t3::after{content:"";position:absolute;left:0;top:22%;bottom:22%;border-radius:3px;background:var(--scw-film)}',
        '.scw-tiles.wait .scw-t1::after{width:70%}',
        '.scw-tiles.wait .scw-t2::after{width:45%}',
        '.scw-tiles.wait .scw-t3::after{width:60%}',
        '.scw-art{position:relative;aspect-ratio:1;background:var(--scw-tile);margin-bottom:8px}',
        '.scw-t1{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.scw-t2{color:var(--scw-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.scw-t3{font-size:12px;line-height:16px;color:var(--scw-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}',
        '.scw-tile{min-width:0;cursor:pointer;display:grid;grid-template-columns:56px minmax(0,1fr);column-gap:10px;align-content:center;padding:4px;margin:-4px;border-radius:4px}',
        '.scw-tile[data-track]:hover,.scw-tile[data-fork]:hover{background:var(--scw-film)}',
        '.scw-fork-h{display:flex;align-items:center;gap:4px}',
        '#sc-wave .scw-fork-x{display:grid;place-items:center;width:20px;height:20px;border-radius:10px;color:var(--scw-muted);transition:background-color .12s}',
        '#sc-wave .scw-fork-x:hover{background:var(--scw-film-strong)}',
        '.scw-fork-x svg{width:14px;height:14px;fill:currentColor}',
        '.scw-tile>.scw-art{grid-row:1/4;width:56px;margin:0}',
        '.scw-tile>.scw-t1,.scw-tile>.scw-t2,.scw-tile>.scw-t3{grid-column:2;margin:0}',
        // Подборки это отдельный раздел со своим заголовком, а не продолжение волны
        '.scw-shelf-h{font-size:20px;line-height:26px;font-weight:600;margin:48px 0 16px}',
        '.scw-shelf-error{display:flex;align-items:center;gap:16px;min-height:48px}',
        '#sc-wave .scw-play{transition:filter .12s,transform .1s}',
        '#sc-wave .scw-play:not(:disabled):hover{filter:brightness(.9)}',
        '#sc-wave .scw-play:not(:disabled):active{transform:scale(.96)}',
        'html.scm-reduce #sc-wave .scw-play{transition:none;transform:none}',
        '@media(prefers-reduced-motion:reduce){#sc-wave .scw-play{transition:none;transform:none!important}}',
        '.scw-tiles.scw-shelf{grid-template-columns:repeat(6,minmax(0,1fr));gap:20px}',
        '@media(max-width:1200px){#sc-wave .scw-tiles:not(.scw-shelf){grid-template-columns:repeat(3,minmax(0,1fr))}#sc-wave .scw-tiles.scw-shelf{grid-template-columns:repeat(4,minmax(0,1fr))}}',
        '.scw-card{position:relative;min-width:0}',
        // Прокрутка к карточке и раскрытому списку не прячет их под шапкой сайта
        '.scw-card,.scw-mix{scroll-margin:72px 0 16px}',
        '#sc-wave .scw-card-open{display:block;width:100%;min-width:0;text-align:left}',
        // Кнопка «слушать» лежит поверх обложки: слой того же размера, что обложка, пропускает клики мимо кнопки
        '.scw-card-over{position:absolute;z-index:2;left:0;top:0;width:100%;aspect-ratio:1;pointer-events:none}',
        '#sc-wave .scw-card-play{position:absolute;right:8px;bottom:8px;width:40px;height:40px;border-radius:50%;background:#fff;display:grid;place-items:center;pointer-events:auto;opacity:0;transform:translateY(6px) scale(.92);box-shadow:0 3px 12px #0009,0 0 0 1px #0002;transition:opacity .18s ease,transform .18s cubic-bezier(.2,0,0,1),background-color .12s,box-shadow .18s}',
        '.scw-card-play svg{width:20px;height:20px;fill:#111}',
        '#sc-wave .scw-card:hover .scw-card-play,#sc-wave .scw-card:focus-within .scw-card-play,#sc-wave .scw-card.on .scw-card-play{opacity:1;transform:translateY(0) scale(1)}',
        '#sc-wave .scw-card .scw-card-play:hover{transform:translateY(0) scale(1.08);background:#ff7133;box-shadow:0 5px 16px #000a,0 0 0 1px #0002}',
        '#sc-wave .scw-card .scw-card-play:active{transform:translateY(0) scale(.95);background:#f50}',
        '#sc-wave .scw-card-play:focus-visible{outline:2px solid #fff;outline-offset:3px}',
        '@media(hover:none){#sc-wave .scw-card .scw-card-play{opacity:1;transform:none}}',
        '.scw-art.scw-quad{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}',
        '.scw-art.scw-quad>span{position:relative;background:var(--scw-tile)}',
        // Лицо карточки полки: название поверх обложки, размер от ширины карточки (6 или 4 колонки)
        '.scw-card .scw-art{container-type:inline-size}',
        '.scw-face{position:absolute;z-index:1;inset:0;display:flex;flex-direction:column;align-items:flex-start;padding:9cqi;color:#fff;pointer-events:none;background:linear-gradient(180deg,rgba(0,0,0,.8) 0%,rgba(0,0,0,.5) 45%,transparent 78%)}',
        '.scw-face b{max-width:100%;font-size:max(13px,14cqi);line-height:1.08;font-weight:700;letter-spacing:-.01em;overflow-wrap:break-word;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;text-shadow:0 1px 6px rgba(0,0,0,.4)}',
        // Радар и новые загрузки: обесцвеченный коллаж под фирменным оранжевым, это главный акцент полки
        // Тон группы карточек (решение владельца 26.09.2026): релизы оранжевые, личные подборки фиолетовые, жанры бирюзовые.
        // Обложка обесцвечивается, тон ложится умножением, под названием затемнение того же оттенка
        '.scw-tone-release{--scw-tone-a:#ff7a33;--scw-tone-b:#ff5500;--scw-tone-c:#7a2600;--scw-tone-face:77,24,0}',
        '.scw-tone-personal{--scw-tone-a:#b196ff;--scw-tone-b:#8b5cf6;--scw-tone-c:#2e1065;--scw-tone-face:34,12,80}',
        '.scw-tone-genre{--scw-tone-a:#3ee0c8;--scw-tone-b:#14b8a6;--scw-tone-c:#064e46;--scw-tone-face:3,44,40}',
        '.scw-art[class*="scw-tone-"] .scw-img{filter:grayscale(1) contrast(1.1)}',
        '.scw-tint{position:absolute;inset:0;background:linear-gradient(155deg,var(--scw-tone-a) 0%,var(--scw-tone-b) 40%,var(--scw-tone-c) 100%);mix-blend-mode:multiply}',
        '.scw-art[class*="scw-tone-"] .scw-face{background:linear-gradient(180deg,rgba(var(--scw-tone-face),.7) 0%,rgba(var(--scw-tone-face),.32) 45%,transparent 75%)}',
        // Карточка без обложек и заготовка во время сборки: тёмный фон своего тона
        '.scw-art.scw-blank{background:linear-gradient(155deg,rgba(var(--scw-tone-face),1) 0%,#191919 85%)}',
        '.scw-stamp{position:absolute;z-index:1;left:max(6px,6cqi);bottom:max(6px,6cqi);padding:1px 6px;border-radius:3px;background:rgba(0,0,0,.62);color:#fff;font-size:11px;line-height:16px;font-weight:600;white-space:nowrap;pointer-events:none}',
        // Наведение плёнкой поверх обложки, играющая подборка кромкой 3 px снизу
        '.scw-card .scw-art::before,.scw-card .scw-art::after{content:"";position:absolute;z-index:1;left:0;right:0;opacity:0;transition:opacity .15s cubic-bezier(.2,0,0,1)}',
        '.scw-card .scw-art::before{top:0;bottom:0;background:linear-gradient(180deg,transparent 25%,#0008)}',
        '.scw-card .scw-art::after{bottom:0;height:3px;background:#ff5500}',
        '.scw-card:hover .scw-art::before,.scw-card:focus-within .scw-art::before,.scw-card.open .scw-art::before,.scw-card.on .scw-art::before,.scw-card.on .scw-art::after{opacity:1}',
        // Раскрытая подборка: плашка под полкой с уголком под своей карточкой (6 колонок, промежуток 20 px)
        '.scw-mix{position:relative;margin-top:16px;padding:16px 16px 8px;border-radius:6px;background:var(--scw-film)}',
        '.scw-mix::before{content:"";position:absolute;top:-8px;left:calc((100% - 100px) / 6 * (var(--scw-at6) + .5) + 20px * var(--scw-at6) - 8px);border:8px solid transparent;border-top:0;border-bottom-color:var(--scw-film)}',
        // Внутри сетки полки список занимает всю строку под своей карточкой; при 4 колонках свои строка и уголок
        '.scw-shelf>.scw-mix{grid-column:1/-1;grid-row:var(--scw-row6);margin-top:0}',
        '@media(max-width:1200px){#sc-wave .scw-shelf>.scw-mix{grid-row:var(--scw-row4)}#sc-wave .scw-mix::before{left:calc((100% - 60px) / 4 * (var(--scw-at4) + .5) + 20px * var(--scw-at4) - 8px)}}',
        // Название не уже 240 px: в узком окне и на длинных русских подписях кнопки уходят строкой ниже, а не сжимают его
        '.scw-mix-head{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:8px}',
        '.scw-mix-head>.scw-mix-tools{margin-left:auto}',
        '#sc-wave .scw-mix-play{width:40px;height:40px;border-radius:50%;background:var(--scw-btn);display:grid;place-items:center;flex:none;transition:filter .12s,transform .12s}',
        '#sc-wave .scw-mix-play:hover{filter:brightness(.9);transform:scale(1.06)}',
        '#sc-wave .scw-mix-play:active{transform:scale(.95)}',
        '.scw-mix-play svg{width:18px;height:18px;fill:var(--scw-btn-ink)}',
        '.scw-mix-title{flex:1 1 240px;min-width:0}',
        '.scw-mix-title b{display:block;font-size:16px;line-height:22px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.scw-mix-title span{color:var(--scw-muted)}',
        '.scw-mix .scw-hint{padding:8px 0 12px}',
        '.scw-mix-rows,.scw-lib-rows{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-flow:row dense;column-gap:16px;max-height:432px;overflow-y:auto;margin:0 -8px;padding-bottom:8px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent}',
        // «Моя музыка»: плашка того же вида, что раскрытая подборка, одной строкой; режимы переключателем волны
        '.scw-lib{padding:16px 16px 8px;border-radius:6px;background:var(--scw-film)}',
        '#sc-wave .scw-lib .scw-seg button[aria-checked="true"]{background:rgba(255,255,255,.14);color:#fff}',
        '#sc-wave .scw-lib .scw-btn[aria-expanded="true"]{box-shadow:inset 0 0 0 32px var(--scw-film-strong)}',
        '.scw-lib .scw-seg{flex:none}',
        // Выбор источников: без галочек, выбранное светлой плёнкой и полужирным; название светлее числа
        '.scw-lib-pick{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 16px;margin:4px -8px 8px;padding-top:8px;border-top:1px solid var(--scw-film-strong)}',
        '#sc-wave .scw-lib-opt{display:flex;align-items:center;min-width:0;height:36px;padding:0 8px;border-radius:4px;text-align:left;color:rgba(255,255,255,.85);transition:background-color .12s,color .12s}',
        '#sc-wave .scw-lib-opt:hover{background:var(--scw-film);color:#fff}',
        '#sc-wave .scw-lib-opt[aria-pressed="true"]{background:rgba(255,255,255,.14);color:#fff;font-weight:600}',
        '.scw-lib-name{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        // Число прижато вправо и одной ширины цифр: столбец чисел ровный
        '.scw-lib-n{margin-left:auto;padding-left:12px;flex:none;color:var(--scw-muted);font-weight:400;font-variant-numeric:tabular-nums}',
        // Источник, из которого играет трек: оранжевая волна сразу за названием
        '.scw-lib-here{flex:none;display:grid;margin-left:8px;color:#ff5500}',
        '.scw-lib-here svg{width:14px;height:14px}',
        '.scw-lib-pick .scw-hint{grid-column:1/-1;padding:4px 8px}',
        '#sc-wave .scw-lib-more{grid-column:1/-1;justify-self:center;margin:8px 0}',
        '#sc-wave .scw-row{display:grid;grid-template-columns:40px minmax(0,1fr) auto;align-items:center;gap:12px;height:48px;padding:4px 8px;border-radius:4px;text-align:left;min-width:0;cursor:pointer;box-sizing:border-box}',
        '#sc-wave .scw-row:hover{background:var(--scw-film)}',
        '.scw-row .scw-art{width:40px;height:40px;margin:0}',
        '#sc-wave .scw-row-play{background:var(--scw-tile)}',
        // Название и автор ссылками: цвет строки, подчёркивание только при наведении
        '#sc-wave .scw-link,#sc-wave .scw-link:visited{color:inherit;text-decoration:none}',
        '#sc-wave .scw-link:hover{text-decoration:underline}',
        '.scw-row-t{min-width:0}',
        '.scw-row-t b,.scw-row-t span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.scw-row-t b{font-weight:600}',
        '.scw-row-t span{color:var(--scw-muted);font-size:12px;line-height:16px}',
        '.scw-row-d{color:var(--scw-faint);font-size:12px;font-variant-numeric:tabular-nums}',
        '.scw-row[aria-current="true"] .scw-row-t b{color:#ff5500}',
        // Строка списка и окна версий играет по нажатию: при наведении на обложке значок «слушать»
        '#sc-wave .scw-row .scw-art::before,.scw-vplay .scw-art::before{content:"";position:absolute;z-index:1;inset:0;background:rgba(0,0,0,.5);opacity:0;transition:opacity .12s}',
        '#sc-wave .scw-row .scw-art::after,.scw-vplay .scw-art::after{content:"";position:absolute;z-index:1;left:50%;top:50%;width:12px;height:14px;margin:-7px 0 0 -5px;background:#fff;clip-path:polygon(0 0,100% 50%,0 100%);opacity:0;transition:opacity .12s}',
        '#sc-wave .scw-row:hover .scw-art::before,#sc-wave .scw-row:hover .scw-art::after,#sc-wave .scw-row-play:focus-visible::before,#sc-wave .scw-row-play:focus-visible::after,.scw-vplay:hover .scw-art::before,.scw-vplay:hover .scw-art::after,.scw-vplay:focus-visible .scw-art::before,.scw-vplay:focus-visible .scw-art::after{opacity:1}',
        // Радар: инструменты в шапке списка, фильтры «Всех найденных», метки строк, заготовка карточки
        '.scw-mix-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
        '.scw-mix-tools.scw-filters{margin:0 0 8px}',
        '#sc-wave .scw-chip{height:28px;padding:0 12px;border-radius:14px;background:var(--scw-surface);color:var(--scw-muted);font-weight:600;white-space:nowrap}',
        '#sc-wave .scw-chip:hover{color:inherit}',
        '#sc-wave .scw-chip[aria-pressed="true"]{background:var(--scw-btn);color:var(--scw-btn-ink)}',
        // Быстрый ряд под подборкой волны: пресеты настроения (выбранный подсвечен, без галочек) и закрепления главной
        // Пресеты и закрепления разделены промежутком шире, чем внутри группы: при переносе строки линия-разделитель повисла бы
        '.scw-quick{display:flex;flex-wrap:wrap;align-items:center;gap:8px 24px;margin-top:24px}',
        '.scw-moods,.scw-pins{display:flex;gap:8px;flex-wrap:wrap}',
        '#sc-wave .scw-moods .scw-chip[aria-checked="true"]{background:var(--scw-btn);color:var(--scw-btn-ink)}',
        '.scw-pin{display:inline-flex;align-items:center;height:28px;border-radius:14px;background:var(--scw-surface);color:var(--scw-muted);max-width:260px}',
        '.scw-pin.on{background:var(--scw-btn);color:var(--scw-btn-ink)}',
        '#sc-wave .scw-pin .scw-chip,#sc-wave .scw-pin .scw-chip[aria-pressed="true"]{min-width:0;padding:0 4px 0 12px;background:none;color:inherit;overflow:hidden;text-overflow:ellipsis}',
        '#sc-wave .scw-pin-x{flex:none;display:grid;place-items:center;width:20px;height:20px;margin-right:4px;border-radius:10px;transition:background-color .12s}',
        '#sc-wave .scw-pin-x:hover{background:var(--scw-film-strong)}',
        '.scw-pin-x svg{width:14px;height:14px;fill:currentColor}',
        '#sc-wave .scw-btn:disabled{opacity:.5;cursor:default}',
        '.scw-select{height:32px;max-width:220px;padding:0 8px;border-radius:4px;border:0;background:var(--scw-surface);color:inherit;font:inherit;cursor:pointer}',
        '.scw-row-e{display:flex;align-items:center;gap:6px;min-width:0}',
        '.scw-badge{font-size:11px;line-height:16px;padding:0 6px;border-radius:8px;box-shadow:inset 0 0 0 1px var(--scw-film-strong);color:var(--scw-muted);white-space:nowrap}',
        // Группа исполнителя в радаре: метка кнопкой, раскрытые записи блоком на всю ширину списка под строкой.
        // Кнопка залита, а не обведена: обводка у простых меток вроде «Уже слышал», и кнопку от них не отличить
        '#sc-wave .scw-group{font-size:11px;line-height:16px;padding:0 6px;box-shadow:none;background:var(--scw-film-strong);color:rgba(255,255,255,.85);white-space:nowrap;transition:background-color .12s}',
        '#sc-wave .scw-group:hover,#sc-wave .scw-group[aria-expanded="true"]{background:rgba(255,255,255,.2);color:inherit}',
        '.scw-group-box{grid-column:1/-1;margin:0 0 8px 8px;padding:6px 0 2px 8px;border-left:2px solid var(--scw-film-strong)}',
        '.scw-group-head{display:flex;align-items:center;gap:12px;padding:0 8px 4px}',
        '.scw-group-head b{min-width:0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.scw-group-rows{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:16px}',
        // Выпуска ещё нет: большой значок в углу, сверху название, как у остальных карточек
        '.scw-art.scw-radar-art{display:grid;place-items:end;background:radial-gradient(ellipse at 70% 20%,#ff550016,transparent 65%),#191919;color:#f50}',
        '.scw-radar-art>svg{width:40%;height:40%;margin:0 9cqi 9cqi 0}',
        '.scw-card.scw-wait{pointer-events:none}',
        '.scw-card.scw-wait .scw-t1,.scw-card.scw-wait .scw-t2{position:relative}',
        '.scw-card.scw-wait .scw-t1::after,.scw-card.scw-wait .scw-t2::after{content:"";position:absolute;left:0;top:22%;bottom:22%;border-radius:3px;background:var(--scw-film)}',
        '.scw-card.scw-wait .scw-t1::after{width:70%}',
        '.scw-card.scw-wait .scw-t2::after{width:45%}',
        '.scw-genre .scw-go{display:flex;align-items:center;gap:6px;min-width:0;font-weight:600}',
        '.scw-tip{position:fixed;z-index:2147483000;max-width:300px;padding:6px 8px;border-radius:4px;background:#303030;color:#fff;box-shadow:0 4px 12px rgba(0,0,0,.45);font-size:12px;line-height:16px;pointer-events:none;opacity:0;transition:opacity .12s}',
        '.scw-tip.on{opacity:1}',
        '.scw-tip b{display:block;font-weight:600}',
        '.scw-tip span{display:block;opacity:.7}',
        // Меню по ПКМ собрано из классов родного меню «…», вид и тема приходят от сайта
        '.scw-menu .scw-mi{display:flex;align-items:center;gap:8px;width:100%;text-align:left;white-space:nowrap}',
        '.scw-menu .scw-mi svg{display:block;width:16px;height:16px;fill:currentColor}',
        '.scw-menu{animation:scw-menu-in .14s cubic-bezier(.2,0,0,1)}',
        '@keyframes scw-menu-in{from{opacity:0;transform:scale(.96)}}',
        '.scw-menu:focus{outline:none}',
        // Вместо синей рамки сайта: кольцо цвета текста и только с клавиатуры
        '.scw-menu .scw-mi:focus{box-shadow:none;outline:none}',
        '.scw-menu .scw-mi:focus-visible{outline:2px solid currentColor;outline-offset:-2px}',
        '.scw-toast{position:fixed;left:50%;bottom:72px;z-index:2147483000;transform:translateX(-50%);max-width:420px;padding:8px 12px;border-radius:4px;background:#303030;color:#fff;box-shadow:0 4px 12px rgba(0,0,0,.45);font-size:14px;line-height:20px;pointer-events:none;opacity:0;transition:opacity .15s}',
        '.scw-toast.on{opacity:1}',
        '.scw-toast.act.on{pointer-events:auto;display:flex;align-items:center;gap:16px}',
        '.scw-toast .scw-undo{font:inherit;font-weight:600;color:#fff;background:none;border:0;padding:0;cursor:pointer;white-space:nowrap}',
        '.scw-toast .scw-undo:hover{text-decoration:none;opacity:.8}',
        '.scw-toast .scw-undo:focus-visible{outline:2px solid #fff;outline-offset:2px}',
        // «Версии этого трека»: окно поверх страницы, вне блока волны, поэтому переменные и сброс кнопок свои
        '.scw-dialog-back{--scw-surface:#303030;--scw-muted:#999;--scw-faint:#757575;--scw-film:rgba(255,255,255,.06);--scw-film-strong:rgba(255,255,255,.1);--scw-tile:rgba(255,255,255,.06);position:fixed;inset:0;z-index:2147482000;display:grid;place-items:center;background:rgba(0,0,0,.6);font-size:14px;line-height:20px}',
        '.scw-dialog{width:min(640px,calc(100vw - 32px));max-height:min(640px,calc(100vh - 64px));display:flex;flex-direction:column;border-radius:8px;background:#1f1f1f;color:#fff;box-shadow:0 12px 40px rgba(0,0,0,.6)}',
        '.scw-dialog button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}',
        '.scw-dialog :focus-visible{outline:2px solid currentColor;outline-offset:2px}',
        '.scw-dialog svg{display:block}',
        '.scw-dialog-top{display:flex;align-items:center;gap:12px;padding:16px 16px 8px}',
        '.scw-dialog-top b{flex:1;min-width:0;font-size:16px;line-height:22px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.scw-dialog .scw-icon{width:32px;height:32px;border-radius:6px;background:var(--scw-surface);display:grid;place-items:center;flex:none}',
        '.scw-dialog .scw-icon svg{width:16px;height:16px;fill:currentColor}',
        '.scw-dialog-body{overflow-y:auto;padding:0 16px 16px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent}',
        '.scw-dialog-h{color:var(--scw-muted);font-size:12px;line-height:16px;margin:16px 0 4px}',
        '.scw-dialog .scw-hint{color:var(--scw-muted);padding:4px 0}',
        '.scw-vrow{display:flex;align-items:center;gap:8px;min-width:0;border-radius:4px}',
        '.scw-vrow:hover{background:var(--scw-film)}',
        '.scw-dialog .scw-vplay{flex:1;min-width:0;display:grid;grid-template-columns:40px minmax(0,1fr);align-items:center;gap:12px;height:48px;padding:4px 8px;text-align:left}',
        '.scw-vplay .scw-art{width:40px;height:40px;margin:0}',
        '.scw-dialog .scw-btn{height:28px;padding:0 10px;border-radius:4px;background:var(--scw-surface);font-weight:600;white-space:nowrap;flex:none;margin-right:8px}',
        // Решение о версии нужно редко: кнопка тихая и проявляется у строки под курсором или фокусом
        '.scw-dialog .scw-vrow .scw-btn{background:transparent;color:var(--scw-muted);box-shadow:inset 0 0 0 1px var(--scw-film-strong);transition:background-color .12s,color .12s}',
        '.scw-dialog .scw-vrow:hover .scw-btn,.scw-dialog .scw-vrow:focus-within .scw-btn{background:var(--scw-surface);color:#fff;box-shadow:none}',
        '@media (prefers-reduced-motion:reduce){.scw-tip,.scw-toast,.scw-card .scw-art::before,.scw-card .scw-art::after,#sc-wave .scw-card-play,#sc-wave .scw-mix-play{transition:none}.scw-menu{animation:none}#sc-wave .scw-card .scw-card-play,#sc-wave .scw-mix-play{transform:none!important}}',
        'html.scm-reduce #sc-wave .scw-card .scw-card-play,html.scm-reduce #sc-wave .scw-mix-play{transition:none;transform:none!important}',
        // Переходы играющего трека выключаются целиком: цвет подложки меняется сразу. Скрипт их тогда и не ставит
        'html.scm-reduce .scw-body,html.scm-reduce .scw-swap{transition:none;animation:none}',
        'html.scm-reduce .scw-body::before{display:none}',
        '@media (prefers-reduced-motion:reduce){.scw-body,.scw-swap{transition:none;animation:none}.scw-body::before{display:none}}',
        // «Меньше анимаций» в F1: без масштаба меню, растворения остаются
        'html.scm-reduce .scw-menu{animation:none}',
    ].join('\n');
    function ensureStyle(): void {
        if (document.getElementById('sc-wave-style')) return;
        const style = el('style', '', CSS);
        style.id = 'sc-wave-style';
        document.head.append(style);
    }

    let section: HTMLElement | null = null;
    let popOpen = false;
    let popQuery = '';
    let hover: number | null = null;
    // Форма волны: сглаженная для рисования и сырая для тихих краёв трека
    const waveforms = new Map<string, { shape: number[]; raw: number[] } | 'pending' | 'failed'>();

    function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }
    function button(className: string, act: string, label: string, icon?: string): HTMLButtonElement {
        const node = el('button', className);
        node.type = 'button';
        node.dataset.act = act;
        node.setAttribute('aria-label', label);
        if (icon) node.insertAdjacentHTML('beforeend', ICON[icon]);
        return node;
    }
    function textButton(act: string, label: string): HTMLButtonElement {
        const node = el('button', 'scw-btn', label);
        node.type = 'button';
        node.dataset.act = act;
        return node;
    }
    // Обложка слоем поверх подложки: до загрузки средний цвет из кэша, картинка проявляется один раз.
    // render() пересобирает секцию целиком, поэтому уже загруженные адреса ставятся сразу, без проявления
    const loadedArt = new Set<string>();
    const coverPath = (track: WaveTrack): string => canonicalUrl(track.permalink_url).replace(/^https:\/\/soundcloud\.com/, '');
    // Полка знает только адрес обложки: без ключа трека нет и среднего цвета
    const paintArt = (node: HTMLElement, url: string, key: string): void => {
        if (!url) return;
        const color = key ? host.__scmCoverColor?.(key) : undefined;
        if (color) node.style.backgroundColor = color;
        const image = el('span', 'scw-img');
        image.style.backgroundImage = 'url("' + url.replace(/["\\]/g, '') + '")';
        node.append(image);
        if (loadedArt.has(url)) {
            image.classList.add('on');
            // При старте сайт грузит десятки обложек и очередь обучения бывает занята: пробуем снова
            if (key) host.__scmLearnCover?.(key, url);
            return;
        }
        const probe = new Image();
        probe.onload = () => {
            if (loadedArt.size > 500) loadedArt.clear();
            loadedArt.add(url);
            image.classList.add('on');
            if (key) host.__scmLearnCover?.(key, url);
        };
        probe.onerror = () => image.classList.add('on');
        probe.src = url;
    };
    const art = (node: HTMLElement, track: WaveTrack, size: 't300x300' | 't500x500'): void => paintArt(node, artworkUrl(track, size), coverPath(track));
    const artistName = (track: WaveTrack): string => track.user?.username ?? '';
    // Текст ссылкой на страницу сайта; без пути (приватный трек, секретная часть в адресе) остаётся просто текстом
    function linkText<K extends 'b' | 'span' | 'div'>(tag: K, className: string, text: string, path: string): HTMLElementTagNameMap[K] {
        const node = el(tag, className);
        if (!path) {
            node.textContent = text;
            return node;
        }
        const link = el('a', 'scw-link', text);
        link.href = path;
        node.append(link);
        return node;
    }
    // Название ведёт на трек, автор на профиль загрузчика: профиль это первая часть пути трека
    const titleLink = <K extends 'b' | 'div'>(tag: K, className: string, track: WaveTrack): HTMLElementTagNameMap[K] =>
        linkText(tag, className, (track.title ?? '').trim() || '…', trackPath(track.permalink_url));
    const artistLink = <K extends 'span' | 'div'>(tag: K, className: string, track: WaveTrack): HTMLElementTagNameMap[K] => {
        const path = trackPath(track.permalink_url);
        return linkText(tag, className, artistName(track), path.slice(0, path.indexOf('/', 1)));
    };
    // Строка любого списка волны: обложка кнопкой «слушать», название и автор ссылками, клик по пустому месту тоже включает трек.
    // Значки и длительность кладутся в end
    function trackRow(track: WaveTrack, now: number): { row: HTMLDivElement; end: HTMLDivElement } {
        const row = el('div', 'scw-row');
        row.dataset.track = String(track.id);
        if (track.id === now) row.setAttribute('aria-current', 'true');
        const cover = el('button', 'scw-art scw-row-play');
        cover.type = 'button';
        cover.setAttribute('aria-label', fillText(T.rowPlay, { title: (track.title ?? '').trim() || '…' }));
        art(cover, track, 't300x300');
        const text = el('div', 'scw-row-t');
        text.append(titleLink('b', '', track), artistLink('span', '', track));
        const end = el('div', 'scw-row-e');
        row.append(cover, text, end);
        return { row, end };
    }
    const moodLabel = (mood: WaveMood): string => ({ happy: T.moodHappy, sad: T.moodSad, aggressive: T.moodAggressive, calm: T.moodCalm, energetic: T.moodEnergetic })[mood];
    const hintText = (): string => {
        if (seed) return seedText(seed, false);
        const genres = genre ? parseGenres(genre) : [];
        const tail = genres.length ? fillText(genres.length > 1 ? T.hintGenres : T.hintGenre, { genre: formatGenres(genres) }) : '';
        const mood = preset ? fillText(T.hintPreset, { mood: moodLabel(preset).toLowerCase() }) : '';
        const base = (mode === 'similar' ? T.hintSimilar : T.hintFresh) + tail + mood;
        return preset && moodShort && active ? base + '. ' + T.presetShort : base;
    };
    const isVisible = (): boolean => !!section && section.isConnected && section.offsetParent !== null;

    function currentCandidate(): WaveCandidate | null {
        if (!active || !player) return null;
        const sound = player.getCurrentSound();
        return sound ? known.get(sound.id) ?? null : null;
    }
    function idleLine(): string {
        if (genre) return fillText(T.idleGenre, { genre });
        if (mode === 'fresh') return T.idleFresh;
        const first = preview[0]?.reason;
        return first && 'seed' in first ? fillText(T.idleSimilar, { seed: first.seed }) : T.idleSimilarAny;
    }
    function emptyLine(): string {
        if (seed) return T.emptySeed;
        if (mode === 'fresh') return genre ? fillText(T.emptyFreshGenre, { genre }) : T.emptyFresh;
        return genre ? fillText(T.emptyGenre, { genre }) : T.emptySimilar;
    }

    function renderHead(): HTMLElement {
        const head = el('div', 'scw-head');
        const titles = el('div', '');
        titles.append(el('div', 'scw-title', T.wave), el('div', 'scw-hint', hintText()));
        const controls = el('div', 'scw-controls');
        const seg = el('div', 'scw-seg');
        seg.setAttribute('role', 'radiogroup');
        seg.setAttribute('aria-label', T.wave);
        for (const [value, label] of [['similar', T.similar], ['fresh', T.fresh]] as const) {
            const option = el('button', '', label);
            option.type = 'button';
            option.setAttribute('role', 'radio');
            option.setAttribute('aria-checked', String(mode === value));
            option.tabIndex = mode === value ? 0 : -1;
            option.dataset.mode = value;
            seg.append(option);
        }
        const shakeButton = button('scw-icon', 'shake', T.shake, 'shake');
        shakeButton.title = T.shake + ', Ctrl+S';
        shakeButton.disabled = state === 'loading' || state === 'unavailable';
        const historyButton = button('scw-icon', 'history', T.history, 'history');
        historyButton.title = T.history;
        // Набор из меню: число треков запускает волну по нему, крестик очищает
        const picks = shelfSection.picks();
        if (picks.length) {
            const chip = el('div', 'scw-genre set');
            chip.title = picks.map((track) => (track.title ?? '').trim()).join('\n');
            const go = el('button', 'scw-go');
            go.type = 'button';
            go.dataset.act = 'pick-start';
            go.setAttribute('aria-label', T.pickStart);
            go.append(el('span', 'scw-label', countText(picks.length, T.tracksCount, T.lang)));
            go.insertAdjacentHTML('beforeend', ICON.play);
            chip.append(go, button('scw-x', 'pick-clear', T.pickClear, 'x'));
            controls.append(chip);
        }
        // Волна от трека, артиста, плейлиста или подборки: вместо жанра её название и крестик возврата к обычной волне.
        // У подборки полки свой режим, переключатель скрыт
        if (seed) {
            const chip = el('div', 'scw-genre set');
            chip.title = seed.title;
            chip.append(el('span', 'scw-label', seed.title), button('scw-x', 'clear-seed', T.clearSeed, 'x'));
            if (!seed.mode) controls.append(seg);
            controls.append(chip, shakeButton, historyButton);
            head.append(titles, controls);
            return head;
        }
        const genreButton = el('button', 'scw-genre' + (genre ? ' set' : ''));
        genreButton.type = 'button';
        genreButton.dataset.act = 'genre';
        genreButton.setAttribute('aria-haspopup', 'dialog');
        genreButton.setAttribute('aria-expanded', String(popOpen));
        if (genre) genreButton.title = genre;
        genreButton.append(el('span', 'scw-label', genre ?? T.anyGenre));
        if (genre) {
            const clear = el('span', 'scw-x');
            clear.dataset.act = 'clear-genre';
            clear.setAttribute('role', 'button');
            clear.setAttribute('aria-label', T.clearGenre);
            clear.insertAdjacentHTML('beforeend', ICON.x);
            genreButton.append(clear);
        } else genreButton.insertAdjacentHTML('beforeend', ICON.chev);
        controls.append(seg, genreButton, shakeButton, historyButton);
        head.append(titles, controls);
        return head;
    }
    // Пресеты настроения: «Всё» и пять настроений. У волны от трека, артиста или подборки ряда нет
    function renderMoods(): HTMLElement | null {
        if (seed) return null;
        const row = el('div', 'scw-moods');
        row.setAttribute('role', 'radiogroup');
        row.setAttribute('aria-label', T.presets);
        const options: Array<[string, string]> = [['all', T.presetAll], ...moodList().map((mood): [string, string] => [mood, moodLabel(mood)])];
        for (const [value, label] of options) {
            const chip = el('button', 'scw-chip', label);
            chip.type = 'button';
            chip.setAttribute('role', 'radio');
            chip.setAttribute('aria-checked', String((preset ?? 'all') === value));
            chip.tabIndex = (preset ?? 'all') === value ? 0 : -1;
            chip.dataset.preset = value;
            row.append(chip);
        }
        return row;
    }
    // Быстрый ряд главной: настроения и закрепления одной строкой; играющее закрепление подсвечено
    function renderQuick(): HTMLElement | null {
        const moods = renderMoods();
        if (!moods && !pins.length) return null;
        const row = el('div', 'scw-quick');
        if (moods) row.append(moods);
        if (pins.length) {
            const group = el('div', 'scw-pins');
            group.setAttribute('role', 'group');
            group.setAttribute('aria-label', T.pinned);
            pins.forEach((pin, index) => {
                const on = pinPlaying(pin);
                const item = el('span', 'scw-pin' + (on ? ' on' : ''));
                const play = el('button', 'scw-chip', pin.title);
                play.type = 'button';
                play.dataset.act = 'pin-play';
                play.dataset.pin = String(index);
                play.title = fillText(T.pinPlay, { title: pin.title });
                play.setAttribute('aria-pressed', String(on));
                const remove = button('scw-pin-x', 'pin-remove', fillText(T.pinRemove, { title: pin.title }), 'x');
                remove.dataset.pin = String(index);
                item.append(play, remove);
                group.append(item);
            });
            row.append(group);
        }
        return row;
    }
    function renderPop(): HTMLElement {
        const pop = el('div', 'scw-pop');
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', T.genreInput);
        const input = el('input', '');
        input.placeholder = T.genreInput;
        input.value = popQuery;
        input.autocomplete = 'off';
        input.maxLength = 60;
        input.dataset.role = 'genre-input';
        pop.append(input);
        const option = (value: string, label: string): HTMLButtonElement => {
            const node = el('button', 'scw-opt', label);
            node.type = 'button';
            node.dataset.genre = value;
            node.setAttribute('aria-selected', String((genre ?? '') === value));
            return node;
        };
        const any = option('', T.anyGenre);
        any.style.marginTop = '6px';
        pop.append(any);
        const query = popQuery.trim().toLowerCase();
        const typed = formatGenres(parseGenres(query));
        const fromLikes = topGenres(profile?.likedTracks ?? [], 8);
        // Написания одного жанра («witch house» из недавних и «witchhouse» из лайков) одной строкой, первое по порядку
        const seen = new Set<string>();
        const list = [...recentGenres, ...fromLikes].filter((item) => {
            const key = genreCanon(normalizeTag(item));
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).filter((item) => !query || item.includes(query));
        if (typed && !list.includes(typed)) pop.append(option(typed, typed));
        if (list.length) {
            pop.append(el('div', 'scw-pop-label', T.fromLikes));
            for (const item of list.slice(0, 10)) pop.append(option(item, item));
        }
        return pop;
    }
    function renderFork(options: Array<{ candidate: WaveCandidate; label: string }>): HTMLElement[] {
        const head = el('div', 'scw-up-h scw-fork-h', T.forkTitle);
        head.append(button('scw-fork-x', 'fork-close', T.forkClose, 'x'));
        const tiles = el('div', 'scw-tiles');
        for (const option of options) {
            const tile = el('div', 'scw-tile');
            tile.dataset.fork = String(option.candidate.track.id);
            const cover = el('div', 'scw-art');
            art(cover, option.candidate.track, 't300x300');
            tile.append(cover, titleLink('div', 'scw-t1', option.candidate.track), artistLink('div', 'scw-t2', option.candidate.track), el('div', 'scw-t3', option.label));
            tiles.append(tile);
        }
        return [head, tiles];
    }
    let waitSince = 0;
    function renderTiles(): HTMLElement[] {
        if (state === 'empty' || state === 'error' || state === 'unavailable') return [];
        if (fork && active) return renderFork(fork.options);
        const waiting = state === 'loading' && !active;
        const list = upcoming(5);
        if (!waiting && !list.length) return [];
        const tiles = el('div', 'scw-tiles' + (waiting ? ' wait' : ''));
        // Заготовки появляются через 150 мс от начала ожидания; пересборка секции продолжает то же появление
        if (!waiting) waitSince = 0;
        else {
            const now = Date.now();
            if (!waitSince) waitSince = now;
            const elapsed = now - waitSince;
            if (elapsed > 350) tiles.classList.add('held');
            else tiles.style.setProperty('--scw-wait-delay', 150 - elapsed + 'ms');
        }
        for (let i = 0; i < 5; i++) {
            const candidate = waiting ? undefined : list[i];
            if (!waiting && !candidate) break;
            const tile = el('div', 'scw-tile');
            if (candidate) tile.dataset.track = String(candidate.track.id);
            const cover = el('div', 'scw-art');
            if (candidate) art(cover, candidate.track, 't300x300');
            tile.append(
                cover,
                candidate ? titleLink('div', 'scw-t1', candidate.track) : el('div', 'scw-t1', '\u00a0'),
                candidate ? artistLink('div', 'scw-t2', candidate.track) : el('div', 'scw-t2', '\u00a0'),
                el('div', 'scw-t3', candidate ? reasonText(candidate.reason, T) : '\u00a0'),
            );
            tiles.append(tile);
        }
        return [el('div', 'scw-up-h', active ? T.next : T.upFirst), tiles];
    }
    // rowsAt: прокрутка списка подборки, когда секция вернулась на страницу и своя прокрутка списка потеряна
    function render(rowsAt?: number, libraryAt?: number): void {
        if (!section) return;
        hideTip();
        const focusedNode = document.activeElement instanceof HTMLElement && section.contains(document.activeElement) ? document.activeElement : null;
        const focused = focusedNode ? focusedNode.dataset.act ?? focusedNode.dataset.mode ?? focusedNode.dataset.role ?? focusedNode.dataset.preset ?? '' : '';
        // У карточек полки одни действия на всех: фокус возвращается по номеру карточки, в строке списка по треку и месту в строке
        const focusedCard = focusedNode?.dataset.card;
        // Источник и режим «Моей музыки» делят одно действие на все кнопки: фокус возвращается по ключу кнопки
        const focusedSource = focusedNode?.dataset.source ?? focusedNode?.dataset.lmode ?? focusedNode?.dataset.pin;
        const focusedRow = focusedNode?.closest<HTMLElement>('.scw-row[data-track]');
        const focusedTrack = focusedRow?.dataset.track;
        const focusedPart = focusedRow && focusedNode ? [...focusedRow.querySelectorAll('button, a')].indexOf(focusedNode) : -1;
        // Пересборка секции не должна сбрасывать прокрутку списка подборки
        const rowsScroll = rowsAt ?? section.querySelector('.scw-mix-rows')?.scrollTop ?? 0;
        const libraryScroll = libraryAt ?? section.querySelector('.scw-lib-rows')?.scrollTop ?? 0;
        section.textContent = '';
        section.setAttribute('aria-label', T.wave);
        section.append(renderHead());
        if (popOpen) section.append(renderPop());
        const body = el('div', 'scw-body');
        const info = el('div', 'scw-info');
        const top = el('div', 'scw-top');
        const playing = active && !!player?.isPlaying();
        shownPlaying = playing;
        const play = button('scw-play', 'play', playing ? T.pause : T.play, playing ? 'pause' : 'play');
        play.disabled = state === 'unavailable' || (state === 'loading' && !active);
        const current = currentCandidate();
        // Блок пересобирается целиком: при смене трека прошлые обложка и цвет переносятся в новый, и смена идёт переходом
        const swap = !!current && !!shownTrack && current.track.id !== shownTrack && !calm();
        const lines = el('div', swap ? 'scw-swap' : '');
        if (current) {
            lines.append(titleLink('div', 'scw-track', current.track), artistLink('div', 'scw-artist', current.track));
        } else {
            const text = state === 'loading' ? T.loading : state === 'empty' ? emptyLine() : state === 'error' ? T.error : state === 'unavailable' ? T.unavailable : idleLine();
            const line = el('div', 'scw-track wrap', text);
            if (state !== 'idle') line.setAttribute('role', 'status');
            lines.append(line);
        }
        top.append(play, lines);
        const canvas = el('canvas', 'scw-wf' + (current ? ' live' : ''));
        const meta = el('div', 'scw-meta');
        if (current) {
            const like = button('scw-like', 'like', T.like, 'heart');
            like.title = T.like + ', Ctrl+L';
            like.setAttribute('aria-pressed', String(currentLiked));
            const later = button('scw-like', 'later', T.later, 'later');
            later.title = T.later + ', Ctrl+D';
            const dislike = button('scw-like', 'dislike', T.menuDislike, 'dislike');
            dislike.title = T.menuDislike;
            const more = button('scw-like', 'more', T.more, 'more');
            more.title = T.more + ', Ctrl+M';
            more.setAttribute('aria-pressed', String(moreTracks.has(current.track.id)));
            meta.append(el('div', 'scw-why', reasonText(current.reason, T)), later, dislike, more, like, el('div', 'scw-time'));
        } else if (state === 'empty') {
            if (genre) meta.append(textButton('drop-genre', T.dropGenre));
            if (mode === 'fresh') meta.append(textButton('to-similar', T.toSimilar));
        } else if (state === 'error' || state === 'unavailable') meta.append(textButton('retry', T.retry));
        info.append(top, canvas, meta);
        const cover = el('div', 'scw-cover' + (swap ? ' scw-cross' : ''));
        if (current) {
            if (swap && shownCover && loadedArt.has(shownCover)) {
                const under = el('span', 'scw-img on');
                under.style.backgroundImage = 'url("' + shownCover.replace(/["\\]/g, '') + '")';
                cover.append(under);
            }
            art(cover, current.track, 't500x500');
        } else if (state === 'idle' && preview.some((item) => artworkUrl(item.track, 't300x300'))) {
            cover.classList.add('collage');
            for (let i = 0; i < 4; i++) {
                const cell = el('span', '');
                if (state === 'idle' && preview[i]) art(cell, preview[i].track, 't300x300');
                cover.append(cell);
            }
        } else {
            cover.classList.add('scw-empty-cover');
            cover.setAttribute('aria-hidden', 'true');
            cover.innerHTML = '<svg viewBox="0 0 200 200" fill="none"><circle cx="100" cy="100" r="76" stroke="currentColor" opacity=".07"/><circle cx="100" cy="100" r="57" stroke="currentColor" opacity=".12"/><path d="M48 96v8m13-22v36m13-43v50m13-61v72m13-84v96m13-75v54m13-44v34m13-43v52m13-36v20" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".7"/></svg>';
        }
        body.append(info, cover);
        paintTint(body, current ? host.__scmCoverColor?.(coverPath(current.track)) ?? '' : '');
        if (breath) body.style.setProperty('--scw-breath', String(breath));
        const quick = renderQuick();
        section.append(body, ...renderTiles(), ...(quick ? [quick] : []), ...librarySection.render(), ...shelfSection.render());
        if (swap) {
            // Уже загруженная обложка встала бы сразу: проявление поверх прошлой запускается с нуля
            const image = cover.lastElementChild;
            if (image instanceof HTMLElement && image.classList.contains('on')) {
                image.classList.remove('on');
                void image.offsetWidth;
                image.classList.add('on');
            }
            drawFor = current?.track.id ?? 0;
        }
        shownTrack = current?.track.id ?? 0;
        shownCover = current ? artworkUrl(current.track, 't500x500') : '';
        const rowsBox = section.querySelector('.scw-mix-rows');
        if (rowsBox) rowsBox.scrollTop = rowsScroll;
        const libraryBox = section.querySelector('.scw-lib-rows');
        if (libraryBox) libraryBox.scrollTop = libraryScroll;
        if (focusedTrack) {
            const row = '.scw-row[data-track="' + focusedTrack + '"] ';
            const parts = section.querySelectorAll<HTMLElement>(row + 'button, ' + row + 'a');
            (parts[focusedPart] ?? parts[0])?.focus({ preventScroll: true });
        } else if (focused) {
            const again = focusedCard !== undefined
                ? section.querySelector<HTMLElement>('[data-act="' + focused + '"][data-card="' + focusedCard + '"]')
                : focusedSource !== undefined
                    ? section.querySelector<HTMLElement>('[data-act="' + focused + '"][data-source="' + focusedSource + '"],[data-act="' + focused + '"][data-lmode="' + focusedSource + '"],[data-act="' + focused + '"][data-pin="' + focusedSource + '"]')
                    : section.querySelector<HTMLElement>('[data-act="' + focused + '"],[data-mode="' + focused + '"],[data-role="' + focused + '"],[data-preset="' + focused + '"]');
            again?.focus();
            if (again instanceof HTMLInputElement) again.setSelectionRange(again.value.length, again.value.length);
        }
        // Треки только что раскрытого списка догрузились, и он вырос: прокрутка догоняет его
        if (revealUntil && Date.now() < revealUntil) section.querySelector('.scw-shelf .scw-mix')?.scrollIntoView({ block: 'nearest' });
        paint();
    }
    // Подложка блока цветом обложки; новая начинает с прошлого цвета, без цвета гаснет до прозрачной
    function paintTint(body: HTMLElement, tint: string): void {
        if (tint) {
            body.classList.add('tinted');
            body.style.setProperty('--scw-cover', tint);
        }
        if (tint !== shownTint && !calm()) {
            body.classList.add('scw-tint-in');
            body.style.setProperty('--scw-cover-from', shownTint || 'transparent');
        }
        shownTint = tint;
    }
    // Фон дышит (Ф3): громкость по форме волны в текущей точке (среднее пяти отсчётов, около полсекунды) от 0 до 1.
    // Только пока трек волны играет, блок виден и движение не убавлено; иначе подложка ровная
    function breathe(): void {
        let next = 0;
        const current = isVisible() && !document.hidden && !calm() ? currentCandidate() : null;
        const sound = current && player?.isPlaying() ? player.getCurrentSound() : null;
        const samples = current && sound?.id === current.track.id ? samplesFor(current.track) : null;
        const duration = sound ? durationOf(sound) : 0;
        if (sound && samples?.length && duration > 0) {
            const at = Math.floor((positionOf(sound) / duration) * samples.length);
            let sum = 0;
            let count = 0;
            for (let i = Math.max(0, at - 2); i <= Math.min(samples.length - 1, at + 2); i++) {
                sum += samples[i];
                count++;
            }
            next = count ? Math.max(0, Math.min(1, (sum / count - 0.2) / 0.8)) : 0;
        }
        next = Math.round(next * 100) / 100;
        if (next === breath) return;
        breath = next;
        section?.querySelector<HTMLElement>('.scw-body')?.style.setProperty('--scw-breath', String(breath));
    }
    // Средний цвет новой обложки считается после её загрузки: подложка красится, как только он готов
    function tintLate(): void {
        const current = shownTint ? null : currentCandidate();
        const tint = current ? host.__scmCoverColor?.(coverPath(current.track)) : undefined;
        const body = tint ? section?.querySelector<HTMLElement>('.scw-body') : null;
        if (!body || !tint) return;
        // Уже вставленный блок меняет цвет плавным переходом подложки, а не анимацией от прошлого
        shownTint = tint;
        body.classList.add('tinted');
        body.style.setProperty('--scw-cover', tint);
    }
    function updateLike(): void {
        // Класс scw-like у всех трёх кнопок ряда, сердце только по data-act
        section?.querySelector('.scw-like[data-act="like"]')?.setAttribute('aria-pressed', String(currentLiked));
    }

    const samplesFor = (track: WaveTrack | undefined): number[] | null => waveformOf(track)?.shape ?? null;
    function waveformOf(track: WaveTrack | undefined): { shape: number[]; raw: number[] } | null {
        const url = track?.waveform_url;
        if (!url || !/^https:\/\/wave\.sndcdn\.com\//.test(url)) return null;
        const cached = waveforms.get(url);
        if (typeof cached === 'object') return cached;
        if (cached) return null;
        waveforms.set(url, 'pending');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        fetch(url, { signal: controller.signal, credentials: 'omit' })
            .then((response) => (response.ok ? response.json() : Promise.reject(new Error('HTTP ' + response.status))))
            .then((data: { samples?: unknown }) => {
                const samples = Array.isArray(data.samples) ? data.samples.filter((value): value is number => typeof value === 'number') : [];
                if (waveforms.size > 60) waveforms.delete(waveforms.keys().next().value as string);
                waveforms.set(url, samples.length ? { shape: shapeSamples(samples), raw: samples } : 'failed');
                paint();
            })
            .catch((error: unknown) => {
                waveforms.set(url, 'failed');
                console.debug('Волна: форма не загружена', error);
            })
            .finally(() => clearTimeout(timer));
        return null;
    }
    // Форма как на SoundCloud: столбики 2 px через 1 px, снизу отражение, сыгранное оранжевым
    function paint(): void {
        const canvas = section?.querySelector<HTMLCanvasElement>('canvas.scw-wf');
        if (!canvas || !isVisible() || document.hidden) return;
        const ratio = window.devicePixelRatio || 1;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        if (!width || !height) return;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        const context = canvas.getContext('2d');
        if (!context) return;
        context.scale(ratio, ratio);
        const ink = (alpha: number): string => 'rgba(255,255,255,' + alpha + ')';
        const current = currentCandidate();
        let samples: Array<number | null> | null = null;
        let look: 'live' | 'dim' | 'flat' = 'flat';
        let progress = 0;
        if (current) {
            samples = samplesFor(current.track);
            look = 'live';
            const sound = player?.getCurrentSound();
            const duration = durationOf(sound) || current.track.full_duration || current.track.duration || 0;
            const position = positionOf(sound);
            progress = duration ? position / duration : 0;
            const time = section?.querySelector('.scw-time');
            if (time) time.textContent = formatTime(position) + ' / ' + formatTime(duration);
        } else if (state === 'idle' && preview.length) {
            // До запуска полоса из форм трёх первых треков подряд, с просветом между ними
            const parts = preview.slice(0, 3).map((item) => samplesFor(item.track));
            if (parts.every((part) => part)) {
                samples = [];
                parts.forEach((part, index) => {
                    if (index) for (let k = 0; k < 18; k++) samples?.push(null);
                    samples?.push(...(part as number[]).filter((_, k) => k % 3 === 0));
                });
                look = 'dim';
            }
        }
        // Форма нового трека растёт слева направо за 300 мс, когда пришла (В6)
        if (current && samples && drawFor === current.track.id) {
            drawFor = 0;
            drawFrom = calm() ? 0 : Date.now();
        }
        const drawn = drawFrom ? (Date.now() - drawFrom) / 300 : 1;
        if (drawn >= 1) drawFrom = 0;
        const step = 3;
        const bars = Math.floor(width / step);
        const top = Math.round(height * 0.7);
        for (let i = 0; i < bars; i++) {
            let value = 0.04;
            if (samples && samples.length) {
                const from = Math.floor((i / bars) * samples.length);
                const to = Math.max(from + 1, Math.floor(((i + 1) / bars) * samples.length));
                let gap = true;
                value = 0;
                for (let k = from; k < to; k++) {
                    const sample = samples[k];
                    if (sample !== null && sample !== undefined) {
                        gap = false;
                        value = Math.max(value, sample);
                    }
                }
                if (gap) continue;
            }
            const fraction = (i + 0.5) / bars;
            const rise = drawn >= 1 ? 1 : 1 - (1 - Math.min(1, Math.max(0, drawn * 1.6 - fraction * 0.6))) ** 3;
            const barHeight = Math.max(1, Math.round(value * (top - 2) * rise));
            const x = i * step;
            const played = look === 'live' && fraction <= progress;
            const hovered = look === 'live' && hover !== null && fraction <= hover && !played;
            let upper: string;
            let lower: string;
            if (played) { upper = '#ff5500'; lower = 'rgba(255,85,0,.42)'; }
            else if (hovered) { upper = ink(0.85); lower = ink(0.34); }
            else if (look === 'live') { upper = ink(0.55); lower = ink(0.2); }
            else { upper = ink(0.22); lower = ink(0.08); }
            context.fillStyle = upper;
            context.fillRect(x, top - barHeight, 2, barHeight);
            context.fillStyle = lower;
            context.fillRect(x, top + 1, 2, Math.round(barHeight * ((height - top - 1) / top)));
        }
        if (drawFrom) repaint();
    }

    // Подсказка с полным текстом, только если строка обрезана многоточием
    const tip = el('div', 'scw-tip');
    tip.setAttribute('role', 'tooltip');
    let tipTimer: ReturnType<typeof setTimeout> | undefined;
    let tipFor: Element | null = null;
    const cut = (node: Element | null): boolean => !!node && node.scrollWidth > node.clientWidth + 1;
    function hideTip(): void {
        if (tipTimer !== undefined) clearTimeout(tipTimer);
        tipTimer = undefined;
        tipFor = null;
        tip.classList.remove('on');
    }
    function onOver(event: MouseEvent): void {
        const target = event.target instanceof Element ? event.target.closest('[data-tip], .scw-tile, .scw-card, .scw-row, .scw-track, .scw-artist, .scw-why') : null;
        if (target === tipFor) return;
        hideTip();
        if (!target) return;
        // Подсказка кнопки (режимы «Моей музыки») показывается всегда, остальное только обрезанным
        const hint = target instanceof HTMLElement ? target.dataset.tip ?? '' : '';
        const card = target.classList.contains('scw-tile') || target.classList.contains('scw-card');
        const lines = hint ? [] : card || target.classList.contains('scw-row') ? [...target.querySelectorAll('.scw-t1, .scw-t2, .scw-t3, .scw-row-t b, .scw-row-t span')] : [target];
        if (!hint && !lines.some(cut)) return;
        tipFor = target;
        tipTimer = setTimeout(() => {
            tip.textContent = hint;
            lines.forEach((line, index) => tip.append(el(index ? 'span' : 'b', '', line.textContent ?? '')));
            if (!tip.isConnected) document.body.append(tip);
            // У карточки полки подсказка над обложкой (низ занят кнопкой «слушать»), у остального над самим элементом
            const anchor = target.classList.contains('scw-card') ? target.querySelector('.scw-art') ?? target : target;
            const rect = anchor.getBoundingClientRect();
            const left = Math.min(Math.max(8, rect.left + rect.width / 2 - tip.offsetWidth / 2), window.innerWidth - tip.offsetWidth - 8);
            const top = rect.top - tip.offsetHeight - 6;
            tip.style.left = left + 'px';
            tip.style.top = Math.max(52, top) + 'px';
            tip.classList.add('on');
        }, 350);
    }

    function likeButton(): Element | null {
        return document.querySelector('.playControls .playbackSoundBadge__like') ?? document.querySelector('.playbackSoundBadge__like');
    }
    function onClick(event: MouseEvent): void {
        const target = event.target instanceof Element ? event.target : null;
        if (!target || !section) return;
        // Название и автор ведут на страницу сайта; строка и плитка при этом трек не включают
        const link = target.closest<HTMLAnchorElement>('a.scw-link');
        if (link) {
            event.preventDefault();
            keptPageScroll = window.scrollY;
            navigate(link.getAttribute('href') ?? '');
            return;
        }
        const forkTile = target.closest<HTMLElement>('.scw-tile[data-fork]');
        if (forkTile) {
            pickFork(Number(forkTile.dataset.fork));
            return;
        }
        const tile = target.closest<HTMLElement>('.scw-tile[data-track]');
        if (tile) {
            const id = Number(tile.dataset.track);
            if (active && player) {
                const item = player.getQueue().slice().find((entry) => ours.has(entry) && entry.sound?.id === id);
                if (item) {
                    jumped = true;
                    player.setCurrentItem(item, {});
                    if (!player.isPlaying()) player.playCurrent({ userInitiated: true });
                }
            } else {
                const candidate = preview.find((item) => item.track.id === id);
                if (candidate) void start(candidate);
            }
            return;
        }
        // Трек раскрытой подборки: уже в очереди этой подборки, значит переход к нему; иначе подборка с него.
        // Кнопки внутри строки (метка группы радара) идут своими действиями ниже
        const row = target.closest('[data-act]') ? null : target.closest<HTMLElement>('.scw-row[data-track]');
        if (row && row.closest('.scw-lib')) {
            librarySection.rowClick(Number(row.dataset.track));
            return;
        }
        if (row && openCard !== null) {
            const id = Number(row.dataset.track);
            const item = active && player && seed?.card === openCard ? player.getQueue().slice().find((entry) => ours.has(entry) && entry.sound?.id === id) : undefined;
            if (item && player) {
                jumped = true;
                player.setCurrentItem(item, {});
                if (!player.isPlaying()) player.playCurrent({ userInitiated: true });
                setTimeout(render, 150);
            } else if (isRadarCard(openCard)) void radarSection.start(openCard, id);
            else void shelfSection.start(openCard, id);
            return;
        }
        const control = target.closest<HTMLElement>('[data-act], [data-mode], [data-genre], [data-preset]');
        if (!control) {
            if (popOpen && !target.closest('.scw-pop')) { popOpen = false; render(); }
            return;
        }
        if (control.dataset.preset !== undefined) {
            const next = moodList().find((mood) => mood === control.dataset.preset) ?? null;
            if (next !== preset) applySettings(mode, genre, next);
            return;
        }
        if (control.dataset.mode) {
            const next: WaveMode = control.dataset.mode === 'fresh' ? 'fresh' : 'similar';
            if (next !== mode) applySettings(next, genre);
            return;
        }
        if (control.dataset.genre !== undefined) {
            applySettings(mode, control.dataset.genre.trim() || null);
            return;
        }
        switch (control.dataset.act) {
            case 'clear-genre':
                event.stopPropagation();
                applySettings(mode, null);
                return;
            case 'clear-seed':
                clearSeed();
                return;
            case 'fork-close':
                closeFork();
                return;
            case 'shelf-open': {
                const index = Number(control.dataset.card);
                if (isRadarCard(index)) radarSection.toggle(index);
                else shelfSection.toggle(index);
                if (openCard === index) revealMix();
                else backToCard(index);
                return;
            }
            case 'lib-source':
            case 'lib-mode':
            case 'lib-play':
            case 'lib-sources':
            case 'lib-list':
            case 'lib-more':
            case 'lib-retry':
            case 'lib-rebuild':
                librarySection.click(control);
                return;
            case 'radar-found':
            case 'radar-group':
            case 'radar-group-all':
            case 'radar-rebuild':
            case 'radar-kind':
            case 'radar-heard':
                radarSection.click(control);
                return;
            case 'shelf-retry':
                shelfSection.resetFailures(); profileRetryAt = 0; shelfSection.ensure();
                return;
            case 'mix-close': {
                const index = openCard;
                openCard = null;
                render();
                if (index !== null) backToCard(index);
                return;
            }
            case 'shelf-play':
            case 'mix-play': {
                const index = control.dataset.act === 'mix-play' ? openCard ?? -1 : Number(control.dataset.card);
                // Играющая подборка: нажатие ставит на паузу и продолжает, как большая кнопка
                if (seed?.card === index && active && player) {
                    if (player.isPlaying()) player.pauseCurrent({ userInitiated: true });
                    else player.playCurrent({ userInitiated: true });
                    setTimeout(render, 150);
                } else if (isRadarCard(index)) void radarSection.start(index);
                else if (index >= 0) void shelfSection.start(index);
                return;
            }
            case 'pick-start':
                shelfSection.startPicks();
                return;
            case 'pick-clear':
                shelfSection.clearPicks();
                return;
            case 'pin-play':
                playPin(Number(control.dataset.pin));
                return;
            case 'pin-remove': {
                const pin = pins[Number(control.dataset.pin)];
                if (pin) void pinTarget({ kind: pin.kind, url: pin.url, artistUrl: '', genre: pin.title }, false);
                return;
            }
            case 'shake':
                shake();
                return;
            case 'history':
                host.soundcloudAPI?.openHistory?.();
                return;
            case 'genre':
                popOpen = !popOpen;
                popQuery = '';
                render();
                if (popOpen) {
                    section.querySelector<HTMLInputElement>('.scw-pop input')?.focus();
                    // Жанры из лайков берутся из профиля, а после перезапуска с длинной очередью его ещё никто не загрузил
                    if (!profile) void ensureProfile().then(() => { if (popOpen) render(); }, (error: unknown) => console.warn('Волна: жанры из лайков не загружены', error));
                }
                return;
            case 'play':
                if (active && player) {
                    if (player.isPlaying()) player.pauseCurrent({ userInitiated: true });
                    else player.playCurrent({ userInitiated: true });
                    setTimeout(render, 150);
                } else void start();
                return;
            case 'like':
                (likeButton() as HTMLElement | null)?.click();
                setTimeout(tick, 400);
                return;
            case 'more':
            case 'later':
            case 'dislike': {
                const current = currentCandidate();
                if (!current) return;
                // «Не сейчас» и «Не нравится» у играющего трека сразу ставят следующий
                if (control.dataset.act === 'later') void setExcluded('later-track', fromTrack(current.track), true);
                else if (control.dataset.act === 'dislike') void setExcluded('track', fromTrack(current.track), true);
                else void setExcluded('more', fromTrack(current.track), !moreTracks.has(current.track.id));
                return;
            }
            case 'drop-genre':
                applySettings(mode, null);
                return;
            case 'to-similar':
                applySettings('similar', genre);
                return;
            case 'retry':
                if (!tickTimer) { clearTimeout(attachTimer); attempts = 0; attach(); return; }
                profileRetryAt = 0;
                resetGeneration();
                void preparePreview();
                return;
        }
    }
    function onInput(event: Event): void {
        if (event.target instanceof HTMLSelectElement && event.target.dataset.role === 'radar-archive') {
            radarSection.select(event.target.value);
            return;
        }
        if (!(event.target instanceof HTMLInputElement) || event.target.dataset.role !== 'genre-input') return;
        popQuery = event.target.value;
        render();
    }
    function onKey(event: KeyboardEvent): void {
        // Переключатели (режим волны, настроение, режим «Моей музыки») листаются стрелками, Home и End: фокус и выбор вместе
        const radio = event.target instanceof HTMLElement && event.target.getAttribute('role') === 'radio' ? event.target : null;
        const group = radio?.closest('[role="radiogroup"]');
        const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[event.key];
        if (radio && group && (step || event.key === 'Home' || event.key === 'End')) {
            event.preventDefault();
            const radios = [...group.querySelectorAll<HTMLElement>('[role="radio"]')];
            const at = radios.indexOf(radio);
            const next = radios[event.key === 'Home' ? 0 : event.key === 'End' ? radios.length - 1 : (at + step + radios.length) % radios.length];
            if (next && next !== radio) {
                next.focus();
                next.click();
            }
            return;
        }
        if (event.key === 'Escape' && popOpen) {
            event.stopPropagation();
            popOpen = false;
            render();
            section?.querySelector<HTMLElement>('[data-act="genre"]')?.focus();
        } else if (event.key === 'Escape' && openCard !== null) {
            // Esc сворачивает подборку, фокус возвращается на её карточку
            event.stopPropagation();
            const index = openCard;
            openCard = null;
            render();
            backToCard(index);
        } else if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.dataset.role === 'genre-input' && parseGenres(popQuery).length) {
            applySettings(mode, popQuery);
        }
    }
    function onMove(event: MouseEvent): void {
        const canvas = event.target instanceof HTMLCanvasElement && event.target.classList.contains('live') ? event.target : null;
        const next = canvas ? (event.clientX - canvas.getBoundingClientRect().left) / canvas.clientWidth : null;
        if (next !== hover) {
            hover = next;
            paint();
        }
    }
    function onDown(event: MouseEvent): void {
        if (!(event.target instanceof HTMLCanvasElement) || !event.target.classList.contains('live') || !player) return;
        const sound = player.getCurrentSound();
        if (!sound || !known.has(sound.id)) return;
        const fraction = (event.clientX - event.target.getBoundingClientRect().left) / event.target.clientWidth;
        // seekCurrentTo плеера падает на этой версии сайта, перематывает сама модель трека
        sound.seek(Math.max(0, Math.min(1, fraction)) * durationOf(sound));
        paint();
    }

    // ===== Плашка с итогом, встраивание блока, слушатели и снятие волны =====
    const toastBox = el('div', 'scw-toast');
    toastBox.setAttribute('role', 'status');
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    // undo: кнопка «Отменить» в плашке; с ней плашка висит дольше и ловит нажатия
    function showToast(text: string, undo?: () => void): void {
        ensureStyle();
        toastBox.textContent = text;
        toastBox.classList.toggle('act', !!undo);
        if (undo) {
            const cancel = el('button', 'scw-undo', T.undo);
            cancel.type = 'button';
            cancel.addEventListener('click', () => {
                toastBox.classList.remove('on');
                undo();
            }, { once: true });
            toastBox.append(cancel);
        }
        if (!toastBox.isConnected) document.body.append(toastBox);
        toastBox.classList.add('on');
        if (toastTimer !== undefined) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastBox.classList.remove('on'), undo ? 6000 : 3500);
    }

    // Цель меню из трека волны: пункты меню и кнопки «Не сейчас», «Больше такого» в блоке
    function fromTrack(track: WaveTrack): MenuTarget {
        return { kind: 'track', url: track.permalink_url ?? '', artistUrl: track.user?.permalink_url ?? '', track };
    }
    // Горячие клавиши из main (Ctrl+L, Ctrl+D, Ctrl+M, Ctrl+S): то же, что кнопки блока, для играющего трека.
    // Лайк ставит кнопка сайта, плашка подтверждает, что вышло: окно могло быть не на главной
    host.__scWaveKey = (action: string): boolean => {
        const sound = player?.getCurrentSound();
        const track: WaveTrack | null = currentCandidate()?.track ?? (sound ? { ...(sound.attributes ?? {}), id: sound.id } : null);
        const title = (track?.title ?? '').trim() || '…';
        switch (action) {
            case 'like': {
                const node = likeButton();
                if (!(node instanceof HTMLElement) || !track) return false;
                node.click();
                setTimeout(() => {
                    tick();
                    const liked = likeButton()?.classList.contains('sc-button-selected') ?? false;
                    showToast(fillText(liked ? T.toastLiked : T.toastUnliked, { title }));
                }, 400);
                return true;
            }
            case 'later':
                if (!track) return false;
                void setExcluded('later-track', fromTrack(track), true);
                return true;
            case 'more':
                if (!track) return false;
                void setExcluded('more', fromTrack(track), !moreTracks.has(track.id));
                return true;
            case 'shake':
                if (state === 'loading' || state === 'unavailable') return false;
                shake();
                return true;
        }
        return false;
    };

    // Сайт ставит главную наверх уже после того, как блок встал, а ленту под ним дорисовывает частями:
    // место возвращается несколько раз за 3 секунды и отпускается, как только человек сам взялся за прокрутку
    function restorePageScroll(y: number): void {
        const until = Date.now() + 3000;
        let stopped = false;
        const stop = (): void => { stopped = true; };
        const events = ['wheel', 'keydown', 'mousedown', 'touchstart'] as const;
        for (const name of events) window.addEventListener(name, stop, { capture: true, passive: true });
        const step = (): void => {
            if (stopped || disposed || Date.now() > until) {
                for (const name of events) window.removeEventListener(name, stop, true);
                return;
            }
            if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
            setTimeout(step, 100);
        };
        step();
    }
    const onPop = (): void => { poppedAt = Date.now(); };

    function mount(): void {
        const home = location.pathname === '/discover' || location.pathname === '/';
        if (!home) return;
        const anchor = document.querySelector('.modular-home-mixed-selection');
        if (!anchor?.parentElement) return;
        ensureStyle();
        if (!section) {
            section = el('section', '');
            section.id = 'sc-wave';
            section.addEventListener('click', onClick);
            section.addEventListener('input', onInput);
            section.addEventListener('keydown', onKey);
            section.addEventListener('mouseover', onOver);
            section.addEventListener('mouseleave', () => { hideTip(); if (hover !== null) { hover = null; paint(); } });
            section.addEventListener('mousemove', onMove);
            section.addEventListener('mousedown', onDown);
            // События прокрутки не всплывают: списки подборки и «Моей музыки» ловятся на погружении
            section.addEventListener('scroll', (event) => {
                if (!(event.target instanceof HTMLElement)) return;
                if (event.target.classList.contains('scw-mix-rows')) keptRowsScroll = event.target.scrollTop;
                else if (event.target.classList.contains('scw-lib-rows')) keptLibraryScroll = event.target.scrollTop;
            }, true);
        }
        if (!(section.isConnected && section.nextElementSibling === anchor)) {
            // Возврат на главную («Назад» после перехода по ссылке): списки встают на прежнюю прокрутку
            const back = !section.isConnected && section.childElementCount > 0;
            anchor.parentElement.insertBefore(section, anchor);
            render(back ? keptRowsScroll : undefined, back ? keptLibraryScroll : undefined);
            // Страница тоже, но только по «Назад»: заход на главную ссылкой сайта начинается сверху
            if (back && keptPageScroll !== null && Date.now() - poppedAt < 5000) restorePageScroll(keptPageScroll);
            keptPageScroll = null;
        }
        // Подбор до запуска только для видимого блока: скрытая в F1 волна не ходит в API
        if (state === 'idle' && !active && !preview.length && player && isVisible()) void preparePreview();
        // Подборки собираются, когда блок виден и сайт готов, и пересобираются после местной полуночи
        if (player && api && state !== 'loading' && isVisible()) shelfSection.ensure();
        // Выпуск радара собирает main по расписанию, страница только читает готовый
        if (player && api && isVisible()) radarSection.ensure();
    }

    let frame = 0;
    let paintFrame = 0;
    const repaint = (): void => {
        if (disposed || document.hidden || paintFrame) return;
        paintFrame = requestAnimationFrame(() => { paintFrame = 0; paint(); });
    };
    const onResize = (): void => { menuSection.closeMenu(); repaint(); };
    const observer = new MutationObserver(() => {
        if (!frame) frame = requestAnimationFrame(() => {
            frame = 0;
            try {
                menuSection.watchFrames();
                mount();
            } catch (error) {
                console.error('Волна: блок не встал', error);
            }
        });
    });
    let tickTimer: ReturnType<typeof setInterval> | undefined;
    let paintTimer: ReturnType<typeof setInterval> | undefined;
    let breathTimer: ReturnType<typeof setInterval> | undefined;
    let attempts = 0;
    let attachTimer: ReturnType<typeof setTimeout> | undefined;
    function attach(): void {
        attachTimer = undefined;
        if (disposed) return;
        if (findModules()) {
            if (siteReported) reportSite();
            tickTimer = setInterval(() => {
                try {
                    tick();
                } catch (error) {
                    console.error('Волна: слежение за плеером', error);
                }
            }, 1000);
            paintTimer = setInterval(() => {
                if (currentCandidate() && player?.isPlaying()) paint();
            }, 250);
            breathTimer = setInterval(breathe, 120);
            state = 'loading';
            void queueControls.ready().catch((error: unknown) => console.warn('Сессия пока не восстановлена', error)).finally(() => {
                if (disposed) return;
                state = active ? 'playing' : 'idle'; render(); mount();
            });
            return;
        }
        attempts++;
        if (attempts === 20) {
            console.warn('Волна: плеер SoundCloud пока не найден');
            state = 'unavailable';
            render();
        }
        // Первые 20 раз раз в секунду, потом всё реже, до 10 минут: каждая попытка оставляет в сайте пробный модуль
        attachTimer = setTimeout(attach, attempts < 20 ? 1000 : Math.min(600000, 10000 * 2 ** (attempts - 20)));
    }
    const onOnline = (): void => {
        if (disposed) return;
        profileRetryAt = 0;
        if (!tickTimer) { clearTimeout(attachTimer); attach(); }
        else if (state === 'error' && !active) { resetGeneration(); void preparePreview(); }
    };
    // Страница снова видна: полка, отложенная на время скрытого окна или после сбоя, пробует сразу
    const onShown = (): void => {
        if (disposed || document.visibilityState === 'hidden' || !player || !api || state === 'loading' || !isVisible()) return;
        shelfSection.ensure(true);
    };

    const onScroll = (): void => {
        hideTip();
        menuSection.closeMenu();
    };
    const dispose = (): void => {
        void queueControls.save().catch((error: unknown) => console.warn('Сессия при переходе не сохранена', error));
        queueControls.dispose();
        recovery.dispose();
        disposed = true;
        dispatcher.dispose();
        if (librarySyncTimer !== undefined) clearTimeout(librarySyncTimer);
        openRequest++;
        generation++;
        seedRequest++;
        observer.disconnect();
        menuSection.dispose();
        document.removeEventListener('contextmenu', menuSection.onPageMenu);
        document.removeEventListener('mousedown', menuSection.onOutside, true);
        document.removeEventListener('keydown', menuSection.onDocumentKey);
        document.removeEventListener('click', onUserInput, true);
        document.removeEventListener('keydown', onUserInput, true);
        window.removeEventListener('blur', menuSection.closeMenu);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('popstate', onPop);
        document.removeEventListener('visibilitychange', repaint);
        document.removeEventListener('visibilitychange', onShown);
        cancelAnimationFrame(paintFrame);
        menuSection.closeMenu();
        if (toastTimer !== undefined) clearTimeout(toastTimer);
        toastBox.remove();
        delete host.__scWaveExclusionsChanged;
        if (frame) cancelAnimationFrame(frame);
        if (attachTimer !== undefined) clearTimeout(attachTimer);
        clearTimeout(siteCheck);
        if (tickTimer !== undefined) clearInterval(tickTimer);
        if (paintTimer !== undefined) clearInterval(paintTimer);
        if (breathTimer !== undefined) clearInterval(breathTimer);
        if (journalTimer !== undefined) clearTimeout(journalTimer);
        flushJournal();
        finishPlay('stop');
        if (signalsTimer !== undefined) clearTimeout(signalsTimer);
        flushSignals();
        document.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('pagehide', dispose);
        window.removeEventListener('online', onOnline);
        hideTip();
        tip.remove();
        section?.remove();
        document.getElementById('sc-wave-style')?.remove();
        delete host.__disposeWave;
        delete host.__scWaveTakeSignals;
        delete host.__scOpenTrack;
        delete host.__scNavigate;
        delete host.__scResolveTracks;
        delete host.__scWhoAmI;
        delete host.__scQueue;
        delete host.__scWaveKey;
        delete host.__scSaveSession;
        delete host.__scResume;
        delete host.__scRadarCollect;
        radarSection.dispose();
        quietSection.dispose();
        delete host.__scQuietOptions;
        versions.close();
    };
    host.__disposeWave = dispose;
    // Выход из приложения: main забирает недописанное вместе с текущим прослушиванием,
    // pagehide при закрытии окна приходит, когда main уже дописал журнал
    host.__scWaveTakeSignals = () => {
        finishPlay('stop');
        if (signalsTimer !== undefined) clearTimeout(signalsTimer);
        signalsTimer = undefined;
        return { userId, signals: userId ? pendingSignals.splice(0) : [] };
    };
    // F1 вернул трек или артиста в волну: перечитать отметки
    host.__scWaveExclusionsChanged = () => {
        exclusionsPromise = null;
        // Из F1 могли снять «Больше такого»: профиль вкуса тоже перечитывается
        tasteAt = 0;
        void ensureExclusions();
    };
    window.addEventListener('pagehide', dispose, { once: true });
    window.addEventListener('online', onOnline);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('contextmenu', menuSection.onPageMenu);
    document.addEventListener('mousedown', menuSection.onOutside, true);
    document.addEventListener('keydown', menuSection.onDocumentKey);
    document.addEventListener('click', onUserInput, true);
    document.addEventListener('keydown', onUserInput, true);
    window.addEventListener('blur', menuSection.closeMenu);
    window.addEventListener('resize', onResize);
    window.addEventListener('popstate', onPop);
    document.addEventListener('visibilitychange', repaint);
    document.addEventListener('visibilitychange', onShown);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    state = 'loading';
    menuSection.watchFrames();
    mount();
    attach();
}

// Помощники идут на страницу объявлениями рядом со скриптом: так они видны installWave и друг другу
const pageHelpers = [
    normalizeTag, tagKeys, tagShares, trackLang, genreKeys, genreEnglish, genreCanon, genrePhrases, genreParts, genreMain, parseGenres, formatGenres, genreKeysFor, classifyLink, classifyTag, canonicalUrl, trackMatchesGenre, trackArtist, rememberRecent, retryDelay,
    isWaveEligible, freshEnough, acceptCandidate, pickSpaced, spacingKeys, spacingGap, tasteMaps, tasteSlot, tasteForTime, sourceBias, trackTraits, seriesTrait, tasteScore, tasteOrder, tasteReason, applyTasteReasons, shuffleInPlace, topGenres, fillText, reasonText, shapeSamples,
    artworkUrl, coversOf, formatTime, playEnd, siteSource, moodTags, trackPath, localDay, countText, tasteGroups, capPerArtist, forgottenPicks, daySample, artistNames, performerNames, sharedPerformer, isNewArtist, spreadBy, pickFinds,
    moodList, moodDictionary, trackMood, playlistMood, artistMoods, neighborMood, moodScore,
    ...identity.identityHelpers, ...sources.sourceHelpers, ...libraryMix.libraryHelpers, siteRequires, installPlaybackPage, installPlaybackRecovery,
    installVersions, installLibrary, installRadar, installShelf, installMenu, installQuiet, quietBounds, installSources, relatedArtistsOf, scMixesOf, likedOwner, likersOf, tasteNeighbors, likedTracksOf, neighborLikes, interleaveMixes,
];

/** Смена настроек тихих краёв трека в F1: страница подхватывает без перезагрузки */
export function waveQuietScript(quiet: QuietOptions): string {
    return 'window.__scQuietOptions && window.__scQuietOptions(' + JSON.stringify({ edges: quiet.edges === true, fade: quiet.fade === true }) + ')';
}

export function waveScript(resume = false, quiet: QuietOptions = { edges: true, fade: true }): string {
    const config: WaveConfig = { texts: WAVE_TEXTS, resume, quiet };
    return '(function(){\n' + pageHelpers.map((helper) => helper.toString()).join('\n') + '\n(' + installWave.toString() + ')(' + JSON.stringify(config) + ', installPlaybackPage, installPlaybackRecovery);\n})();';
}
