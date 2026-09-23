import type { BaseWindow } from 'electron';

// Сначала show, потом restore: restore() показывает спрятанное в трей окно в обход Electron,
// isVisible() после него уже true, show() пропускается, и страница остаётся скрытой (чёрное окно).
export function revealWindow(window: BaseWindow): void {
    if (!window.isVisible()) window.show();
    if (window.isMinimized()) window.restore();
    window.focus();
}
