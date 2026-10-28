// Реестр исполнителей для радара (разбор 28.10.2026): за кем следить, считается по исполнителям, а не по аккаунтам
// загрузчиков. У артиста бывает несколько аккаунтов (старый свой и дистрибьюторский), а перезаливщик выкладывает чужих.
// Вес копится из лайков, плейлистов, дослушанного и подписок без затухания по месяцам: любимый артист не выпадает
// из радара оттого, что его неделю не слушали. Чистая функция, данные приходят аргументами
import type { TastePlay } from './historyIndex';
import type { TasteUpload } from './recommendStore';
import { nameKey, trackCredits, type TrackCredit } from './trackIdentity';

const DAY = 86400000;

export const REGISTRY_PARAMS = {
    /** Исполнителей в реестре, самые весомые */
    size: 400,
    /** В реестр от стольких разных треков, иначе от minWeight или подписки */
    minTracks: 2,
    minWeight: 1.5,
    /** Сигналы трека: лайк, свой и сохранённый плейлист, дослушанное своим выбором и автоподбором (за трек в день) */
    like: 1,
    ownPlaylist: 0.5,
    savedPlaylist: 0.25,
    heard: 0.5,
    heardAuto: 0.25,
    /** Вклад одного трека не больше: зацикленный трек не делает артиста главным */
    trackCap: 2,
    /** Дослушанное за столько дней */
    playsDays: 180,
    /** Подписка добавляет к весу */
    follow: 1,
    /** Доля веса у гостя и ремиксера: слабые роли */
    featured: 0.5,
    remixer: 0.3,
};

export interface RegistryArtist {
    key: string;
    /** Самое частое написание имени */
    name: string;
    weight: number;
    /** Разных треков с сигналом */
    tracks: number;
    /** Аккаунты, где исполнитель выкладывал своё: загрузчик с тем же именем */
    accounts: number[];
    followed: boolean;
}
export interface RegistryInput {
    likes: Array<{ id: number; upload: TasteUpload | null }>;
    playlists: Array<{ id: number; own: boolean; upload: TasteUpload | null }>;
    plays: Array<Pick<TastePlay, 'at' | 'id' | 'artist' | 'heard' | 'dur' | 'covered' | 'source' | 'picked' | 'title' | 'artistName' | 'end' | 'endedBy'>>;
    /** Разбор сыгранных загрузок из хранилища: участники точнее, чем по одному названию */
    uploads: Map<number, TasteUpload>;
    /** Подписки с именем аккаунта, если оно известно */
    follows: Array<{ id: number; name: string }>;
    /** Каналы (radar channelSet): их имя не исполнитель */
    channels: Set<number>;
    /** Скрытые аккаунты */
    hidden: Set<number>;
    now: number;
}

interface Performer { key: string; name: string; share: number; account: number }
// Исполнители трека: исполнители из титров и метаданных, гости и ремиксеры слабее. Своя запись без исполнителя
// в названии принадлежит загрузчику, кроме канала. Аккаунт отмечается, только если загрузчик сам исполнитель
function performersOf(uploader: number, uploaderName: string, credits: TrackCredit[], channels: Set<number>): Performer[] {
    const P = REGISTRY_PARAMS;
    const own = nameKey(uploaderName);
    const artists = credits.filter((credit) => credit.role === 'artist' && credit.key);
    const list: Performer[] = [];
    if (!artists.length && own && !channels.has(uploader)) list.push({ key: own, name: uploaderName.split('|')[0].trim(), share: 1, account: uploader });
    for (const credit of artists) list.push({ key: credit.key, name: credit.name, share: 1, account: credit.key === own ? uploader : 0 });
    for (const credit of credits) {
        if (!credit.key || (credit.key === own && !artists.length)) continue;
        if (credit.role === 'featured') list.push({ key: credit.key, name: credit.name, share: P.featured, account: 0 });
        else if (credit.role === 'remixer') list.push({ key: credit.key, name: credit.name, share: P.remixer, account: credit.key === own ? uploader : 0 });
    }
    return list;
}

