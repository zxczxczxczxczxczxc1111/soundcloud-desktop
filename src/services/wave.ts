// «Моя волна»: подбор треков через API сайта и блок первым на главной.
// Функции ниже уходят на страницу текстом, поэтому они не ссылаются на импорты и константы модуля,
// только друг на друга по имени: waveScript кладёт их объявления в одну обёртку со скриптом.
import type { PlaySignal, TrackMeta } from '../types';

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
}
export type WaveMode = 'similar' | 'fresh';
export type WaveReason =
    | { kind: 'similar'; seed: string }
    | { kind: 'fresh'; seed: string }
    | { kind: 'newArtist' }
    | { kind: 'genreFresh'; genre: string }
    | { kind: 'genrePopular'; genre: string }
    | { kind: 'genreSimilar'; genre: string; seed: string }
    | { kind: 'seedTrack' }
    | { kind: 'artistTrack'; artist: string }
    | { kind: 'mood'; seed: string; genre: string }
    | { kind: 'tasteArtist'; artist: string }
    | { kind: 'tasteTag'; genre: string };
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
    skippedArtists: Set<number>;
    /** «Не нравится» и скрытые артисты: навсегда, в любом режиме */
    excludedTracks: Set<number>;
    excludedArtists: Set<number>;
}
export type WaveLinkKind = 'track' | 'artist' | 'playlist';

export type WaveTexts = Record<
    | 'wave' | 'similar' | 'fresh' | 'anyGenre' | 'genreInput' | 'fromLikes' | 'hintSimilar' | 'hintFresh' | 'hintGenre' | 'hintGenres'
    | 'idleSimilar' | 'idleSimilarAny' | 'idleFresh' | 'idleGenre' | 'whySimilar' | 'whyFresh' | 'whyNewArtist' | 'whyGenreFresh'
    | 'whyGenrePopular' | 'whyGenreSimilar' | 'loading' | 'emptyFresh' | 'emptyFreshGenre' | 'emptyGenre' | 'emptySimilar'
    | 'dropGenre' | 'toSimilar' | 'play' | 'pause' | 'clearGenre' | 'upFirst' | 'next' | 'like' | 'error' | 'retry' | 'unavailable'
    | 'whySeedTrack' | 'whyArtistTrack' | 'whyMood' | 'seedTrack' | 'seedArtist' | 'seedPlaylist' | 'clearSeed' | 'emptySeed'
    | 'menuWaveTrack' | 'menuWaveArtist' | 'menuWavePlaylist' | 'menuDislike' | 'menuUndislike' | 'menuHideArtist' | 'menuShowArtist'
    | 'toastDisliked' | 'toastUndisliked' | 'toastHidden' | 'toastShown' | 'toastFailed' | 'toastNotSaved' | 'toastEmpty' | 'shake' | 'history'
    | 'whyTasteArtist' | 'whyTasteTag' | 'more' | 'later' | 'menuUnmore' | 'menuUnlater' | 'toastMore' | 'toastUnmore' | 'toastLater'
    | 'toastLaterArtist' | 'toastUnlater',
    string
>;

export const WAVE_TEXTS: Record<'ru' | 'en', WaveTexts> = {
    ru: {
        wave: 'Моя волна', similar: 'Похожее', fresh: 'Новое', anyGenre: 'Любой жанр', genreInput: 'Жанры через запятую', fromLikes: 'Из твоих лайков',
        hintSimilar: 'Похоже на то, что ты слушаешь и лайкаешь', hintFresh: 'Треки в твоём вкусе, которых ты ещё не слышал', hintGenre: ', в жанре {genre}',
        hintGenres: ', в жанрах {genre}',
        idleSimilar: 'Начнётся с похожего на {seed}', idleSimilarAny: 'Начнётся с похожего на твои лайки', idleFresh: 'Начнётся с треков, которых ты ещё не слышал',
        idleGenre: 'Начнётся со свежего {genre}',
        whySimilar: 'Похоже на {seed}', whyFresh: 'Новое для тебя, похоже на {seed}', whyNewArtist: 'Новый для тебя артист', whyGenreFresh: 'Свежее в жанре {genre}',
        whyGenrePopular: 'Популярное в жанре {genre}', whyGenreSimilar: '{genre}, похоже на {seed}',
        loading: 'Подбираю треки…', emptyFresh: 'Не нашлось треков, которых ты ещё не слышал', emptyFreshGenre: 'Не нашлось треков {genre}, которых ты ещё не слышал',
        emptyGenre: 'Не нашлось треков в жанре {genre}', emptySimilar: 'Не нашлось похожих треков: волне нужны лайки или история прослушивания',
        dropGenre: 'Любой жанр', toSimilar: 'Включить Похожее', play: 'Включить волну', pause: 'Пауза', clearGenre: 'Убрать жанр',
        upFirst: 'Первыми сыграют', next: 'Далее', like: 'Нравится', error: 'Не удалось подобрать треки, SoundCloud не ответил', retry: 'Повторить',
        unavailable: 'Волна не работает с этой версией SoundCloud',
        whySeedTrack: 'С него началась волна', whyArtistTrack: 'Из треков {artist}', whyMood: 'В духе {seed}: {genre}',
        seedTrack: 'Волна по треку {seed}', seedArtist: 'Волна по артисту {seed}', seedPlaylist: 'Волна по плейлисту {seed}',
        clearSeed: 'Вернуть обычную волну', emptySeed: 'Не нашлось похожих треков',
        menuWaveTrack: 'Волна по треку', menuWaveArtist: 'Волна по артисту', menuWavePlaylist: 'Волна по плейлисту',
        menuDislike: 'Не нравится', menuUndislike: 'Вернуть в волну', menuHideArtist: 'Не показывать артиста', menuShowArtist: 'Показывать артиста',
        toastDisliked: 'Трек больше не попадёт в волну', toastUndisliked: 'Трек снова может попасть в волну',
        toastHidden: 'Артист больше не попадёт в волну', toastShown: 'Артист снова может попасть в волну',
        toastFailed: 'Не получилось: SoundCloud не ответил', toastNotSaved: 'Отметка не сохранилась', toastEmpty: 'Не нашлось похожих треков',
        shake: 'Встряхнуть', history: 'История, Ctrl+H',
        whyTasteArtist: 'Ты часто дослушиваешь {artist}', whyTasteTag: 'В духе {genre}, который ты любишь',
        more: 'Больше такого', later: 'Не сейчас', menuUnmore: 'Отменить «Больше такого»', menuUnlater: 'Вернуть в волну',
        toastMore: 'Волна подберёт больше такого', toastUnmore: 'Отметка «Больше такого» снята',
        toastLater: 'Трек не попадёт в волну неделю', toastLaterArtist: 'Артист не попадёт в волну неделю', toastUnlater: 'Снова может попасть в волну',
    },
    en: {
        wave: 'My Wave', similar: 'Similar', fresh: 'New', anyGenre: 'Any genre', genreInput: 'Genres, comma separated', fromLikes: 'From your likes',
        hintSimilar: 'Similar to what you play and like', hintFresh: 'Tracks in your taste you haven’t heard yet', hintGenre: ', in {genre}',
        hintGenres: ', in {genre}',
        idleSimilar: 'Starts with tracks similar to {seed}', idleSimilarAny: 'Starts with tracks similar to your likes', idleFresh: 'Starts with tracks you haven’t heard yet',
        idleGenre: 'Starts with fresh {genre}',
        whySimilar: 'Similar to {seed}', whyFresh: 'New to you, similar to {seed}', whyNewArtist: 'Artist new to you', whyGenreFresh: 'Fresh in {genre}',
        whyGenrePopular: 'Popular in {genre}', whyGenreSimilar: '{genre}, similar to {seed}',
        loading: 'Picking tracks…', emptyFresh: 'No tracks you haven’t heard yet', emptyFreshGenre: 'No {genre} tracks you haven’t heard yet',
        emptyGenre: 'No tracks in {genre}', emptySimilar: 'No similar tracks: the wave needs your likes or listening history',
        dropGenre: 'Any genre', toSimilar: 'Switch to Similar', play: 'Play wave', pause: 'Pause', clearGenre: 'Clear genre',
        upFirst: 'Up first', next: 'Next up', like: 'Like', error: 'Couldn’t pick tracks, SoundCloud didn’t respond', retry: 'Try again',
        unavailable: 'My Wave doesn’t work with this SoundCloud version',
        whySeedTrack: 'Your wave starts here', whyArtistTrack: 'By {artist}', whyMood: 'In the vibe of {seed}: {genre}',
        seedTrack: 'Wave from {seed}', seedArtist: 'Wave from artist {seed}', seedPlaylist: 'Wave from playlist {seed}',
        clearSeed: 'Back to My Wave', emptySeed: 'No similar tracks found',
        menuWaveTrack: 'Wave from track', menuWaveArtist: 'Wave from artist', menuWavePlaylist: 'Wave from playlist',
        menuDislike: 'Dislike', menuUndislike: 'Allow in My Wave', menuHideArtist: 'Hide artist', menuShowArtist: 'Show artist',
        toastDisliked: 'This track won’t play in My Wave', toastUndisliked: 'This track can play in My Wave again',
        toastHidden: 'This artist won’t play in My Wave', toastShown: 'This artist can play in My Wave again',
        toastFailed: 'Didn’t work: SoundCloud didn’t respond', toastNotSaved: 'Couldn’t save this', toastEmpty: 'No similar tracks found',
        shake: 'Shake up', history: 'History, Ctrl+H',
        whyTasteArtist: 'You often finish {artist}', whyTasteTag: 'The {genre} you love',
        more: 'More like this', later: 'Not now', menuUnmore: 'Undo “More like this”', menuUnlater: 'Allow in My Wave',
        toastMore: 'My Wave will play more like this', toastUnmore: '“More like this” removed',
        toastLater: 'This track won’t play in My Wave for a week', toastLaterArtist: 'This artist won’t play in My Wave for a week',
        toastUnlater: 'Can play in My Wave again',
    },
};

