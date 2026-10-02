import { expect, it } from 'vitest';
import { scoutStart } from './scout';

// 200 отсчётов на 200 с: отсчёт на секунду, форма уже сглажена (0,1-1)
const shape = (quiet: number, loudFrom: number, length = 200): number[] => Array.from({ length }, (_, i) => (i >= loudFrom ? 1 : quiet));

it('scoutStart: первое громкое место за секунду до подъёма, хвост на 20 с остаётся', () => {
    expect(scoutStart(shape(0.2, 120), 200000)).toBe(119000);
    // Подъём в последние секунды: окно не выходит за конец
    expect(scoutStart(shape(0.2, 195), 200000)).toBe(178000);
    // Громко с самого начала: место не раньше 8% трека
    expect(scoutStart(shape(1, 0), 200000)).toBe(15000);
    // Короткий трек и пустая форма играют с начала
    expect(scoutStart(shape(0.2, 20, 60), 30000)).toBe(0);
    expect(scoutStart([], 200000)).toBe(0);
});
