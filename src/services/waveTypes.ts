import type { LibraryMode } from './libraryMix';
// Типы «Моей волны»: трек сайта, причины, фильтр подбора, тексты, профиль вкуса. Только типы, на страницу не уходят

export interface WaveTrack {
    id: number;
    kind?: string;
    title?: string;
    genre?: string | null;
    tag_list?: string | null;
    user_id?: number;
    user?: { id?: number; username?: string; avatar_url?: string | null; permalink_url?: string } | null;
    permalink_url?: string;
    artwork_url?: string | null;
    waveform_url?: string | null;
    policy?: string;
    streamable?: boolean;
    duration?: number;
    full_duration?: number;
    /** Метаданные издателя: часто null или псевдоним загрузчика, иногда isrc и автор (приложение А плана радара) */
    publisher_metadata?: { artist?: string | null; isrc?: string | null; writer_composer?: string | null } | null;
    /** Даты ISO: загрузка, публикация (бывает позже загрузки), заявленный релиз с точностью до дня */
    created_at?: string;
    display_date?: string;
    release_date?: string | null;
}

export type WaveMode = 'similar' | 'fresh';

export type OpenTrackResult = 'played' | 'not-ready' | 'unavailable' | 'failed' | 'superseded';

export type WaveReason =
    | { kind: 'similar'; seed: string }
    | { kind: 'fresh'; seed: string }
    | { kind: 'newArtist' }
    | { kind: 'genreFresh'; genre: string }
    | { kind: 'genrePopular'; genre: string }
    | { kind: 'genreSimilar'; genre: string; seed: string }
    | { kind: 'seedTrack' }
    | { kind: 'restored' }
    | { kind: 'artistTrack'; artist: string }
    | { kind: 'mood'; seed: string; genre: string }
    | { kind: 'tasteArtist'; artist: string }
    | { kind: 'tasteTag'; genre: string }
    | { kind: 'daily' }
    | { kind: 'forgotten' }
    | { kind: 'group'; name: string }
    | { kind: 'version'; seed: string }
    /** Позиция радара: why это готовая короткая причина из выпуска */
    | { kind: 'radar'; why: string }
    /** Трек «Моей музыки»: name это плейлист, из которого он пришёл, пусто у лайков */
    | { kind: 'library'; name: string };

export interface WaveCandidate {
    track: WaveTrack;
    reason: WaveReason;
}

export interface WaveFilter {
    mode: WaveMode;
    /** Треки сессии и уже стоящие в очереди */
    taken: Set<number>;
    /** Недавняя история SoundCloud: в «Похожем» не повторяется */
    recent: Set<number>;
    /** Всё слышанное: история и свой журнал */
    heard: Set<number>;
    liked: Set<number>;
    /** Ключи вероятных копий версий, рано пропущенных человеком в этой сессии: аккаунт целиком не банится */
    skipped: Set<string>;
    /** «Не нравится» (с подтверждёнными копиями) и скрытые артисты: навсегда, в любом режиме */
    excludedTracks: Set<number>;
    excludedArtists: Set<number>;
    /** «Скрыть другие версии»: семья по разбору названия и версии, которые в ней оставлены */
    excludedFamilies: Map<string, Set<string>>;
}

export type WaveLinkKind = 'track' | 'artist' | 'playlist';
/** Цель меню по правому клику: трек, артист или плейлист по ссылке, трек волны сразу с данными */
export interface MenuTarget { kind: WaveLinkKind; url: string; artistUrl: string; track?: WaveTrack }

