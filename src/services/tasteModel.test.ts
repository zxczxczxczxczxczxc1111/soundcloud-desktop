import { expect, it } from 'vitest';
import type { TastePlay } from './historyIndex';
import { buildTaste, playWeights, type TasteMark } from './tasteModel';

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 24, 12);
let clock = 0;
function play(fields: Partial<TastePlay>): TastePlay {
    clock++;
    return {
        at: NOW - 3600000 + clock, id: 1, artist: 10, heard: 200000, dur: 200000, end: 'done', source: 'site:single', likedNow: false, away: false,
        genre: 'techno', tags: '"dark techno" berlin', artistName: 'Artist', artwork: '', path: '/artist/one', ...fields,
    };
}
// Выше порога уверенности: 200 засчитанных прослушиваний чужого трека далеко в прошлом, чтобы веса шли в полную силу
const confident = Array.from({ length: 200 }, (_, i) => play({ at: NOW - 400 * DAY + i, id: 999, artist: 999, genre: '', tags: '' }));
const empty = { artists: [], tags: [] };
const weightOf = <K>(list: Array<[K, number]>, key: K): number | undefined => list.find(([item]) => item === key)?.[1];

it('исход прослушивания по таблице плана', () => {
    expect(playWeights({ heard: 10000, dur: 200000, end: 'skip', likedNow: false })).toEqual([-1, -0.3, -0.1]);
    expect(playWeights({ heard: 60000, dur: 200000, end: 'skip', likedNow: false })).toEqual([-0.2, 0, 0]);
    expect(playWeights({ heard: 120000, dur: 200000, end: 'skip', likedNow: false })).toEqual([0.5, 0.2, 0.1]);
    expect(playWeights({ heard: 190000, dur: 200000, end: 'done', likedNow: false })).toEqual([1, 0.4, 0.2]);
    // Перемотка в конец: done, но звука меньше 80%
    expect(playWeights({ heard: 120000, dur: 200000, end: 'done', likedNow: false })).toEqual([0.5, 0.2, 0.1]);
    const liked = playWeights({ heard: 190000, dur: 200000, end: 'done', likedNow: true }) ?? [];
    [3, 1.2, 0.5].forEach((value, index) => expect(liked[index]).toBeCloseTo(value, 6));
    expect(playWeights({ heard: 190000, dur: 200000, end: 'stop', likedNow: false })).toBeNull();
    expect(playWeights({ heard: 10000, dur: 200000, end: 'done', likedNow: false })).toBeNull();
});

it('волна и фон ослабляют плюсы, но не минусы; без уверенности всё вполсилы', () => {
    const site = buildTaste([...confident, play({ id: 1 })], [], empty, NOW).profile;
    const wave = buildTaste([...confident, play({ id: 1, source: 'wave:similar' })], [], empty, NOW).profile;
    const away = buildTaste([...confident, play({ id: 1, away: true })], [], empty, NOW).profile;
    const skipped = buildTaste([...confident, play({ id: 1, source: 'wave:similar', heard: 5000, end: 'skip' })], [], empty, NOW).profile;
    const unsure = buildTaste([play({ id: 1 })], [], empty, NOW).profile;
    expect(weightOf(site.tracks, 1)).toBeCloseTo(1, 2);
    expect(weightOf(wave.tracks, 1)).toBeCloseTo(0.7, 2);
    expect(weightOf(away.tracks, 1)).toBeCloseTo(0.5, 2);
    expect(weightOf(skipped.tracks, 1)).toBeCloseTo(-1, 2);
    expect(weightOf(skipped.artists, 10)).toBeCloseTo(-0.3, 2);
    expect(weightOf(unsure.tracks, 1)).toBeCloseTo(0.5, 2);
    expect(site.counted).toBe(201);
});

it('старое забывается с полураспадом 60 дней, переслушивание за 14 дней добавляет треку', () => {
    const old = buildTaste([...confident, play({ id: 1, at: NOW - 60 * DAY })], [], empty, NOW).profile;
    expect(weightOf(old.tracks, 1)).toBeCloseTo(0.5, 2);
    const replay = buildTaste([...confident, play({ id: 1, at: NOW - 3 * DAY }), play({ id: 1 })], [], empty, NOW).profile;
    const once = (days: number): number => Math.pow(0.5, days / 60);
    expect(weightOf(replay.tracks, 1)).toBeCloseTo(once(3) + 2, 1);
    // Артист от переслушивания не растёт
    expect(weightOf(replay.artists, 10)).toBeCloseTo(0.4 * once(3) + 0.4, 2);
});

it('теги по ключам без регистра и знаков, «Больше такого» как лайк, убранное из вкуса не уходит', () => {
    const mark: TasteMark = { id: 7, artist: 70, genre: 'Drum & Bass', tags: '', at: NOW };
    const { profile, view } = buildTaste([...confident, play({ id: 1 })], [mark], { artists: [10], tags: [] }, NOW);
    expect(weightOf(profile.tags, 'techno')).toBeCloseTo(0.2, 2);
    expect(weightOf(profile.tags, 'darktechno')).toBeCloseTo(0.2, 2);
    expect(weightOf(profile.tags, 'drumandbass')).toBeCloseTo(0.3, 2);
    expect(weightOf(profile.tracks, 7)).toBeCloseTo(2, 2);
    expect(weightOf(profile.artists, 70)).toBeCloseTo(0.8, 2);
    expect(weightOf(profile.artists, 10)).toBeUndefined();
    expect(view.removed.artists).toEqual([{ id: 10, name: 'Artist' }]);
    expect(view.tags.find((tag) => tag.key === 'darktechno')?.label).toBe('dark techno');
    expect(view.artists.some((artist) => artist.id === 10)).toBe(false);
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
