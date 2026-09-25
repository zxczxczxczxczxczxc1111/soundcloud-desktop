import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const SEND_CHANNELS = new Set([
    'settings-ready',
    'apply-changes',
    'setting-changed',
    'toggle-settings',
    'switch-account',
    'add-account',
    'logout-account',
]);

const INVOKE_CHANNELS = new Set([
    'export-diagnostics',
    'get-settings-state',
    'get-current-track',
    'get-translations',
    'open-external-url',
    'get-accounts',
    'get-update-state',
    'open-release-page',
    'check-updates',
    'install-update-now',
    'open-data-folder',
    'get-wave-exclusions',
    'remove-wave-exclusion',
    'backup-state',
    'backup-save',
    'backup-pick',
    'backup-restore',
    'backup-folder',
    'backup-auto',
]);

const ON_CHANNELS = new Set(['presence-preview-update', 'discord-incognito-changed', 'update-translations', 'accounts-updated', 'update-state', 'wave-exclusions-changed', 'backup-state-changed']);

function isHttpsUrl(value: string): boolean {
    try {
        return new URL(value).protocol === 'https:';
    } catch {
        return false;
    }
}

contextBridge.exposeInMainWorld('settingsAPI', {
    send: (channel: string, ...args: unknown[]) => {
        if (!SEND_CHANNELS.has(channel)) return;
        ipcRenderer.send(channel, ...args);
    },
    invoke: (channel: string, ...args: unknown[]) => {
        if (!INVOKE_CHANNELS.has(channel)) {
            return Promise.reject(new Error(`Blocked IPC invoke channel: ${channel}`));
        }
        return ipcRenderer.invoke(channel, ...args);
    },
    on: (channel: string, listener: (...args: unknown[]) => void) => {
        if (!ON_CHANNELS.has(channel) || typeof listener !== 'function') return;

        const wrapped = (_event: IpcRendererEvent, ...args: unknown[]) => listener(...args);
        ipcRenderer.on(channel, wrapped);
    },
    openExternal: (url: string) => {
        if (!isHttpsUrl(url)) return Promise.resolve('');
        return ipcRenderer.invoke('open-external-url', url);
    },
});
