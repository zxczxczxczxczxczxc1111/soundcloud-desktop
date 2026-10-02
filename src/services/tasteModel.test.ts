import { expect, it } from 'vitest';
import type { TastePlay, WaveSlice } from './historyIndex';
import type { TasteLibrary } from './recommendStore';
import { buildTaste, playWeights, TASTE_PARAMS, type TasteMark } from './tasteModel';

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 24, 12);
let clock = 0;
function play(fields: Partial<TastePlay>): TastePlay {
    clock++;
    return {
        at: NOW - 3600000 + clock, id: 1, artist: 10, heard: 200000, dur: 200000, end: 'done', source: 'site:single', likedNow: false, away: false,
        covered: null, endedBy: '', picked: false, looped: false, genre: 'techno', tags: '"dark techno" berlin', title: '', artistName: 'Artist', artwork: '', path: '/artist/one',
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
});

it('смена трека раньше секунды не сигнал, лайк при ней засчитывается', () => {
    expect(playWeights({ heard: 400, dur: 200000, end: 'skip', likedNow: false, endedBy: 'user' })).toBeNull();
    expect(playWeights({ heard: 400, dur: 200000, end: 'skip', likedNow: true, endedBy: 'user' })).toEqual([2, 0.8, 0.3]);
    const profile = buildTaste([...confident, play({ id: 1, heard: 400, end: 'skip', endedBy: 'user' })], [], empty, NOW).profile;
    expect(weightOf(profile.tracks, 1)).toBeUndefined();
    expect(weightOf(profile.artists, 10)).toBeUndefined();
});

it('круг повтора не плюсует артиста и теги, серия кругов подряд даёт один голос переслушивания', () => {
    const wave = { source: 'wave:similar' };
    const once = buildTaste([...confident, play({ id: 1, ...wave })], [], empty, NOW).profile;
    const loops = buildTaste([...confident, play({ id: 1, ...wave }), ...[1, 2, 3].map(() => play({ id: 1, ...wave, looped: true }))], [], empty, NOW).profile;
    expect(weightOf(loops.artists, 10)).toBeCloseTo(weightOf(once.artists, 10) ?? 0, 6);
    expect(weightOf(loops.tags, 'techno')).toBeCloseTo(weightOf(once.tags, 'techno') ?? 0, 6);
    // Прослушивание 0.7 и один голос переслушивания 0.7; за каждый круг вышло бы 2 на потолке суток
    expect(weightOf(loops.tracks, 1)).toBeCloseTo(blended(1.4, HOUR_AGE), 2);
    expect(loops.counted).toBe(201);
    // Отдельное прослушивание после серии снова голосует
    const again = buildTaste([...confident, play({ id: 1, ...wave, at: NOW - 3 * DAY }), play({ id: 1, ...wave, at: NOW - 3 * DAY + 200000, looped: true }), play({ id: 1, ...wave })], [], empty, NOW).profile;
    expect(weightOf(again.tracks, 1)).toBeCloseTo(blended(1.4, 3) + blended(1.4, HOUR_AGE), 2);
});

it('В2.3: «Не нравится», скрытый аккаунт и «Не сейчас» минусом; «Больше такого» с названием учит участников и семью', () => {
    const marks: TasteMark[] = [
        { id: 7, artist: 70, genre: 'Phonk', tags: '', at: NOW, kind: 'track', title: 'Some Song', name: 'Uploader' },
        { id: 8, artist: 80, genre: '', tags: '', at: NOW, kind: 'later-track', title: 'Other', name: 'Other Uploader' },
        { id: 90, artist: 90, genre: '', tags: '', at: NOW, kind: 'artist', name: 'Spam' },
        { id: 91, artist: 91, genre: '', tags: '', at: NOW, kind: 'later-artist', name: 'Tired' },
        { id: 9, artist: 99, genre: '', tags: '', at: NOW, kind: 'more', title: 'Artist X - Song (slowed)', name: 'Channel' },
    ];
    const { profile } = buildTaste(confident, marks, empty, NOW);
    expect(weightOf(profile.tracks, 7)).toBeCloseTo(-2, 2);
    expect(weightOf(profile.artists, 70)).toBeCloseTo(-0.5, 2);
    expect(weightOf(profile.tags, 'phonk')).toBeCloseTo(-0.2, 2);
    expect(weightOf(profile.tracks, 8)).toBeCloseTo(-0.5, 2);
    expect(weightOf(profile.artists, 90)).toBeCloseTo(-1, 2);
    expect(weightOf(profile.artists, 91)).toBeCloseTo(-0.3, 2);
    // «Больше такого» чужой песни на канале: участник из названия и семья версий, каналу половина
    expect(weightOf(profile.credits, 'artistx')).toBeCloseTo(0.8, 2);
    expect(weightOf(profile.families, 'song|artistx')).toBeCloseTo(0.6, 2);
    expect(weightOf(profile.artists, 99)).toBeCloseTo(0.4, 2);
});

