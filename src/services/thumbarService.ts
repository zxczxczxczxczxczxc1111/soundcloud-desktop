import { type BrowserWindow, nativeImage, type ThumbarButton } from 'electron';
import { join } from 'path';
import type { TranslationService } from './translationService';
import type { PlaybackController, PlaybackCommand } from './playbackController';
export class ThumbarService {
    private key = '';
    private state: { playing: boolean; liked: boolean } | null = null;
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
    // После hide() Electron забывает кнопки превью, при каждом показе окна их надо ставить заново
    public restore(window: BrowserWindow): void {
        this.key = '';
        if (this.state) this.updateThumbarButtons(window, this.state.playing, this.state.liked);
    }
}
