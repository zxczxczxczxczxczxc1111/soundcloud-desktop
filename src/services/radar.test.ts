import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
    RADAR_PARAMS, RadarService, buildRadar, cleanRadarItem, coverageComplete, creditNames, exclusionFilter, freshness, heardIds, radarCoverage, radarSources,
    selectEdition, selectRadar, type RadarCandidate, type RadarCoverage, type RadarInput,
} from './radar';
import { RecommendStore, type StoredUpload } from './recommendStore';
import { HistoryIndex } from './historyIndex';
import { WaveSignals } from './waveSignals';
import { TasteService } from './tasteModel';
import { confirmedGroups, familyKey, parseTrackTitle, trackCredits, versionKey } from './trackIdentity';
import type { WaveExclusionList } from './waveExclusions';

const DAY = 86400000;
const CUTOFF = Date.parse('2026-09-25T06:00:00Z');
const FROM = CUTOFF - RADAR_PARAMS.windowDays * DAY;
const FULL: RadarCoverage = { accounts: 3, checked: 3, failed: 0, searches: 1, searchesDone: 1 };
const PARTIAL: RadarCoverage = { accounts: 3, checked: 1, failed: 1, searches: 1, searchesDone: 0 };

function upload(id: number, title: string, uploader: number, uploaderName: string, extra: Partial<StoredUpload> = {}): StoredUpload {
    const duration = extra.duration ?? 180000;
    const track = { id, title, user_id: uploader, user: { id: uploader, username: uploaderName }, duration };
    return {
        key: 'sc:track:' + id, id, uploader, uploaderName, title, familyKey: familyKey(track), versionKey: versionKey(track), version: parseTrackTitle(title).version,
        credits: trackCredits(track), isrc: '', duration, createdAt: CUTOFF - 3 * DAY, displayAt: 0, releaseDay: '', genre: 'phonk', tags: '', policy: 'ALLOW',
        parser: 1, firstSeen: 0, checked: 0, ...extra,
    };
}
const input = (uploads: StoredUpload[], extra: Partial<RadarInput> = {}): RadarInput => ({
    period: '2026-09-25', now: CUTOFF + 1000, cutoff: CUTOFF, uploads, reuploads: new Set(), tasteVersion: 2, follows: [], heard: new Set(), excluded: () => false,
    groups: new Map(), history: [], coverage: FULL,
    profile: { artists: [[1, 3], [3, 2]], credits: [['artist', 2]], tags: [['phonk', 1], ['jazz', 0.6]], families: [], markers: [], tracks: [] },
    ...extra,
});

it('свежесть версии: своя публикация это релиз, чужой канал без даты релиза и перезалив только новая загрузка', () => {
    const fresh = CUTOFF - 3 * DAY;
    expect(freshness(upload(1, 'Song', 1, 'Artist'), false, FROM, CUTOFF)).toEqual({ kind: 'release', at: fresh });
    // A10: старая песня на сборном канале и перезалив с более ранней копией
    expect(freshness(upload(2, 'Artist - Song', 2, 'Vibes'), false, FROM, CUTOFF).kind).toBe('upload');
    expect(freshness(upload(3, 'Song', 3, 'Artist'), true, FROM, CUTOFF).kind).toBe('upload');
    // A09: новый ремикс старой песни, выложенный самим ремиксером, доказан датой публикации
    expect(freshness(upload(4, 'Old Artist - Classic (Remixer Remix)', 4, 'Remixer'), false, FROM, CUTOFF).kind).toBe('release');
    // Заявленная дата релиза главнее: в окне релиз, давняя дата делает свежую публикацию перезаливом, будущая ждёт
    expect(freshness(upload(5, 'Artist - Song', 5, 'Label', { createdAt: CUTOFF - 90 * DAY, releaseDay: '2026-09-20' }), false, FROM, CUTOFF)).toEqual({ kind: 'release', at: Date.parse('2026-09-20T00:00:00Z') });
    expect(freshness(upload(6, 'Song', 6, 'Artist', { releaseDay: '2019-01-01' }), false, FROM, CUTOFF).kind).toBe('upload');
    expect(freshness(upload(7, 'Song', 7, 'Artist', { releaseDay: '2026-10-02' }), false, FROM, CUTOFF).kind).toBe('future');
    expect(freshness(upload(11, 'Song', 11, 'Artist', { releaseDay: '2026-09-24', createdAt: CUTOFF + 3600000 }), false, FROM, CUTOFF).kind).toBe('future');
    // Скрытая давняя загрузка, опубликованная в окне; публикация после отсечки войдёт в следующий выпуск
    expect(freshness(upload(8, 'Song', 8, 'Artist', { createdAt: CUTOFF - 90 * DAY, displayAt: fresh }), false, FROM, CUTOFF).kind).toBe('release');
    expect(freshness(upload(9, 'Song', 9, 'Artist', { createdAt: CUTOFF + 3600000 }), false, FROM, CUTOFF).kind).toBe('future');
    expect(freshness(upload(10, 'Song', 10, 'Artist', { createdAt: FROM - 1 }), false, FROM, CUTOFF).kind).toBe('old');
});

