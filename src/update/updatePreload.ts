import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// Экрану обновления нужны ровно два канала: получать состояние и сказать «Позже»
contextBridge.exposeInMainWorld('updateScreen', {
    onState: (listener: (state: unknown) => void) => {
        if (typeof listener !== 'function') return;
        ipcRenderer.on('update-screen-state', (_event: IpcRendererEvent, state: unknown) => listener(state));
    },
    later: () => ipcRenderer.send('update-screen-later'),
});