export type WaveTexts = Record<
    | 'wave' | 'similar' | 'fresh' | 'anyGenre' | 'genreInput' | 'fromLikes' | 'hintSimilar' | 'hintFresh' | 'hintGenre' | 'hintGenres'
    | 'idleSimilar' | 'idleSimilarAny' | 'idleFresh' | 'idleGenre' | 'whySimilar' | 'whyFresh' | 'whyNewArtist' | 'whyGenreFresh'
    | 'whyGenrePopular' | 'whyGenreSimilar' | 'loading' | 'emptyFresh' | 'emptyFreshGenre' | 'emptyGenre' | 'emptySimilar'
    | 'dropGenre' | 'toSimilar' | 'play' | 'pause' | 'clearGenre' | 'upFirst' | 'next' | 'like' | 'error' | 'retry' | 'unavailable'
    | 'whySeedTrack' | 'whyRestored' | 'whyArtistTrack' | 'whyMood' | 'seedTrack' | 'seedArtist' | 'seedPlaylist' | 'clearSeed' | 'emptySeed'
    | 'menuWaveTrack' | 'menuWaveArtist' | 'menuWavePlaylist' | 'menuDislike' | 'menuUndislike' | 'menuHideArtist' | 'menuShowArtist'
    | 'toastDisliked' | 'toastUndisliked' | 'toastHidden' | 'toastShown' | 'toastFailed' | 'toastNotSaved' | 'toastEmpty' | 'shake' | 'history'
    | 'whyTasteArtist' | 'whyTasteTag' | 'more' | 'later' | 'menuUnmore' | 'menuUnlater' | 'toastMore' | 'toastUnmore' | 'toastLater'
    | 'toastLaterArtist' | 'toastUnlater'
    | 'lang' | 'shelf' | 'shelfDaily' | 'shelfForgotten' | 'shelfEmpty' | 'shelfFailed' | 'tracksCount' | 'groupAnd' | 'whyDaily' | 'whyForgotten' | 'whyGroup'
    | 'seedDaily' | 'seedForgotten' | 'seedGroup' | 'seedTracks' | 'menuPick' | 'menuUnpick' | 'toastPicked' | 'toastUnpicked' | 'toastPickFull'
    | 'pickStart' | 'pickClear' | 'mixPlay' | 'mixClose' | 'mixLoading' | 'mixFailed' | 'mixEmpty' | 'whyVersion'
    | 'radar' | 'radarUploads' | 'radarUploadsHint' | 'radarHeard' | 'radarPartial' | 'radarCoverage' | 'radarComplete' | 'radarEmptyWeek'
    | 'radarCollecting' | 'radarNoSession' | 'radarOffline' | 'radarError' | 'radarSoon' | 'radarFailed' | 'radarFound' | 'radarAll' | 'radarReleases'
    | 'radarPosts' | 'radarHideHeard' | 'radarAfter' | 'radarRebuild' | 'radarBuildNow' | 'radarRebuilt' | 'radarBuilt' | 'radarWaiting' | 'radarArchive'
    | 'radarRevision' | 'radarFoundEmpty' | 'radarNoMatch' | 'whyRadar' | 'whyRadarArtist' | 'whyRadarFollow' | 'whyRadarTag' | 'whyRadarTaste'
    | 'menuVersions' | 'menuHideFamily' | 'menuShowFamily' | 'toastFamilyHidden' | 'toastFamilyShown' | 'versionsTitle' | 'versionsSame'
    | 'versionsOther' | 'versionsLoading' | 'versionsEmpty' | 'versionsFailed' | 'versionsLink' | 'versionsUnlink' | 'versionsProbable'
    | 'versionsConfirmed' | 'versionsThis' | 'toastLinked' | 'toastUnlinked' | 'dialogClose' | 'radarPost' | 'rowPlay'
    | 'radarAlbum' | 'radarEp' | 'radarSingle' | 'radarCompilation' | 'radarGroupAll' | 'radarGroupQueued'
    | 'library' | 'libraryLikes' | 'libraryOrder' | 'libraryShuffle' | 'librarySmart' | 'libraryOrderTip' | 'libraryShuffleTip' | 'librarySmartTip'
    | 'libraryPlay' | 'libraryPick' | 'libraryLoading' | 'libraryFailed' | 'libraryBuilding' | 'libraryEmpty' | 'libraryList' | 'libraryMore'
    | 'libraryModes' | 'whyLibrary' | 'whyLibraryLikes' | 'seedLibrary',
    string
