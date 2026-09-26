import { describe, expect, it, vi } from 'vitest';
import { FakeIpc, fakeEvent, trusting } from './fakeIpc.helper.test';
import { registerWindowIpc, type WindowIpcDeps } from './windowIpc';

function setup(settings: Record<string, unknown> = {}, canGoForward = true) {
    const ipc = new FakeIpc();
    const own = fakeEvent();
    const window = { hide: vi.fn(), minimize: vi.fn(), maximize: vi.fn(), unmaximize: vi.fn(), isMaximized: vi.fn(() => false), close: vi.fn() };
    const page = { reload: vi.fn(), stop: vi.fn(), navigationHistory: { canGoForward: () => canGoForward, goForward: vi.fn() } };
    const header = { send: vi.fn() };
    const deps: WindowIpcDeps = {
        trustedLocal: trusting(own),
        store: { get: (key, fallback) => (key in settings ? settings[key] : fallback), set: vi.fn(), delete: vi.fn() },
        window: () => window,
        page: () => page,
        header: () => header,
        navigateBack: vi.fn(),
        headerTexts: () => ({ headerBack: 'Назад' }),
    };
    registerWindowIpc(ipc, deps);
    return { ipc, own, window, page, header, deps };
}

describe('обработчики окна', () => {
    it('чужой отправитель ничего не трогает, запросы отклоняются', async () => {
        const { ipc, window, page, deps } = setup();
        const stranger = fakeEvent();
        for (const channel of ['minimize-window', 'maximize-window', 'title-bar-double-click', 'close-window', 'navigate-back', 'navigate-forward', 'refresh-page', 'cancel-refresh'])
            await ipc.send(channel, stranger);
        expect([window.hide, window.minimize, window.maximize, window.close, page.reload, page.stop, page.navigationHistory.goForward, deps.navigateBack].every((fn) => vi.mocked(fn).mock.calls.length === 0)).toBe(true);
        for (const channel of ['get-header-texts', 'is-maximized', 'get-minimize-to-tray', 'get-navigation-controls-enabled'])
            await expect(ipc.invoke(channel, stranger)).rejects.toThrow('Недопустимый отправитель IPC');
    });
    it('свернуть и закрыть уводят в трей по настройке, иначе сворачивают и закрывают окно', async () => {
        const tray = setup({ minimizeToTray: true });
        await tray.ipc.send('minimize-window', tray.own);
        await tray.ipc.send('close-window', tray.own);
        expect(tray.window.hide).toHaveBeenCalledTimes(2);
        const plain = setup({ minimizeToTray: false });
        await plain.ipc.send('minimize-window', plain.own);
        await plain.ipc.send('close-window', plain.own);
        expect(plain.window.minimize).toHaveBeenCalledOnce();
        expect(plain.window.close).toHaveBeenCalledOnce();
        expect(plain.window.hide).not.toHaveBeenCalled();
    });
    it('развернуть переключает окно, обновление говорит шапке и перезагружает сайт', async () => {
        const { ipc, own, window, page, header } = setup();
        await ipc.send('maximize-window', own);
        expect(window.maximize).toHaveBeenCalledOnce();
        window.isMaximized.mockReturnValue(true);
        await ipc.send('title-bar-double-click', own);
        expect(window.unmaximize).toHaveBeenCalledOnce();
        await ipc.send('refresh-page', own);
        expect(header.send).toHaveBeenCalledWith('refresh-state-changed', true);
        expect(page.reload).toHaveBeenCalledOnce();
        await ipc.send('cancel-refresh', own);
        expect(page.stop).toHaveBeenCalledOnce();
        expect(header.send).toHaveBeenLastCalledWith('refresh-state-changed', false);
        await expect(ipc.invoke('is-maximized', own)).resolves.toBe(true);
    });
    it('«Вперёд» только когда есть куда, настройки шапки с умолчаниями', async () => {
        const blocked = setup({}, false);
        await blocked.ipc.send('navigate-forward', blocked.own);
        expect(blocked.page.navigationHistory.goForward).not.toHaveBeenCalled();
        const { ipc, own } = setup();
        await expect(ipc.invoke('get-minimize-to-tray', own)).resolves.toBe(true);
        await expect(ipc.invoke('get-navigation-controls-enabled', own)).resolves.toBe(false);
        await expect(ipc.invoke('get-header-texts', own)).resolves.toEqual({ headerBack: 'Назад' });
    });
});
