import { contextBridge, ipcRenderer } from 'electron';
import type { TrackInfo, TrackUpdateReason } from './types';

contextBridge.exposeInMainWorld('soundcloudAPI', {
    playback: (command: string) => {
        if (['play', 'pause', 'next', 'previous'].includes(command)) ipcRenderer.send('soundcloud:playback', command);
    },
    sendProfileUpdate: (username: string) => {
        ipcRenderer.send('soundcloud:profile-update', username);
    },
    sendTrackUpdate: (data: TrackInfo, reason: TrackUpdateReason) => {
        ipcRenderer.send('soundcloud:track-update', {
            data,
            reason,
        });
    },
});
