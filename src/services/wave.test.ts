import { describe, expect, it } from 'vitest';
import {
    WAVE_TEXTS, acceptCandidate, artworkUrl, canonicalUrl, classifyLink, formatGenres, genreKeys, genreKeysFor, isWaveEligible,
    moodTags, normalizeTag, trackPath, parseGenres, pickSpaced, reasonText, shapeSamples, topGenres, trackMatchesGenre,
    applyTasteReasons, tagKeys, tasteMaps, tasteOrder, tasteReason, tasteScore, type TasteMaps, type WaveCandidate, type WaveFilter, type WaveTrack,
    countText, forgottenPicks, localDay, pickFinds, tasteGroups, capPerArtist, artistNames, isNewArtist, spreadBy, genreCanon, genreParts, genreMain,
} from './wave';
import { copyKeys, familyKey, versionKey } from './trackIdentity';

describe('вкус волны', () => {
    const taste = (artists: Array<[number, number]>, tags: Array<[string, number]> = [], tracks: Array<[number, number]> = [], extra: object = {}): TasteMaps =>
        tasteMaps({ artists, tags, tracks, ...extra }) ?? { artists: new Map(), credits: new Map(), families: new Map(), tags: new Map(), markers: new Map(), tracks: new Map() };
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
        // Профиль до P4 без новых частей читается, новые части проверяются так же
        expect(maps?.credits.size).toBe(0);
        const next = tasteMaps({ credits: [['artistx', 1], [5, 1]], families: [['song|artistx', 0.5]], markers: [['slowed', 0.2], ['remix', 'x']] });
        expect([...(next?.credits ?? [])]).toEqual([['artistx', 1]]);
        expect([...(next?.families ?? [])]).toEqual([['song|artistx', 0.5]]);
        expect([...(next?.markers ?? [])]).toEqual([['slowed', 0.2]]);
    });

    it('A14: любимый исполнитель доходит до его песен на чужих каналах, имя загрузчика не считается дважды', () => {
        const profile = taste([[10, 0.4]], [], [], {
            credits: [['artistx', 1.5], ['artistz', 0.6], ['bad', -0.5]],
            families: [['song|artistx', 0.6]],
            markers: [['slowed', 0.4]],
        });
        // Ремикс любимого исполнителя на незнакомом канале: вес участника, семьи и пометки
        const repost = item(1, 99, { title: 'Artist X - Song (slowed)', user: { id: 99, username: 'Some Channel' } });
        const score = tasteScore(repost.track, profile);
        expect(score.artist).toBe(0);
        expect(score.credit).toBeCloseTo(1.5, 6);
        expect(score.creditName).toBe('Artist X');
        expect(score.family).toBeCloseTo(0.6, 6);
        expect(score.marker).toBeCloseTo(0.4, 6);
        expect(score.known).toBe(true);
        expect(tasteReason(repost, profile)).toEqual({ kind: 'tasteArtist', artist: 'Artist X' });
        // Своё у самого исполнителя: вес аккаунта, имя в участниках не добавляется
        const own = item(2, 10, { title: 'Other Song', user: { id: 10, username: 'Artist Z' } });
        expect(tasteScore(own.track, profile)).toMatchObject({ artist: 0.4, credit: 0 });
        // Минус участника и плюс другого складываются
        const mixed = item(3, 98, { title: 'Artist X, Bad - Thing', user: { id: 98, username: 'Hub' } });
        expect(tasteScore(mixed.track, profile).credit).toBeCloseTo(1, 6);
        // Безымянный ремикс без участников оценивается остальным и не выпадает
        const anon = item(4, 97, { title: 'Nightcall (Remix)', genre: 'phonk', user: { id: 97, username: 'anon' } });
        expect(tasteScore(anon.track, taste([], [['phonk', 1]])).score).toBeCloseTo(1, 6);
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

    it('жанр весит целиком, одна метка из пачки десятой частью и без причины «В духе»; ник загрузчика в метках не считается', () => {
        const profile = taste([], [['dark', 2], ['ivoxygen', 3]]);
        const byGenre = item(1, 10, { genre: 'Dark' });
        const byTag = item(2, 20, { genre: 'Pop', tag_list: 'dark sad love night slow' });
        const nick = item(3, 30, { genre: 'Pop', tag_list: 'ivoxygen', user: { id: 30, username: 'IVOXYGEN' } });
        expect(tasteScore(byGenre.track, profile).tag).toBeCloseTo(2, 6);
        expect(tasteScore(byTag.track, profile).tag).toBeCloseTo(0.2, 6);
        expect(tasteReason(byGenre, profile)).toEqual({ kind: 'tasteTag', genre: 'dark' });
        expect(tasteReason(byTag, profile)).toBeNull();
        expect(tasteScore(nick.track, profile).tag).toBe(0);
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
    mode: 'similar', taken: new Set(), recent: new Set(), heard: new Set(), liked: new Set(), skipped: new Set(),
    excludedTracks: new Set(), excludedArtists: new Set(), excludedFamilies: new Map(), ...extra,
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
        // Witch house только звучит как house
        expect(trackMatchesGenre(track(8, { genre: 'Witch House' }), genreKeys('house'))).toBe(false);
        expect(trackMatchesGenre(track(9, { genre: 'Deep House' }), genreKeys('house'))).toBe(true);
        // Зёрна строго по полю жанра: метка Hip Hop у рокового трека не делает его зерном хип-хопа, трек без жанра идёт по меткам
        const spam = track(10, { genre: 'Alternative Rock', tag_list: '"Hip Hop" Rap Ambient' });
        expect(trackMatchesGenre(spam, genreKeys('hip hop'))).toBe(true);
        expect(trackMatchesGenre(spam, genreKeys('hip hop'), true)).toBe(false);
        expect(trackMatchesGenre(track(11, { tag_list: '"Hip Hop"' }), genreKeys('hip hop'), true)).toBe(true);
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
        expect(acceptCandidate(track(6), filter({ excludedTracks: new Set([6]) }))).toBe(false);
        expect(acceptCandidate(track(7, { user_id: 70 }), filter({ mode: 'fresh', excludedArtists: new Set([70]) }))).toBe(false);
    });

    it('A07: ранний пропуск убирает версию и её перезаливы, остальные треки того же канала проходят', () => {
        const skippedTrack = track(5, { user_id: 50, title: 'Mix Channel - Song A', user: { id: 50, username: 'Mix Channel' } });
        const skipped = new Set(copyKeys(skippedTrack));
        const reupload = track(6, { user_id: 60, title: 'Mix Channel - Song A', user: { id: 60, username: 'Reup' }, duration: 181000 });
        const sameChannel = track(7, { user_id: 50, title: 'Mix Channel - Song B', user: { id: 50, username: 'Mix Channel' } });
        const slowed = track(8, { user_id: 50, title: 'Mix Channel - Song A (Slowed)', user: { id: 50, username: 'Mix Channel' } });
        expect(acceptCandidate(reupload, filter({ skipped }))).toBe(false);
        expect(acceptCandidate(sameChannel, filter({ skipped }))).toBe(true);
        expect(acceptCandidate(slowed, filter({ skipped }))).toBe(true);
    });

    it('A08: «Скрыть другие версии» убирает остальные версии композиции, выбранную версию и другую песню того же исполнителя нет', () => {
        const chosen = track(1, { title: 'Artist - Song' });
        const hidden = new Map([[familyKey(chosen), new Set([versionKey(chosen)])]]);
        expect(acceptCandidate(track(2, { title: 'Artist - Song (Slowed)' }), filter({ excludedFamilies: hidden }))).toBe(false);
        expect(acceptCandidate(track(4, { title: 'Artist - Song' }), filter({ excludedFamilies: hidden }))).toBe(true);
        expect(acceptCandidate(track(3, { title: 'Artist - Other Song' }), filter({ excludedFamilies: hidden }))).toBe(true);
    });

    it('новый артист: у чужой песни на канале решают исполнители из названия, у своей ещё и аккаунт', () => {
        const history = [track(1, { user_id: 10, title: 'Known Artist - Hit', user: { id: 10, username: 'Big Channel' } }), track(2, { user_id: 20, title: 'Solo', user: { id: 20, username: 'Solo Act' } })];
        const names = artistNames(history);
        expect([...names].sort()).toEqual(['knownartist', 'soloact']);
        const ids = new Set([10, 20]);
        // Известный исполнитель на незнакомом канале не новый; незнакомый исполнитель на знакомом сборном канале новый
        expect(isNewArtist(track(3, { user_id: 30, title: 'Known Artist - Other', user: { id: 30, username: 'Reup' } }), ids, names)).toBe(false);
        expect(isNewArtist(track(4, { user_id: 10, title: 'Fresh Face - Debut', user: { id: 10, username: 'Big Channel' } }), ids, names)).toBe(true);
        expect(isNewArtist(track(5, { user_id: 20, title: 'Another', user: { id: 20, username: 'Solo Act' } }), ids, names)).toBe(false);
        expect(isNewArtist(track(6, { user_id: 60, title: 'Untitled', user: { id: 60, username: 'Stranger' } }), ids, names)).toBe(true);
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
        expect(reasonText({ kind: 'daily' }, WAVE_TEXTS.en)).toBe('Daily find: not played by you yet');
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

    it('написания жанра склеиваются, составной жанр сайта режется на части, но не по &', () => {
        expect(genreCanon('hiphopandrap')).toBe('hiphop');
        expect(genreCanon('rap')).toBe('hiphop');
        expect(genreCanon('techno')).toBe('techno');
        expect(genreParts('Hip Hop/Rap - Trap')).toEqual(['hiphop', 'trap']);
        expect(genreParts('Hip-hop & Rap')).toEqual(['hiphop']);
        expect(genreParts('Hip-hop/Rap')).toEqual(['hiphop']);
        expect(genreParts('Drum & Bass')).toEqual(['drumandbass']);
        expect(genreParts('R&B & Soul')).toEqual(['rnb']);
        expect(genreParts('Phonk/Fonk')).toEqual(['phonk']);
        expect(genreParts('')).toEqual([]);
        expect(genreMain('hip hop/rap - trap')).toEqual({ key: 'trap', label: 'trap' });
        expect(genreMain('Hip-hop & Rap')).toEqual({ key: 'hiphop', label: 'Hip-hop & Rap' });
        expect(genreMain('Phonk/Fonk')).toEqual({ key: 'phonk', label: 'Phonk' });
        expect(genreMain('  ')).toEqual({ key: '', label: '' });
    });

    it('большая группа отдаёт поджанр, который стоит у треков жанром; тег без жанра группу не делит', () => {
        const items = [
            ...Array.from({ length: 30 }, (_, i) => track(500 + i, { user: { id: 500 + i, username: 'Rapper ' + i }, genre: 'Hip-hop & Rap' })),
            ...Array.from({ length: 12 }, (_, i) => track(600 + i, { user: { id: 600 + i, username: 'Trapper ' + i }, genre: 'Hip Hop/Rap - Trap' })),
            ...Array.from({ length: 9 }, (_, i) => track(700 + i, { user: { id: 700 + i, username: 'Sadboy ' + i }, genre: 'Hip-hop & Rap', tag_list: 'sad' })),
        ].map((entry) => ({ track: entry, weight: 1 }));
        const groups = tasteGroups(items, 8, 8);
        const trap = groups.find((group) => group.labels[0] === 'Trap');
        const rest = groups.find((group) => group.keys.includes('hiphop'));
        expect(trap?.tracks).toHaveLength(12);
        expect(rest?.tracks).toHaveLength(39);
        expect(rest?.keys).not.toContain('trap');
        expect(groups.some((group) => group.labels[0] === 'sad')).toBe(false);
    });

    it('метка не уводит трек из жанра, который поставил загрузчик; подпись берётся из поля жанра, а не из тегов', () => {
        const user = (id: number) => ({ user: { id, username: 'User ' + id } });
        const items = [
            ...Array.from({ length: 51 }, (_, i) => track(1000 + i, { ...user(1000 + i), genre: 'Alternative' })),
            ...Array.from({ length: 45 }, (_, i) => track(2000 + i, { ...user(2000 + i), genre: 'Alternative Rock', tag_list: i < 9 ? 'grunge alternative' : 'grunge' })),
            ...Array.from({ length: 20 }, (_, i) => track(3000 + i, { ...user(3000 + i), genre: 'Hip-hop & Rap', tag_list: 'rap' })),
            ...Array.from({ length: 10 }, (_, i) => track(3100 + i, { ...user(3100 + i), tag_list: 'rap' })),
        ].map((entry) => ({ track: entry, weight: 1 }));
        const groups = tasteGroups(items, 8, 8);
        const alternative = groups.filter((group) => group.keys[0] === 'alternative');
        expect(alternative).toHaveLength(1);
        // Девять треков Alternative Rock с меткой alternative остаются в своём жанре
        expect(alternative[0].tracks).toHaveLength(51);
        expect(groups.find((group) => group.keys[0] === 'alternativerock')?.tracks).toHaveLength(45);
        expect(groups.find((group) => group.keys[0] === 'hiphop')?.labels[0]).toBe('Hip-hop & Rap');
    });

    it('артист с пачкой меток на все жанры не собирает свою карточку и не растекается по чужим (случай ivoxygen)', () => {
        const star = { id: 1, username: 'Star' };
        const spam = 'Alternative "Alternative Rock" "Hip Hop" Rap Ambient Dark Atmospheric';
        const items = [
            ...Array.from({ length: 12 }, (_, i) => track(100 + i, { user_id: 1, user: star, genre: 'Alternative Rock', tag_list: spam })),
            ...Array.from({ length: 10 }, (_, i) => track(200 + i, { user_id: 1, user: star, genre: 'Hip-hop & Rap', tag_list: spam })),
            ...Array.from({ length: 4 }, (_, i) => track(300 + i, { user_id: 1, user: star, genre: 'Ambient', tag_list: spam })),
            ...Array.from({ length: 20 }, (_, i) => track(400 + i, { user_id: 10 + i, user: { id: 10 + i, username: 'Rock ' + i }, genre: 'Alternative Rock', tag_list: 'grunge' })),
            ...Array.from({ length: 20 }, (_, i) => track(500 + i, { user_id: 40 + i, user: { id: 40 + i, username: 'Rap ' + i }, genre: 'Hip-hop & Rap', tag_list: 'trap' })),
        ].map((entry) => ({ track: entry, weight: 1 }));
        const groups = tasteGroups(items, 8, 8);
        const place = (id: number): string | undefined => groups.find((group) => group.tracks.some((entry) => entry.id === id))?.keys[0];
        expect(place(100)).toBe('alternativerock');
        expect(place(200)).toBe('hiphop');
        expect(groups.some((group) => ['ambient', 'dark', 'atmospheric'].includes(group.keys[0]))).toBe(false);
        expect(groups.find((group) => group.keys[0] === 'hiphop')?.tracks).toHaveLength(30);
    });

    it('в подборке не больше заданного числа треков одного артиста, порядок сохраняется', () => {
        const list = [1, 1, 2, 1, 3, 1, 2].map((artist, i) => track(10 + i, { user_id: artist }));
        expect(capPerArtist(list, 2).map((entry) => entry.id)).toEqual([10, 11, 12, 14, 16]);
    });

    it('сборный канал не раздаёт свой жанр чужим песням без тегов, своя песня артиста наследует', () => {
        const channel = { id: 1, username: 'Techno Hub' };
        const techno = Array.from({ length: 10 }, (_, i) => track(100 + i, { user_id: 1, user: channel, title: 'Artist ' + i + ' - Track', genre: 'Techno', tag_list: 'industrial' }));
        const foreign = track(400, { user_id: 1, user: channel, title: 'Pop Star - Ballad' });
        const artist = { id: 2, username: 'Solo' };
        const own = Array.from({ length: 10 }, (_, i) => track(200 + i, { user_id: 2, user: artist, title: 'Solo Tune ' + i, genre: 'Techno', tag_list: 'industrial' }));
        const bare = track(401, { user_id: 2, user: artist, title: 'Untagged Solo Tune' });
        const groups = tasteGroups([...techno, foreign, ...own, bare].map((entry) => ({ track: entry, weight: 1 })), 4, 8);
        const ids = groups.flatMap((group) => group.tracks.map((entry) => entry.id));
        expect(ids).not.toContain(400);
        expect(ids).toContain(401);
    });

    it('давно не слушал: без недавнего и нелюбимого, ценное вперёд, дальше старые лайки', () => {
        const liked = [track(1), track(2), track(3), track(4), track(5, { policy: 'SNIP' }), track(6)];
        const weights = new Map([[1, -1.5], [3, 2]]);
        expect(forgottenPicks(liked, new Set([2]), weights, 10).map((entry) => entry.id)).toEqual([3, 6, 4]);
        expect(forgottenPicks(liked, new Set(), null, 2).map((entry) => entry.id)).toEqual([6, 4]);
    });

    it('A01: находки берут знакомый аккаунт и несколько его песен, без слышанного и недоступного', () => {
        const candidates = [
            track(1, { user_id: 50 }), track(2, { user_id: 60 }), track(3, { user_id: 60 }), track(4, { user_id: 70, title: 'Same' }),
            track(5, { user_id: 70, title: 'Other' }), track(6, { user_id: 80 }), track(7, { user_id: 90, policy: 'SNIP' }), track(8, { user_id: 95 }),
        ];
        const finds = pickFinds(candidates, (entry) => entry.id === 6, null, 10);
        expect(finds.map((entry) => entry.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 8]);
        expect(pickFinds(candidates, () => false, null, 2)).toHaveLength(2);
        // Десять песен одного загрузчика все проходят, потолка на аккаунт нет
        const one = Array.from({ length: 10 }, (_, i) => track(100 + i, { user_id: 7, title: 'Song ' + i }));
        expect(pickFinds(one, () => false, null, 30)).toHaveLength(10);
    });

    it('A03: второй трек аккаунта, который подходит лучше, не теряется из-за порядка ответа', () => {
        const worse = track(1, { user_id: 60, genre: 'house', title: 'First' });
        const better = track(2, { user_id: 60, genre: 'techno', title: 'Second' });
        const profile = tasteMaps({ tags: [['techno', 3]] });
        if (!profile) throw new Error('профиль не разобран');
        const half = (): number => 0.5;
        expect(pickFinds([worse, better], () => false, profile, 1, half).map((entry) => entry.id)).toEqual([2]);
        expect(pickFinds([better, worse], () => false, profile, 1, half).map((entry) => entry.id)).toEqual([2]);
    });

    it('находки: перезалив той же версии одной находкой, slowed и ремикс отдельными (A02); из копий остаётся лучшая', () => {
        const candidates = [
            track(1, { user_id: 10, title: 'Artist - Song' }), track(2, { user_id: 20, title: 'Artist - Song', duration: 181000 }),
            track(3, { user_id: 30, title: 'Artist - Song (Slowed + Reverb)' }), track(4, { user_id: 40, title: 'Artist - Song (Altare Remix)' }),
            track(5, { user_id: 50, title: 'Song' }),
        ];
        const finds = pickFinds(candidates, () => false, null, 10);
        expect(finds.map((entry) => entry.id).sort((a, b) => a - b)).toEqual([1, 3, 4, 5]);
        // Копия, которую вкус ценит выше, побеждает независимо от порядка
        const profile = tasteMaps({ tracks: [[2, 1]] });
        if (!profile) throw new Error('профиль не разобран');
        expect(pickFinds(candidates, () => false, profile, 10).map((entry) => entry.id).sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
        expect(pickFinds(candidates.slice().reverse(), () => false, profile, 10).map((entry) => entry.id).sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
    });

    it('разнесение по аккаунту: один аккаунт не подряд, пока есть другие, ничего не теряется', () => {
        expect(spreadBy([1, 1, 1, 2, 3], (value) => value, 1)).toEqual([1, 2, 1, 3, 1]);
        expect(spreadBy([4, 4], (value) => value, 1)).toEqual([4, 4]);
    });
});