it('A10, A11: перезалив идёт в «Новые загрузки», слышанный релиз остаётся в 50 с отметкой, связи со вкусом нет: не идёт никуда', () => {
    const edition = buildRadar(input([
        upload(1, 'Night Drive', 1, 'Artist'),
        upload(2, 'Artist - Hit', 2, 'Vibes'),
        upload(3, 'Morning', 3, 'Other'),
        upload(4, 'Random', 99, 'Stranger', { genre: 'country' }),
    ], { heard: new Set([3]) }))!;
    expect(edition.items.map((item) => [item.id, item.kind, item.heard])).toEqual([[1, 'release', false], [3, 'release', true]]);
    expect(edition.uploads.map((item) => [item.id, item.kind])).toEqual([[2, 'upload']]);
    expect(edition).toMatchObject({ status: 'complete', algorithm: RADAR_PARAMS.version, taste: 2, revision: 0 });
    expect(edition.items[0].reason).toEqual({ kind: 'artist', name: 'Artist' });
    expect(edition.uploads[0].reason).toEqual({ kind: 'artist', name: 'Artist' });
});

it('A05: подтверждённые и вероятные копии одной версии одной строкой, релиз главнее перезалива; другая версия в группе исполнителя', () => {
    const groups = confirmedGroups([{ a: 'sc:track:10', b: 'sc:track:11', same: true, source: 'user', at: 1 }]);
    const edition = buildRadar(input([
        upload(10, 'Artist - Tune', 1, 'Artist'),
        upload(11, 'Tune (official)', 3, 'Other'),
        upload(12, 'Artist - Tune', 2, 'Vibes', { duration: 181000 }),
        upload(13, 'Artist - Tune (Slowed)', 1, 'Artist'),
    ], { groups }))!;
    expect([...edition.items, ...edition.uploads].flatMap((item) => item.group ?? [item.id]).sort((a, b) => a - b)).toEqual([10, 13]);
    expect(edition.items).toHaveLength(1);
});

it('группы исполнителей (решение владельца 26.09.2026): одна строка на исполнителя, у сборного канала исполнитель из названия, потолок аккаунта считает группы', () => {
    const own = Array.from({ length: 4 }, (_, i) => upload(41 + i, 'Own ' + i, 1, 'Artist', { createdAt: CUTOFF - (5 - i) * DAY }));
    const channel = ['Alpha - A', 'Alpha - B', 'Beta - C', 'Gamma - D', 'Delta - E'].map((title, i) => upload(51 + i, title, 2, 'Vibes', { releaseDay: '2026-09-23' }));
    const edition = buildRadar(input([...own, ...channel]))!;
    const artist = edition.items.filter((item) => item.id >= 41 && item.id <= 44);
    expect(artist).toHaveLength(1);
    // Ведёт лучшая по оценке, в группе все записи по дате
    expect(artist[0].group).toEqual([41, 42, 43, 44]);
    const vibes = edition.items.filter((item) => item.id >= 51);
    expect(vibes).toHaveLength(RADAR_PARAMS.perUploader);
    expect(vibes.find((item) => item.group)?.group).toEqual([51, 52]);
    expect(new Set(vibes.map((item) => item.id)).size).toBe(3);
});

