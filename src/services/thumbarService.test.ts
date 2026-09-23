import { expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ nativeImage: { createFromPath: () => ({}) } }));
import type { BrowserWindow } from 'electron';
import type { PlaybackController } from './playbackController';
import type { TranslationService } from './translationService';
import { ThumbarService } from './thumbarService';

it('не ставит кнопки превью спрятанному окну и ставит их заново после показа', () => {
    let visible = true;
    const setThumbarButtons = vi.fn((buttons: unknown[]) => buttons.length > 0);
    const window = { id: 1, isDestroyed: () => false, isVisible: () => visible, setThumbarButtons } as unknown as BrowserWindow;
    const translation = { getLanguage: () => 'ru', translate: (key: string) => key } as unknown as TranslationService;
    const service = new ThumbarService(translation, '', {} as PlaybackController);
    service.updateThumbarButtons(window, true, false);
    service.updateThumbarButtons(window, true, false);
    expect(setThumbarButtons).toHaveBeenCalledTimes(1);
    visible = false;
    service.updateThumbarButtons(window, false, false);
    expect(setThumbarButtons).toHaveBeenCalledTimes(1);
    visible = true;
    service.restore(window);
    expect(setThumbarButtons).toHaveBeenCalledTimes(2);
    expect(setThumbarButtons.mock.lastCall?.[0]).toHaveLength(4);
    service.restore(window);
    expect(setThumbarButtons).toHaveBeenCalledTimes(3);
});