// Жанр и теги на SoundCloud свободный текст: сравниваются без регистра, пробелов и знаков
export function normalizeTag(text: string): string {
    return text.toLowerCase().replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '');
}

// Ключи жанра и тегов трека для модели вкуса: одни и те же в main и на странице, не больше шести
export function tagKeys(genre: string | null | undefined, tagList: string | null | undefined): string[] {
    const keys: string[] = [];
    const add = (label: string): void => {
        const key = normalizeTag(label);
        if (key.length >= 2 && keys.length < 6 && !keys.includes(key)) keys.push(key);
    };
    add(genre ?? '');
    for (const match of (tagList ?? '').matchAll(/"([^"]+)"|(\S+)/g)) add(match[1] ?? match[2] ?? '');
    return keys;
}

export function genreKeys(genre: string): string[] {
    const groups = [
        ['witchhouse', 'wtchhs', 'witchhaus'],
        ['drumandbass', 'dnb', 'drumnbass', 'dandb'],
        ['rnb', 'randb', 'rhythmandblues'],
        ['lofi', 'lowfi'],
        ['ukgarage', 'ukg'],
        ['hiphop', 'hiphoprap'],
    ];
    const key = normalizeTag(genre);
    if (!key) return [];
    const group = groups.find((list) => list.includes(key));
    return group ? [key, ...group.filter((item) => item !== key)] : [key];
}

// Несколько жанров через запятую, слэш, точку с запятой или черту: «techno / dark techno, industrial».
// & не разделитель, иначе развалятся drum & bass и r&b
export function parseGenres(input: string): string[] {
    const list: string[] = [];
    const seen = new Set<string>();
    for (const part of input.toLowerCase().split(/[/,;|]+/)) {
        const genre = part.replace(/\s+/g, ' ').trim().slice(0, 40);
        const key = normalizeTag(genre);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        list.push(genre);
        if (list.length >= 4) break;
    }
    return list;
}
export function formatGenres(list: string[]): string {
    return list.join(' / ');
}
export function genreKeysFor(genre: string | null): string[] {
    return genre ? [...new Set(parseGenres(genre).flatMap(genreKeys))] : [];
}

// Ссылка на soundcloud.com в список, карточку или шапку: трек, артист или плейлист (в том числе системный)
export function classifyLink(href: string, base: string): { kind: WaveLinkKind; url: string } | null {
    const reserved = [
        'sets', 'likes', 'tracks', 'albums', 'reposts', 'popular-tracks', 'followers', 'following', 'comments', 'spotlight', 'toptracks',
        'you', 'discover', 'search', 'feed', 'stream', 'upload', 'settings', 'messages', 'notifications', 'charts', 'stations', 'pages',
        'terms-of-use', 'mobile', 'people', 'jobs', 'imprint', 'pro', 'signin', 'logout', 'artists', 'creators', 'tags', 'recommended',
    ];
    let url: URL;
    try {
        url = new URL(href, base);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' || url.hostname !== 'soundcloud.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const clean = url.origin + '/' + parts.join('/');
    if (parts.length === 1 && !reserved.includes(parts[0])) return { kind: 'artist', url: clean };
    if (parts.length === 2 && !reserved.includes(parts[0]) && !reserved.includes(parts[1])) return { kind: 'track', url: clean };
    if (parts.length === 3 && parts[1] === 'sets' && (parts[0] === 'discover' || !reserved.includes(parts[0]))) return { kind: 'playlist', url: clean };
    return null;
}
// Та же форма ссылки, что хранит main: без запроса, хвоста и регистра
export function canonicalUrl(value: string | undefined): string {
    if (!value) return '';
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === 'soundcloud.com' ? (url.origin + url.pathname).replace(/\/+$/, '').toLowerCase() : '';
    } catch {
        return '';
    }
}

// Путь трека /user/track для журнала; у приватного трека в адресе третьим сегментом секретная ссылка, такой путь не пишется
export function trackPath(value: unknown): string {
    const url = canonicalUrl(typeof value === 'string' ? value : undefined);
    const path = url ? new URL(url).pathname : '';
    return /^\/[a-z0-9_-]+\/[a-z0-9_-]+$/.test(path) ? path : '';
}

export function trackMatchesGenre(track: WaveTrack, keys: string[]): boolean {
    if (!keys.length) return true;
    const parts: string[] = [];
    const genre = track.genre ?? '';
    parts.push(normalizeTag(genre));
    for (const part of genre.split(/[/,&|+;]/)) parts.push(normalizeTag(part));
    for (const match of (track.tag_list ?? '').matchAll(/"([^"]+)"|(\S+)/g)) parts.push(normalizeTag(match[1] ?? match[2] ?? ''));
    // Короткий ключ только целиком: rap не должен находиться в trap
    return parts.some((part) => part && keys.some((key) => part === key || (key.length >= 5 && part.includes(key))));
}

export function trackArtist(track: WaveTrack): number {
    return track.user_id ?? track.user?.id ?? 0;
}

// Треки Go+ (SNIP) играют 30 секунд на бесплатном тарифе, BLOCK не играет вовсе, длинные миксы волну не держат
export function isWaveEligible(track: WaveTrack): boolean {
    if (!track || typeof track.id !== 'number' || (track.kind !== undefined && track.kind !== 'track')) return false;
    if (track.streamable === false || track.policy === 'SNIP' || track.policy === 'BLOCK') return false;
    const duration = track.full_duration || track.duration || 0;
    return duration >= 30000 && duration <= 15 * 60000;
}

export function acceptCandidate(track: WaveTrack, filter: WaveFilter): boolean {
    if (!isWaveEligible(track) || filter.taken.has(track.id) || filter.skippedArtists.has(trackArtist(track))) return false;
    if (filter.excludedTracks.has(track.id) || filter.excludedArtists.has(trackArtist(track))) return false;
    if (filter.mode === 'fresh') return !filter.heard.has(track.id) && !filter.liked.has(track.id);
    return !filter.recent.has(track.id);
}

// Перезаливки одного трека разными id: сравниваются артист и название без пометок в скобках
export function trackSignature(track: WaveTrack): string {
    const title = (track.title ?? '').toLowerCase().replace(/[([{][^)\]}]*[)\]}]/g, '');
    return trackArtist(track) + ':' + normalizeTag(title);
}

// Следующие треки из пула: артист не повторяется в окне из трёх последних, пул не меняется
export function pickSpaced(pool: WaveCandidate[], count: number, recentArtists: number[]): WaveCandidate[] {
    const picked: WaveCandidate[] = [];
    const rest = pool.slice();
    const window = recentArtists.slice(-3);
    while (picked.length < count && rest.length) {
        let index = rest.findIndex((item) => !window.includes(trackArtist(item.track)));
        if (index < 0) index = 0;
        const [item] = rest.splice(index, 1);
        picked.push(item);
        window.push(trackArtist(item.track));
        if (window.length > 3) window.shift();
    }
    return picked;
}