it('A22: пустота при незавершённом обходе не публикуется, при завершённом это честная пустая неделя; неполное с релизами partial', () => {
    expect(buildRadar(input([], { coverage: PARTIAL }))).toBeNull();
    expect(buildRadar(input([upload(2, 'Artist - Hit', 2, 'Vibes')], { coverage: PARTIAL }))).toBeNull();
    expect(buildRadar(input([], { coverage: FULL }))).toMatchObject({ status: 'complete', items: [], uploads: [] });
    expect(buildRadar(input([upload(1, 'Song', 1, 'Artist')], { coverage: PARTIAL }))).toMatchObject({ status: 'partial', coverage: PARTIAL });
    expect(coverageComplete(FULL)).toBe(true);
    expect(coverageComplete({ ...FULL, failed: 1 })).toBe(false);
    expect(coverageComplete({ accounts: 0, checked: 0, failed: 0, searches: 0, searchesDone: 0 })).toBe(true);
});

it('«Не нравится» с подтверждёнными копиями, скрытый аккаунт и семья убирают запись; истёкшее «Не сейчас» нет', () => {
    const list: WaveExclusionList = {
        tracks: [{ id: 1, title: 'A', artist: '', url: '', at: 1 }],
        artists: [{ id: 9, title: 'Hidden', artist: '', url: '', at: 1 }],
        laterTracks: [{ id: 4, title: 'Later', artist: '', url: '', at: 1, until: CUTOFF - 1 }],
        laterArtists: [],
        more: [],
        families: [{ id: 50, title: 'Artist - Theme', artist: 'Artist', artistId: 1, url: '', at: 1 }],
    };
    const excluded = exclusionFilter(list, confirmedGroups([{ a: 'sc:track:1', b: 'sc:track:2', same: true, source: 'user', at: 1 }]), CUTOFF);
    expect(excluded(upload(1, 'X', 1, 'Artist'))).toBe(true);
    expect(excluded(upload(2, 'Y', 2, 'Other'))).toBe(true);
    expect(excluded(upload(3, 'Z', 9, 'Hidden'))).toBe(true);
    expect(excluded(upload(4, 'Later', 1, 'Artist'))).toBe(false);
    // «Скрыть другие версии» на оригинале: slowed скрыт, сам оригинал и его перезалив остаются
    expect(excluded(upload(5, 'Artist - Theme (Slowed)', 7, 'Slowed Channel'))).toBe(true);
    expect(excluded(upload(7, 'Artist - Theme', 8, 'Vibes'))).toBe(false);
    expect(excluded(upload(6, 'Artist - Other', 1, 'Artist'))).toBe(false);
});

const candidate = (id: number, base: number, direction: string, extra: Partial<RadarCandidate> = {}): RadarCandidate => ({
    key: 'sc:track:' + id, id, base, direction, family: 'f' + id, uploader: id, kind: 'release', at: CUTOFF - DAY, heard: false, linked: true, reason: { kind: 'taste' }, performer: 'u:' + id, ...extra,
});

it('A12: редкий устойчивый вкус получает место при сопоставимом качестве, слабое ради разнообразия не подставляется', () => {
    const pool = [
        ...Array.from({ length: 60 }, (_, i) => candidate(i + 1, 0.9, 'phonk')),
        ...Array.from({ length: 3 }, (_, i) => candidate(101 + i, 0.82, 'jazz')),
        ...Array.from({ length: 5 }, (_, i) => candidate(201 + i, 0.3, 'pop')),
    ];
    const picked = selectRadar(pool, []);
    expect(picked).toHaveLength(50);
    const jazz = picked.findIndex((item) => item.direction === 'jazz');
    expect(jazz).toBeGreaterThan(0);
    expect(jazz).toBeLessThan(10);
    expect(picked.some((item) => item.direction === 'pop')).toBe(false);
    expect(Math.max(...picked.map((item) => item.bonus))).toBeLessThanOrEqual(RADAR_PARAMS.diversityCap);
    // Один ввод даёт один результат: порядок получения ничего не решает
    const shuffled = pool.slice().reverse();
    expect(selectRadar(shuffled, []).map((item) => item.id)).toEqual(picked.map((item) => item.id));
});

