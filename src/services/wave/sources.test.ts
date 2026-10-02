import { describe, expect, it } from 'vitest';
import { interleaveMixes, relatedArtistsOf, scMixesOf, type ScMix } from './sources';

describe('источники SoundCloud', () => {
    it('похожие артисты: только аккаунты с треками, без повторов, мусор отбрасывается', () => {
        expect(relatedArtistsOf({ collection: [
            { id: 1, username: ' LUFNAEL ', track_count: 29, followers_count: 400 },
            { id: 2, username: 'пустой', track_count: 0 },
            { id: 1, username: 'повтор', track_count: 5 },
            { id: 'x', username: 'мусор', track_count: 5 },
            null,
        ] })).toEqual([{ id: 1, username: 'LUFNAEL', tracks: 29, followers: 400 }]);
        expect(relatedArtistsOf(null)).toEqual([]);
        expect(relatedArtistsOf({ collection: 'нет' })).toEqual([]);
    });

    it('подборки: Your Mix, Daily Drops, Weekly Wave и Liked By с номерами треков; станции, тренды и похожие на трек не берутся', () => {
        const item = (urn: string, title: string, ids: number[]) => ({ kind: 'system-playlist', urn, title, tracks: ids.map((id) => ({ id, kind: 'track', policy: 'MONETIZE' })) });
        const body = { collection: [
            { urn: 'soundcloud:selections:personalized-tracks:7', items: { collection: [item('soundcloud:system-playlists:personalized-tracks:7:2250509282', 'Related tracks: x', [1])] } },
            { urn: 'soundcloud:selections:your-moods', items: { collection: [item('soundcloud:system-playlists:your-moods:7:1', 'Your Mix 1', [10, 11, 10]), item('soundcloud:system-playlists:your-moods:7:1', 'Повтор', [12])] } },
            { urn: 'soundcloud:selections:made-for-you', items: { collection: [item('soundcloud:system-playlists:new-for-you:7', 'Daily Drops', [20]), item('soundcloud:system-playlists:weekly:7', 'Weekly Wave', [30])] } },
            { urn: 'soundcloud:selections:liked-by-7', items: { collection: [item('soundcloud:system-playlists:liked-by:525777930', "katanacss's Picks", [40])] } },
            { urn: 'soundcloud:selections:artist-stations', items: { collection: [item('soundcloud:system-playlists:artist-stations:1:2', 'IVOXYGEN', [50])] } },
            { urn: 'soundcloud:selections:trending-by-genre-playlists', items: { collection: [item('soundcloud:system-playlists:trending-by-genre:hip-hop', 'Hip Hop', [60])] } },
            { urn: 'soundcloud:selections:recently-played:7', items: { collection: [{ kind: 'user', urn: 'soundcloud:users:1' }] } },
            { items: null },
        ] };
        expect(scMixesOf(body)).toEqual([
            { kind: 'mix', title: 'Your Mix 1', urn: 'soundcloud:system-playlists:your-moods:7:1', ids: [10, 11], owner: 0 },
            { kind: 'daily', title: 'Daily Drops', urn: 'soundcloud:system-playlists:new-for-you:7', ids: [20], owner: 0 },
            { kind: 'weekly', title: 'Weekly Wave', urn: 'soundcloud:system-playlists:weekly:7', ids: [30], owner: 0 },
            { kind: 'liked', title: "katanacss's Picks", urn: 'soundcloud:system-playlists:liked-by:525777930', ids: [40], owner: 525777930 },
        ]);
        expect(scMixesOf({ collection: 'нет' })).toEqual([]);
    });

    it('номера подборок вперемешку по кругу, без повторов, только выбранные виды', () => {
        const mix = (kind: ScMix['kind'], ids: number[]): ScMix => ({ kind, title: kind, urn: kind, ids, owner: 0 });
        const list = interleaveMixes([mix('mix', [1, 2, 3]), mix('daily', [4, 1]), mix('liked', [9]), mix('weekly', [])], ['mix', 'daily', 'weekly']);
        expect(list.map((entry) => entry.id)).toEqual([1, 4, 2, 3]);
        expect(list[1].mix.kind).toBe('daily');
    });
});
