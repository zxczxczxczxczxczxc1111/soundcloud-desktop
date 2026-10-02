// Источники SoundCloud для подбора, которые волна раньше не брала: похожие артисты, лучшие треки артиста и персональные
// подборки SoundCloud (Your Mix, Daily Drops, Weekly Wave, Liked By). Раздел страницы волны: installSources уходит на
// страницу текстом вместе с волной (pageHelpers в wave.ts) и зовёт помощников по голому имени. Ответы живут в памяти
// страницы, подборки ещё и в localStorage на сутки: SoundCloud обновляет их раз в день
import * as waveTexts from '../waveTexts';
import * as wavePicks from '../wavePicks';
import type { WaveTrack } from '../waveTypes';

const { localDay } = waveTexts;
const { isWaveEligible } = wavePicks;

/** Похожий артист из relatedartists: число треков и подписчиков, чтобы не брать пустые аккаунты */
export interface RelatedArtist { id: number; username: string; tracks: number; followers: number }
/** Персональная подборка SoundCloud: вид, название, урна и номера треков по порядку. owner у «Liked By» это аккаунт,
 *  чьи лайки в подборке */
export interface ScMix { kind: 'mix' | 'daily' | 'weekly' | 'liked'; title: string; urn: string; ids: number[]; owner: number }

/** Похожие артисты из ответа relatedartists: только аккаунты с треками, без повторов */
export function relatedArtistsOf(body: unknown): RelatedArtist[] {
    const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
    const list = (body as { collection?: unknown } | null)?.collection;
    if (!Array.isArray(list)) return [];
    const seen = new Set<number>();
    return list.flatMap((value): RelatedArtist[] => {
        const user = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
        if (!user || !isId(user.id) || seen.has(user.id)) return [];
        seen.add(user.id);
        const count = (item: unknown): number => (typeof item === 'number' && Number.isFinite(item) && item > 0 ? item : 0);
        const tracks = count(user.track_count);
        return tracks ? [{ id: user.id, username: typeof user.username === 'string' ? user.username.trim() : '', tracks, followers: count(user.followers_count) }] : [];
    });
}

/** Подборки из mixedSelections (проверено 02.10.2026): системные плейлисты your-moods (Your Mix N), new-for-you
 *  (Daily Drops), weekly (Weekly Wave) и liked-by:<id> («<артист>'s Picks»). Треки в ответе заготовками {id, kind, policy} */
export function scMixesOf(body: unknown): ScMix[] {
    const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
    const selections = (body as { collection?: unknown } | null)?.collection;
    if (!Array.isArray(selections)) return [];
    const mixes: ScMix[] = [];
    const seen = new Set<string>();
    for (const selection of selections) {
        const items = (selection as { items?: { collection?: unknown } } | null)?.items?.collection;
        if (!Array.isArray(items)) continue;
        for (const value of items) {
            const item = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
            const urn = typeof item?.urn === 'string' ? item.urn : '';
            const match = /^soundcloud:system-playlists:(your-moods|new-for-you|weekly|liked-by):(\d+)/.exec(urn);
            if (!item || !match || seen.has(urn)) continue;
            seen.add(urn);
            const kind = match[1] === 'your-moods' ? 'mix' : match[1] === 'new-for-you' ? 'daily' : match[1] === 'weekly' ? 'weekly' : 'liked';
            const title = (typeof item.title === 'string' ? item.title : typeof item.short_title === 'string' ? item.short_title : '').trim().slice(0, 120);
            const ids = Array.isArray(item.tracks) ? [...new Set(item.tracks.map((track: unknown) => (track as { id?: unknown } | null)?.id).filter(isId))].slice(0, 100) : [];
            mixes.push({ kind, title, urn, ids, owner: kind === 'liked' ? Number(match[2]) : 0 });
        }
    }
    return mixes;
}

