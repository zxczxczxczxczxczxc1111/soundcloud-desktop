import { expect, it } from 'vitest';
import { buildRegistry, REGISTRY_PARAMS, type RegistryInput } from './artistRegistry';
import type { TasteUpload } from './recommendStore';
import type { TrackCredit } from './trackIdentity';

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 28);
const credit = (name: string, role: TrackCredit['role'] = 'artist'): TrackCredit => ({ name, key: name.toLowerCase().replace(/[^a-z0-9]/g, ''), role, source: 'title' });
const upload = (id: number, uploader: number, uploaderName: string, credits: TrackCredit[] = []): TasteUpload => ({
    id, uploader, uploaderName, title: 'T' + id, duration: 200000, genre: '', tags: '', credits,
});
type Play = RegistryInput['plays'][number];
const play = (id: number, artist: number, artistName: string, at: number, extra: Partial<Play> = {}): Play => ({
    at, id, artist, heard: 190000, dur: 200000, covered: 190000, source: 'search', picked: true, title: 'Song ' + id, artistName, end: 'ended', endedBy: 'auto', ...extra,
});
const input = (part: Partial<RegistryInput>): RegistryInput => ({
    likes: [], playlists: [], plays: [], uploads: new Map(), follows: [], channels: new Set(), hidden: new Set(), now: NOW, ...part,
});

it('реестр: вес исполнителя из лайков, плейлистов и дослушанного, свой аккаунт отмечается, у канала имя не исполнитель', () => {
    const artists = buildRegistry(input({
        likes: [
            { id: 1, upload: upload(1, 10, 'Alpha') },
            { id: 2, upload: upload(2, 10, 'Alpha') },
            // Канал выложил чужое: исполнитель из титров, аккаунт канала ему не приписывается
            { id: 3, upload: upload(3, 20, 'Vibes Channel', [credit('Beta')]) },
            { id: 4, upload: upload(4, 20, 'Vibes Channel') },
        ],
        playlists: [{ id: 5, own: true, upload: upload(5, 30, 'Beta Official', [credit('Beta'), credit('Gamma', 'featured')]) }],
        channels: new Set([20]),
    }));
    const byKey = new Map(artists.map((artist) => [artist.key, artist]));
    expect(byKey.get('alpha')).toMatchObject({ name: 'Alpha', weight: 2, tracks: 2, accounts: [10] });
    expect(byKey.get('beta')).toMatchObject({ weight: 1.5, tracks: 2, accounts: [] });
    // Гость с одним треком и весом 0.25 ниже порога
    expect(byKey.has('gamma')).toBe(false);
    expect(byKey.has('vibeschannel')).toBe(false);
});

it('реестр: дослушанное раз в день за трек, ранний ручной пропуск и недослушанное не в счёт, автоподбор слабее, старше полугода нет', () => {
    const plays = [
        play(1, 10, 'Alpha', NOW - DAY),
        play(1, 10, 'Alpha', NOW - DAY + 3600000),
        play(1, 10, 'Alpha', NOW - 2 * DAY),
        play(2, 10, 'Alpha', NOW - DAY, { source: 'wave:main', picked: false }),
        play(3, 10, 'Alpha', NOW - DAY, { covered: 20000, heard: 20000, endedBy: 'user' }),
        play(4, 10, 'Alpha', NOW - DAY, { covered: 100000 }),
        play(5, 10, 'Alpha', NOW - (REGISTRY_PARAMS.playsDays + 1) * DAY),
    ];
    const [alpha] = buildRegistry(input({ plays }));
    // Трек 1 дважды по дню (0.5 + 0.5), трек 2 автоподбором 0.25
    expect(alpha).toMatchObject({ key: 'alpha', weight: 1.25, tracks: 2, accounts: [10] });
});

it('реестр: зацикленный трек не делает исполнителя главным, подписка входит с весом и аккаунтом, скрытые и каналы без подписки', () => {
    const plays = Array.from({ length: 20 }, (_, day) => play(1, 10, 'Loop', NOW - (day + 1) * DAY));
    const artists = buildRegistry(input({
        plays,
        likes: [{ id: 7, upload: upload(7, 40, 'Hidden') }, { id: 8, upload: upload(8, 40, 'Hidden') }],
        follows: [{ id: 50, name: 'Followed' }, { id: 20, name: 'Vibes Channel' }, { id: 60, name: '' }],
        channels: new Set([20]),
        hidden: new Set([40]),
    }));
    const byKey = new Map(artists.map((artist) => [artist.key, artist]));
    expect(byKey.get('loop')).toMatchObject({ weight: REGISTRY_PARAMS.trackCap, tracks: 1 });
    expect(byKey.get('followed')).toMatchObject({ weight: REGISTRY_PARAMS.follow, followed: true, accounts: [50] });
    expect(byKey.has('vibeschannel')).toBe(false);
    // Скрытый аккаунт не становится источником, но исполнитель по лайкам остаётся
    expect(byKey.get('hidden')).toMatchObject({ accounts: [] });
});

it('реестр: не больше предела, самые весомые первыми', () => {
    const likes = Array.from({ length: REGISTRY_PARAMS.size + 10 }, (_, i) => [
        { id: i * 2 + 1, upload: upload(i * 2 + 1, 1000 + i, 'Artist' + i) },
        { id: i * 2 + 2, upload: upload(i * 2 + 2, 1000 + i, 'Artist' + i) },
    ]).flat();
    likes.push({ id: 99999, upload: upload(99999, 1000, 'Artist0') });
    const artists = buildRegistry(input({ likes }));
    expect(artists).toHaveLength(REGISTRY_PARAMS.size);
    expect(artists[0]).toMatchObject({ key: 'artist0', weight: 3 });
});
