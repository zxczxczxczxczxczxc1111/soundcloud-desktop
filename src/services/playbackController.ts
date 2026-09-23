import type { WebContents } from 'electron';
export type PlaybackCommand = 'play' | 'pause' | 'toggle' | 'next' | 'previous' | 'like';

export function executePageCommand(command: PlaybackCommand): boolean {
    const selectors = {
        play: '.playControls__play',
        pause: '.playControls__play',
        toggle: '.playControls__play',
        next: '.skipControl__next',
        previous: '.skipControl__previous',
        like: '.playbackSoundBadge__like',
    };
    const button = document.querySelector<HTMLElement>(selectors[command]);
    if (!button || button.getAttribute('aria-disabled') === 'true' || button.hasAttribute('disabled')) return false;
    const playing = button.classList.contains('playing');
    if ((command === 'play' && playing) || (command === 'pause' && !playing)) return true;
    button.click();
    return true;
}

export class PlaybackController {
    constructor(private contents: WebContents) {}
    public async execute(command: PlaybackCommand): Promise<boolean> {
        if (this.contents.isDestroyed()) return false;
        return this.contents.executeJavaScript(
            '(' + executePageCommand.toString() + ')(' + JSON.stringify(command) + ');',
        );
    }
}
