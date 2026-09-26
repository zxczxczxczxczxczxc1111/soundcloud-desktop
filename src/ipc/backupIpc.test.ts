import { describe, expect, it, vi } from 'vitest';
import { BACKUP_EXTENSION } from '../services/backupPolicy';
import type { WaveExclusionList } from '../services/waveExclusions';
import { FakeIpc, fakeEvent, trusting } from './fakeIpc.helper.test';
import { registerBackupIpc, type BackupIpcDeps } from './backupIpc';

const emptyList = (): WaveExclusionList => ({ tracks: [], artists: [], laterTracks: [], laterArtists: [], more: [], families: [] });

function memoryStore(initial: Record<string, unknown> = {}) {
    const values = new Map(Object.entries(initial));
    return {
        values,
        get: (key: string, fallback?: unknown) => (values.has(key) ? values.get(key) : fallback),
        set: vi.fn((key: string, value: unknown) => void values.set(key, value)),
        delete: vi.fn((key: string) => void values.delete(key)),
    };
}

function setup(options: { settings?: Record<string, unknown>; responses?: Record<string, unknown>; save?: string; open?: string } = {}) {
    const ipc = new FakeIpc();
    const own = fakeEvent();
    const store = memoryStore(options.settings);
    const responses: Record<string, unknown> = {
        backupSave: { ok: true, size: 2048 },
        backupInspect: { ok: true, hash: 'h1', settings: {}, summary: {} },
        backupRestore: { ok: true, accounts: [], settings: null },
        backupRollback: true,
        backupFinish: true,
        ...options.responses,
    };
    const request = vi.fn(async (method: string) => responses[method]);
    const signals = { flush: vi.fn(), pause: vi.fn(), resume: vi.fn() };
    const exclusions = { load: vi.fn(emptyList), merge: vi.fn(emptyList), restore: vi.fn(() => true), currentUser: vi.fn(() => 11) };
    const deps: BackupIpcDeps = {
        trustedLocal: trusting(own),
        store,
        diagnostics: { record: vi.fn() },
        library: { request, invalidate: vi.fn() } as unknown as BackupIpcDeps['library'],
        exclusions,
        journal: () => null,
        signals: () => signals,
        history: () => null,
        settingsView: () => undefined,
        page: () => null,
        ask: vi.fn(async () => 11),
        translate: (key) => key,
        dialogs: {
            save: vi.fn(async () => (options.save ? { canceled: false, filePath: options.save } : { canceled: true, filePath: '' })),
            open: vi.fn(async () => (options.open ? { canceled: false, filePaths: [options.open] } : { canceled: true, filePaths: [] })),
        },
        documentsFolder: () => '/documents',
        profilePath: '/profile',
        about: { version: '0.8.0', build: 'abc' },
        applySettingChange: vi.fn(),
        reloadNeeded: () => false,
    };
    const backup = registerBackupIpc(ipc, deps);
    return { ipc, own, store, request, signals, exclusions, deps, backup };
}