it('В2.3: прослушивание в простое плюсом не считается; В2.11: убранный аккаунт снят и из участников, уверенность растёт плавно', () => {
    const away = buildTaste([...confident, play({ id: 1, away: true }), play({ id: 1, away: true, at: NOW - 1000 })], [], empty, NOW).profile;
    expect(weightOf(away.tracks, 1)).toBeUndefined();
    expect(weightOf(away.artists, 10)).toBeUndefined();
    const own = { artist: 50, artistName: 'Artist Z', title: 'Tune' };
    const dropped = buildTaste([...confident, play({ id: 2, ...own })], [], { artists: [50], tags: [] }, NOW).profile;
    expect(weightOf(dropped.artists, 50)).toBeUndefined();
    expect(weightOf(dropped.credits, 'artistz')).toBeUndefined();
    // Сто засчитанных из двухсот: три четверти силы, а не половина
    const half = buildTaste([...confident.slice(0, 99), play({ id: 1 })], [], empty, NOW).profile;
    expect(weightOf(half.tracks, 1)).toBeCloseTo(blended(0.75, HOUR_AGE), 2);
});

it('волна ослабляет плюсы, но не минусы; без уверенности всё вполсилы', () => {
    const site = buildTaste([...confident, play({ id: 1 })], [], empty, NOW).profile;
    const wave = buildTaste([...confident, play({ id: 1, source: 'wave:similar' })], [], empty, NOW).profile;
    const picked = buildTaste([...confident, play({ id: 1, source: 'wave:similar', picked: true })], [], empty, NOW).profile;
    const skipped = buildTaste([...confident, play({ id: 1, source: 'wave:similar', heard: 5000, end: 'skip' })], [], empty, NOW).profile;
    const unsure = buildTaste([play({ id: 1 })], [], empty, NOW).profile;
    expect(weightOf(site.tracks, 1)).toBeCloseTo(blended(1, HOUR_AGE), 2);
    expect(weightOf(wave.tracks, 1)).toBeCloseTo(blended(0.7, HOUR_AGE), 2);
    // Выбранный кликом трек волны весит как выбранный на сайте
    expect(weightOf(picked.tracks, 1)).toBeCloseTo(blended(1, HOUR_AGE), 2);
    // «Моя музыка» играет собранное самим человеком: без скидки волны (Э7)
    const library = buildTaste([...confident, play({ id: 1, source: 'wave:library' })], [], empty, NOW).profile;
    expect(weightOf(library.tracks, 1)).toBeCloseTo(blended(1, HOUR_AGE), 2);
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
    // Жанр весит целиком, две метки делят 0.5 пополам
    expect(weightOf(profile.tags, 'darktechno')).toBeCloseTo(blended(0.2 * 0.25, HOUR_AGE, false), 3);
    // Ручное действие подтверждает сразу
    expect(weightOf(profile.tags, 'drumandbass')).toBeCloseTo(0.3, 2);
    expect(weightOf(profile.tracks, 7)).toBeCloseTo(2, 2);
    expect(weightOf(profile.artists, 70)).toBeCloseTo(0.8, 2);
    expect(weightOf(profile.artists, 10)).toBeUndefined();
    expect(view.removed.artists).toEqual([{ id: 10, name: 'Artist' }]);
    expect(view.tags.find((tag) => tag.key === 'darktechno')?.label).toBe('dark techno');
    expect(view.artists.some((artist) => artist.id === 10)).toBe(false);
});

