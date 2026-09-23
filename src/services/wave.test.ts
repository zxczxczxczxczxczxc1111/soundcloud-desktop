import { describe, expect, it } from 'vitest';
import {
    WAVE_TEXTS, acceptCandidate, artworkUrl, canonicalUrl, classifyLink, formatGenres, genreKeys, genreKeysFor, isWaveEligible,
    normalizeTag, parseGenres, pickSpaced, reasonText, shapeSamples, topGenres, trackMatchesGenre, trackSignature,
    type WaveCandidate, type WaveFilter, type WaveTrack,
} from './wave';

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
