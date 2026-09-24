import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const SEND_CHANNELS = new Set(['history:ready', 'history:close', 'history:artist']);
const INVOKE_CHANNELS = new Set(['history:init', 'history:overview', 'history:day', 'history:search', 'history:play', 'history:taste', 'history:taste-remove']);
const ON_CHANNELS = new Set(['history:changed', 'history:language', 'theme-changed']);

contextBridge.exposeInMainWorld('historyAPI', {
    send: (channel: string, ...args: unknown[]) => {
        if (!SEND_CHANNELS.has(channel)) return;
        ipcRenderer.send(channel, ...args);
    },
    invoke: (channel: string, ...args: unknown[]) => {
        if (!INVOKE_CHANNELS.has(channel)) return Promise.reject(new Error(`Blocked IPC invoke channel: ${channel}`));
        return ipcRenderer.invoke(channel, ...args);
    },
    on: (channel: string, listener: (...args: unknown[]) => void) => {
        if (!ON_CHANNELS.has(channel) || typeof listener !== 'function') return;
        ipcRenderer.on(channel, (_event: IpcRendererEvent, ...args: unknown[]) => listener(...args));
    },
});
