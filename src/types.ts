/**
 * Core type definitions for the SoundCloud RPC application
 */

/**
 * Information about the currently playing track
 */
export interface TrackInfo {
    /** Title of the track */
    title: string;
    /** Author/artist of the track */
    author: string;
    /** URL to the track's artwork image */
    artwork: string;
    /** Elapsed playback time (format: "MM:SS" or "H:MM:SS") */
    elapsed: string;
    /** Total duration of the track (format: "MM:SS" or "H:MM:SS") */
    duration: string;
    /** Whether the track is currently playing */
    isPlaying: boolean;
    /** Whether the track is liked by the user */
    isLiked: boolean;
    /** SoundCloud URL of the track */
    url: string;
    /** SoundCloud URL of the artist profile */
    artistUrl: string;
}

/**
 * Сведения о текущем треке из модели сайта: для шаблонов и фильтров карточки Discord
 */
export interface TrackMeta {
    id: number;
    /** Ссылка на трек, по ней метаданные сверяются с TrackInfo */
    url: string;
    genre: string;
    tags: string;
    plays: number;
    likes: number;
    /** Имя загрузившего на SoundCloud */
    artist: string;
    avatar: string;
    artwork: string;
    /** Подпись волны, если трек играет из неё, иначе пусто */
    wave: string;
}

/**
 * Одно прослушивание трека для журнала сигналов волны
 */
export interface PlaySignal {
    /** Начало прослушивания, мс от эпохи */
    at: number;
    id: number;
    artist: number;
    /** Длительность трека, мс */
    dur: number;
    /** Где остановился, мс */
    pos: number;
    /** Сколько реально играло без перемоток, мс */
    heard: number;
    /** done: дослушал, skip: ушёл раньше, stop: закрыта страница или клиент */
    end: 'done' | 'skip' | 'stop';
    /** wave:similar, wave:fresh, wave:track, wave:artist, wave:playlist или site:<тип очереди сайта> */
    source: string;
    /** Почему волна взяла трек: вид причины */
    why: string;
    /** Лайк стоял к концу прослушивания */
    liked: boolean;
    /** Лайк поставлен во время прослушивания */
    likedNow: boolean;
    disliked: boolean;
    hiddenArtist: boolean;
    genre: string;
    tags: string;
    /** Версия записи: 1 до 0.5.2, 2 с названием, адресом, обложкой и поясом */
    v?: 1 | 2;
    /** Смещение местного времени от UTC на начало прослушивания, минуты */
    tz?: number;
    title?: string;
    artistName?: string;
    /** Путь трека /user/track; у приватного трека пустой, секретная ссылка в журнал не пишется */
    path?: string;
    artwork?: string;
    /** Больше половины прослушивания экран был заблокирован или система простаивала: ставит main */
    away?: boolean;
}

/**
 * Общие данные воспроизведения для интеграций
 */
export interface PlaybackTrackData {
    /** Title of the track */
    title: string;
    /** Author/artist of the track */
    author: string;
    /** Total duration of the track */
    duration: string;
    /** Elapsed playback time (format: "MM:SS" or "H:MM:SS") */
    elapsed: string;
}

/**
 * Data sent to webhooks
 */
export interface WebhookTrackData extends PlaybackTrackData {
    /** SoundCloud URL of the track */
    url: string;
    /** URL to the track's artwork image */
    artwork: string;
}

/**
 * Parsed track information with artist and track name separated
 */
export interface ParsedTrackInfo {
    /** Parsed artist name (null if not found) */
    artist: string | null;
    /** Parsed track name */
    track: string;
}

/**
 * Normalized track information for display
 */
export interface NormalizedTrackInfo {
    /** Artist name (never null, defaults to "Unknown Artist") */
    artist: string;
    /** Track name (never null, defaults to "Unknown Track") */
    track: string;
}

/**
 * Translation keys used throughout the application
 */
export interface Translations {
    client: string;
    adBlocker: string;
    enableAdBlocker: string;
    changesAppRestart: string;
    proxy: string;
    proxyHost: string;
    proxyPort: string;
    enableProxy: string;
    webhooks: string;
    discord: string;
    enableWebhooks: string;
    webhookUrl: string;
    webhookTrigger: string;
    webhookDescription: string;
    showWebhookExample: string;
    enableRichPresence: string;
    displaySmallIcon: string;
    displayButtons: string;
    useArtistInStatusLine: string;
    enableRichPresencePreview: string;
    richPresencePreview: string;
    richPresencePreviewDescription: string;
    applyChanges: string;
    minimizeToTray: string;
    enableNavigationControls: string;
    enableTrackParser: string;
    trackParserDescription: string;
    customThemes: string;
    selectCustomTheme: string;
    noTheme: string;
    openThemesFolder: string;
    refreshThemes: string;
    customThemeDescription: string;
    plugins: string;
    openPluginsFolder: string;
    refreshPlugins: string;
    pluginsDescription: string;
    noPluginsFound: string;
    pressF1ToOpenSettings: string;
    closeSettings: string;
    noActivityToShow: string;
    richPresencePreviewTitle: string;
    listenOnSoundcloud: string;
}

/**
 * Словарь перевода сайта: ключ это английская фраза сайта, перед ней «контекст::», если он есть
 */
export interface SiteDictionary {
    /** Обычные фразы, параметры [[name]] как в оригинале */
    phrases: Record<string, string>;
    /** Множественное число: ключ по фразе в единственном числе, формы для 1, 2-4 и 5+, число подставляется в %d */
    plurals: Record<string, string[]>;
}

/**
 * Update reason for track state changes
 */
export type TrackUpdateReason =
    | 'playback-state-change'
    | 'track-change'
    | 'seek-change'
    | 'initial-state'
    | 'progress'
    | 'loop';

/**
 * Message sent from renderer to main process for track updates
 */
export interface TrackUpdateMessage {
    /** Track information */
    data: TrackInfo;
    /** Reason for the update */
    reason: TrackUpdateReason;
}