// Профиль вкуса из main: веса треков, артистов и тегов
export interface TasteMaps {
    artists: Map<number, number>;
    tags: Map<string, number>;
    tracks: Map<number, number>;
}
export interface TasteScore {
    score: number;
    track: number;
    artist: number;
    /** Средний вес известных тегов трека */
    tag: number;
    /** Самый любимый из тегов трека и его вес */
    tagKey: string;
    tagBest: number;
    /** У артиста есть история */
    known: boolean;
}
// Ответ main недоверенный: берутся только пары [id или ключ тега, конечное число]
export function tasteMaps(input: unknown): TasteMaps | null {
    if (!input || typeof input !== 'object') return null;
    const source = input as { artists?: unknown; tags?: unknown; tracks?: unknown };
    const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
    const isKey = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 80;
    const pairs = <K>(list: unknown, valid: (value: unknown) => value is K, limit: number): Map<K, number> => {
        const map = new Map<K, number>();
        if (!Array.isArray(list)) return map;
        for (const item of list.slice(0, limit))
            if (Array.isArray(item) && valid(item[0]) && typeof item[1] === 'number' && Number.isFinite(item[1])) map.set(item[0], item[1]);
        return map;
    };
    return { artists: pairs(source.artists, isId, 500), tags: pairs(source.tags, isKey, 300), tracks: pairs(source.tracks, isId, 1000) };
}
export function tasteScore(track: WaveTrack, taste: TasteMaps): TasteScore {
    const artistId = trackArtist(track);
    const own = taste.tracks.get(track.id) ?? 0;
    const artist = taste.artists.get(artistId) ?? 0;
    let sum = 0;
    let count = 0;
    let tagKey = '';
    let tagBest = 0;
    for (const key of tagKeys(track.genre, track.tag_list)) {
        const weight = taste.tags.get(key);
        if (weight === undefined) continue;
        sum += weight;
        count++;
        if (weight > tagBest) {
            tagBest = weight;
            tagKey = key;
        }
    }
    const tag = count ? sum / count : 0;
    return { score: own + artist + tag, track: own, artist, tag, tagKey, tagBest, known: taste.artists.has(artistId) };
}
// Порядок подборки по вкусу вместо перемешивания: взвешенная случайная выборка (чем выше оценка, тем раньше),
// треки с сильным минусом не берутся, не меньше 30% артистов без истории, чтобы волна не кормила сама себя
export function tasteOrder<T extends { track: WaveTrack }>(list: T[], taste: TasteMaps, random: () => number = Math.random): T[] {
    const keyed: Array<{ item: T; known: boolean; key: number }> = [];
    for (const item of list) {
        const score = tasteScore(item.track, taste);
        if (score.track <= -1) continue;
        const weight = Math.exp(Math.max(-3, Math.min(3, score.score)));
        keyed.push({ item, known: score.known, key: Math.log(Math.max(random(), 1e-12)) / weight });
    }
    keyed.sort((a, b) => b.key - a.key);
    const fresh = keyed.filter((entry) => !entry.known);
    const familiar = keyed.filter((entry) => entry.known);
    const ordered: T[] = [];
    let freshTaken = 0;
    while (fresh.length || familiar.length) {
        const needFresh = fresh.length > 0 && freshTaken < Math.floor(0.3 * (ordered.length + 1));
        const takeFresh = needFresh || !familiar.length || (fresh.length > 0 && fresh[0].key >= familiar[0].key);
        const next = takeFresh ? fresh.shift() : familiar.shift();
        if (!next) break;
        if (takeFresh) freshTaken++;
        ordered.push(next.item);
    }
    return ordered;
}
// Причина, когда трек поставила оценка: любимый артист или любимый тег. Похожее на зерно без явного вкуса не трогается
export function tasteReason(candidate: WaveCandidate, taste: TasteMaps): WaveReason | null {
    if (candidate.reason.kind !== 'similar' && candidate.reason.kind !== 'fresh') return null;
    const score = tasteScore(candidate.track, taste);
    const name = (candidate.track.user?.username ?? '').trim();
    if (name && score.artist >= 1 && score.artist >= score.tag) return { kind: 'tasteArtist', artist: name };
    if (!score.tagKey || score.tagBest < 1 || score.artist >= 0.3) return null;
    const labels = [candidate.track.genre ?? '', ...Array.from((candidate.track.tag_list ?? '').matchAll(/"([^"]+)"|(\S+)/g), (match) => match[1] ?? match[2] ?? '')];
    const label = labels.find((item) => normalizeTag(item) === score.tagKey);
    return label ? { kind: 'tasteTag', genre: label.trim().toLowerCase() } : null;
}

// Причина по вкусу только у заметной трети подборки: иначе с ростом журнала строка «почему» у всех одна и та же
export function applyTasteReasons(list: WaveCandidate[], taste: TasteMaps): void {
    const scored = list
        .map((candidate) => ({ candidate, score: tasteScore(candidate.track, taste).score }))
        .filter((entry) => entry.score >= 1)
        .sort((a, b) => b.score - a.score);
    for (const { candidate } of scored.slice(0, Math.ceil(list.length * 0.3))) {
        const reason = tasteReason(candidate, taste);
        if (reason) candidate.reason = reason;
    }
}

export function shuffleInPlace<T>(list: T[]): T[] {
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

// Самые частые жанры лайков для выпадающего списка, в том написании, что встречается чаще
export function topGenres(tracks: WaveTrack[], limit: number): string[] {
    const counts = new Map<string, { count: number; label: string }>();
    for (const track of tracks) {
        const label = (track.genre ?? '').trim().toLowerCase();
        const key = normalizeTag(label);
        if (!key || key.length < 2) continue;
        const entry = counts.get(key);
        if (entry) entry.count++;
        else counts.set(key, { count: 1, label });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit).map((entry) => entry.label);
}

export function fillText(template: string, values: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (all, name: string) => (name in values ? values[name] : all));
}

export function reasonText(reason: WaveReason, texts: WaveTexts): string {
    switch (reason.kind) {
        case 'similar': return fillText(texts.whySimilar, { seed: reason.seed });
        case 'fresh': return fillText(texts.whyFresh, { seed: reason.seed });
        case 'newArtist': return texts.whyNewArtist;
        case 'genreFresh': return fillText(texts.whyGenreFresh, { genre: reason.genre });
        case 'genrePopular': return fillText(texts.whyGenrePopular, { genre: reason.genre });
        case 'genreSimilar': return fillText(texts.whyGenreSimilar, { genre: reason.genre, seed: reason.seed });
        case 'seedTrack': return texts.whySeedTrack;
        case 'artistTrack': return fillText(texts.whyArtistTrack, { artist: reason.artist });
        case 'mood': return fillText(texts.whyMood, { seed: reason.seed, genre: reason.genre });
        case 'tasteArtist': return fillText(texts.whyTasteArtist, { artist: reason.artist });
        case 'tasteTag': return fillText(texts.whyTasteTag, { genre: reason.genre });
    }
}

// Настроение зёрен для запасного пути волны: их жанр и теги, а если их нет, самые частые жанры и теги
// среди похожих (включая отсеянные) в том написании, что встречается чаще
export function moodTags(seeds: WaveTrack[], around: WaveTrack[], limit: number): string[] {
    const labels = (track: WaveTrack): string[] => {
        const list = [(track.genre ?? '').trim()];
        for (const match of (track.tag_list ?? '').matchAll(/"([^"]+)"|(\S+)/g)) list.push((match[1] ?? match[2] ?? '').trim());
        return list.filter((label) => normalizeTag(label).length >= 2);
    };
    const count = (tracks: WaveTrack[]): string[] => {
        const counts = new Map<string, { count: number; spellings: Map<string, number> }>();
        for (const track of tracks)
            for (const label of new Set(labels(track).map((item) => item.toLowerCase()))) {
                const key = normalizeTag(label);
                const entry = counts.get(key) ?? { count: 0, spellings: new Map<string, number>() };
                entry.count++;
                entry.spellings.set(label, (entry.spellings.get(label) ?? 0) + 1);
                counts.set(key, entry);
            }
        return [...counts.values()]
            .sort((a, b) => b.count - a.count)
            .slice(0, limit)
            .map((entry) => [...entry.spellings].sort((a, b) => b[1] - a[1])[0][0]);
    };
    const own = count(seeds);
    return own.length ? own : count(around);
}

// Громкие мастеринги дают сплошной «штрихкод», поэтому динамика растягивается: 10-й и 99-й перцентили в 0..1
export function shapeSamples(samples: number[]): number[] {
    if (!samples.length) return [];
    const sorted = samples.slice().sort((a, b) => a - b);
    const low = sorted[Math.floor(sorted.length * 0.1)];
    const high = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] || 1;
    return samples.map((value) => 0.1 + 0.9 * Math.pow(Math.min(1, Math.max(0, (value - low) / (high - low || 1))), 1.4));
}

export function artworkUrl(track: WaveTrack, size: 't300x300' | 't500x500'): string {
    const url = track.artwork_url || track.user?.avatar_url || '';
    return /^https:\/\//.test(url) ? url.replace(/-large\.(jpg|png)/, '-' + size + '.$1') : '';
}

