import { describe, expect, it } from 'vitest';
import {
    WAVE_TEXTS, acceptCandidate, artworkUrl, canonicalUrl, classifyLink, formatGenres, genreKeys, genreKeysFor, isWaveEligible,
    moodTags, normalizeTag, trackPath, parseGenres, pickSpaced, reasonText, shapeSamples, topGenres, trackMatchesGenre, trackSignature,
    applyTasteReasons, tagKeys, tasteMaps, tasteOrder, tasteReason, type TasteMaps, type WaveCandidate, type WaveFilter, type WaveTrack,
    countText, forgottenPicks, localDay, pickFinds, tasteGroups,
} from './wave';

describe('вкус волны', () => {
    const taste = (artists: Array<[number, number]>, tags: Array<[string, number]> = [], tracks: Array<[number, number]> = []): TasteMaps =>
        tasteMaps({ artists, tags, tracks }) ?? { artists: new Map(), tags: new Map(), tracks: new Map() };
    const item = (id: number, artist: number, extra: Partial<WaveTrack> = {}): WaveCandidate => ({
        track: { id, kind: 'track', user_id: artist, duration: 180000, title: 'T' + id, ...extra },
        reason: { kind: 'similar', seed: 'Seed' },
    });

    it('ключи тегов как у модели в main, профиль из main проверяется', () => {
        expect(tagKeys('Drum & Bass', '"liquid dnb" chill Chill x')).toEqual(['drumandbass', 'liquiddnb', 'chill']);
        expect(tasteMaps(null)).toBeNull();
        const maps = tasteMaps({ artists: [[1, 2], [-1, 3], ['x', 1], [2, Infinity]], tags: [['techno', 1], ['', 2]], tracks: 'bad' });
        expect([...(maps?.artists ?? [])]).toEqual([[1, 2]]);
        expect([...(maps?.tags ?? [])]).toEqual([['techno', 1]]);
        expect(maps?.tracks.size).toBe(0);
    });

    it('сильный минус отсеивается, любимое чаще встаёт вперёд, треть мест у новых артистов', () => {
        const list = [item(1, 10), item(2, 20), item(3, 30, { genre: 'Techno' }), item(4, 40), item(5, 50), item(6, 60), item(7, 70), item(8, 80), item(9, 90), item(10, 100)];
        const profile = taste([[10, 3], [20, 3], [30, 3], [40, 3], [50, 3], [60, 3], [70, 3]], [], [[9, -1.2]]);
        let seed = 1;
        const random = (): number => {
            seed = (seed * 16807) % 2147483647;
            return seed / 2147483647;
        };
        let loved = 0;
        for (let run = 0; run < 200; run++) {
            const ordered = tasteOrder(list, profile, random);
            expect(ordered.map((entry) => entry.track.id)).not.toContain(9);
            expect(ordered).toHaveLength(9);
            // Новые артисты 80 и 100: хотя бы один в первых четырёх
            const firstFour = ordered.slice(0, 4).map((entry) => entry.track.user_id);
            expect(firstFour.some((artist) => artist === 80 || artist === 100)).toBe(true);
            if ([10, 20, 30, 40, 50, 60, 70].includes(ordered[0].track.user_id ?? 0)) loved++;
        }
        expect(loved).toBeGreaterThan(150);
    });

    it('причина по вкусу: любимый артист, иначе любимый тег, похожее на зерно без вкуса не трогается', () => {
        const profile = taste([[10, 1.5], [30, 0.1]], [['darktechno', 2]]);
        const byArtist = item(1, 10, { user: { id: 10, username: 'Artist' } });
        const byTag = item(2, 20, { tag_list: '"Dark Techno" berlin' });
        const plain = item(3, 30, { genre: 'house' });
        expect(tasteReason(byArtist, profile)).toEqual({ kind: 'tasteArtist', artist: 'Artist' });
        expect(tasteReason(byTag, profile)).toEqual({ kind: 'tasteTag', genre: 'dark techno' });
        expect(tasteReason(plain, profile)).toBeNull();
        expect(tasteReason({ ...byArtist, reason: { kind: 'artistTrack', artist: 'X' } }, profile)).toBeNull();
        expect(reasonText({ kind: 'tasteTag', genre: 'dark techno' }, WAVE_TEXTS.ru)).toBe('В духе dark techno, который ты любишь');
    });

    it('причина по вкусу достаётся только заметной трети подборки', () => {
        const profile = taste([], [['techno', 2]]);
        const list = Array.from({ length: 10 }, (_, i) => item(i + 1, 100 + i, { genre: 'techno' }));
        applyTasteReasons(list, profile);
        expect(list.filter((entry) => entry.reason.kind === 'tasteTag')).toHaveLength(3);
        expect(list.filter((entry) => entry.reason.kind === 'similar')).toHaveLength(7);
    });
});