describe('обработчики резервной копии', () => {
    it('чужой отправитель отклонён во всех шести запросах', async () => {
        const { ipc, request, deps } = setup();
        const stranger = fakeEvent();
        for (const channel of ['backup-state', 'backup-save', 'backup-pick', 'backup-restore', 'backup-folder', 'backup-auto'])
            await expect(ipc.invoke(channel, stranger, true)).rejects.toThrow('Недопустимый отправитель IPC');
        expect(request).not.toHaveBeenCalled();
        expect(deps.dialogs.save).not.toHaveBeenCalled();
    });
    it('сохранение: расширение дописывается, отмена диалога ничего не пишет, копия внутри профиля отклонена', async () => {
        const saved = setup({ save: '/backups/copy' });
        await expect(saved.ipc.invoke('backup-save', saved.own)).resolves.toEqual({ ok: true, size: 2048 });
        expect(saved.request).toHaveBeenCalledWith('backupSave', '/backups/copy.' + BACKUP_EXTENSION, expect.any(Object), { version: '0.8.0', build: 'abc' }, 0);
        const canceled = setup();
        await expect(canceled.ipc.invoke('backup-save', canceled.own)).resolves.toBeNull();
        const inside = setup({ save: '/profile/copies/copy.' + BACKUP_EXTENSION });
        await expect(inside.ipc.invoke('backup-save', inside.own)).resolves.toEqual({ ok: false, reason: 'inside-profile' });
        expect(inside.request).not.toHaveBeenCalled();
    });
    it('папка копий внутри профиля не принимается', async () => {
        const { ipc, own, store } = setup({ open: '/profile/sub' });
        await expect(ipc.invoke('backup-folder', own)).resolves.toMatchObject({ folder: '', rejected: 'inside-profile' });
        expect(store.set).not.toHaveBeenCalled();
        const good = setup({ open: '/backups' });
        await expect(good.ipc.invoke('backup-folder', good.own)).resolves.toMatchObject({ folder: '/backups' });
    });
    it('автокопия: мусор вместо флага отклонён, без папки не включается, с папкой делает первую копию сразу', async () => {
        const bare = setup();
        await expect(bare.ipc.invoke('backup-auto', bare.own, 'да')).rejects.toThrow('Неверное значение автокопии');
        await expect(bare.ipc.invoke('backup-auto', bare.own, true)).resolves.toMatchObject({ auto: false });
        expect(bare.store.set).not.toHaveBeenCalled();
        const withFolder = setup({ settings: { backupFolder: '/backups' } });
        await expect(withFolder.ipc.invoke('backup-auto', withFolder.own, true)).resolves.toMatchObject({ auto: true });
        await vi.waitFor(() => expect(withFolder.store.values.get('backupLastAt')).toEqual(expect.any(Number)));
        expect(withFolder.request).toHaveBeenCalledWith('backupSave', expect.stringMatching(/^[\\/]backups[\\/]soundcloud-backup-/), expect.any(Object), expect.any(Object), expect.any(Number));
    });
    it('восстановление только по ключу последнего выбора, ключ одноразовый', async () => {
        const { ipc, own, request } = setup({ open: '/backups/copy.' + BACKUP_EXTENSION });
        await expect(ipc.invoke('backup-restore', own, 'подбор')).resolves.toEqual({ ok: false, reason: 'changed' });
        const picked = (await ipc.invoke('backup-pick', own)) as { ok: boolean; token: string; current: number };
        expect(picked).toMatchObject({ ok: true, current: 11 });
        await expect(ipc.invoke('backup-restore', own, 'чужой ключ')).resolves.toEqual({ ok: false, reason: 'changed' });
        await expect(ipc.invoke('backup-restore', own, picked.token)).resolves.toMatchObject({ ok: true, plays: 0 });
        expect(request).toHaveBeenCalledWith('backupRestore', '/backups/copy.' + BACKUP_EXTENSION, 'h1');
        await expect(ipc.invoke('backup-restore', own, picked.token)).resolves.toEqual({ ok: false, reason: 'changed' });
    });
    it('сбой записи отметок посреди восстановления: откат, настройки не трогаются, журнал сигналов снова пишет', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { ipc, own, request, signals, exclusions, deps } = setup({
            open: '/backups/copy.' + BACKUP_EXTENSION,
            responses: { backupRestore: { ok: true, accounts: [{ id: 11, exclusions: emptyList(), journal: [], plays: 1, mixes: 0, editions: 0 }], settings: { fullShuffle: false } } },
        });
        exclusions.merge.mockReturnValue(null as unknown as WaveExclusionList);
        const picked = (await ipc.invoke('backup-pick', own)) as { token: string };
        await expect(ipc.invoke('backup-restore', own, picked.token)).resolves.toEqual({ ok: false, reason: 'io-error' });
        expect(request).toHaveBeenCalledWith('backupRollback');
        expect(deps.applySettingChange).not.toHaveBeenCalled();
        expect(signals.pause).toHaveBeenCalledOnce();
        expect(signals.resume).toHaveBeenCalledOnce();
        expect(deps.diagnostics.record).toHaveBeenCalledWith('backup.restore-failed', { reason: 'io-error' });
        warn.mockRestore();
    });
    it('пока копия пишется, вторая не начинается и F1 видит «занято»', async () => {
        let finish: (value: unknown) => void = () => {};
        const { ipc, own, request } = setup({ save: '/backups/copy' });
        request.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
        const first = ipc.invoke('backup-save', own);
        await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
        await expect(ipc.invoke('backup-state', own)).resolves.toMatchObject({ busy: true });
        await expect(ipc.invoke('backup-save', own)).resolves.toEqual({ ok: false, reason: 'busy' });
        finish({ ok: true, size: 1 });
        await first;
        await expect(ipc.invoke('backup-state', own)).resolves.toMatchObject({ busy: false });
    });
});