export function formatTime(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

// Дослушал, если ушёл не раньше чем за 15 секунд до конца
export function playEnd(duration: number, position: number): 'done' | 'skip' {
    return duration > 0 && position >= duration - 15000 ? 'done' : 'skip';
}
// Источник трека не из волны: тип очереди сайта (single, playlist, stream, history...)
export function siteSource(type: unknown): string {
    return 'site' + (typeof type === 'string' && /^[a-z][a-z_-]{0,23}$/i.test(type) ? ':' + type.toLowerCase() : '');
}

interface SiteSound {
    id: number;
    attributes?: Record<string, unknown>;
    isPlayable?(): boolean;
    isSnippetized?(): boolean;
    isBlocked?(): boolean;
    seek(ms: number): void;
    getMediaDuration?(): number;
    currentTime?(): number;
}
interface SiteQueueItem {
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
interface SitePlayer {
    getQueue(): SiteQueue;
    getQueueState(): { currentIndex: number };
    getCurrentQueueItem(): SiteQueueItem | null | undefined;
    getCurrentSound(): SiteSound | null | undefined;
    replaceQueue(items: SiteQueueItem[], index: number): void;
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
interface WebpackRequire {
    c?: Record<string, { exports?: unknown } | undefined>;
}
interface WaveJournalApi {
    load(userId: number): Promise<unknown>;
    add(userId: number, ids: number[]): void;
}
interface WaveExclusionsApi {
    load(userId: number): Promise<unknown>;
    set(userId: number, kind: 'track' | 'artist' | 'later-track' | 'later-artist' | 'more', entry: object, excluded: boolean): Promise<unknown>;
}
interface WaveWindow extends Window {
    __disposeWave?: () => void;
    __scWaveExclusionsChanged?: () => void;
    __scWaveTakeSignals?: () => { userId: number; signals: PlaySignal[] };
    __scOpenTrack?: (path: string, navigate?: boolean) => Promise<boolean>;
    __scNavigate?: (path: string) => boolean;
    __scResolveTracks?: (ids: unknown) => Promise<{ asked: number[]; tracks: object[] } | null>;
    __scWhoAmI?: () => Promise<number>;
    // Кэш средних цветов обложек из плавности сайта (pageMotion), ключ это путь трека
    __scmCoverColor?: (key: string) => string | undefined;
    __scmLearnCover?: (key: string, url: string) => void;
    __scSiteTranslation?: { language?: string };
    soundcloudAPI?: {
        waveJournal?: WaveJournalApi;
        waveExclusions?: WaveExclusionsApi;
        waveTaste?: { load(userId: number): Promise<unknown> };
        waveSignals?: { add(userId: number, signals: PlaySignal[]): void };
        reportWaveEmpty?(counts: { seen: number; artistTracks: number; moodTags: number }): void;
        sendTrackMeta?(meta: TrackMeta): void;
        openHistory?(): void;
    };
}
interface WaveConfig {
    texts: Record<'ru' | 'en', WaveTexts>;
}

export function installWave(config: WaveConfig): void {
    const host = window as unknown as WaveWindow & Record<string, unknown>;
    host.__disposeWave?.();
    const T: WaveTexts = config.texts[host.__scSiteTranslation?.language === 'ru' ? 'ru' : 'en'];
    const BATCH = 10;
    const REFILL_AT = 4;
    const STORE_KEY = 'scDesktopWave';

    type State = 'idle' | 'loading' | 'playing' | 'empty' | 'error' | 'unavailable';
    interface Profile {
        userId: number;
        history: WaveTrack[];
        recent: Set<number>;
        heard: Set<number>;
        liked: Set<number>;
        likedTracks: WaveTrack[];
        knownArtists: Set<number>;
        loadedAt: number;
    }
    interface Cursor { query: Record<string, string | number> | null; done: boolean }

    let player: SitePlayer | null = null;
    let api: SiteApi | null = null;
    let SoundModel: SoundCtor | null = null;
    let disposed = false;
    let state: State = 'idle';
    let mode: WaveMode = 'similar';
    let genre: string | null = null;
    let recentGenres: string[] = [];
    try {
        const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') as { mode?: unknown; genre?: unknown; recentGenres?: unknown };
        if (saved.mode === 'fresh') mode = 'fresh';
        if (typeof saved.genre === 'string') genre = formatGenres(parseGenres(saved.genre)) || null;
        if (Array.isArray(saved.recentGenres)) recentGenres = saved.recentGenres.filter((item): item is string => typeof item === 'string').slice(0, 6);
    } catch (error) {
        console.warn('Волна: настройки не прочитаны', error);
    }
    const saveSettings = (): void => {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify({ mode, genre, recentGenres }));
        } catch (error) {
            console.warn('Волна: настройки не сохранены', error);
        }
    };

    let profile: Profile | null = null;
    let profilePromise: Promise<Profile> | null = null;
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
    const signatures = new Set<string>();
    // Сессия волны
    let active = false;
    let startedAt = 0;
    let fallbackBefore: boolean | null = null;
    // Автоплей сайта возвращён, потому что подборка кончилась
    let autoplayReleased = false;
    const ours = new WeakSet<SiteQueueItem>();
    const known = new Map<number, WaveCandidate>();
    const taken = new Set<number>();
    const skippedArtists = new Set<number>();
    const likedSeeds: WaveTrack[] = [];
    const recentArtists: number[] = [];
    let itemIndex = 900000;
    // Волна от трека, артиста или плейлиста из меню по ПКМ: зёрна вместо вкуса, жанр не действует.
    // own это треки самого артиста, они идут в подборку; derived это найденное, от него волна едет дальше
    interface Seed { kind: WaveLinkKind; title: string; tracks: WaveTrack[]; own: WaveTrack[] }
    let seed: Seed | null = null;
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
    interface Excluded { id: number; title: string; artist: string; url: string; until?: number }
    interface MoreEntry extends Excluded { artistId: number; genre: string; tags: string }
    type MarkKind = 'track' | 'artist' | 'later-track' | 'later-artist' | 'more';
    const excludedTracks = new Map<number, Excluded>();
    const excludedArtists = new Map<number, Excluded>();
    const laterTracks = new Map<number, Excluded>();
    const laterArtists = new Map<number, Excluded>();
    const moreTracks = new Map<number, MoreEntry>();
    let exclusionsPromise: Promise<void> | null = null;
    // Профиль вкуса из main: порядок подборки и причины, живёт 30 минут
    let taste: TasteMaps | null = null;
    let tasteAt = 0;
    let tastePromise: Promise<void> | null = null;
    // Слежение за текущим треком: журнал, пропуски и лайки
    let currentId = 0;
    let currentPosition = 0;
    let currentDuration = 0;
    let currentLiked = false;
    let jumped = false;
    // Что сейчас нарисовано на кнопке блока: играет или пауза
    let shownPlaying = false;
    const recorded = new Set<number>();
    const pendingJournal: number[] = [];
    let userId = 0;
    let journalTimer: ReturnType<typeof setTimeout> | undefined;
    // Журнал сигналов: одно событие на прослушивание любого трека, не только из волны
    interface Play { signal: PlaySignal; lastPosition: number; likedAtStart: boolean }
    let play: Play | null = null;
    const pendingSignals: PlaySignal[] = [];
    let signalsTimer: ReturnType<typeof setTimeout> | undefined;
    // Сведения о текущем треке для карточки Discord: уходят в main, только когда поменялись
    let sentMeta = '';
    // «Встряхнуть»: зёрна прошлой подборки не берутся, пока хватает других
    const staleSeeds = new Set<number>();

    const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    // Модель трека сайта может оказаться без методов (чужой элемент очереди): тогда длительность и позиция нулевые
    const durationOf = (sound: SiteSound | null | undefined): number => (typeof sound?.getMediaDuration === 'function' ? sound.getMediaDuration() || 0 : 0);
    const positionOf = (sound: SiteSound | null | undefined): number => (typeof sound?.currentTime === 'function' ? sound.currentTime() || 0 : 0);

    function findRequire(): WebpackRequire[] {
        const found: WebpackRequire[] = [];
        const probe = '__scWave' + Date.now() + Math.random().toString(36).slice(2);
        const legacy = host.webpackJsonp as { push(chunk: unknown): unknown } | undefined;
        if (Array.isArray(legacy)) legacy.push([[], { [probe]: (_module: unknown, _exports: unknown, require: WebpackRequire) => { found.push(require); } }, [[probe]]]);
        return found.sort((a, b) => Object.keys(b.c ?? {}).length - Object.keys(a.c ?? {}).length);
    }
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

    async function call(name: string, path: object, query: object): Promise<unknown> {
        if (!api) throw new Error('API сайта не найден');
        const result = await Promise.race([api.callEndpoint(name, path, query), wait(15000).then(() => { throw new Error('Тайм-аут ' + name); })]);
        return result.body;
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
        await Promise.all([
            call('playHistoryTracks', {}, { limit: 200 }).then((body) => {
                for (const entry of collection(body)) {
                    const track = asTrack((entry as { track?: unknown }).track);
                    if (track) history.push(track);
                }
            }).catch((error: unknown) => console.warn('Волна: история не загружена', error)),
            (async () => {
                let query: Record<string, string | number> | null = { limit: 200 };
                for (let page = 0; query && page < 25; page++) {
                    const body = await call('soundLikesIds', {}, query);
                    for (const id of collection(body)) if (typeof id === 'number') liked.add(id);
                    query = nextQuery(body);
                }
                const first = [...liked].slice(0, 50);
                if (first.length) likedTracks = collection(await call('trackBatch', {}, { ids: first.join(',') })).map(asTrack).filter((track): track is WaveTrack => !!track);
            })().catch((error: unknown) => console.warn('Волна: лайки не загружены', error)),
            (async () => {
                const loaded = userId ? await host.soundcloudAPI?.waveJournal?.load(userId) : [];
                if (Array.isArray(loaded)) journal = loaded.filter((id): id is number => typeof id === 'number');
            })().catch((error: unknown) => console.warn('Волна: журнал не загружен', error)),
        ]);
        const recent = new Set(history.map((track) => track.id));
        const heard = new Set([...journal, ...recent]);
        const knownArtists = new Set([...history, ...likedTracks].map(trackArtist));
        return { userId, history, recent, heard, liked, likedTracks, knownArtists, loadedAt: Date.now() };
    }
    function ensureProfile(): Promise<Profile> {
        if (profile && Date.now() - profile.loadedAt < 30 * 60000) return Promise.resolve(profile);
        profilePromise ??= loadProfile().then((loaded) => {
            // Прослушанное в этой сессии не теряется при обновлении профиля
            if (profile) for (const id of profile.heard) loaded.heard.add(id);
            profile = loaded;
            return loaded;
        }).finally(() => { profilePromise = null; });
        return profilePromise;
    }

    function fillExcluded(map: Map<number, Excluded>, input: unknown): void {
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
        })().catch((error: unknown) => {
            exclusionsPromise = null;
            console.warn('Волна: исключения не загружены', error);
        });
        return exclusionsPromise;
    }
    // Не загрузился: подборка идёт перемешиванием, следующий подбор попробует снова
    function ensureTaste(): Promise<void> {
        if (taste && Date.now() - tasteAt < 30 * 60000) return Promise.resolve();
        tastePromise ??= (async () => {
            const id = await ensureUser();
            const maps = tasteMaps(id ? await host.soundcloudAPI?.waveTaste?.load(id) : null);
            if (maps) {
                taste = maps;
                tasteAt = Date.now();
            }
        })().catch((error: unknown) => {
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
    const isExcluded = (track: WaveTrack): boolean =>
        excludedTracks.has(track.id) || excludedArtists.has(trackArtist(track)) || marked(laterTracks, track.id) || marked(laterArtists, trackArtist(track));
    const liveKeys = (map: Map<number, Excluded>): number[] => [...map.keys()].filter((id) => marked(map, id));
    // «Больше такого» как зерно волны: для похожих хватает id, для жанра и причины нужны название и метки
    const moreSeeds = (): WaveTrack[] =>
        [...moreTracks.values()].map((entry) => ({
            id: entry.id, kind: 'track', title: entry.title, genre: entry.genre, tag_list: entry.tags, permalink_url: entry.url,
            user_id: entry.artistId || undefined, user: { id: entry.artistId || undefined, username: entry.artist },
        }));

    function currentFilter(): WaveFilter {
        const p = profile;
        return {
            mode, taken, recent: p?.recent ?? new Set(), heard: p?.heard ?? new Set(), liked: p?.liked ?? new Set(), skippedArtists,
            excludedTracks: new Set([...excludedTracks.keys(), ...liveKeys(laterTracks)]),
            excludedArtists: new Set([...excludedArtists.keys(), ...liveKeys(laterArtists)]),
        };
    }
    function seedsFor(keys: string[]): WaveTrack[] {
        const p = profile;
        if (!p) return [];
        const mixed: WaveTrack[] = [...likedSeeds];
        if (seed) mixed.push(...seed.tracks, ...derivedSeeds);
        else {
            const history = p.history.slice(0, 30);
            // «Больше такого» идёт вперёд лайков сайта
            const likes = [...moreSeeds(), ...p.likedTracks].slice(0, 50);
            for (let i = 0; i < Math.max(history.length, likes.length); i++) {
                if (history[i]) mixed.push(history[i]);
                if (likes[i]) mixed.push(likes[i]);
            }
        }
        const seen = new Set<number>();
        // Трек, артист или плейлист выбраны руками: их треки остаются зёрнами, даже если артист пропущен или скрыт.
        // Отметки действуют на подборку, иначе волна от такого трека играла бы его одного
        const chosen = new Set(seed?.tracks.map((track) => track.id) ?? []);
        const list = mixed.filter((track) => {
            if (seen.has(track.id) || usedSeeds.has(track.id)) return false;
            if (!chosen.has(track.id) && (skippedArtists.has(trackArtist(track)) || isExcluded(track))) return false;
            seen.add(track.id);
            return !!seed || trackMatchesGenre(track, keys);
        });
        const fresh = list.filter((track) => !staleSeeds.has(track.id));
        // Встряхивали столько раз, что свежих зёрен не осталось: круг начинается заново
        if (fresh.length || !staleSeeds.size) return fresh;
        staleSeeds.clear();
        return list;
    }
    function accept(list: WaveCandidate[], candidate: WaveCandidate, filter: WaveFilter): boolean {
        const signature = trackSignature(candidate.track);
        if (!acceptCandidate(candidate.track, filter) || signatures.has(signature)) return false;
        signatures.add(signature);
        taken.add(candidate.track.id);
        list.push(candidate);
        return true;
    }
    async function genrePage(source: 'recent' | 'search', tag: string): Promise<WaveTrack[]> {
        const cursor = cursors.get(source + ':' + tag) ?? { query: null, done: false };
        if (cursor.done) return [];
        const body = source === 'recent'
            ? await call('recentTracks', { tag }, cursor.query ?? { limit: 50 })
            : await call('searchCategory', { category: 'tracks' }, cursor.query ?? { q: '*', 'filter.genre_or_tag': tag, limit: 50 });
        const next = nextQuery(body);
        cursors.set(source + ':' + tag, { query: next, done: !next });
        return collection(body).map(asTrack).filter((track): track is WaveTrack => !!track);
    }
    // Корни для станции трека: зёрна и найденное от них, ещё не использованные; выбранные руками зёрна отметки не отсекают
    const stationRoots = (): WaveTrack[] =>
        seed
            ? [
                ...seed.tracks.filter((track) => !usedStations.has(track.id)),
                ...derivedSeeds.filter((track) => !usedStations.has(track.id) && !isExcluded(track) && !skippedArtists.has(trackArtist(track))),
            ]
            : [];
    // Станция трека это системный плейлист, из него сайт берёт свой автоплей
    async function stationTracks(from: WaveTrack): Promise<WaveTrack[]> {
        return playlistTracks(await resolveUrl('https://soundcloud.com/discover/sets/track-stations:' + from.id));
    }
    // Один проход по источникам: похожие на три зерна и, если выбраны жанры, свежее и популярное в каждом.
    // У волны от трека, артиста или плейлиста зёрна идут по порядку и жанр не действует
    async function gatherRound(): Promise<number> {
        const own = generation;
        const p = await ensureProfile();
        await Promise.all([ensureExclusions(), ensureTaste()]);
        if (own !== generation) return 0;
        const tags = !seed && genre ? parseGenres(genre) : [];
        const keys = tags.length ? genreKeysFor(genre) : [];
        const seeds = seedsFor(keys);
        let picked: WaveTrack[];
        if (seed) picked = seeds.slice(0, 3);
        else {
            picked = likedSeeds.filter((track) => seeds.includes(track)).slice(0, 1);
            const rest = seeds.filter((track) => !picked.includes(track)).slice(0, 12);
            shuffleInPlace(rest);
            picked.push(...rest.slice(0, 3 - picked.length));
        }
        for (const track of picked) usedSeeds.add(track.id);
        const found: WaveCandidate[] = [];
        const filter = currentFilter();
        if (seed && !ownAdded) {
            ownAdded = true;
            for (const track of seed.own) accept(found, { track, reason: { kind: 'artistTrack', artist: seed.title } }, filter);
        }
        // Всё, что пришло из похожих и станции, включая отсеянное: по нему считается настроение запасного пути
        const observed: WaveTrack[] = [];
        // Похожее на from: причина по жанру или режиму; у волны от трека найденное становится зерном дальше
        const take = (track: WaveTrack, from: WaveTrack): void => {
            observed.push(track);
            if (!trackMatchesGenre(track, keys)) return;
            const seedTitle = (from.title ?? '').trim() || '…';
            const matched = tags.find((tag) => trackMatchesGenre(track, genreKeys(tag)));
            const reason: WaveReason = matched
                ? { kind: 'genreSimilar', genre: matched, seed: seedTitle }
                : mode === 'fresh' && !p.knownArtists.has(trackArtist(track))
                    ? { kind: 'newArtist' }
                    : { kind: mode === 'fresh' ? 'fresh' : 'similar', seed: seedTitle };
            if (accept(found, { track, reason }, filter) && seed && derivedSeeds.length < 100) derivedSeeds.push(track);
        };
        let failures = 0;
        const tasks: Promise<void>[] = picked.map((from) =>
            call('relatedSounds', { track_id: from.id }, { limit: 50 }).then((body) => {
                for (const value of collection(body)) {
                    const track = asTrack(value);
                    if (track) take(track, from);
                }
            }).catch((error: unknown) => {
                failures++;
                // Зерно без ответа можно взять в следующий раз
                usedSeeds.delete(from.id);
                console.warn('Волна: похожие не загружены', error);
            }),
        );
        for (const tag of tags)
            for (const source of ['recent', 'search'] as const)
                tasks.push(genrePage(source, tag).then((tracks) => {
                    for (const track of tracks) accept(found, { track, reason: { kind: source === 'recent' ? 'genreFresh' : 'genrePopular', genre: tag } }, filter);
                }).catch((error: unknown) => { failures++; console.warn('Волна: жанр не загружен', error); }));
        await Promise.all(tasks);
        if (own !== generation) return 0;
        // У маленьких артистов похожие замкнуты на их же треки (замер 23.09.2026: «Steel Lullaby» дал 4 трека по кругу),
        // тогда волна идёт по станции трека: там десятки других артистов
        const root = seed && found.length < 3 ? stationRoots()[0] : undefined;
        if (root) {
            usedStations.add(root.id);
            try {
                for (const track of await stationTracks(root)) take(track, root);
            } catch (error) {
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
                    const own = artist ? await artistOwnTracks(artist) : [];
                    artistCount = own.length;
                    for (const track of own) accept(found, { track, reason: { kind: 'artistTrack', artist: artistName(first) || seed.title } }, filter);
                } catch (error) {
                    console.warn('Волна: треки артиста не загружены', error);
                }
                if (own !== generation) return 0;
            }
            fallbackMood ??= moodTags(seed.tracks, observed, 2);
            const moodTasks = fallbackMood.flatMap((tag) => (['recent', 'search'] as const).map((source) =>
                genrePage(source, tag).then((tracks) => {
                    for (const track of tracks) accept(found, { track, reason: { kind: 'mood', seed: seed?.title ?? '…', genre: tag } }, filter);
                }).catch((error: unknown) => console.warn('Волна: настроение не загружено', error))));
            await Promise.all(moodTasks);
            if (own !== generation) return 0;
        }
        if (tasks.length && failures === tasks.length && !found.length) throw new Error('Источники волны не ответили');
        // По вкусу, если профиль есть; без него как раньше, перемешиванием
        const current = taste;
        if (current) {
            applyTasteReasons(found, current);
            pool.push(...tasteOrder(found, current));
        } else pool.push(...shuffleInPlace(found));
        const pagesLeft = (list: string[]): boolean => list.some((tag) => (['recent', 'search'] as const).some((source) => !cursors.get(source + ':' + tag)?.done));
        const sourcesLeft = seedsFor(keys).length > 0 || stationRoots().length > 0 || pagesLeft(tags) || pagesLeft(fallbackMood ?? []);
        if (!found.length && !sourcesLeft) exhausted = true;
        return found.length;
    }
    function ensurePool(need: number): Promise<void> {
        if (pool.length >= need || exhausted) return Promise.resolve();
        if (!gathering) {
            const own = generation;
            const run = (async () => {
                for (let round = 0; round < 4 && pool.length < need && !exhausted && !disposed && own === generation; round++) await gatherRound();
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
    function takeFromPool(count: number): WaveCandidate[] {
        const picked = pickSpaced(pool, count, recentArtists);
        pool = pool.filter((item) => !picked.includes(item));
        for (const item of picked) {
            recentArtists.push(trackArtist(item.track));
            if (recentArtists.length > 6) recentArtists.shift();
        }
        return picked;
    }
    function resetGeneration(): void {
        generation++;
        pool = [];
        preview = [];
        exhausted = false;
        gathering = null;
        ownAdded = false;
        artistFallbackDone = false;
        fallbackMood = null;
        seenCount = 0;
        artistCount = 0;
        usedSeeds.clear();
        usedStations.clear();
        cursors.clear();
        signatures.clear();
        taken.clear();
        for (const candidate of known.values()) taken.add(candidate.track.id);
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
            known.set(candidate.track.id, candidate);
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
        skippedArtists.clear();
        const p = player;
        if (p && fallbackBefore !== null && p.getState('fallbackEnabled') === false) p.toggleState('fallbackEnabled', fallbackBefore);
        fallbackBefore = null;
        state = 'idle';
        resetGeneration();
        if (isVisible()) void preparePreview();
        else render();
    }
    // Подборка кончилась, а треков волны впереди нет: после последнего играет автоплей SoundCloud, если он был включён.
    // Его станция сменит очередь, и волна закончится сама
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
            const added = makeItems(takeFromPool(BATCH));
            if (added.length) {
                player.getQueue().add(added);
                holdAutoplay(player);
            } else if (exhausted && aheadOfCurrent() === 0) releaseAutoplay(player);
        } catch (error) {
            console.warn('Волна: догрузка не удалась', error);
        } finally {
            refilling = false;
        }
        render();
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
    function applySettings(nextMode: WaveMode, nextGenre: string | null): void {
        mode = nextMode;
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
        // Показанное и сыгранное не возвращается и другой версией того же трека
        for (const track of [...shown, ...[...known.values()].map((candidate) => candidate.track)]) signatures.add(trackSignature(track));
        if (active) void restartAhead();
        else void preparePreview();
    }

    function journal(id: number): void {
        if (!id || recorded.has(id) || recorded.size > 5000) return;
        recorded.add(id);
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
    function waveLabel(): string {
        if (seed) return fillText(seed.kind === 'track' ? T.seedTrack : seed.kind === 'artist' ? T.seedArtist : T.seedPlaylist, { seed: seed.title });
        return [T.wave, mode === 'similar' ? T.similar : T.fresh, genre ?? ''].filter(Boolean).join(' · ');
    }
    function fromWave(item: SiteQueueItem | null | undefined): boolean {
        return active && !!item && ours.has(item);
    }
    function publishMeta(sound: SiteSound): void {
        const attrs = sound.attributes ?? {};
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

    function beginPlay(sound: SiteSound): void {
        const attrs = sound.attributes ?? {};
        const item = player?.getCurrentQueueItem();
        const candidate = known.get(sound.id);
        const waveItem = fromWave(item) && !!candidate;
        play = {
            signal: {
                at: Date.now(),
                id: sound.id,
                artist: numberOf(attrs.user_id) || numberOf((attrs.user as { id?: unknown } | undefined)?.id),
                dur: durationOf(sound) || numberOf(attrs.full_duration) || numberOf(attrs.duration),
                pos: 0,
                heard: 0,
                end: 'skip',
                source: waveItem ? 'wave:' + (seed ? seed.kind : mode) : siteSource(item?.sourceInfo?.type),
                why: waveItem && candidate ? candidate.reason.kind : '',
                liked: currentLiked,
                likedNow: false,
                disliked: false,
                hiddenArtist: false,
                genre: textOf(attrs.genre, 80),
                tags: textOf(attrs.tag_list, 300),
                v: 2,
                tz: -new Date().getTimezoneOffset(),
                title: textOf(attrs.title, 300),
                artistName: textOf((attrs.user as { username?: unknown } | undefined)?.username, 200),
                path: trackPath(attrs.permalink_url),
                artwork: textOf(attrs.artwork_url, 400),
            },
            lastPosition: positionOf(sound),
            likedAtStart: currentLiked,
        };
    }
    function finishPlay(end?: PlaySignal['end']): void {
        const current = play;
        play = null;
        // Трек сменили раньше, чем он прозвучал секунду: сигнала нет
        if (!current || current.signal.heard < 1000) return;
        const signal = current.signal;
        signal.end = end ?? playEnd(signal.dur, signal.pos);
        signal.likedNow = signal.liked && !current.likedAtStart;
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
        // Трек на повторе: позиция вернулась в начало после конца, это новое прослушивание
        if (signal.dur && current.lastPosition >= signal.dur - 5000 && position < 5000) {
            finishPlay('done');
            beginPlay(sound);
            return;
        }
        const delta = position - current.lastPosition;
        if (playing && delta > 0 && delta <= 3000) signal.heard += delta;
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
        } catch (error) {
            console.warn('Волна: сигналы не записаны', error);
        }
    }

    // Раз в секунду: журнал слышанного, пропуски, лайки, конец волны и догрузка
    function tick(): void {
        const p = player;
        if (!p || disposed) return;
        const sound = p.getCurrentSound();
        const id = sound?.id ?? 0;
        if (id !== currentId) {
            const previous = known.get(currentId);
            // Пропуск: трек волны сменился в первые 30 секунд не по клику в блоке и не в конце.
            // Трек, с которого волна началась, выбран руками: его пропуск артиста не убирает
            if (active && previous && previous.reason.kind !== 'seedTrack' && !jumped && currentPosition < 30000 && currentDuration - currentPosition > 10000) {
                skippedArtists.add(trackArtist(previous.track));
                pool = pool.filter((item) => !skippedArtists.has(trackArtist(item.track)));
            }
            jumped = false;
            finishPlay();
            currentId = id;
            currentPosition = 0;
            currentDuration = durationOf(sound);
            currentLiked = likeButton()?.classList.contains('sc-button-selected') ?? false;
            if (sound) beginPlay(sound);
            render();
        } else if (sound) {
            currentPosition = positionOf(sound);
            if (currentPosition >= 10000) journal(id);
            const liked = likeButton()?.classList.contains('sc-button-selected') ?? false;
            if (liked !== currentLiked) {
                currentLiked = liked;
                const candidate = known.get(id);
                if (liked && candidate && !likedSeeds.includes(candidate.track)) likedSeeds.unshift(candidate.track);
                updateLike();
            }
            trackPlay(sound, p.isPlaying());
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

    // ===== Волна от трека, артиста и плейлиста, отметки «Не нравится» =====
    /** Что под курсором при ПКМ: ссылка, артист трека (если виден) и сам трек, если он уже известен волне */
    interface MenuTarget { kind: WaveLinkKind; url: string; artistUrl: string; track?: WaveTrack }
    interface Artist { id: number; username: string; url: string }

    const resolved = new Map<string, Promise<unknown>>();
    function resolveUrl(url: string): Promise<unknown> {
        const key = canonicalUrl(url) || url;
        let found = resolved.get(key);
        if (!found) {
            found = call('resolve', {}, { url });
            resolved.set(key, found);
            if (resolved.size > 100) resolved.delete(resolved.keys().next().value as string);
            // Неудачный ответ не кешируется: следующий клик спросит снова
            void found.catch(() => resolved.delete(key));
        }
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
    // Топ артиста, у кого топ короче пяти треков, ещё и последние загрузки
    async function artistOwnTracks(id: number): Promise<WaveTrack[]> {
        let list = tracksOf(await call('userToptracks', { id }, { limit: 20 }));
        if (list.length < 5) list = list.concat(tracksOf(await call('userTracks', { id }, { limit: 30 })));
        return uniqueTracks(list).filter(isWaveEligible);
    }
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
        const request = ++seedRequest;
        try {
            await Promise.all([ensureProfile(), ensureExclusions()]);
            const loaded = await loadSeed(kind, target);
            if (request !== seedRequest || disposed) return;
            if (!loaded?.seed.tracks.length) {
                showToast(T.toastEmpty);
                return;
            }
            seed = loaded.seed;
            derivedSeeds = [];
            // Лайки прошлой волны тянули бы новую в сторону, её пропуски отсекали бы артистов новой
            likedSeeds.length = 0;
            skippedArtists.clear();
            popOpen = false;
            staleSeeds.clear();
            resetGeneration();
            const first = loaded.first;
            // Стартовый трек встанет первым или уже играет: станция и треки артиста не должны вернуть его ещё раз
            if (first) {
                taken.add(first.id);
                signatures.add(trackSignature(first));
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
        } catch (error) {
            if (request !== seedRequest) return;
            console.warn('Волна: не удалось начать волну', error);
            showToast(T.toastFailed);
        }
    }
    // Переход внутри сайта без перезагрузки: клик по ссылке ловит роутер сайта
    function navigate(path: string): boolean {
        if (typeof path !== 'string' || !/^\/[a-z0-9_-]{1,100}(\/[a-z0-9_-]{1,255})?$/.test(path)) return false;
        if (location.pathname === path) return true;
        const link = document.createElement('a');
        link.href = path;
        document.body.append(link);
        link.click();
        link.remove();
        return true;
    }
    // Ссылка «открыть в клиенте» из Discord: переход на страницу трека внутри сайта без перезагрузки и сразу воспроизведение;
    // страница истории включает трек, не уводя сайт со своей страницы.
    // false значит «сайт ещё не готов, спроси позже», true значит «сделано или повторять бессмысленно»
    async function openTrack(path: string, go = true): Promise<boolean> {
        if (!player || !SoundModel || !api) return false;
        if (!/^\/[a-z0-9_-]{1,100}\/[a-z0-9_-]{1,255}$/.test(path)) return true;
        if (go) navigate(path);
        let track: WaveTrack | null;
        try {
            track = asTrack(await resolveUrl('https://soundcloud.com' + path));
        } catch (error) {
            console.warn('Волна: трек по ссылке не найден', error);
            return true;
        }
        const Item = player.getQueue().model;
        if (!track || (track.kind && track.kind !== 'track') || !Item) return true;
        const sound = new SoundModel(track, { parse: true });
        if ((sound.isPlayable && !sound.isPlayable()) || sound.isBlocked?.()) return true;
        const item = new Item({}, { sound, originalModel: sound, queryPosition: 0, sourceInfo: { type: 'single' }, index: 0 });
        item.release?.();
        player.replaceQueue([item], 0);
        player.playCurrent({ userInitiated: true });
        return true;
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
        skippedArtists.clear();
        staleSeeds.clear();
        resetGeneration();
        if (active) void restartAhead();
        else if (isVisible()) void preparePreview();
        else { state = 'idle'; render(); }
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
            // Артист и метки трека нужны main только для «Больше такого»: по ним учится модель вкуса
            const payload = kind === 'more' ? entry : { id: entry.id, title: entry.title, artist: entry.artist, url: entry.url };
            const saved = id ? await host.soundcloudAPI?.waveExclusions?.set(id, kind, payload, excluded) : false;
            if (saved !== true) {
                showToast(T.toastNotSaved);
                return;
            }
            const maps: Record<MarkKind, Map<number, Excluded>> = { track: excludedTracks, artist: excludedArtists, 'later-track': laterTracks, 'later-artist': laterArtists, more: moreTracks };
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
            if (kind === 'more') {
                // Профиль вкуса пересчитается к следующему подбору, а сам трек сразу становится зерном, как лайк
                tasteAt = 0;
                if (excluded && marked && !likedSeeds.some((track) => track.id === entry.id)) likedSeeds.unshift(marked);
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
            showToast(toasts[kind][excluded ? 0 : 1]);
            if (excluded && kind !== 'more') purgeExcluded();
            else render();
        } catch (error) {
            console.warn('Волна: отметка не поставлена', error);
            showToast(T.toastFailed);
        }
    }
    // Исключённое уходит из подборки и из очереди впереди; играющий трек волны сразу сменяется следующим
    function purgeExcluded(): void {
        pool = pool.filter((item) => !isExcluded(item.track));
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

    // ===== Блок на главной =====
    const ICON: Record<string, string> = {
        play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
        pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
        chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>',
        heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35 10.55 20C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09A6 6 0 0 1 16.5 3C19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z"/></svg>',
        x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4l5.6 5.6L5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6z"/></svg>',
        shake: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z"/></svg>',
        more: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
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
        '.scw-body{display:flex;gap:24px}',
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
        '.scw-cover.collage{display:grid;grid-template-columns:1fr 1fr}',
        '.scw-cover.collage>span{position:relative;background:var(--scw-tile)}',
        // Картинка проявляется поверх подложки со средним цветом обложки
        '.scw-img{position:absolute;inset:0;background:center/cover;opacity:0;transition:opacity .2s cubic-bezier(.2,0,0,1)}',
        '.scw-img.on{opacity:1}',
        '.scw-up-h{color:var(--scw-muted);margin:32px 0 12px}',
        '.scw-tiles{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:28px}',
        // Ожидание: заготовки той же формы, полосы поверх строк, высота плиток не меняется
        '.scw-tiles.wait{pointer-events:none;animation:scw-fade .2s cubic-bezier(.2,0,0,1) var(--scw-wait-delay,150ms) backwards}',
        '.scw-tiles.wait.held{animation:none}',
        '@keyframes scw-fade{from{opacity:0}}',
        '.scw-tiles.wait .scw-t1,.scw-tiles.wait .scw-t2,.scw-tiles.wait .scw-t3{position:relative}',
        '.scw-tiles.wait .scw-t1::after,.scw-tiles.wait .scw-t2::after,.scw-tiles.wait .scw-t3::after{content:"";position:absolute;left:0;top:22%;bottom:22%;border-radius:3px;background:var(--scw-film)}',
        '.scw-tiles.wait .scw-t1::after{width:70%}',
        '.scw-tiles.wait .scw-t2::after{width:45%}',
        '.scw-tiles.wait .scw-t3::after{width:60%}',
        '.scw-tile{min-width:0;cursor:pointer}',
        '.scw-art{position:relative;aspect-ratio:1;background:var(--scw-tile);margin-bottom:8px}',
        '.scw-t1{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.scw-t2{color:var(--scw-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.scw-t3{font-size:12px;line-height:16px;color:var(--scw-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}',
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
        '@media (prefers-reduced-motion:reduce){.scw-tip,.scw-toast{transition:none}.scw-menu{animation:none}}',
        // «Меньше анимаций» в F1: без масштаба меню, растворения остаются
        'html.scm-reduce .scw-menu{animation:none}',
    ].join('\n');
    const MENU_ICON: Record<string, string> = {
        wave: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 6.5h1.5v3H1zM4 4.5h1.5v7H4zM7 2h1.5v12H7zM10 5h1.5v6H10zM13 7h1.5v2H13z"/></svg>',
        artist: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5a3.25 3.25 0 1 1 0 6.5 3.25 3.25 0 0 1 0-6.5zM2 14.5c0-3 2.7-5 6-5s6 2 6 5z"/></svg>',
        block: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm4.3 10.2A5.5 5.5 0 0 0 4.8 3.7zM3.7 4.8a5.5 5.5 0 0 0 7.5 7.5z"/></svg>',
        hide: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 1.5a3.25 3.25 0 1 1 0 6.5 3.25 3.25 0 0 1 0-6.5zM.5 14.5c0-3 2.7-5 6-5 1.1 0 2.2.2 3 .7v4.3zM10.5 11h5v1.5h-5z"/></svg>',
        undo: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.6 3.4 5.7 4.5 4.1 6H10a4.5 4.5 0 0 1 0 9H6v-1.5h4a3 3 0 0 0 0-6H4.1l1.6 1.5-1.1 1.1L1.2 6.75z"/></svg>',
        more: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.25 2h1.5v5.25H14v1.5H8.75V14h-1.5V8.75H2v-1.5h5.25z"/></svg>',
        later: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.34 2.02C6.59 1.82 2 6.42 2 12c0 5.52 4.48 10 10 10 3.71 0 6.93-2.02 8.66-5.02-7.51-.25-12.09-8.43-8.32-14.96z"/></svg>',
    };
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
    const waveforms = new Map<string, number[] | 'pending' | 'failed'>();

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
    const art = (node: HTMLElement, track: WaveTrack, size: 't300x300' | 't500x500'): void => {
        const url = artworkUrl(track, size);
        if (!url) return;
        const key = coverPath(track);
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
    const artistName = (track: WaveTrack): string => track.user?.username ?? '';
    const hintText = (): string => {
        if (seed) return fillText(seed.kind === 'track' ? T.seedTrack : seed.kind === 'artist' ? T.seedArtist : T.seedPlaylist, { seed: seed.title });
        const genres = genre ? parseGenres(genre) : [];
        const tail = genres.length ? fillText(genres.length > 1 ? T.hintGenres : T.hintGenre, { genre: formatGenres(genres) }) : '';
        return (mode === 'similar' ? T.hintSimilar : T.hintFresh) + tail;
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
            option.dataset.mode = value;
            seg.append(option);
        }
        const shakeButton = button('scw-icon', 'shake', T.shake, 'shake');
        shakeButton.title = T.shake;
        shakeButton.disabled = state === 'loading' || state === 'unavailable';
        const historyButton = button('scw-icon', 'history', T.history, 'history');
        historyButton.title = T.history;
        // Волна от трека, артиста или плейлиста: вместо жанра его название и крестик возврата к обычной волне
        if (seed) {
            const chip = el('div', 'scw-genre set');
            chip.title = seed.title;
            chip.append(el('span', 'scw-label', seed.title), button('scw-x', 'clear-seed', T.clearSeed, 'x'));
            controls.append(seg, chip, shakeButton, historyButton);
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
        const list = [...new Set([...recentGenres, ...fromLikes])].filter((item) => !query || item.includes(query));
        if (typed && !list.includes(typed)) pop.append(option(typed, typed));
        if (list.length) {
            pop.append(el('div', 'scw-pop-label', T.fromLikes));
            for (const item of list.slice(0, 10)) pop.append(option(item, item));
        }
        return pop;
    }
    let waitSince = 0;
    function renderTiles(): HTMLElement[] {
        if (state === 'empty' || state === 'error' || state === 'unavailable') return [];
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
                el('div', 'scw-t1', candidate?.track.title ?? '\u00a0'),
                el('div', 'scw-t2', candidate ? artistName(candidate.track) : '\u00a0'),
                el('div', 'scw-t3', candidate ? reasonText(candidate.reason, T) : '\u00a0'),
            );
            tiles.append(tile);
        }
        return [el('div', 'scw-up-h', active ? T.next : T.upFirst), tiles];
    }
    function render(): void {
        if (!section) return;
        hideTip();
        const focused = document.activeElement instanceof HTMLElement && section.contains(document.activeElement)
            ? document.activeElement.dataset.act ?? document.activeElement.dataset.mode ?? document.activeElement.dataset.role ?? ''
            : '';
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
        const lines = el('div', '');
        const current = currentCandidate();
        if (current) {
            lines.append(el('div', 'scw-track', current.track.title ?? ''), el('div', 'scw-artist', artistName(current.track)));
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
            like.setAttribute('aria-pressed', String(currentLiked));
            const later = button('scw-like', 'later', T.later, 'later');
            later.title = T.later;
            const more = button('scw-like', 'more', T.more, 'more');
            more.title = T.more;
            more.setAttribute('aria-pressed', String(moreTracks.has(current.track.id)));
            meta.append(el('div', 'scw-why', reasonText(current.reason, T)), later, more, like, el('div', 'scw-time'));
        } else if (state === 'empty') {
            if (genre) meta.append(textButton('drop-genre', T.dropGenre));
            if (mode === 'fresh') meta.append(textButton('to-similar', T.toSimilar));
        } else if (state === 'error') meta.append(textButton('retry', T.retry));
        info.append(top, canvas, meta);
        const cover = el('div', 'scw-cover');
        if (current) art(cover, current.track, 't500x500');
        else {
            cover.classList.add('collage');
            for (let i = 0; i < 4; i++) {
                const cell = el('span', '');
                if (state === 'idle' && preview[i]) art(cell, preview[i].track, 't300x300');
                cover.append(cell);
            }
        }
        body.append(info, cover);
        section.append(body, ...renderTiles());
        if (focused) {
            const again = section.querySelector<HTMLElement>('[data-act="' + focused + '"],[data-mode="' + focused + '"],[data-role="' + focused + '"]');
            again?.focus();
            if (again instanceof HTMLInputElement) again.setSelectionRange(again.value.length, again.value.length);
        }
        paint();
    }
    function updateLike(): void {
        const like = section?.querySelector('.scw-like');
        like?.setAttribute('aria-pressed', String(currentLiked));
    }

    function samplesFor(track: WaveTrack | undefined): number[] | null {
        const url = track?.waveform_url;
        if (!url || !/^https:\/\/wave\.sndcdn\.com\//.test(url)) return null;
        const cached = waveforms.get(url);
        if (Array.isArray(cached)) return cached;
        if (cached) return null;
        waveforms.set(url, 'pending');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        fetch(url, { signal: controller.signal, credentials: 'omit' })
            .then((response) => (response.ok ? response.json() : Promise.reject(new Error('HTTP ' + response.status))))
            .then((data: { samples?: unknown }) => {
                const samples = Array.isArray(data.samples) ? data.samples.filter((value): value is number => typeof value === 'number') : [];
                if (waveforms.size > 60) waveforms.delete(waveforms.keys().next().value as string);
                waveforms.set(url, samples.length ? shapeSamples(samples) : 'failed');
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
            const barHeight = Math.max(1, Math.round(value * (top - 2)));
            const x = i * step;
            const fraction = (i + 0.5) / bars;
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
        const target = event.target instanceof Element ? event.target.closest('.scw-tile, .scw-track, .scw-artist, .scw-why') : null;
        if (target === tipFor) return;
        hideTip();
        if (!target) return;
        const lines = target.classList.contains('scw-tile') ? [...target.querySelectorAll('.scw-t1, .scw-t2, .scw-t3')] : [target];
        if (!lines.some(cut)) return;
        tipFor = target;
        tipTimer = setTimeout(() => {
            tip.textContent = '';
            lines.forEach((line, index) => tip.append(el(index ? 'span' : 'b', '', line.textContent ?? '')));
            if (!tip.isConnected) document.body.append(tip);
            const anchor = target.classList.contains('scw-tile') ? target.querySelector('.scw-art') ?? target : target;
            const rect = anchor.getBoundingClientRect();
            const left = Math.min(Math.max(8, rect.left + rect.width / 2 - tip.offsetWidth / 2), window.innerWidth - tip.offsetWidth - 8);
            const top = target.classList.contains('scw-tile') ? rect.bottom - tip.offsetHeight - 8 : rect.top - tip.offsetHeight - 6;
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
        const control = target.closest<HTMLElement>('[data-act], [data-mode], [data-genre]');
        if (!control) {
            if (popOpen && !target.closest('.scw-pop')) { popOpen = false; render(); }
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
                if (popOpen) section.querySelector<HTMLInputElement>('.scw-pop input')?.focus();
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
            case 'later': {
                const current = currentCandidate();
                if (!current) return;
                // «Не сейчас» у играющего трека сразу ставит следующий, как «Не нравится»
                if (control.dataset.act === 'later') void setExcluded('later-track', fromTrack(current.track), true);
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
                resetGeneration();
                void preparePreview();
                return;
        }
    }
    function onInput(event: Event): void {
        if (!(event.target instanceof HTMLInputElement) || event.target.dataset.role !== 'genre-input') return;
        popQuery = event.target.value;
        render();
    }
    function onKey(event: KeyboardEvent): void {
        if (event.key === 'Escape' && popOpen) {
            event.stopPropagation();
            popOpen = false;
            render();
            section?.querySelector<HTMLElement>('[data-act="genre"]')?.focus();
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

    // ===== Меню по ПКМ и плашка с итогом =====
    const toastBox = el('div', 'scw-toast');
    toastBox.setAttribute('role', 'status');
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    function showToast(text: string): void {
        ensureStyle();
        toastBox.textContent = text;
        if (!toastBox.isConnected) document.body.append(toastBox);
        toastBox.classList.add('on');
        if (toastTimer !== undefined) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastBox.classList.remove('on'), 3500);
    }

    // Элементы списков сайта и их главные ссылки: проверено на ленте, лайках, истории, поиске, плейлисте, главной
    const ITEM_SELECTOR = '.soundList__item, .searchItem__trackItem, .historicalPlays__item, .userStreamItem, .trackItem, .compactTrackList__item, .playableTile, .soundBadge, .playbackSoundBadge, .userBadgeListItem, .userBadge, .sound';
    const PRIMARY_SELECTOR = 'a.soundTitle__title, a.trackItem__trackTitle, a.playbackSoundBadge__titleLink, a.playableTile__mainHeading, a.playableTile__heading, a.sound__coverArt, a.playableTile__artworkLink, a.userBadge__usernameLink, a.userBadgeListItem__heading';
    const USER_SELECTOR = 'a.soundTitle__username, a.trackItem__username, a.playbackSoundBadge__lightLink, a.playableTile__usernameHeading, .playableTile a.sc-link-secondary';
    const HERO_SELECTOR = '.fullHero, .listenHero, .profileHeader, .systemPlaylistHero, .l-listen-hero';
    function fromTrack(track: WaveTrack): MenuTarget {
        return { kind: 'track', url: track.permalink_url ?? '', artistUrl: track.user?.permalink_url ?? '', track };
    }
    function menuTarget(node: Element): MenuTarget | null {
        if (node.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return null;
        const inWave = node.closest('#sc-wave');
        if (inWave) {
            const tile = node.closest<HTMLElement>('.scw-tile[data-track]');
            const id = tile ? Number(tile.dataset.track) : 0;
            const candidate = id ? known.get(id) ?? preview.find((item) => item.track.id === id) : node.closest('.scw-body') ? currentCandidate() : null;
            return candidate ? fromTrack(candidate.track) : null;
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
            items.push(trackMarked(moreTracks, target) ? ['unmore', T.menuUnmore, 'undo'] : ['more', T.more, 'more']);
            items.push(trackMarked(laterTracks, target) ? ['unlater', T.menuUnlater, 'undo'] : ['later', T.later, 'later']);
            items.push(trackExcluded(target) ? ['undislike', T.menuUndislike, 'undo'] : ['dislike', T.menuDislike, 'block']);
        }
        if (target.kind === 'artist') items.push(artistMarked(laterArtists, target) ? ['unlater-artist', T.menuUnlater, 'undo'] : ['later-artist', T.later, 'later']);
        if (hasArtist) items.push(artistExcluded(target) ? ['show-artist', T.menuShowArtist, 'undo'] : ['hide-artist', T.menuHideArtist, 'hide']);
        return items;
    }
    function runMenu(act: string, target: MenuTarget): void {
        switch (act) {
            case 'wave-track': void startSeed('track', target); return;
            case 'wave-artist': void startSeed('artist', target); return;
            case 'wave-playlist': void startSeed('playlist', target); return;
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
        if (!player || !api || disposed || state === 'unavailable') return;
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
                if (!disposed) attachFrame(frame);
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
        }
        if (!(section.isConnected && section.nextElementSibling === anchor)) {
            anchor.parentElement.insertBefore(section, anchor);
            render();
        }
        // Подбор до запуска только для видимого блока: скрытая в F1 волна не ходит в API
        if (state === 'idle' && !active && !preview.length && player && isVisible()) void preparePreview();
    }

    let frame = 0;
    const observer = new MutationObserver(() => {
        if (!frame) frame = requestAnimationFrame(() => {
            frame = 0;
            try {
                watchFrames();
                mount();
            } catch (error) {
                console.error('Волна: блок не встал', error);
            }
        });
    });
    let tickTimer: ReturnType<typeof setInterval> | undefined;
    let paintTimer: ReturnType<typeof setInterval> | undefined;
    let attempts = 0;
    let attachTimer: ReturnType<typeof setTimeout> | undefined;
    function attach(): void {
        attachTimer = undefined;
        if (disposed) return;
        if (findModules()) {
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
            state = 'idle';
            render();
            mount();
            return;
        }
        if (++attempts < 20) {
            attachTimer = setTimeout(attach, 1000);
            return;
        }
        console.warn('Волна: плеер SoundCloud не найден');
        state = 'unavailable';
        render();
    }

    const onScroll = (): void => {
        hideTip();
        closeMenu();
    };
    const dispose = (): void => {
        disposed = true;
        generation++;
        seedRequest++;
        observer.disconnect();
        for (const cleanup of frameCleanups.values()) cleanup();
        frameCleanups.clear();
        document.removeEventListener('contextmenu', onPageMenu);
        document.removeEventListener('mousedown', onOutside, true);
        document.removeEventListener('keydown', onDocumentKey);
        window.removeEventListener('blur', closeMenu);
        window.removeEventListener('resize', closeMenu);
        closeMenu();
        if (toastTimer !== undefined) clearTimeout(toastTimer);
        toastBox.remove();
        delete host.__scWaveExclusionsChanged;
        if (frame) cancelAnimationFrame(frame);
        if (attachTimer !== undefined) clearTimeout(attachTimer);
        if (tickTimer !== undefined) clearInterval(tickTimer);
        if (paintTimer !== undefined) clearInterval(paintTimer);
        if (journalTimer !== undefined) clearTimeout(journalTimer);
        flushJournal();
        finishPlay('stop');
        if (signalsTimer !== undefined) clearTimeout(signalsTimer);
        flushSignals();
        document.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('pagehide', dispose);
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
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('contextmenu', onPageMenu);
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onDocumentKey);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    state = 'loading';
    watchFrames();
    mount();
    attach();
}

// Помощники идут на страницу объявлениями рядом со скриптом: так они видны installWave и друг другу
const pageHelpers = [
    normalizeTag, tagKeys, genreKeys, parseGenres, formatGenres, genreKeysFor, classifyLink, canonicalUrl, trackMatchesGenre, trackArtist,
    isWaveEligible, acceptCandidate, trackSignature, pickSpaced, tasteMaps, tasteScore, tasteOrder, tasteReason, applyTasteReasons, shuffleInPlace, topGenres, fillText, reasonText, shapeSamples,
    artworkUrl, formatTime, playEnd, siteSource, moodTags, trackPath,
];

export function waveScript(): string {
    const config: WaveConfig = { texts: WAVE_TEXTS };
    return '(function(){\n' + pageHelpers.map((helper) => helper.toString()).join('\n') + '\n(' + installWave.toString() + ')(' + JSON.stringify(config) + ');\n})();';
}