it('A13: 50 релизов одного направления от разных аккаунтов входят все, штраф повтора семьи ограничен', () => {
    const picked = selectRadar(Array.from({ length: 70 }, (_, i) => candidate(i + 1, 0.9 - i * 0.001, 'phonk', { family: 'same' })), []);
    expect(picked).toHaveLength(50);
    expect(new Set(picked.map((item) => item.direction))).toEqual(new Set(['phonk']));
    expect(Math.max(...picked.map((item) => item.penalty))).toBe(RADAR_PARAMS.repeatCap);
});

it('потолок аккаунта (решение владельца 25.09.2026): в основном списке до 3 записей одного аккаунта, выпуск не добивается его остатком', () => {
    const pool = [
        ...Array.from({ length: 10 }, (_, i) => candidate(i + 1, 0.9 - i * 0.001, 'phonk', { uploader: 1 })),
        ...Array.from({ length: 5 }, (_, i) => candidate(100 + i, 0.4, 'jazz')),
    ];
    const picked = selectRadar(pool, [], RADAR_PARAMS.size, RADAR_PARAMS.perUploader);
    expect(picked.filter((item) => item.uploader === 1).map((item) => item.id)).toEqual([1, 2, 3]);
    expect(picked).toHaveLength(8);
    // Без потолка, как в «Новых загрузках», аккаунт не ограничен
    expect(selectRadar(pool, []).filter((item) => item.uploader === 1)).toHaveLength(10);
});

it('связь плюс 10 открытий (решение владельца 25.09.2026): сначала связанные со вкусом, открытия по жанру не больше 10 и всегда ниже', () => {
    const linked = Array.from({ length: 45 }, (_, i) => candidate(i + 1, 0.5 - i * 0.001, 'phonk'));
    const open = Array.from({ length: 30 }, (_, i) => candidate(100 + i, 0.99 - i * 0.001, 'pop', { linked: false }));
    const picked = selectEdition([...open, ...linked], []);
    expect(picked).toHaveLength(50);
    expect(picked.slice(0, 40).every((item) => item.linked)).toBe(true);
    expect(picked.slice(40).map((item) => item.id)).toEqual(Array.from({ length: 10 }, (_, i) => 100 + i));
    // Связанных мало: выпуск короче 50, открытий всё равно не больше 10
    const short = selectEdition([...open, ...linked.slice(0, 5)], []);
    expect(short.map((item) => item.linked)).toEqual([...Array(5).fill(true), ...Array(10).fill(false)]);
});

it('связь со вкусом: подписка, аккаунт и участник из вкуса связаны; чужой трек по жанру и аккаунт с одним прослушиванием нет', () => {
    const edition = buildRadar(input([
        upload(1, 'Night Drive', 1, 'Artist'),
        upload(2, 'Artist - Collab', 50, 'Label', { releaseDay: '2026-09-23' }),
        upload(3, 'Genre Only', 60, 'Stranger'),
        upload(4, 'Followed', 70, 'Friend', { genre: 'country' }),
        upload(5, 'Barely', 80, 'Once'),
    ], {
        follows: [70],
        profile: { artists: [[1, 3], [3, 2], [80, 0.1]], credits: [['artist', 2]], tags: [['phonk', 1], ['jazz', 0.6]], families: [], markers: [], tracks: [] },
    }))!;
    const linked = new Map(edition.items.map((item) => [item.id, item.reason.kind]));
    // Связанные первыми, открытия по жанру после них в своём порядке оценки
    expect([...linked.keys()]).toEqual([1, 2, 4, 5, 3]);
    expect(linked.get(3)).toBe('tag');
});