const track = (id: number, extra: Partial<WaveTrack> = {}): WaveTrack => ({ id, kind: 'track', user_id: id, duration: 180000, policy: 'ALLOW', title: 'Track ' + id, ...extra });
const filter = (extra: Partial<WaveFilter> = {}): WaveFilter => ({
    mode: 'similar', taken: new Set(), recent: new Set(), heard: new Set(), liked: new Set(), skippedArtists: new Set(),
    excludedTracks: new Set(), excludedArtists: new Set(), ...extra,
});

describe('жанр', () => {
    it('сравнивает без регистра, пробелов и знаков, знает синонимы', () => {
        expect(normalizeTag('Witch-House ')).toBe('witchhouse');
        expect(normalizeTag('Drum & Bass')).toBe('drumandbass');
        expect(genreKeys('witch house')).toEqual(['witchhouse', 'wtchhs', 'witchhaus']);
        expect(genreKeys('  ')).toEqual([]);
    });
    it('ищет в жанре и тегах, короткий ключ только целиком', () => {
        const keys = genreKeys('witch house');
        expect(trackMatchesGenre(track(1, { genre: 'Witch House' }), keys)).toBe(true);
        expect(trackMatchesGenre(track(2, { genre: 'Electronic', tag_list: 'dark "witch house" 2024' }), keys)).toBe(true);
        expect(trackMatchesGenre(track(3, { genre: 'darkwitchhouse / drill' }), keys)).toBe(true);
        expect(trackMatchesGenre(track(4, { genre: 'wtchhs' }), keys)).toBe(true);
        expect(trackMatchesGenre(track(5, { genre: 'Trap' }), genreKeys('rap'))).toBe(false);
        expect(trackMatchesGenre(track(6, { genre: 'Rap / Trap' }), genreKeys('rap'))).toBe(true);
        expect(trackMatchesGenre(track(7, {}), [])).toBe(true);
    });
    it('настроение: жанр и теги зерна, у зерна без них самые частые среди похожих', () => {
        expect(moodTags([track(1, { genre: 'Witch House', tag_list: 'dark "haunted mound"' })], [track(2, { genre: 'Rap' })], 2)).toEqual(['witch house', 'dark']);
        const around = [
            track(2, { genre: 'Phonk', tag_list: 'drift' }), track(3, { genre: 'phonk', tag_list: '"Dark Phonk" drift' }),
            track(4, { genre: 'Phonk' }), track(5, { genre: '', tag_list: 'x' }),
        ];
        expect(moodTags([track(1, {})], around, 2)).toEqual(['phonk', 'drift']);
        expect(moodTags([track(1, {})], [], 2)).toEqual([]);
    });
    it('путь трека для журнала: только /user/track, секретная ссылка приватного трека не проходит', () => {
        expect(trackPath('https://soundcloud.com/Mighty_Mason/krovyu-1?in=x')).toBe('/mighty_mason/krovyu-1');
        expect(trackPath('https://soundcloud.com/user/track/s-AbCdEf')).toBe('');
        expect(trackPath('https://evil.test/user/track')).toBe('');
        expect(trackPath(undefined)).toBe('');
    });
    it('понимает несколько жанров через запятую и слэш, drum & bass остаётся целым', () => {
        expect(parseGenres(' Techno / dark  techno, industrial;techno ')).toEqual(['techno', 'dark techno', 'industrial']);
        expect(parseGenres('drum & bass | r&b')).toEqual(['drum & bass', 'r&b']);
        expect(parseGenres('a,b,c,d,e')).toHaveLength(4);
        expect(parseGenres(' / , ')).toEqual([]);
        expect(formatGenres(parseGenres('techno,dark techno'))).toBe('techno / dark techno');
        const keys = genreKeysFor('techno / witch house');
        expect(keys).toEqual(['techno', 'witchhouse', 'wtchhs', 'witchhaus']);
        expect(trackMatchesGenre(track(1, { genre: 'wtchhs' }), keys)).toBe(true);
        expect(trackMatchesGenre(track(2, { genre: 'Techno' }), keys)).toBe(true);
        expect(trackMatchesGenre(track(3, { genre: 'House' }), keys)).toBe(false);
        expect(genreKeysFor(null)).toEqual([]);
    });
});

