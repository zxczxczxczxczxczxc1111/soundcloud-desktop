import { describe, expect, it } from 'vitest';
import { glowPalette } from './glow';

// Картинка из пикселей: список [r, g, b, сколько раз]
const pixels = (...parts: Array<[number, number, number, number]>): number[] => parts.flatMap(([r, g, b, n]) => Array.from({ length: n }, () => [r, g, b, 255]).flat());
const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

describe('glowPalette', () => {
    it('серая, чёрная и белая обложка цветов не даёт', () => {
        expect(glowPalette(pixels([74, 78, 80, 300], [10, 10, 10, 200], [250, 250, 250, 100]))).toEqual([]);
        // Пара цветных точек на чёрно-белой обложке случайна
        expect(glowPalette(pixels([74, 78, 80, 300], [220, 30, 30, 5]))).toEqual([]);
        expect(glowPalette([])).toEqual([]);
    });

    it('чёрно-белый снимок с небольшим цветным акцентом: свет цвета акцента', () => {
        const [r, g, b] = rgb(glowPalette(pixels([60, 60, 62, 300], [200, 200, 200, 250], [110, 80, 200, 20]))[0]);
        expect(b).toBeGreaterThan(g + 40);
        expect(r).toBeGreaterThan(g);
    });

    it('всегда три разных цвета #rrggbb', () => {
        for (const cover of [pixels([12, 12, 16, 400], [30, 60, 160, 80]), pixels([200, 30, 40, 200], [30, 40, 200, 80]), pixels([228, 118, 152, 100])]) {
            const palette = glowPalette(cover);
            expect(palette).toHaveLength(3);
            for (const color of palette) expect(color).toMatch(/^#[0-9a-f]{6}$/);
            expect(new Set(palette).size).toBe(3);
        }
    });

    it('тёмная обложка с синим светом: первый цвет синий, а не тёмно-серый средний', () => {
        const [r, g, b] = rgb(glowPalette(pixels([12, 12, 16, 400], [30, 60, 160, 80]))[0]);
        expect(b).toBeGreaterThan(r + 60);
        expect(b).toBeGreaterThan(g);
    });

    it('пёстрая обложка: первым идёт оттенок с большим весом, вторым другой оттенок, а не их смесь', () => {
        const [first, second] = glowPalette(pixels([200, 30, 40, 200], [30, 40, 200, 80])).map(rgb);
        expect(first[0]).toBeGreaterThan(first[2] + 60);
        expect(second[2]).toBeGreaterThan(second[0] + 60);
    });

    it('светлота ровная: тёмный красный даёт такой же светлый первый цвет, как яркий', () => {
        const dull = rgb(glowPalette(pixels([110, 20, 20, 100]))[0]);
        const bright = rgb(glowPalette(pixels([255, 30, 30, 100]))[0]);
        expect(Math.max(...dull)).toBeGreaterThan(180);
        expect(Math.abs(Math.max(...dull) - Math.max(...bright))).toBeLessThan(40);
    });

    it('прозрачные пиксели не считаются', () => {
        const data = [...pixels([30, 40, 200, 50]), ...Array.from({ length: 500 }, () => [255, 0, 0, 0]).flat()];
        const [r, , b] = rgb(glowPalette(data)[0]);
        expect(b).toBeGreaterThan(r);
    });
});
