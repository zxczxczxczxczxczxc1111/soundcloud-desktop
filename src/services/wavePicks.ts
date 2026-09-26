// Отбор кандидатов волны: годен ли трек, фильтр, разнос артистов, лимиты, «давно не слушал», новые исполнители.
// Функции уходят на страницу текстом вместе с волной (pageHelpers в wave.ts): чужие функции зовутся по голому имени,
// поэтому импорт через пространство имён и разбор в константы, как в wave.ts
import * as identity from './trackIdentity';
import type { WaveCandidate, WaveFilter, WaveTrack } from './waveTypes';

const { copyKey, familyKey, nameKey, trackCredits, versionKey } = identity;

export function trackArtist(track: WaveTrack): number {
    return track.user_id ?? track.user?.id ?? 0;
}

/** Запоминает id не больше limit штук, вытесняя самые старые; true, если id встретился впервые */
export function rememberRecent(seen: Set<number>, id: number, limit: number): boolean {
    if (seen.has(id)) return false;
    seen.add(id);
    if (seen.size > limit) seen.delete(seen.values().next().value as number);
    return true;
}

// Треки Go+ (SNIP) играют 30 секунд на бесплатном тарифе, BLOCK не играет вовсе, длинные миксы волну не держат
export function isWaveEligible(track: WaveTrack): boolean {
    if (!track || typeof track.id !== 'number' || (track.kind !== undefined && track.kind !== 'track')) return false;
    if (track.streamable === false || track.policy === 'SNIP' || track.policy === 'BLOCK') return false;
    const duration = track.full_duration || track.duration || 0;
    return duration >= 30000 && duration <= 15 * 60000;
}

export function acceptCandidate(track: WaveTrack, filter: WaveFilter): boolean {
    if (!isWaveEligible(track) || filter.taken.has(track.id) || filter.skipped.has(copyKey(track))) return false;
    if (filter.excludedTracks.has(track.id) || filter.excludedArtists.has(trackArtist(track))) return false;
    if (filter.excludedFamilies.size && !(filter.excludedFamilies.get(familyKey(track))?.has(versionKey(track)) ?? true)) return false;
    if (filter.mode === 'fresh') return !filter.heard.has(track.id) && !filter.liked.has(track.id);
    return !filter.recent.has(track.id);
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

export function shuffleInPlace<T>(list: T[]): T[] {
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

// Не больше cap треков одного артиста, порядок сохраняется: любимый артист не забирает подборку жанра целиком
export function capPerArtist(tracks: WaveTrack[], cap: number): WaveTrack[] {
    const taken = new Map<number, number>();
    return tracks.filter((track) => {
        const artist = trackArtist(track);
        const count = taken.get(artist) ?? 0;
        taken.set(artist, count + 1);
        return count < cap;
    });
}

// «Давно не слушал»: лайки, которых нет среди прослушанного за последние недели. Сначала то, что модель вкуса
// ценит выше (дослушивал, переслушивал), дальше лайки постарше. liked идёт от новых лайков к старым
export function forgottenPicks(liked: WaveTrack[], recent: Set<number>, weights: Map<number, number> | null, limit: number): WaveTrack[] {
    return liked
        .map((track, order) => ({ track, order, weight: weights?.get(track.id) ?? 0 }))
        .filter((entry) => entry.weight > -1 && !recent.has(entry.track.id) && isWaveEligible(entry.track))
        .sort((a, b) => b.weight - a.weight || b.order - a.order)
        .slice(0, limit)
        .map((entry) => entry.track);
}

// Ключи имён исполнителей: загрузчик, если выложил своё, и участники из названия и метаданных, кроме авторов песни
export function artistNames(tracks: WaveTrack[]): Set<string> {
    const names = new Set<string>();
    for (const track of tracks) {
        const credits = trackCredits(track).filter((credit) => credit.role !== 'writer');
        const uploader = nameKey(track.user?.username);
        if (uploader && !credits.some((credit) => credit.role === 'artist' && credit.key !== uploader)) names.add(uploader);
        for (const credit of credits) names.add(credit.key);
    }
    return names;
}

// Новый исполнитель: у чужой песни на канале решают участники из названия, у своей ещё и сам аккаунт
export function isNewArtist(track: WaveTrack, knownIds: Set<number>, knownNames: Set<string>): boolean {
    const credits = trackCredits(track).filter((credit) => credit.role !== 'writer');
    const uploader = nameKey(track.user?.username);
    const foreign = credits.some((credit) => credit.role === 'artist' && credit.key !== uploader);
    if (!foreign && (knownIds.has(trackArtist(track)) || (!!uploader && knownNames.has(uploader)))) return false;
    return !credits.some((credit) => knownNames.has(credit.key));
}

// Разнести по ключу в порядке списка: следующий берётся первый, чей ключ не встречался среди последних gap,
// а если такого нет, просто первый. Ничего не выбрасывается
export function spreadBy<T>(list: T[], keyOf: (item: T) => string | number, gap: number): T[] {
    const rest = list.slice();
    const result: T[] = [];
    const window: Array<string | number> = [];
    while (rest.length) {
        let index = rest.findIndex((item) => !window.includes(keyOf(item)));
        if (index < 0) index = 0;
        const [item] = rest.splice(index, 1);
        result.push(item);
        window.push(keyOf(item));
        if (window.length > gap) window.shift();
    }
    return result;
}