describe('ссылки для меню', () => {
    const base = 'https://soundcloud.com/feed';
    it('отличает трек, артиста и плейлист, в том числе системный', () => {
        expect(classifyLink('/artist/track-name?in=x#t=1', base)).toEqual({ kind: 'track', url: 'https://soundcloud.com/artist/track-name' });
        expect(classifyLink('/artist', base)).toEqual({ kind: 'artist', url: 'https://soundcloud.com/artist' });
        expect(classifyLink('/artist/sets/mix', base)).toEqual({ kind: 'playlist', url: 'https://soundcloud.com/artist/sets/mix' });
        expect(classifyLink('/discover/sets/personalized-tracks::a:1', base)?.kind).toBe('playlist');
    });
    it('не принимает служебные страницы и чужие сайты', () => {
        for (const href of ['/you/likes', '/artist/likes', '/artist/sets', '/discover', '/search/sounds?q=x', '/artist/track/comments', 'https://evil.com/a/b', 'javascript:alert(1)', 'http://soundcloud.com/a/b'])
            expect(classifyLink(href, base)).toBeNull();
    });
    it('приводит ссылку к виду, который хранит main', () => {
        expect(canonicalUrl('https://soundcloud.com/Artist/Track/?in=x')).toBe('https://soundcloud.com/artist/track');
        expect(canonicalUrl('https://evil.com/a')).toBe('');
        expect(canonicalUrl(undefined)).toBe('');
    });
});

describe('фильтры', () => {
    it('отсекает Go+, BLOCK, длинные, короткие и не треки', () => {
        expect(isWaveEligible(track(1))).toBe(true);
        expect(isWaveEligible(track(2, { policy: 'SNIP' }))).toBe(false);
        expect(isWaveEligible(track(3, { policy: 'BLOCK' }))).toBe(false);
        expect(isWaveEligible(track(4, { full_duration: 16 * 60000 }))).toBe(false);
        expect(isWaveEligible(track(5, { duration: 20000 }))).toBe(false);
        expect(isWaveEligible(track(6, { kind: 'playlist' }))).toBe(false);
        expect(isWaveEligible(track(7, { streamable: false }))).toBe(false);
    });
    it('«Новое» не берёт слышанное и лайкнутое, «Похожее» только недавнее', () => {
        const heard = new Set([1]);
        const liked = new Set([2]);
        const recent = new Set([3]);
        expect(acceptCandidate(track(1), filter({ mode: 'fresh', heard, liked }))).toBe(false);
        expect(acceptCandidate(track(2), filter({ mode: 'fresh', heard, liked }))).toBe(false);
        expect(acceptCandidate(track(1), filter({ heard, liked, recent }))).toBe(true);
        expect(acceptCandidate(track(3), filter({ heard, liked, recent }))).toBe(false);
        expect(acceptCandidate(track(4), filter({ taken: new Set([4]) }))).toBe(false);
        expect(acceptCandidate(track(5), filter({ skippedArtists: new Set([5]) }))).toBe(false);
        expect(acceptCandidate(track(6), filter({ excludedTracks: new Set([6]) }))).toBe(false);
        expect(acceptCandidate(track(7, { user_id: 70 }), filter({ mode: 'fresh', excludedArtists: new Set([70]) }))).toBe(false);
    });
    it('узнаёт перезаливку по артисту и названию без пометок', () => {
        expect(trackSignature(track(1, { user_id: 9, title: 'Song (Slowed)' }))).toBe(trackSignature(track(2, { user_id: 9, title: 'song [prod. x]' })));
        expect(trackSignature(track(1, { user_id: 9, title: 'Song' }))).not.toBe(trackSignature(track(2, { user_id: 8, title: 'Song' })));
    });
});

it('разносит артистов в окне из трёх и не трогает пул', () => {
    const pool: WaveCandidate[] = [1, 1, 1, 2, 3, 4].map((artist, index) => ({ track: track(index + 1, { user_id: artist }), reason: { kind: 'newArtist' } }));
    const picked = pickSpaced(pool, 4, [2]);
    expect(picked.map((item) => item.track.user_id)).toEqual([1, 3, 4, 2]);
    expect(pool).toHaveLength(6);
});

it('частые жанры лайков и подписи причин на двух языках', () => {
    expect(topGenres([track(1, { genre: 'Phonk' }), track(2, { genre: 'phonk' }), track(3, { genre: 'Rap' }), track(4, { genre: '' })], 5)).toEqual(['phonk', 'rap']);
    expect(reasonText({ kind: 'genreSimilar', genre: 'phonk', seed: 'X' }, WAVE_TEXTS.ru)).toBe('phonk, похоже на X');
    expect(reasonText({ kind: 'fresh', seed: 'X' }, WAVE_TEXTS.en)).toBe('New to you, similar to X');
    for (const texts of Object.values(WAVE_TEXTS)) for (const value of Object.values(texts)) expect(value).not.toMatch(/[–—]/);
});