/** Чьи лайки в подборке «Liked By»: имя из названия «<артист>'s Picks», приставка «Liked By» отрезается */
export function likedOwner(title: string): string {
    return title.trim().replace(/^liked by\s+/i, '').replace(/[’']s picks$/i, '').trim();
}

/** Номера подборок вперемешку: по одному из каждой по кругу, без повторов. Подборка SoundCloud сама уже упорядочена,
 *  а круг не даёт одной Your Mix занять весь проход */
export function interleaveMixes(mixes: ScMix[], kinds: Array<ScMix['kind']>): Array<{ id: number; mix: ScMix }> {
    const lists = mixes.filter((mix) => kinds.includes(mix.kind) && mix.ids.length);
    const out: Array<{ id: number; mix: ScMix }> = [];
    const seen = new Set<number>();
    for (let i = 0; lists.some((mix) => i < mix.ids.length); i++)
        for (const mix of lists) {
            const id = mix.ids[i];
            if (id !== undefined && !seen.has(id)) {
                seen.add(id);
                out.push({ id, mix });
            }
        }
    return out;
}

export interface SourcesCore {
    call(name: string, path: object, query: object): Promise<unknown>;
    ensureUser(): Promise<number>;
    tracksOf(body: unknown): WaveTrack[];
}
export interface SourcesSection {
    /** Похожие артисты аккаунта; ответ живёт 6 часов, сбой не кэшируется */
    relatedArtists(id: number): Promise<RelatedArtist[]>;
    /** Лучшие треки аккаунта, годные для волны; 6 часов */
    topTracks(id: number): Promise<WaveTrack[]>;
    /** Подборки SoundCloud на сегодня; пусто, если сайт не ответил (следующий вызов спросит снова) */
    scMixes(): Promise<ScMix[]>;
    /** Треки по номерам через trackBatch с кэшем раздела */
    tracksByIds(ids: number[]): Promise<WaveTrack[]>;
}

export function installSources(core: SourcesCore): SourcesSection {
    const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
    const { call, ensureUser, tracksOf } = core;
    const HOURS_6 = 6 * 3600000;
    const MIXES_KEY = 'scDesktopWaveScMixes';
    const related = new Map<number, { at: number; found: Promise<RelatedArtist[]> }>();
    const tops = new Map<number, { at: number; found: Promise<WaveTrack[]> }>();
    const tracks = new Map<number, WaveTrack>();
    let mixes: { user: number; day: string; list: ScMix[] } | null = null;
    let mixesPromise: Promise<ScMix[]> | null = null;
    let mixesFailedAt = 0;
    // Ответ в кэш на 6 часов; отказ из кэша уходит, следующий вызов спросит снова. Кэш не растёт без конца
    function cached<T>(map: Map<number, { at: number; found: Promise<T> }>, id: number, load: () => Promise<T>): Promise<T> {
        const kept = map.get(id);
        if (kept && Date.now() - kept.at < HOURS_6) return kept.found;
        const found = load();
        map.delete(id);
        map.set(id, { at: Date.now(), found });
        if (map.size > 300) map.delete(map.keys().next().value as number);
        void found.catch(() => {
            if (map.get(id)?.found === found) map.delete(id);
        });
        return found;
    }
    function readMixes(user: number, day: string): ScMix[] | null {
        try {
            const saved = JSON.parse(localStorage.getItem(MIXES_KEY) || 'null') as { user?: unknown; day?: unknown; list?: unknown } | null;
            if (!saved || saved.user !== user || saved.day !== day || !Array.isArray(saved.list)) return null;
            // Свой же снимок, но localStorage правят и руками: форма проверяется заново
            return saved.list.flatMap((value): ScMix[] => {
                const item = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
                if (!item || typeof item.urn !== 'string' || !Array.isArray(item.ids)) return [];
                const kind = item.kind === 'mix' || item.kind === 'daily' || item.kind === 'weekly' || item.kind === 'liked' ? item.kind : null;
                if (!kind) return [];
                return [{ kind, title: typeof item.title === 'string' ? item.title.slice(0, 120) : '', urn: item.urn.slice(0, 200), ids: item.ids.filter(isId).slice(0, 100), owner: isId(item.owner) ? item.owner : 0 }];
            });
        } catch (error) {
            console.warn('Волна: подборки SoundCloud из памяти не прочитаны', error);
            return null;
        }
    }
    function saveMixes(user: number, day: string, list: ScMix[]): void {
        try {
            localStorage.setItem(MIXES_KEY, JSON.stringify({ user, day, list }));
        } catch (error) {
            console.warn('Волна: подборки SoundCloud не сохранены', error);
        }
    }
    function scMixes(): Promise<ScMix[]> {
        const day = localDay(Date.now());
        if (mixes && mixes.day === day) return Promise.resolve(mixes.list);
        // Сайт не ответил: каждый проход подбора не переспрашивает, повтор через 10 минут
        if (Date.now() - mixesFailedAt < 10 * 60000) return Promise.resolve([]);
        mixesPromise ??= (async () => {
            const user = await ensureUser();
            if (!user) return [];
            const saved = readMixes(user, day);
            if (saved) {
                mixes = { user, day, list: saved };
                return saved;
            }
            const list = scMixesOf(await call('mixedSelections', {}, { limit: 20 }));
            // Подборка без номеров в ответе: состав одним запросом systemPlaylist
            for (const mix of list)
                if (!mix.ids.length)
                    try {
                        const body = (await call('systemPlaylist', { urn: mix.urn }, {})) as { tracks?: unknown } | null;
                        mix.ids = Array.isArray(body?.tracks) ? [...new Set(body.tracks.map((track: unknown) => (track as { id?: unknown } | null)?.id).filter(isId))].slice(0, 100) : [];
                    } catch (error) {
                        console.warn('Волна: состав подборки SoundCloud не загружен', mix.urn, error);
                    }
            mixes = { user, day, list };
            if (list.length) saveMixes(user, day, list);
            return list;
        })().catch((error: unknown) => {
            mixesFailedAt = Date.now();
            console.warn('Волна: подборки SoundCloud не загружены', error);
            return [];
        }).finally(() => {
            mixesPromise = null;
        });
        return mixesPromise;
    }
    async function tracksByIds(ids: number[]): Promise<WaveTrack[]> {
        const missing = [...new Set(ids)].filter((id) => !tracks.has(id));
        for (let i = 0; i < missing.length; i += 50)
            for (const track of tracksOf(await call('trackBatch', {}, { ids: missing.slice(i, i + 50).join(',') }))) tracks.set(track.id, track);
        if (tracks.size > 3000) for (const id of [...tracks.keys()].slice(0, tracks.size - 3000)) tracks.delete(id);
        return ids.map((id) => tracks.get(id)).filter((track): track is WaveTrack => !!track);
    }
    return {
        relatedArtists: (id) => cached(related, id, async () => relatedArtistsOf(await call('userRelatedArtists', { id }, { limit: 20 }))),
        topTracks: (id) => cached(tops, id, async () => tracksOf(await call('userToptracks', { id }, { limit: 10 })).filter(isWaveEligible)),
        scMixes,
        tracksByIds,
    };
}
