import type { BaseWindow } from 'electron';

type RevealedWindow = Pick<BaseWindow, 'isVisible' | 'isMinimized' | 'isDestroyed' | 'show' | 'restore' | 'focus' | 'setOpacity'>;

export const FADE_MS = 150;
const FADE_STEPS = 8;
// Страница, которая не рисует кадры (тёмное окно, тяжёлая загрузка), не держит окно прозрачным дольше этого
export const PAINT_WAIT_MS = 200;
const fades = new WeakMap<RevealedWindow, number>();

// Спрятанное в трей окно Windows в первый кадр после show показывает белым, пока Chromium не прислал кадр.
// Замер 23.09.2026: белый кадр на 8-40 мс в 7 показах из 9, тёмный фон видов не помог.
// Поэтому окно показывается прозрачным и проявляется, когда страница нарисовала кадр
function fadeIn(window: RevealedWindow, painted: () => Promise<unknown>): void {
    const run = (fades.get(window) ?? 0) + 1;
    fades.set(window, run);
    const alive = (): boolean => fades.get(window) === run && !window.isDestroyed();
    let started = false;
    const start = (): void => {
        if (started || !alive()) return;
        started = true;
        let step = 0;
        const tick = (): void => {
            if (!alive()) return;
            step++;
            // Замедление к концу: основная часть прозрачности уходит в первые шаги
            window.setOpacity(1 - (1 - step / FADE_STEPS) ** 2);
            if (step < FADE_STEPS) setTimeout(tick, FADE_MS / FADE_STEPS);
        };
        tick();
    };
    setTimeout(start, PAINT_WAIT_MS);
    painted().then(start, (error: unknown) => {
        console.warn('Показ окна: кадр страницы не дождались', error);
        start();
    });
}

// Сначала show, потом restore: restore() показывает спрятанное в трей окно в обход Electron,
// isVisible() после него уже true, show() пропускается, и страница остаётся скрытой (чёрное окно).
export function revealWindow(window: RevealedWindow, painted?: () => Promise<unknown>): void {
    const hidden = !window.isVisible();
    if (hidden && painted) window.setOpacity(0);
    if (hidden) window.show();
    if (window.isMinimized()) window.restore();
    window.focus();
    if (hidden && painted) fadeIn(window, painted);
}
