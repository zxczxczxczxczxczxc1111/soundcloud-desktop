import { expect, it } from 'vitest';
import type { TastePlay } from './historyIndex';
import type { TasteLibrary } from './recommendStore';
import { buildTaste, playWeights, TASTE_PARAMS, type TasteMark } from './tasteModel';

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 24, 12);
let clock = 0;
function play(fields: Partial<TastePlay>): TastePlay {
    clock++;
    return {
        at: NOW - 3600000 + clock, id: 1, artist: 10, heard: 200000, dur: 200000, end: 'done', source: 'site:single', likedNow: false, away: false,
        covered: null, endedBy: '', picked: false, genre: 'techno', tags: '"dark techno" berlin', title: '', artistName: 'Artist', artwork: '', path: '/artist/one',
        ...fields,
    };
}
// Выше порога уверенности: 200 засчитанных прослушиваний чужого трека далеко в прошлом, чтобы веса шли в полную силу
const confident = Array.from({ length: 200 }, (_, i) => play({ at: NOW - 400 * DAY + i, id: 999, artist: 999, genre: '', tags: '', artistName: 'Old' }));
const empty = { artists: [], tags: [] };
const weightOf = <K>(list: Array<[K, number]>, key: K): number | undefined => list.find(([item]) => item === key)?.[1];
/** Вклад value давностью age дней после смешивания частей; week: входит ли он в недельную часть */
const blended = (value: number, age: number, week = true): number => {
    const { blend, halfLifeDays } = TASTE_PARAMS;
    return value * (blend.long * Math.pow(0.5, age / halfLifeDays) + (age <= 30 ? blend.month : 0) + (age <= 7 && week ? blend.week : 0));
};
const HOUR_AGE = 1 / 24;

it('исход прослушивания: минус только за уход по воле человека', () => {
    expect(playWeights({ heard: 10000, dur: 200000, end: 'skip', likedNow: false })).toEqual([-1, -0.3, -0.1]);
    expect(playWeights({ heard: 60000, dur: 200000, end: 'skip', likedNow: false })).toEqual([-0.2, 0, 0]);
    expect(playWeights({ heard: 120000, dur: 200000, end: 'skip', likedNow: false })).toEqual([0.5, 0.2, 0.1]);
    expect(playWeights({ heard: 190000, dur: 200000, end: 'done', likedNow: false })).toEqual([1, 0.4, 0.2]);
    // Перемотка в конец: done, но звука меньше 80% или меньше половины. Перемотка не дизлайк
    expect(playWeights({ heard: 120000, dur: 200000, end: 'done', likedNow: false })).toEqual([0.5, 0.2, 0.1]);
    expect(playWeights({ heard: 60000, dur: 200000, end: 'done', likedNow: false })).toBeNull();
    const liked = playWeights({ heard: 190000, dur: 200000, end: 'done', likedNow: true }) ?? [];
    [3, 1.2, 0.5].forEach((value, index) => expect(liked[index]).toBeCloseTo(value, 6));
    expect(playWeights({ heard: 10000, dur: 200000, end: 'done', likedNow: false })).toBeNull();
    // Закрытие клиента: слышанное засчитывается, минуса нет
    expect(playWeights({ heard: 190000, dur: 200000, end: 'stop', likedNow: false })).toEqual([1, 0.4, 0.2]);
    expect(playWeights({ heard: 120000, dur: 200000, end: 'stop', likedNow: false })).toEqual([0.5, 0.2, 0.1]);
    expect(playWeights({ heard: 60000, dur: 200000, end: 'stop', likedNow: false })).toBeNull();
    expect(playWeights({ heard: 10000, dur: 200000, end: 'stop', likedNow: false })).toBeNull();
});