>;

// Профиль вкуса из main: веса треков, аккаунтов-кураторов, участников, семей версий, тегов и пометок версии
export interface TasteMaps {
    artists: Map<number, number>;
    credits: Map<string, number>;
    families: Map<string, number>;
    tags: Map<string, number>;
    markers: Map<string, number>;
    tracks: Map<number, number>;
}

export interface TasteScore {
    score: number;
    track: number;
    /** Вес загрузившего аккаунта как куратора */
    artist: number;
    /** Участники из названия и метаданных, кроме загрузчика: лучший плюс и худший минус вместе */
    credit: number;
    /** Самый любимый участник и его вес */
    creditName: string;
    creditBest: number;
    /** Семья версий: другая версия любимой песни */
    family: number;
    /** Средний вес известных пометок версии (slowed, remix, live) */
    marker: number;
    /** Средний вес известных тегов трека */
    tag: number;
    /** Самый любимый из тегов трека и его вес */
    tagKey: string;
    tagBest: number;
    /** У аккаунта или участника есть история */
    known: boolean;
}

export interface TasteGroup {
    /** Ключи тегов группы, самые весомые первыми */
    keys: string[];
    /** Главные теги для названия в написании, которое у треков встречается чаще */
    labels: string[];
    /** Треки группы, самые весомые первыми */
    tracks: WaveTrack[];
    weight: number;
}

// Типы ядра волны, которые нужны и разделам в wave/
export type WaveState = 'idle' | 'loading' | 'playing' | 'empty' | 'error' | 'unavailable';
export interface Profile {
    userId: number;
    history: WaveTrack[];
    recent: Set<number>;
    heard: Set<number>;
    liked: Set<number>;
    likedTracks: WaveTrack[];
    knownArtists: Set<number>;
    /** Ключи имён исполнителей из истории и лайков: для причины «новый артист» */
    knownNames: Set<string>;
    loadedAt: number;
    likesCursor: Record<string, string | number> | null;
    /** Лайки прошлого профиля, которых новое листание ещё не подтвердило: в конце листания снятые уходят */
    unconfirmed?: Set<number>;
}
// Волна от трека, артиста или плейлиста из меню по ПКМ: зёрна вместо вкуса, жанр не действует.
// own это треки самого артиста, они идут в подборку; derived это найденное, от него волна едет дальше.
// У подборок полки и набора из меню own это сама подборка
export type SeedKind = WaveLinkKind | 'daily' | 'forgotten' | 'group' | 'tracks' | 'radar' | 'library';
export interface Seed {
    kind: SeedKind;
    title: string;
    tracks: WaveTrack[];
    own: WaveTrack[];
    /** own по порядку впереди найденного (fixed), через один с ним (blend) или три к одному (smart); без order own тасуется с найденным */
    order?: 'fixed' | 'blend' | 'smart';
    /** Свой режим подбора у подборки полки, переключатель на неё не действует */
    mode?: WaveMode;
    /** Номер карточки полки, от которой идёт волна */
    card?: number;
    /** «Моя музыка»: выбранные источники и режим; left это номера оставшихся треков из сессии, пока пул не собран заново */
    library?: { pick: string[]; mode: LibraryMode; left?: number[] };
}
/** Вид отметки из меню и блока: «Не нравится», скрытый артист, «Не сейчас» у трека и артиста, «Больше такого» */
export type MarkKind = 'track' | 'artist' | 'later-track' | 'later-artist' | 'more';
/** Отметка волны из main: «Не нравится», скрытый артист, «Не сейчас» до until */
export interface Excluded { id: number; title: string; artist: string; url: string; until?: number }
