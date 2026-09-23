import { describe, expect, it, vi } from 'vitest';
import { splitThemeCSS, ViewStyles } from './viewStyles';

describe('CSS остаётся данными', () => {
    it('передаёт обратные кавычки и интерполяцию в CSS API без исполнения', async () => {
        const view = {
            isDestroyed: () => false,
            insertCSS: vi.fn().mockResolvedValue('style'),
            removeInsertedCSS: vi.fn(),
        };
        const css = 'body::before { content: "` ${globalThis.compromised = true}"; }';
        await new ViewStyles().apply(view, css);
        expect(view.insertCSS).toHaveBeenCalledExactlyOnceWith(css);
        expect(Reflect.get(globalThis, 'compromised')).toBeUndefined();
    });
    it('сохраняет разделение обычной темы по представлениям', () => {
        expect(
            splitThemeCSS(
                '/* @target header */ h1{color:red} /* @end */ /* @target content */ a{color:blue}',
            ).header.trim(),
        ).toBe('h1{color:red}');
        expect(splitThemeCSS('body{color:red}').content).toBe('body{color:red}');
    });
    it('удаляет предыдущий стиль и объединяет быстрые обновления', async () => {
        const view = {
            isDestroyed: () => false,
            insertCSS: vi.fn().mockResolvedValue('style'),
            removeInsertedCSS: vi.fn().mockResolvedValue(undefined),
        };
        const styles = new ViewStyles();
        await styles.apply(view, 'first');
        await Promise.all([styles.apply(view, 'second'), styles.apply(view, 'third')]);
        expect(view.removeInsertedCSS).toHaveBeenCalledExactlyOnceWith('style');
        expect(view.insertCSS.mock.calls.map((call) => call[0])).toEqual(['first', 'third']);
        await styles.apply(view, '');
        expect(view.removeInsertedCSS).toHaveBeenCalledTimes(2);
    });
});