it('пачка меток на все жанры и ник артиста в метках не раздувают вкус: жанр 1, метки вместе 0.5, ник и числа выброшены', () => {
    const spam = { genre: 'Alternative Rock', tags: 'Alternative "Hip Hop" Rap Ambient Dark ivoxygen 333', artist: 40, artistName: 'IVOXYGEN' };
    const profile = buildTaste([...confident, play({ id: 41, ...spam, title: 'Castle' })], [], empty, NOW).profile;
    const rock = weightOf(profile.tags, 'alternativerock') ?? 0;
    expect(rock).toBeGreaterThan(0);
    // Пять меток после жанра (hip hop и rap склеены в один hiphop) делят половину веса жанра
    expect(weightOf(profile.tags, 'ambient')).toBeCloseTo(rock * 0.5 / 4, 3);
    expect(weightOf(profile.tags, 'hiphop')).toBeCloseTo(rock * 0.5 / 4, 3);
    expect(weightOf(profile.tags, 'ivoxygen')).toBeUndefined();
    expect(weightOf(profile.tags, '333')).toBeUndefined();
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

it('П5: ночной артист выше ночью и ниже днём, поправка не больше потолка и модуля общего веса', () => {
    // Местное время: понедельник-среда перед NOW, ночь 2:00, утро 8:00, день 14:00, вечер 20:00
    const at = (day: number, hour: number, i: number): number => new Date(2026, 8, 21 + day, hour, i).getTime();
    const plays: TastePlay[] = [];
    for (let i = 0; i < 20; i++) {
        plays.push(play({ at: at(i % 3, 2, i), id: 100 + i, artist: 1, artistName: 'Night', genre: 'ambient', tags: '' }));
        plays.push(play({ at: at(i % 3, 14, i), id: 200 + i, artist: 2, artistName: 'Day', genre: 'techno', tags: '' }));
    }
    for (let i = 0; i < 10; i++) {
        plays.push(play({ at: at(i % 3, 8, i), id: 300 + i, artist: 3, artistName: 'Filler', genre: 'house', tags: '' }));
        plays.push(play({ at: at(i % 3, 20, i), id: 400 + i, artist: 3, artistName: 'Filler', genre: 'house', tags: '' }));
    }
    plays.sort((a, b) => a.at - b.at);
    const { profile } = buildTaste([...confident, ...plays], [], empty, NOW);
    const context = (key: number) => profile.contexts.find((entry) => entry.key === key);
    // Будний день: ночь это ключ 0, день ключ 4
    const night = context(0);
    const day = context(4);
    expect(weightOf(night?.artists ?? [], 1)).toBeGreaterThan(0);
    expect(weightOf(night?.artists ?? [], 2)).toBeLessThan(0);
    expect(weightOf(day?.artists ?? [], 2)).toBeGreaterThan(0);
    expect(weightOf(day?.artists ?? [], 1)).toBeLessThan(0);
    expect(weightOf(night?.tags ?? [], 'ambient')).toBeGreaterThan(0);
    expect(weightOf(night?.tags ?? [], 'techno')).toBeLessThan(0);
    for (const entry of profile.contexts) {
        for (const [id, delta] of entry.artists) expect(Math.abs(delta)).toBeLessThanOrEqual(Math.min(TASTE_PARAMS.contextArtistCap, Math.abs(weightOf(profile.artists, id) ?? 0)) + 0.001);
        for (const [key, delta] of entry.tags) expect(Math.abs(delta)).toBeLessThanOrEqual(Math.min(TASTE_PARAMS.contextTagCap, Math.abs(weightOf(profile.tags, key) ?? 0)) + 0.001);
    }
    // Выходных в журнале нет: их поправка идёт от отрезка без типа дня, сжатая сильнее
    const weekendNight = weightOf(context(1)?.artists ?? [], 1) ?? 0;
    expect(weekendNight).toBeGreaterThan(0);
    expect(weekendNight).toBeLessThan(weightOf(night?.artists ?? [], 1) ?? 0);
});

it('П6, П9: язык трека копится частью вкуса, статистика источников волны уходит в профиль', () => {
    const plays: TastePlay[] = [];
    for (let i = 0; i < 10; i++) {
        plays.push(play({ id: 500 + i, artist: 50 + i, title: 'Песня ' + i, artistName: 'Артист ' + i, end: 'skip', endedBy: 'user', heard: 10000 }));
        plays.push(play({ id: 600 + i, artist: 60 + i, title: 'Song ' + i, artistName: 'Artist ' + i }));
        plays.push(play({ id: 700 + i, artist: 70 + i, title: 'Night Drive (Instrumental)', artistName: 'Beats' }));
    }
    const sources: WaveSlice[] = [
        { key: 'relatedArtist', plays: 10, early: 2, done: 7, likes: 0, more: 0, against: 0 },
        { key: '', plays: 5, early: 1, done: 1, likes: 0, more: 0, against: 0 },
        { key: 'scMix', plays: 0, early: 0, done: 0, likes: 0, more: 0, against: 0 },
    ];
    const { profile } = buildTaste([...confident, ...plays], [], empty, NOW, null, sources);
    expect(weightOf(profile.langs, 'cyr')).toBeLessThan(0);
    expect(weightOf(profile.langs, 'lat')).toBeGreaterThan(0);
    expect(weightOf(profile.langs, 'inst')).toBeGreaterThan(0);
    // У трека без названия язык не считается: двести прослушиваний трека 999 латиницу не раздули
    expect(profile.langs).toHaveLength(3);
    expect(weightOf(profile.langs, 'lat')).toBeLessThan(1);
    expect(profile.sources).toEqual([['relatedArtist', 7, 2]]);
});
