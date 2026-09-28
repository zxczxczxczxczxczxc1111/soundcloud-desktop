import { expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ nativeImage: { createFromPath: () => ({}) } }));
import type { BrowserWindow } from 'electron';
import type { PlaybackController } from './playbackController';
import type { TranslationService } from './translationService';
import type { TrackInfo } from '../types';
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

it('заголовок окна и подсказка превью показывают играющий трек, без трека заголовок приложения', () => {
    let visible = true;
    let title = 'SoundCloud';
    const setTitle = vi.fn((value: string) => {
        title = value;
    });
    const setThumbnailToolTip = vi.fn();
    const window = {
        id: 1, isDestroyed: () => false, isVisible: () => visible, setThumbarButtons: () => true,
        getTitle: () => title, setTitle, setThumbnailToolTip,
    } as unknown as BrowserWindow;
    const translation = { getLanguage: () => 'ru', translate: () => '{elapsed} из {duration}' } as unknown as TranslationService;
    const service = new ThumbarService(translation, '', {} as PlaybackController);
    const track = (patch: Partial<TrackInfo>): TrackInfo => ({
        title: 'Mira Solen - Night Drive', author: 'Deep Label', artwork: '', elapsed: '1:05', duration: '3:40',
        url: 'https://soundcloud.com/a/b', artistUrl: '', isPlaying: true, isLiked: false, ...patch,
    });
    service.updateTrack(window, track({}), true, 'SoundCloud');
    expect(title).toBe('Night Drive - Mira Solen');
    expect(setThumbnailToolTip).toHaveBeenLastCalledWith('Night Drive - Mira Solen\n1:05 из 3:40');
    // Без разбора названия артистом идёт загрузчик, оставшееся время сайта пересчитывается в длительность
    service.updateTrack(window, track({ elapsed: '1:06', duration: '-2:34' }), false, 'SoundCloud');
    expect(title).toBe('Mira Solen - Night Drive - Deep Label');
    expect(setThumbnailToolTip).toHaveBeenLastCalledWith('Mira Solen - Night Drive - Deep Label\n1:06 из 3:40');
    service.updateTrack(window, track({ elapsed: '1:06', duration: '-2:34' }), false, 'SoundCloud');
    expect(setTitle).toHaveBeenCalledTimes(2);
    expect(setThumbnailToolTip).toHaveBeenCalledTimes(2);
    // Спрятанному окну подсказка не ставится, после показа ставится последняя
    visible = false;
    service.updateTrack(window, track({ elapsed: '2:00' }), true, 'SoundCloud');
    expect(setThumbnailToolTip).toHaveBeenCalledTimes(2);
    visible = true;
    service.restore(window);
    expect(setThumbnailToolTip).toHaveBeenLastCalledWith('Night Drive - Mira Solen\n2:00 из 3:40');
    service.updateTrack(window, track({ title: '', author: '', elapsed: '', duration: '' }), true, 'SoundCloud');
    expect(title).toBe('SoundCloud');
    expect(setThumbnailToolTip).toHaveBeenLastCalledWith('');
});