it('A21: ошибка и конец очереди не дизлайк, кусок на повторе не полное прослушивание', () => {
    // Трек сменил сам сайт (ошибка воспроизведения, конец очереди)
    expect(playWeights({ heard: 10000, dur: 200000, end: 'skip', likedNow: false, endedBy: 'auto' })).toBeNull();
    expect(playWeights({ heard: 60000, dur: 200000, end: 'skip', likedNow: false, endedBy: 'auto' })).toBeNull();
    expect(playWeights({ heard: 190000, dur: 200000, end: 'skip', likedNow: false, endedBy: 'auto' })).toEqual([1, 0.4, 0.2]);
    expect(playWeights({ heard: 10000, dur: 200000, end: 'skip', likedNow: false, endedBy: 'user' })).toEqual([-1, -0.3, -0.1]);
    // Одни и те же 40 секунд по кругу: слышно 190, покрыто 40. Ни полного прослушивания, ни частичного ухода
    expect(playWeights({ heard: 190000, covered: 40000, dur: 200000, end: 'done', likedNow: false })).toBeNull();
    expect(playWeights({ heard: 190000, covered: 40000, dur: 200000, end: 'skip', likedNow: false, endedBy: 'user' })).toBeNull();
    // Перемотка вперёд: покрыто меньше слышанного не бывает, берётся меньшее
    expect(playWeights({ heard: 60000, covered: 60000, dur: 200000, end: 'skip', likedNow: false, endedBy: 'user' })).toEqual([-0.2, 0, 0]);
    expect(playWeights({ heard: 170000, covered: 120000, dur: 200000, end: 'done', likedNow: false })).toEqual([0.5, 0.2, 0.1]);
    // Ошибка в первые секунды не превращается в пропуск и на странице истории
    const { view } = buildTaste([
        play({ source: 'wave:similar', heard: 5000, end: 'skip', endedBy: 'auto' }),
        play({ source: 'wave:similar', heard: 5000, end: 'skip', endedBy: 'user' }),
        play({ source: 'wave:similar', heard: 50000, end: 'stop' }),
    ], [], empty, NOW);
    expect(view.early[29]).toMatchObject({ total: 2, early: 1 });
});

it('волна ослабляет плюсы, но не минусы; простой системы нейтрален; без уверенности всё вполсилы', () => {
    const site = buildTaste([...confident, play({ id: 1 })], [], empty, NOW).profile;
    const wave = buildTaste([...confident, play({ id: 1, source: 'wave:similar' })], [], empty, NOW).profile;
    const picked = buildTaste([...confident, play({ id: 1, source: 'wave:similar', picked: true })], [], empty, NOW).profile;
    const away = buildTaste([...confident, play({ id: 1, away: true })], [], empty, NOW).profile;
    const skipped = buildTaste([...confident, play({ id: 1, source: 'wave:similar', heard: 5000, end: 'skip' })], [], empty, NOW).profile;
    const unsure = buildTaste([play({ id: 1 })], [], empty, NOW).profile;
    expect(weightOf(site.tracks, 1)).toBeCloseTo(blended(1, HOUR_AGE), 2);
    expect(weightOf(wave.tracks, 1)).toBeCloseTo(blended(0.7, HOUR_AGE), 2);
    // Выбранный кликом трек волны весит как выбранный на сайте
    expect(weightOf(picked.tracks, 1)).toBeCloseTo(blended(1, HOUR_AGE), 2);
    expect(weightOf(away.tracks, 1)).toBeCloseTo(weightOf(site.tracks, 1) ?? 0, 6);
    expect(weightOf(away.artists, 10)).toBeCloseTo(weightOf(site.artists, 10) ?? 0, 6);
    expect(weightOf(skipped.tracks, 1)).toBeCloseTo(-1, 2);
    expect(weightOf(skipped.artists, 10)).toBeCloseTo(-0.3, 2);
    expect(weightOf(unsure.tracks, 1)).toBeCloseTo(blended(0.5, HOUR_AGE), 2);
    expect(site.counted).toBe(201);
    expect(site.version).toBe(TASTE_PARAMS.version);
});

it('старое живёт в устойчивой части, переслушивание за 14 дней добавляет треку', () => {
    const old = buildTaste([...confident, play({ id: 1, at: NOW - 60 * DAY })], [], empty, NOW).profile;
    expect(weightOf(old.tracks, 1)).toBeCloseTo(blended(1, 60), 2);
    const replay = buildTaste([...confident, play({ id: 1, at: NOW - 3 * DAY }), play({ id: 1 })], [], empty, NOW).profile;
    expect(weightOf(replay.tracks, 1)).toBeCloseTo(blended(1, 3) + blended(2, HOUR_AGE), 1);
    // Артист от переслушивания не растёт; два разных дня подтверждают интерес недели
    expect(weightOf(replay.artists, 10)).toBeCloseTo(blended(0.4, 3) + blended(0.4, HOUR_AGE), 2);
});

