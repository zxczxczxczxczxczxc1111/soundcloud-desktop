import { expect, it } from 'vitest';
import { extractThemeColors } from './colorExtractor';

it('отклоняет HTML и JavaScript после цветовой функции', () => {
    const css = '--primary-color: rgb(1,2,3)</style><svg onload="alert(1)">;';
    expect(extractThemeColors(css)?.primary).toBe('#ff5500');
    expect(extractThemeColors('--primary-color: rgb(1,2,3)${alert(1)};')?.primary).toBe('#ff5500');
});
it('сохраняет обычные форматы палитры', () => {
    for (const color of ['#123', '#abcdef', 'red', 'rgba(1, 2, 3, 0.5)', 'hsl(120deg 50% 30% / 0.8)']) {
        expect(extractThemeColors('--primary-color: ' + color + ';')?.primary).toBe(color);
    }
});