it('растягивает динамику формы и берёт обложку нужного размера', () => {
    const shaped = shapeSamples([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 140]);
    expect(Math.min(...shaped)).toBeCloseTo(0.1);
    expect(Math.max(...shaped)).toBeCloseTo(1);
    expect(artworkUrl(track(1, { artwork_url: 'https://i1.sndcdn.com/artworks-abc-large.jpg' }), 't500x500')).toBe('https://i1.sndcdn.com/artworks-abc-t500x500.jpg');
    expect(artworkUrl(track(1, { artwork_url: 'javascript:alert(1)' }), 't300x300')).toBe('');
});

describe('подборки', () => {
    it('сутки местные, число со словом по правилам языка', () => {
        expect(localDay(new Date(2026, 8, 24, 23, 59).getTime())).toBe('2026-09-24');
        expect(localDay(new Date(2026, 8, 25, 0, 0).getTime())).toBe('2026-09-25');
        const ru = WAVE_TEXTS.ru.tracksCount;
        expect([1, 3, 5, 11, 21, 22].map((count) => countText(count, ru, 'ru'))).toEqual(['1 трек', '3 трека', '5 треков', '11 треков', '21 трек', '22 трека']);
        expect([1, 5].map((count) => countText(count, WAVE_TEXTS.en.tracksCount, 'en'))).toEqual(['1 track', '5 tracks']);
        expect(reasonText({ kind: 'group', name: 'Techno' }, WAVE_TEXTS.ru)).toBe('Твой вкус: Techno');
        expect(reasonText({ kind: 'daily' }, WAVE_TEXTS.en)).toBe('Daily find: an artist new to you');
    });

    it('делит лайки на вкусы по тегам, трек без тегов идёт за своим артистом, мелкое отбрасывается', () => {
        const techno = Array.from({ length: 10 }, (_, i) => track(100 + i, { user_id: 1 + (i % 5), genre: 'Techno', tag_list: 'industrial "hard techno"' }));
        const lofi = Array.from({ length: 10 }, (_, i) => track(200 + i, { user_id: 11 + (i % 5), genre: 'Lo-Fi', tag_list: 'chill jazzhop' }));
        const polka = [track(300, { genre: 'Polka' }), track(301, { genre: 'Polka' })];
        const bare = track(400, { user_id: 1 });
        const items = [...techno, ...lofi, ...polka, bare].map((entry) => ({ track: entry, weight: entry.id === 105 ? 3 : 1 }));
        const groups = tasteGroups(items, 4, 8);
        expect(groups).toHaveLength(2);
        expect(groups[0].keys).toEqual(expect.arrayContaining(['techno', 'industrial', 'hardtechno']));
        expect(groups[0].labels[0]).toBe('Techno');
        expect(groups[0].tracks[0].id).toBe(105);
        expect(groups[0].tracks.map((entry) => entry.id)).toContain(400);
        expect(groups[1].keys).toEqual(expect.arrayContaining(['lofi', 'chill', 'jazzhop']));
        expect(groups.flatMap((group) => group.tracks).some((entry) => entry.id === 300)).toBe(false);
        expect(tasteGroups(items, 4, 11)).toHaveLength(1);
        expect(tasteGroups([], 4, 1)).toEqual([]);
    });

    it('давно не слушал: без недавнего и нелюбимого, ценное вперёд, дальше старые лайки', () => {
        const liked = [track(1), track(2), track(3), track(4), track(5, { policy: 'SNIP' }), track(6)];
        const weights = new Map([[1, -1.5], [3, 2]]);
        expect(forgottenPicks(liked, new Set([2]), weights, 10).map((entry) => entry.id)).toEqual([3, 6, 4]);
        expect(forgottenPicks(liked, new Set(), null, 2).map((entry) => entry.id)).toEqual([6, 4]);
    });

    it('находки: только новые артисты, по треку на артиста, без слышанного и перезаливок', () => {
        const candidates = [
            track(1, { user_id: 50 }), track(2, { user_id: 60 }), track(3, { user_id: 60 }), track(4, { user_id: 70, title: 'Same' }),
            track(5, { user_id: 70, title: 'Same (Remastered)' }), track(6, { user_id: 80 }), track(7, { user_id: 90, policy: 'SNIP' }), track(8, { user_id: 95 }),
        ];
        const finds = pickFinds(candidates, (entry) => entry.id === 6, new Set([50]), null, 10);
        expect(finds.map((entry) => entry.id).sort((a, b) => a - b)).toEqual([2, 4, 8]);
        expect(pickFinds(candidates, () => false, new Set(), null, 2)).toHaveLength(2);
    });
});