it('теги по ключам без регистра и знаков, «Больше такого» как лайк, убранное из вкуса не уходит', () => {
    const mark: TasteMark = { id: 7, artist: 70, genre: 'Drum & Bass', tags: '', at: NOW };
    const { profile, view } = buildTaste([...confident, play({ id: 1 })], [mark], { artists: [10], tags: [] }, NOW);
    // Один трек за неделю новый интерес не подтверждает: недельная часть его тегам не идёт
    expect(weightOf(profile.tags, 'techno')).toBeCloseTo(blended(0.2, HOUR_AGE, false), 2);
    expect(weightOf(profile.tags, 'darktechno')).toBeCloseTo(blended(0.2, HOUR_AGE, false), 2);
    // Ручное действие подтверждает сразу
    expect(weightOf(profile.tags, 'drumandbass')).toBeCloseTo(0.3, 2);
    expect(weightOf(profile.tracks, 7)).toBeCloseTo(2, 2);
    expect(weightOf(profile.artists, 70)).toBeCloseTo(0.8, 2);
    expect(weightOf(profile.artists, 10)).toBeUndefined();
    expect(view.removed.artists).toEqual([{ id: 10, name: 'Artist' }]);
    expect(view.tags.find((tag) => tag.key === 'darktechno')?.label).toBe('dark techno');
    expect(view.artists.some((artist) => artist.id === 10)).toBe(false);
});

it('новый интерес недели подтверждают две разные записи или два дня, копии одной версии за две не идут', () => {
    const phonk = { genre: 'phonk', tags: '', artist: 30, artistName: 'Drift' };
    const one = buildTaste([...confident, play({ id: 31, ...phonk, title: 'Drift - Night' })], [], empty, NOW).profile;
    const two = buildTaste([...confident, play({ id: 31, ...phonk, title: 'Drift - Night' }), play({ id: 32, ...phonk, title: 'Drift - Day' })], [], empty, NOW).profile;
    // Перезалив той же версии с той же длительностью: одна запись
    const copies = buildTaste([...confident, play({ id: 31, ...phonk, title: 'Drift - Night' }), play({ id: 33, ...phonk, artist: 34, artistName: 'Reup', title: 'Drift - Night' })], [], empty, NOW).profile;
    expect(weightOf(one.tags, 'phonk')).toBeCloseTo(blended(0.2, HOUR_AGE, false), 2);
    expect(weightOf(two.tags, 'phonk')).toBeCloseTo(blended(0.4, HOUR_AGE), 2);
    expect(weightOf(copies.tags, 'phonk')).toBeCloseTo(blended(0.4, HOUR_AGE, false), 2);
});

it('24/7: хит на повторе упирается в суточный потолок и не забивает остальной вкус', () => {
    const plays: TastePlay[] = [...confident];
    for (let day = 0; day < 30; day++) {
        // Сорок прослушиваний хита в минуту друг за другом внутри одних местных суток и одно прослушивание другого трека
        for (let i = 0; i < 40; i++) plays.push(play({ at: NOW - day * DAY - (i + 1) * 60000, id: 1, artist: 10 }));
        plays.push(play({ at: NOW - day * DAY - 50 * 60000, id: 2, artist: 20, genre: 'jazz', tags: '' }));
    }
    plays.sort((a, b) => a.at - b.at);
    const { profile } = buildTaste(plays, [], empty, NOW);
    const hit = weightOf(profile.artists, 10) ?? 0;
    const other = weightOf(profile.artists, 20) ?? 0;
    expect(other).toBeGreaterThan(0);
    // Без потолка было бы в 40 раз больше; с потолком не больше отношения 1.2 к 0.4
    expect(hit / other).toBeLessThanOrEqual(3.01);
    expect((weightOf(profile.tags, 'techno') ?? 0) / (weightOf(profile.tags, 'jazz') ?? 1)).toBeLessThanOrEqual(3.01);
    // Трек за сутки набирает не больше двух
    const days = Array.from({ length: 30 }, (_, day) => blended(2, day + 0.04)).reduce((sum, value) => sum + value, 0);
    expect(weightOf(profile.tracks, 1) ?? 0).toBeLessThanOrEqual(days + 0.01);
});