/** Реестр: исполнители по весу, от minTracks разных треков (или minWeight, или подписки), не больше size */
export function buildRegistry(input: RegistryInput): RegistryArtist[] {
    const P = REGISTRY_PARAMS;
    // Вклад трека: сумма его сигналов, не больше trackCap; исполнители трека берутся из разбора загрузки или названия
    const tracks = new Map<number, { value: number; performers: Performer[] }>();
    const add = (id: number, value: number, performers: () => Performer[]): void => {
        const entry = tracks.get(id) ?? { value: 0, performers: performers() };
        entry.value = Math.min(P.trackCap, entry.value + value);
        tracks.set(id, entry);
    };
    const fromUpload = (upload: TasteUpload) => (): Performer[] => performersOf(upload.uploader, upload.uploaderName, upload.credits, input.channels);
    for (const like of input.likes) if (like.upload) add(like.id, P.like, fromUpload(like.upload));
    for (const track of input.playlists) if (track.upload) add(track.id, track.own ? P.ownPlaylist : P.savedPlaylist, fromUpload(track.upload));
    // Дослушанное: один сигнал за трек в день, автоподбор волны и сайта слабее своего выбора
    const since = input.now - P.playsDays * DAY;
    const counted = new Set<string>();
    for (const play of input.plays) {
        if (play.at < since || !play.dur || play.dur <= 0) continue;
        const covered = play.covered ?? play.heard;
        const early = play.endedBy === 'user' && covered < 30000;
        if (early || covered < play.dur * 0.7) continue;
        const day = play.id + ':' + Math.floor(play.at / DAY);
        if (counted.has(day)) continue;
        counted.add(day);
        const auto = (play.source.startsWith('wave:') || play.source.startsWith('site:')) && !play.picked;
        const upload = input.uploads.get(play.id);
        const uploaderName = play.artistName.split('|')[0].trim();
        add(play.id, auto ? P.heardAuto : P.heard, upload
            ? fromUpload(upload)
            : () => performersOf(play.artist, uploaderName, trackCredits({ id: play.id, title: play.title, user: { id: play.artist, username: uploaderName } }), input.channels));
    }
    interface Entry { weight: number; tracks: Set<number>; names: Map<string, number>; accounts: Set<number>; followed: boolean }
    const artists = new Map<string, Entry>();
    const entry = (key: string): Entry => {
        const known = artists.get(key);
        if (known) return known;
        const created: Entry = { weight: 0, tracks: new Set(), names: new Map(), accounts: new Set(), followed: false };
        artists.set(key, created);
        return created;
    };
    for (const [id, track] of tracks) {
        for (const performer of track.performers) {
            const artist = entry(performer.key);
            artist.weight += track.value * performer.share;
            artist.tracks.add(id);
            if (performer.name) artist.names.set(performer.name, (artist.names.get(performer.name) ?? 0) + 1);
            if (performer.account && !input.hidden.has(performer.account)) artist.accounts.add(performer.account);
        }
    }
    for (const follow of input.follows) {
        const key = nameKey(follow.name);
        if (!key || input.channels.has(follow.id) || input.hidden.has(follow.id)) continue;
        const artist = entry(key);
        artist.weight += P.follow;
        artist.followed = true;
        artist.accounts.add(follow.id);
        if (follow.name) artist.names.set(follow.name, (artist.names.get(follow.name) ?? 0) + 1);
    }
    return [...artists]
        // Ключ длиннее 80 знаков источником радара не бывает (isCatalogKey хранилища)
        .filter(([key, artist]) => key.length >= 2 && key.length <= 80 && (artist.followed || artist.tracks.size >= P.minTracks || artist.weight >= P.minWeight))
        .map(([key, artist]): RegistryArtist => ({
            key,
            name: [...artist.names].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? key,
            weight: Math.round(artist.weight * 1000) / 1000,
            tracks: artist.tracks.size,
            accounts: [...artist.accounts].sort((a, b) => a - b),
            followed: artist.followed,
        }))
        .sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : 1))
        .slice(0, P.size);
}
