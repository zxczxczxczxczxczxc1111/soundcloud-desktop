import { describe, expect, it, vi } from 'vitest';
import { FakeIpc, fakeEvent, trusting } from './fakeIpc.helper.test';
import { registerLibraryIpc, type LibraryIpcDeps } from './libraryIpc';

function setup() {
    const ipc = new FakeIpc();
    const site = fakeEvent();
    const request = vi.fn(async () => 'ok');
    const deps: LibraryIpcDeps = { trustedSite: trusting(site), library: { request } as unknown as LibraryIpcDeps['library'] };
    registerLibraryIpc(ipc, deps);
    return { ipc, site, request, deps };
}

describe('запросы страницы к хранилищам', () => {
    it('чужой отправитель и неверный пользователь не доходят до фонового потока', async () => {
        const { ipc, site, request } = setup();
        const stranger = fakeEvent();
        await expect(ipc.invoke('soundcloud:library:loadSession', stranger, 11)).rejects.toThrow('Недопустимый отправитель библиотеки');
        await expect(ipc.invoke('soundcloud:recommend:syncState', stranger, 11)).rejects.toThrow('Недопустимый отправитель рекомендаций');
        for (const user of [0, -5, 2 ** 60, 'я'])
            for (const channel of ['soundcloud:library:saveSession', 'soundcloud:recommend:uploads'])
                await expect(ipc.invoke(channel, site, user, {})).rejects.toThrow('Пользователь не определён');
        expect(request).not.toHaveBeenCalled();
    });
    it('аргументы уходят по числу, которое ждёт метод, лишнее отбрасывается', async () => {
        const { ipc, site, request } = setup();
        await ipc.invoke('soundcloud:library:saveMix', site, 11, 'Название', [{ id: 1 }]);
        expect(request).toHaveBeenLastCalledWith('saveMix', 11, 'Название', [{ id: 1 }]);
        await ipc.invoke('soundcloud:library:loadSession', site, 11, 'лишнее', 'лишнее');
        expect(request).toHaveBeenLastCalledWith('loadSession', 11);
        await ipc.invoke('soundcloud:recommend:syncPage', site, 11, 'a', 'b', 'c', 'd', 'e');
        expect(request).toHaveBeenLastCalledWith('syncPage', 11, 'a', 'b', 'c', 'd');
        await ipc.invoke('soundcloud:recommend:catalogChecked', site, 11, 'k', 'l', 's', 'e', 3);
        expect(request).toHaveBeenLastCalledWith('catalogChecked', 11, 'k', 'l', 's', 'e', 3);
        await ipc.invoke('soundcloud:recommend:recordingLinks', site, 11, 'лишнее');
        expect(request).toHaveBeenLastCalledWith('recordingLinks', 11);
    });
    it('все каналы на месте и повторная регистрация их не ломает', () => {
        const { ipc, deps } = setup();
        expect([...ipc.handlers.keys()].filter((channel) => channel.startsWith('soundcloud:library:'))).toHaveLength(7);
        expect([...ipc.handlers.keys()].filter((channel) => channel.startsWith('soundcloud:recommend:'))).toHaveLength(11);
        expect(() => registerLibraryIpc(ipc, deps)).not.toThrow();
    });
});
