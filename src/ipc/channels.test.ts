import { describe, expect, it } from 'vitest';
import { FakeIpc } from './fakeIpc.helper.test';
import { registerAccountsIpc } from './accountsIpc';
import { registerBackupIpc } from './backupIpc';
import { registerLibraryIpc } from './libraryIpc';
import { registerPageIpc } from './pageIpc';
import { registerRadarIpc } from './radarIpc';
import { registerSettingsIpc } from './settingsIpc';
import { registerUpdateIpc } from './updateIpc';
import { registerWaveIpc } from './waveIpc';
import { registerWindowIpc } from './windowIpc';

// Каналы, которые main.ts регистрировал до разреза по темам (bc01cad): ни один не должен потеряться или задвоиться
const LISTENERS = [
    'add-account', 'apply-changes', 'cancel-refresh', 'close-window', 'logout-account', 'maximize-window', 'minimize-window', 'navigate-back', 'navigate-forward',
    'refresh-page', 'setting-changed', 'soundcloud:early-blocks', 'soundcloud:open-history', 'soundcloud:playback', 'soundcloud:player-area',
    'soundcloud:profile-update', 'soundcloud:site-state', 'soundcloud:site-translation', 'soundcloud:track-meta', 'soundcloud:track-update', 'soundcloud:wave-empty',
    'soundcloud:wave-journal:add', 'soundcloud:wave-signals:add', 'switch-account', 'title-bar-double-click', 'toggle-history', 'toggle-queue', 'toggle-settings',
    'update-screen-later',
];
const HANDLERS = [
    'backup-auto', 'backup-folder', 'backup-pick', 'backup-restore', 'backup-save', 'backup-state', 'check-updates', 'export-diagnostics', 'get-accounts',
    'get-current-track', 'get-header-texts', 'get-minimize-to-tray', 'get-navigation-controls-enabled', 'get-translations', 'get-update-state', 'get-wave-exclusions',
    'install-update-now', 'is-maximized', 'open-data-folder', 'open-external-url', 'open-release-page', 'remove-wave-exclusion', 'soundcloud:radar:found',
    'soundcloud:radar:rebuild', 'soundcloud:radar:state', 'soundcloud:radar:view', 'soundcloud:wave-exclusions:load', 'soundcloud:wave-exclusions:set',
    'soundcloud:wave-journal:load', 'soundcloud:wave-library:heard', 'soundcloud:wave-library:load', 'soundcloud:wave-library:save', 'soundcloud:wave-shelf:load',
    'soundcloud:wave-shelf:save', 'soundcloud:wave-taste',
    ...['loadSession', 'saveSession', 'loadCatalog', 'saveCatalog', 'listMixes', 'saveMix', 'removeMix'].map((method) => 'soundcloud:library:' + method),
    ...['recordUploads', 'uploads', 'recordingLinks', 'setRecordingLink', 'syncStart', 'syncPage', 'syncFinish', 'syncState', 'libraryMembers', 'radarPlan', 'catalogChecked']
        .map((method) => 'soundcloud:recommend:' + method),
];

describe('каналы обработчиков', () => {
    it('все темы вместе дают те же каналы, что main.ts до разреза, по одному обработчику на канал', () => {
        const ipc = new FakeIpc();
        // Регистрация зависимости не вызывает: они нужны только в момент запроса
        const deps = {} as never;
        registerWindowIpc(ipc, deps);
        registerUpdateIpc(ipc, deps);
        registerPageIpc(ipc, deps);
        registerWaveIpc(ipc, deps);
        registerRadarIpc(ipc, deps);
        registerLibraryIpc(ipc, deps);
        registerBackupIpc(ipc, deps);
        registerSettingsIpc(ipc, deps);
        registerAccountsIpc(ipc, deps);
        expect([...ipc.listeners.keys()].sort()).toEqual([...LISTENERS].sort());
        expect([...ipc.handlers.keys()].sort()).toEqual([...HANDLERS].sort());
        expect([...ipc.listeners.values()].every((list) => list.length === 1)).toBe(true);
        expect(LISTENERS.length + HANDLERS.length).toBe(82);
    });
});
