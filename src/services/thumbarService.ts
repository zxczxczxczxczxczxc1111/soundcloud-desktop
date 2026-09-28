import { type BrowserWindow, nativeImage, type ThumbarButton } from 'electron';
import { join } from 'path';
import type { TranslationService } from './translationService';
import type { PlaybackController, PlaybackCommand } from './playbackController';
import type { TrackInfo } from '../types';
import { formatClock, trackParts, trackSeconds } from '../utils/trackParser';

export class ThumbarService {
    private key = '';
    private state: { playing: boolean; liked: boolean } | null = null;
    private tooltip = '';
    private shownTooltip = '';
    private icons: Record<string, Electron.NativeImage>;
    constructor(
        private translation: TranslationService,
        resources: string,
        private playback: PlaybackController,
    ) {
        this.icons = Object.fromEntries(
            ['backward', 'play', 'pause', 'forward', 'heart', 'heart-filled'].map((name) => [
                name,
                nativeImage.createFromPath(join(resources, 'icons', name + '.ico')),
            ]),
        );
    }
    public updateThumbarButtons(window: BrowserWindow, playing: boolean, liked: boolean): void {
        this.state = { playing, liked };
        // У спрятанного в трей окна нет кнопки на панели задач. Кнопки, поставленные в этот момент, Windows не сохранит,
        // а Electron сочтёт их добавленными и после показа будет только обновлять несуществующие.
        if (window.isDestroyed() || !window.isVisible()) return;
        const key = [window.id, playing, liked, this.translation.getLanguage()].join(':');
        if (key === this.key) return;
        const button = (command: PlaybackCommand, icon: string, tooltip: string): ThumbarButton => ({
            icon: this.icons[icon],
            tooltip,
            click: () => {
                void this.playback.execute(command).catch(console.error);
            },
        });
        const buttons = [
            button('like', liked ? 'heart-filled' : 'heart', this.translation.translate(liked ? 'unlike' : 'like')),
            button('previous', 'backward', this.translation.translate('previous')),
            button('toggle', playing ? 'pause' : 'play', this.translation.translate(playing ? 'pause' : 'play')),
            button('next', 'forward', this.translation.translate('next')),
        ];
        if (window.setThumbarButtons(buttons)) this.key = key;
    }
    // Заголовок окна Windows пишет над превью на панели задач и в Alt+Tab, подсказка всплывает при наведении на превью.
    // Без трека заголовок возвращается к названию приложения
    public updateTrack(window: BrowserWindow, track: TrackInfo, parse: boolean, appTitle: string): void {
        if (window.isDestroyed()) return;
        const parts = trackParts(track.title, track.author, parse);
        const title = !parts.track ? appTitle : parts.artist ? parts.track + ' - ' + parts.artist : parts.track;
        if (title !== window.getTitle()) window.setTitle(title);
        let tooltip = parts.track ? title : '';
        const { elapsed, duration } = trackSeconds(track.elapsed, track.duration);
        if (parts.track && duration > 0) {
            const time = this.translation.translate('thumbnailTime').replace('{elapsed}', formatClock(elapsed)).replace('{duration}', formatClock(duration));
            tooltip += '\n' + time;
        }
        this.tooltip = tooltip;
        // Спрятанному в трей окну подсказку не поставить: кнопки на панели нет. Её вернёт restore()
        if (tooltip === this.shownTooltip || !window.isVisible()) return;
        window.setThumbnailToolTip(tooltip);
        this.shownTooltip = tooltip;
    }
    // После hide() Electron забывает кнопки превью, при каждом показе окна их надо ставить заново
    public restore(window: BrowserWindow): void {
        this.key = '';
        if (this.state) this.updateThumbarButtons(window, this.state.playing, this.state.liked);
        // Кнопка на панели после показа новая, подсказки на ней нет
        this.shownTooltip = '';
        if (!this.tooltip || window.isDestroyed()) return;
        window.setThumbnailToolTip(this.tooltip);
        this.shownTooltip = this.tooltip;
    }
}
