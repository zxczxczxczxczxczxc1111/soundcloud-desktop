import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FADE_MS, PAINT_WAIT_MS, revealWindow } from './revealWindow';

function fakeWindow(visible: boolean, minimized = false) {
    const state = { visible, minimized, opacity: 1, calls: [] as string[] };
    const window = {
        state,
        isVisible: () => state.visible,
        isMinimized: () => state.minimized,
        isDestroyed: () => false,
        show: () => {
            state.calls.push('show');
            state.visible = true;
        },
        restore: () => {
            state.calls.push('restore');
            state.minimized = false;
        },
        focus: () => state.calls.push('focus'),
        setOpacity: (value: number) => {
            state.calls.push('opacity ' + value.toFixed(2));
            state.opacity = value;
        },
    };
    return window;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

it('спрятанное окно показывается прозрачным и проявляется после кадра страницы', async () => {
    const window = fakeWindow(false);
    let paint: () => void = () => undefined;
    revealWindow(window, () => new Promise<void>((resolve) => (paint = resolve)));
    expect(window.state.calls.slice(0, 3)).toEqual(['opacity 0.00', 'show', 'focus']);
    await vi.advanceTimersByTimeAsync(PAINT_WAIT_MS / 2);
    expect(window.state.opacity).toBe(0);
    paint();
    await vi.advanceTimersByTimeAsync(0);
    expect(window.state.opacity).toBeGreaterThan(0);
    expect(window.state.opacity).toBeLessThan(1);
    await vi.advanceTimersByTimeAsync(FADE_MS);
    expect(window.state.opacity).toBe(1);
    const steps = window.state.calls.filter((call) => call.startsWith('opacity')).map((call) => Number(call.slice(8)));
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
});

it('страница без кадров не держит окно прозрачным', async () => {
    const window = fakeWindow(false);
    revealWindow(window, () => new Promise(() => undefined));
    await vi.advanceTimersByTimeAsync(PAINT_WAIT_MS - 1);
    expect(window.state.opacity).toBe(0);
    await vi.advanceTimersByTimeAsync(FADE_MS + 1);
    expect(window.state.opacity).toBe(1);
});

it('ошибка ожидания кадра сразу проявляет окно', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const window = fakeWindow(false);
    revealWindow(window, () => Promise.reject(new Error('страница перезагружается')));
    await vi.advanceTimersByTimeAsync(FADE_MS);
    expect(window.state.opacity).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
});

it('видимое и свёрнутое окна не трогают прозрачность', () => {
    const shown = fakeWindow(true);
    revealWindow(shown, () => Promise.resolve());
    expect(shown.state.calls).toEqual(['focus']);
    const minimized = fakeWindow(true, true);
    revealWindow(minimized, () => Promise.resolve());
    expect(minimized.state.calls).toEqual(['restore', 'focus']);
});

it('повторный показ посреди проявления не оставляет окно полупрозрачным', async () => {
    const window = fakeWindow(false);
    revealWindow(window, () => Promise.resolve());
    await vi.advanceTimersByTimeAsync(FADE_MS / 2);
    window.state.visible = false;
    revealWindow(window, () => new Promise(() => undefined));
    expect(window.state.opacity).toBe(0);
    await vi.advanceTimersByTimeAsync(FADE_MS);
    // Старое проявление остановилось и не подняло прозрачность раньше нового
    expect(window.state.opacity).toBe(0);
    await vi.advanceTimersByTimeAsync(PAINT_WAIT_MS + FADE_MS);
    expect(window.state.opacity).toBe(1);
});
