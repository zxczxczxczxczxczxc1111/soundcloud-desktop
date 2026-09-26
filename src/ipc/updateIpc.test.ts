import { describe, expect, it, vi } from 'vitest';
import type { UpdateState } from '../services/updateService';
import { FakeIpc, fakeEvent, trusting } from './fakeIpc.helper.test';
import { registerUpdateIpc, type UpdateIpcDeps } from './updateIpc';

function setup(releaseUrl = 'https://github.com/owner/repo/releases/tag/v1', openError = '') {
    const ipc = new FakeIpc();
    const own = fakeEvent();
    const updates = { installNow: vi.fn(() => true), getState: vi.fn(() => ({ releaseUrl }) as UpdateState), check: vi.fn(async () => {}) };
    const deps: UpdateIpcDeps = {
        trustedLocal: trusting(own),
        updates: () => updates,
        screenOwns: (sender) => sender === own.sender,
        later: vi.fn(),
        openExternal: vi.fn(async () => {}),
        openPath: vi.fn(async () => openError),
        dataFolder: () => 'C:/data',
    };
    registerUpdateIpc(ipc, deps);
    return { ipc, own, updates, deps };
}

describe('обработчики обновлений', () => {
    it('чужой отправитель отклонён, «Позже» принимается только от экрана обновления', async () => {
        const { ipc, updates, deps } = setup();
        const stranger = fakeEvent();
        for (const channel of ['install-update-now', 'get-update-state', 'open-release-page', 'check-updates', 'open-data-folder'])
            await expect(ipc.invoke(channel, stranger)).rejects.toThrow('Недопустимый отправитель IPC');
        await ipc.send('update-screen-later', stranger);
        expect(deps.later).not.toHaveBeenCalled();
        expect(updates.installNow).not.toHaveBeenCalled();
        expect(updates.check).not.toHaveBeenCalled();
    });
    it('свои запросы доходят до службы обновлений и оболочки', async () => {
        const { ipc, own, updates, deps } = setup();
        await ipc.send('update-screen-later', own);
        expect(deps.later).toHaveBeenCalledOnce();
        await expect(ipc.invoke('install-update-now', own)).resolves.toBe(true);
        await ipc.invoke('check-updates', own);
        expect(updates.check).toHaveBeenCalledOnce();
        await ipc.invoke('open-release-page', own);
        expect(deps.openExternal).toHaveBeenCalledWith('https://github.com/owner/repo/releases/tag/v1');
        await ipc.invoke('open-data-folder', own);
        expect(deps.openPath).toHaveBeenCalledWith('C:/data');
    });
    it('без адреса выпуска ничего не открывается, ошибка открытия папки приходит отказом', async () => {
        const { ipc, own, deps } = setup('', 'нет доступа');
        await ipc.invoke('open-release-page', own);
        expect(deps.openExternal).not.toHaveBeenCalled();
        await expect(ipc.invoke('open-data-folder', own)).rejects.toThrow('нет доступа');
    });
    it('без службы обновлений ответы пустые, а не падение', async () => {
        const ipc = new FakeIpc();
        const own = fakeEvent();
        registerUpdateIpc(ipc, { ...setup().deps, trustedLocal: trusting(own), updates: () => null });
        await expect(ipc.invoke('install-update-now', own)).resolves.toBe(false);
        await expect(ipc.invoke('get-update-state', own)).resolves.toBeNull();
    });
});