it('пачка без дат релиза (решение владельца 25.09.2026): больше 6 за неделю это выгрузка каталога, релизами остаются 2 лучших', () => {
    const bulk = Array.from({ length: 9 }, (_, i) => upload(11 + i, 'Pack ' + i, 1, 'Artist', { createdAt: CUTOFF - 4 * DAY + i * 3600000 }));
    const dated = upload(20, 'Single', 1, 'Artist', { releaseDay: '2026-09-24', createdAt: CUTOFF - 2 * DAY });
    const spread = Array.from({ length: 7 }, (_, i) => upload(31 + i, 'Slow ' + i, 3, 'Other', { createdAt: CUTOFF - (1 + i * 3) * DAY }));
    const edition = buildRadar(input([...bulk, dated, ...spread]))!;
    const rows = (list: Array<{ id: number }>, from: number, to: number) => list.filter((item) => item.id >= from && item.id <= to);
    const sorted = (ids: number[] | undefined): number[] => (ids ?? []).slice().sort((a, b) => a - b);
    // Два лучших из пачки и релиз с датой одной строкой исполнителя, остаток пачки строкой в «Новых загрузках»
    const main = rows(edition.items, 11, 20);
    expect(main).toHaveLength(1);
    expect(sorted(edition.items.find((item) => item.id === main[0].id)?.group)).toEqual([11, 12, 20]);
    const rest = edition.uploads.filter((item) => item.id >= 11 && item.id <= 19);
    expect(rest).toHaveLength(1);
    expect(sorted(rest[0].group)).toEqual([13, 14, 15, 16, 17, 18, 19]);
    expect(rest[0].kind).toBe('upload');
    // Записи раз в три дня это не пачка: в окне недели три релиза, одной группой по дате
    const slow = rows(edition.items, 31, 37);
    expect(slow).toHaveLength(1);
    expect(edition.items.find((item) => item.id === slow[0].id)?.group).toEqual([33, 32, 31]);
    expect(rows(edition.uploads, 31, 37)).toHaveLength(0);
});

it('«Новые загрузки»: сборный канал с десятью исполнителями занимает не больше трёх мест, как в основном списке', () => {
    const names = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'];
    const hub = names.map((name, i) => upload(100 + i, name + ' - Song ' + i, 50, 'Hub'));
    const edition = buildRadar(input(hub, { profile: { artists: [], credits: names.map((name): [string, number] => [name, 2]), tags: [['phonk', 1]], families: [], markers: [], tracks: [] } }))!;
    const fromHub = [...edition.items, ...edition.uploads].filter((item) => item.id >= 100 && item.id < 110);
    expect(fromHub.length).toBeGreaterThan(0);
    expect(edition.uploads.filter((item) => item.id >= 100 && item.id < 110)).toHaveLength(Math.min(RADAR_PARAMS.perUploader, fromHub.length));
});

it('история выпусков: направление, которого давно не было, получает большую прибавку', () => {
    const pool = [candidate(1, 0.8, 'phonk'), candidate(2, 0.8, 'jazz')];
    expect(selectRadar(pool, [['phonk', 'phonk'], ['phonk']])[0].direction).toBe('jazz');
    expect(selectRadar(pool, [['jazz'], ['jazz']])[0].direction).toBe('phonk');
});

it('«слышано»: 70% уникального покрытия, у коротких 80%; повтор куска не полное; лайк и подтверждённая копия тоже', () => {
    const groups = confirmedGroups([{ a: 'sc:track:1', b: 'sc:track:9', same: true, source: 'catalog', at: 1 }]);
    const heard = heardIds([
        { id: 1, heard: 130000, dur: 180000, covered: 130000 },
        { id: 2, heard: 110000, dur: 180000, covered: 110000 },
        { id: 3, heard: 20000, dur: 25000, covered: 19000 },
        { id: 4, heard: 22000, dur: 25000, covered: 21000 },
        { id: 5, heard: 170000, dur: 180000, covered: null },
        { id: 6, heard: 170000, dur: 180000, covered: 30000 },
    ], [7], groups);
    expect([...heard].sort((a, b) => a - b)).toEqual([1, 4, 5, 7, 9]);
});