it('A12: редкий, но постоянный интерес остаётся заметным рядом с жанром, который занял последний месяц', () => {
    const plays: TastePlay[] = [...confident];
    // Эмбиент раз в неделю весь год, фонк по двадцать треков в день последний месяц
    for (let week = 0; week < 52; week++) plays.push(play({ at: NOW - week * 7 * DAY - 7200000, id: 100 + week, artist: 100 + week, genre: 'ambient', tags: '' }));
    for (let day = 0; day < 30; day++)
        for (let i = 0; i < 20; i++) plays.push(play({ at: NOW - day * DAY - (i + 3) * 60000, id: 1000 + day * 20 + i, artist: 500 + i, genre: 'phonk', tags: '' }));
    plays.sort((a, b) => a.at - b.at);
    const { profile } = buildTaste(plays, [], empty, NOW);
    const ambient = weightOf(profile.tags, 'ambient') ?? 0;
    const phonk = weightOf(profile.tags, 'phonk') ?? 0;
    expect(phonk).toBeGreaterThan(ambient);
    // Без суточного потолка фонк перевешивал бы в двадцать с лишним раз
    expect(ambient / phonk).toBeGreaterThan(0.15);
});

it('A14: куратор, участники из названия, семья и пометки версии считаются отдельно; безымянный ремикс не теряется', () => {
    const plays = [
        ...confident,
        // Канал выложил чужой ремикс: исполнитель и ремиксер из названия, каналу половина
        play({ id: 41, artist: 40, artistName: 'Bass Channel', title: 'Artist X - Song (Y Remix)' }),
        // Исполнитель выложил своё: его имя тоже идёт в участники
        play({ id: 42, artist: 50, artistName: 'Artist Z', title: 'Tune (slowed + reverb)' }),
        // Безымянный ремикс без исполнителя: трек, канал и теги на месте
        play({ id: 43, artist: 60, artistName: 'anon', title: 'Nightcall (Remix)', genre: 'phonk', tags: '' }),
    ];
    const { profile } = buildTaste(plays, [], empty, NOW);
    const full = (value: number): number => blended(value, HOUR_AGE, false);
    expect(weightOf(profile.artists, 40)).toBeCloseTo(full(0.4 * TASTE_PARAMS.curatorShare), 2);
    expect(weightOf(profile.credits, 'artistx')).toBeCloseTo(full(0.4), 2);
    expect(weightOf(profile.credits, 'y')).toBeCloseTo(full(0.4), 2);
    expect(weightOf(profile.credits, 'basschannel')).toBeUndefined();
    expect(weightOf(profile.artists, 50)).toBeCloseTo(full(0.4), 2);
    expect(weightOf(profile.credits, 'artistz')).toBeCloseTo(full(0.4), 2);
    expect(weightOf(profile.families, 'tune|artistz')).toBeCloseTo(full(0.3), 2);
    expect(weightOf(profile.markers, 'slowed')).toBeCloseTo(full(0.1), 2);
    expect(weightOf(profile.markers, 'reverb')).toBeCloseTo(full(0.1), 2);
    expect(weightOf(profile.tracks, 43)).toBeCloseTo(blended(1, HOUR_AGE), 2);
    expect(weightOf(profile.artists, 60)).toBeCloseTo(full(0.4), 2);
    expect(weightOf(profile.tags, 'phonk')).toBeCloseTo(full(0.2), 2);
    expect(weightOf(profile.markers, 'remix')).toBeGreaterThan(0);
    // Дизлайк версии не переносится на семью
    const skipped = buildTaste([...confident, play({ id: 42, artist: 50, artistName: 'Artist Z', title: 'Tune (slowed + reverb)', heard: 5000, end: 'skip' })], [], empty, NOW).profile;
    expect(weightOf(skipped.families, 'tune|artistz')).toBeUndefined();
});

