import type { PlaybackCommand } from './playbackController';

export function installMediaControls(): void {
    if (!navigator.mediaSession) return;
    const api = (window as Window & { soundcloudAPI?: { playback(command: PlaybackCommand): void } }).soundcloudAPI;
    if (!api) return;
    for (const [action, command] of [['play', 'play'], ['pause', 'pause'], ['nexttrack', 'next'], ['previoustrack', 'previous']] as const) {
        navigator.mediaSession.setActionHandler(action, () => api.playback(command));
    }
}
export const mediaControlsScript = '(' + installMediaControls.toString() + ')();';