it('план обхода: подписки и сильные кураторы без скрытых, поиск только по участникам с известным именем; покрытие по свежим проверкам', () => {
    const profile = { version: 2, artists: [[5, 1.5], [6, 0.1], [9, 2]] as Array<[number, number]>, credits: [['artistname', 1], ['unknown', 3], ['weak', 0.2]] as Array<[string, number]>, families: [], tags: [], markers: [], tracks: [], counted: 10 };
    const names = new Map([['artistname', 'Artist Name'], ['weak', 'Weak']]);
    const since = CUTOFF - DAY;
    const sources = radarSources([4, 5], profile, names, [
        { key: 'user:4', label: 'Four', checked: since + 1, status: 'ok', error: '', found: 2 },
        { key: 'user:5', label: '', checked: since - 1, status: 'ok', error: '', found: 1 },
        { key: 'search:artistname', label: 'Artist Name', checked: since + 1, status: 'failed', error: 'rate', found: 0 },
    ], new Set([9]));
    expect(sources.map((source) => [source.key, source.label, source.weight])).toEqual([
        ['user:4', 'Four', 1], ['user:5', '', 1.5], ['search:artistname', 'Artist Name', 1],
    ]);
    expect(radarCoverage(sources, since)).toEqual({ accounts: 2, checked: 1, failed: 1, searches: 1, searchesDone: 0 });
    expect(creditNames([
        { id: 1, title: 'Artist Name - Song', artistName: 'Channel' },
        { id: 2, title: 'Tune', artistName: 'Weak | tags' },
    ], new Set(['artistname', 'weak', 'nobody']))).toEqual(new Map([['weak', 'Weak'], ['artistname', 'Artist Name']]));
});

it('подписок больше предела: скрытые место не занимают, остаются весомые во вкусе, а не первые по номеру', () => {
    const follows = Array.from({ length: RADAR_PARAMS.follows + 2 }, (_, i) => i + 1);
    const last = follows[follows.length - 1];
    // Вес ниже порога кураторов: в обход аккаунт попадает только как подписка
    const profile = { version: 2, artists: [[last, 0.2]] as Array<[number, number]>, credits: [], families: [], tags: [], markers: [], tracks: [], counted: 10 };
    const ids = radarSources(follows, profile, new Map(), [], new Set([1])).map((source) => source.id);
    expect(ids).toHaveLength(RADAR_PARAMS.follows);
    expect(ids).not.toContain(1);
    expect(ids).toContain(last);
    expect(ids).toContain(2);
    expect(ids).not.toContain(last - 1);
});

it('позиция выпуска из файла проверяется: чужой ключ и мусор отбрасываются', () => {
    expect(cleanRadarItem({ key: 'sc:track:5', id: 5, title: 'T', kind: 'upload', heard: true, reason: { kind: 'follow', name: 'X' } }))
        .toMatchObject({ id: 5, kind: 'upload', heard: true, reason: { kind: 'follow', name: 'X' }, score: 0, direction: '' });
    // Группа: без повторов и мусора; без самой позиции или из одной записи не хранится
    expect(cleanRadarItem({ key: 'sc:track:5', id: 5, group: [4, 5, 5, 'x', -1, 1.5] })?.group).toEqual([4, 5]);
    expect(cleanRadarItem({ key: 'sc:track:5', id: 5, group: [4, 6] })?.group).toBeUndefined();
    expect(cleanRadarItem({ key: 'sc:track:5', id: 5, group: [5] })?.group).toBeUndefined();
    expect(cleanRadarItem({ key: 'sc:track:6', id: 5 })).toBeNull();
    expect(cleanRadarItem({ key: 'sc:track:0', id: 0 })).toBeNull();
    expect(cleanRadarItem('x')).toBeNull();
});

const folders: string[] = [];
afterEach(() => {
    for (const created of folders.splice(0)) rmSync(created, { recursive: true, force: true });
});