it('треки плейлистов (решение владельца 26.09.2026): свой 0.6 лайка без даты, сохранённый 0.3, лайкнутый второй раз не идёт', () => {
    const upload = (id: number) => ({ id, uploader: 70, uploaderName: 'Label', title: 'Label - T' + id, duration: 200000, genre: 'trap', tags: '', credits: [] });
    const library: TasteLibrary = {
        likes: [{ id: 73, added: 0, upload: upload(73) }],
        follows: [],
        playlists: [{ id: 71, own: true, upload: upload(71) }, { id: 72, own: false, upload: upload(72) }, { id: 73, own: true, upload: upload(73) }, { id: 74, own: false, upload: null }],
        uploads: [],
    };
    const { profile } = buildTaste(confident, [], empty, NOW, library);
    const undated = 2 * TASTE_PARAMS.undatedLike * TASTE_PARAMS.blend.long;
    expect(weightOf(profile.tracks, 71)).toBeCloseTo(undated * TASTE_PARAMS.playlistOwn, 2);
    expect(weightOf(profile.tracks, 72)).toBeCloseTo(undated * TASTE_PARAMS.playlistSaved, 2);
    expect(weightOf(profile.tracks, 73)).toBeCloseTo(undated, 2);
    expect(weightOf(profile.tracks, 74)).toBeCloseTo(undated * TASTE_PARAMS.playlistSaved, 2);
    expect(weightOf(profile.tags, 'trap')).toBeGreaterThan(0);
});

it('лайки сайта и подписки: дата лайка вместо даты обхода, без даты только в устойчивой части, двойного счёта нет', () => {
    const upload = (id: number, uploader: number, title: string) => ({ id, uploader, uploaderName: 'Label', title, duration: 200000, genre: 'house', tags: '', credits: [] });
    const library: TasteLibrary = {
        likes: [
            { id: 51, added: NOW - 10 * DAY, upload: upload(51, 70, 'Label - One') },
            { id: 52, added: 0, upload: upload(52, 70, 'Label - Two') },
            { id: 53, added: 0, upload: null },
            // Этот лайк уже поставлен во время прослушивания
            { id: 1, added: NOW, upload: null },
        ],
        follows: [80],
        playlists: [],
        uploads: [],
    };
    const { profile } = buildTaste([...confident, play({ id: 1, likedNow: true })], [], empty, NOW, library);
    expect(weightOf(profile.tracks, 51)).toBeCloseTo(blended(2, 10), 2);
    expect(weightOf(profile.tracks, 52)).toBeCloseTo(2 * TASTE_PARAMS.undatedLike * TASTE_PARAMS.blend.long, 2);
    expect(weightOf(profile.tracks, 53)).toBeCloseTo(2 * TASTE_PARAMS.undatedLike * TASTE_PARAMS.blend.long, 2);
    expect(weightOf(profile.tracks, 1)).toBeCloseTo(blended(3, HOUR_AGE), 2);
    expect(weightOf(profile.artists, 80)).toBeCloseTo(TASTE_PARAMS.follow * TASTE_PARAMS.blend.long, 2);
    expect(weightOf(profile.tags, 'house')).toBeGreaterThan(0);
    // Кредиты из хранилища (метаданные издателя) важнее разбора названия у сыгранного трека
    const withMeta = buildTaste([...confident, play({ id: 61, artist: 90, artistName: 'Label', title: 'One' })], [], empty, NOW, {
        likes: [], follows: [], playlists: [], uploads: [{ ...upload(61, 90, 'One'), credits: [{ name: 'Real Artist', key: 'realartist', role: 'artist', source: 'metadata' }] }],
    }).profile;
    expect(weightOf(withMeta.credits, 'realartist')).toBeCloseTo(blended(0.4, HOUR_AGE, false), 2);
    expect(weightOf(withMeta.artists, 90)).toBeCloseTo(blended(0.4 * TASTE_PARAMS.curatorShare, HOUR_AGE, false), 2);
});

it('ранние пропуски считаются только по трекам волны за 30 местных суток', () => {
    const { view } = buildTaste([
        play({ source: 'wave:similar', heard: 5000, end: 'skip' }),
        play({ source: 'wave:similar' }),
        play({ source: 'site:single', heard: 5000, end: 'skip' }),
        play({ source: 'wave:fresh', heard: 5000, end: 'skip', at: NOW - 40 * DAY }),
    ], [], empty, NOW);
    expect(view.early).toHaveLength(30);
    expect(view.early[29]).toMatchObject({ total: 2, early: 1 });
    expect(view.early.slice(0, 29).every((day) => day.total === 0)).toBe(true);
});
