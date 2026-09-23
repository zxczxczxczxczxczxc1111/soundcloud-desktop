import { BaseWindow, type Rectangle } from 'electron';

type WindowEvent = 'focus' | 'show' | 'restore';
interface WatchedWindow {
    isDestroyed(): boolean;
    isVisible(): boolean;
    isMinimized(): boolean;
    getBounds(): Rectangle;
    on(event: WindowEvent, listener: () => void): unknown;
    removeListener(event: WindowEvent, listener: () => void): unknown;
    hookWindowMessage?(message: number, callback: (wParam: Buffer, lParam: Buffer) => void): void;
    unhookWindowMessage?(message: number): void;
}

const WM_NCACTIVATE = 0x0086;

// Показ и удаление прозрачного окна 1x1 заставляет Chromium пересчитать перекрытие окон.
// Проверено на гонке 23.09.2026: страница 10 с оставалась hidden поверх перекрывшего окна и сразу стала visible;
// setVisible вида страницы не помог
export function flashTinyWindow(bounds: Rectangle): void {
    const tiny = new BaseWindow({
        x: bounds.x + 40,
        y: bounds.y + 40,
        width: 1,
        height: 1,
        show: false,
        frame: false,
        transparent: true,
        resizable: false,
        focusable: false,
        skipTaskbar: true,
    });
    tiny.showInactive();
    setTimeout(() => {
        if (!tiny.isDestroyed()) tiny.destroy();
    }, 150);
}

// Сторож тёмного окна: после выхода окна наверх страница бывает hidden, пока окно не сдвинут
// (расчёт перекрытия Chromium не успел за активацией), и стоит без кадров.
// На Windows сигнал активации это WM_NCACTIVATE с wParam=1: событие focus приходит и тогда, когда окно
// получило фокус под другим окном, а при настоящем выходе наверх позже уже не повторяется
export function watchHiddenPage(
    window: WatchedWindow,
    visibility: () => Promise<unknown>,
    nudge: (bounds: Rectangle) => void = flashTinyWindow,
    delay = 1500,
    platform: NodeJS.Platform = process.platform,
): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const shown = (): boolean => !window.isDestroyed() && window.isVisible() && !window.isMinimized();
    const check = async (): Promise<void> => {
        timer = undefined;
        if (!shown()) return;
        let state: unknown;
        try {
            state = await visibility();
        } catch (error) {
            console.warn('Сторож окна: состояние страницы не прочитано', error);
            return;
        }
        if (state !== 'hidden' || !shown()) {
            if (attempts) console.warn('Сторож окна: страница проснулась после попытки ' + attempts);
            attempts = 0;
            return;
        }
        if (attempts >= 2) {
            console.warn('Сторож окна: страница осталась скрытой');
            attempts = 0;
            return;
        }
        attempts++;
        try {
            nudge(window.getBounds());
        } catch (error) {
            console.warn('Сторож окна: не удалось разбудить страницу', error);
            return;
        }
        timer = setTimeout(() => void check(), 1000);
    };
    const schedule = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        attempts = 0;
        timer = setTimeout(() => void check(), delay);
    };
    const hooked = platform === 'win32' && typeof window.hookWindowMessage === 'function';
    const events: WindowEvent[] = hooked ? ['show', 'restore'] : ['focus', 'show', 'restore'];
    for (const event of events) window.on(event, schedule);
    if (hooked)
        window.hookWindowMessage?.(WM_NCACTIVATE, (wParam) => {
            if (wParam.length && wParam.readUInt8(0) !== 0) schedule();
        });
    return () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        for (const event of events) window.removeListener(event, schedule);
        if (hooked) window.unhookWindowMessage?.(WM_NCACTIVATE);
    };
}