it('сборка в worker: до конца обхода ждёт, после публикует один раз; подписка без истории даёт слабую связь', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sc-radar-test-'));
    folders.push(directory);
    const store = new RecommendStore(directory);
    const index = new HistoryIndex(directory, new WaveSignals(directory));
    const taste = new TasteService(directory, index, () => [], (user, played) => store.tasteLibrary(user, played));
    const empty: WaveExclusionList = { tracks: [], artists: [], laterTracks: [], laterArtists: [], more: [], families: [] };
    const radar = new RadarService(store, index, taste, () => empty);
    const now = Date.now();
    const cutoff = now - 3600000;
    try {
        store.syncStart(77, 'followings', false, now);
        store.syncPage(77, 'followings', 1, [{ key: 'sc:user:5' }], null, now);
        store.syncFinish(77, 'followings', 1, 'complete', '', now);
        const at = (age: number): string => new Date(cutoff - age).toISOString();
        store.recordUploads(77, [
            { id: 51, kind: 'track', title: 'Fresh', user_id: 5, user: { id: 5, username: 'Five' }, duration: 200000, created_at: at(2 * DAY) },
            { id: 52, kind: 'track', title: 'Artist - Reup', user_id: 5, user: { id: 5, username: 'Five' }, duration: 200000, created_at: at(DAY) },
            { id: 53, kind: 'track', title: 'Ancient', user_id: 5, user: { id: 5, username: 'Five' }, duration: 200000, created_at: at(90 * DAY) },
        ], now);
        expect(radar.plan(77, now).map((source) => source.key)).toEqual(['user:5']);
        expect(radar.build(77, '2026-09-25', cutoff, false, false, now)).toEqual({ published: false, waiting: true, edition: null });
        store.catalogChecked(77, 'user:5', 'Five', 'ok', '', 3, now - 60000);
        const outcome = radar.build(77, '2026-09-25', cutoff, false, false, now);
        expect(outcome).toMatchObject({ published: true, edition: { status: 'complete', revision: 1, coverage: { accounts: 1, checked: 1 } } });
        expect(outcome.edition?.items.map((item) => [item.id, item.reason.kind])).toEqual([[51, 'follow']]);
        expect(outcome.edition?.uploads.map((item) => item.id)).toEqual([52]);
        expect(radar.build(77, '2026-09-25', cutoff, true, false, now)).toEqual({ published: false, waiting: false, edition: null });
        expect(store.editions(77)).toHaveLength(1);
    } finally {
        index.close();
        store.close();
    }
});

it('выпуск для страницы: «Уже слышал» на сейчас без перестановки; «Все найденные» без позиций выпуска, найденное позже с отметкой', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sc-radar-test-'));
    folders.push(directory);
    const store = new RecommendStore(directory);
    const index = new HistoryIndex(directory, new WaveSignals(directory));
    const taste = new TasteService(directory, index, () => [], (user, played) => store.tasteLibrary(user, played));
    const empty: WaveExclusionList = { tracks: [], artists: [], laterTracks: [], laterArtists: [], more: [], families: [] };
    const radar = new RadarService(store, index, taste, () => empty);
    const now = Date.now();
    const cutoff = now - 3 * 3600000;
    const at = (shift: number): string => new Date(cutoff + shift).toISOString();
    const track = (id: number, title: string, created: string): object => ({ id, kind: 'track', title, user_id: 5, user: { id: 5, username: 'Five' }, duration: 200000, created_at: created });
    try {
        store.syncStart(77, 'followings', false, now);
        store.syncPage(77, 'followings', 1, [{ key: 'sc:user:5' }], null, now);
        store.syncFinish(77, 'followings', 1, 'complete', '', now);
        store.recordUploads(77, [track(51, 'Fresh', at(-2 * DAY)), track(52, 'Artist - Reup', at(-DAY))], now - 4 * 3600000);
        store.catalogChecked(77, 'user:5', 'Five', 'ok', '', 2, now - 4 * 3600000);
        expect(radar.build(77, '2026-09-25', cutoff, false, false, now).published).toBe(true);
        // После выпуска: лайк позиции и новая загрузка подписки
        store.syncStart(77, 'likes', false, now);
        store.syncPage(77, 'likes', 1, [{ key: 'sc:track:51' }], null, now);
        store.syncFinish(77, 'likes', 1, 'complete', '', now);
        store.recordUploads(77, [track(54, 'Later', at(3600000))], now);

        const view = radar.view(77, undefined, undefined, now);
        expect(view.editions.map((entry) => [entry.period, entry.revision])).toEqual([['2026-09-25', 1]]);
        expect(view.edition?.items.map((item) => [item.id, item.heard])).toEqual([[51, true]]);
        expect(view.edition?.uploads.map((item) => item.id)).toEqual([52]);
        expect(radar.view(77, '2026-09-18', 1, now)).toEqual({ edition: null, editions: view.editions });

        const found = radar.found(77, '2026-09-25', 1, now);
        expect(found.map((item) => [item.id, item.after === true])).toEqual([[54, true]]);
        expect(radar.found(77, '2026-09-18', 1, now)).toEqual([]);
        expect(radar.found('77', '2026-09-25', 1, now)).toEqual([]);
    } finally {
        index.close();
        store.close();
    }
});
