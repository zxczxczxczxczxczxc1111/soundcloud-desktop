import { describe, expect, it, vi } from 'vitest';
import { FakeIpc, fakeEvent, trusting } from './fakeIpc.helper.test';
import type { PlaybackState } from './pageIpc';
import { getAccounts, registerAccountsIpc, type AccountsIpcDeps, type PendingChanges } from './accountsIpc';

function memoryStore(initial: Record<string, unknown>) {
    const values = new Map(Object.entries(initial));
    return {
        values,
        get: (key: string, fallback?: unknown) => (values.has(key) ? values.get(key) : fallback),
        set: vi.fn((key: string, value: unknown) => void values.set(key, value)),
        delete: vi.fn((key: string) => void values.delete(key)),
    };
}

function setup(settings: Record<string, unknown> = {}, pending: PendingChanges = { network: false, reload: false }) {
    const ipc = new FakeIpc();
    const own = fakeEvent();
    const site = fakeEvent();
    const store = memoryStore({ accounts: [{ id: 'default', name: 'Основной' }, { id: 'acc_1', name: 'Второй' }], currentAccountId: 'default', ...settings });
    const app = { relaunch: vi.fn(), quit: vi.fn() };
    const page = { session: { clearStorageData: vi.fn(async () => {}) }, reload: vi.fn() };
    const proxy = { apply: vi.fn(async () => {}) };
    const adblock = { setEnabled: vi.fn(async () => {}) };
    const presence = { updatePresence: vi.fn(async () => {}), clearActivity: vi.fn() };
    const playback: PlaybackState = {
        info: { title: 'Песня', author: '', artwork: '', elapsed: '', duration: '', isPlaying: true, isLiked: false, url: '', artistUrl: '' },
        playedThisRun: true, updates: 0, changes: 0, lastUpdateAt: 0, lastProgressAt: 0,
    };
    const settingsView = { send: vi.fn() };
    const deps: AccountsIpcDeps = {
        trustedLocal: trusting(own),
        trustedSite: trusting(site),
        store,
        app,
        page: () => page,
        proxy: () => proxy,
        adblock: () => adblock,
        presence: () => presence,
        playback,
        pending,
        toast: vi.fn(),
        settingsView: () => settingsView,
    };
    registerAccountsIpc(ipc, deps);
    return { ipc, own, site, store, app, page, proxy, adblock, presence, settingsView, deps };
}

describe('аккаунты', () => {
    it('список из настроек недоверенный: чужие записи отбрасываются, основной аккаунт есть всегда', () => {
        const store = { get: () => [{ id: 'acc_2', name: 'Два' }, { id: '../../etc', name: 'взлом' }, { id: 'acc_3' }, null, 'строка'] };
        expect(getAccounts(store)).toEqual([{ id: 'default', name: 'Основной аккаунт' }, { id: 'acc_2', name: 'Два' }]);
        expect(getAccounts({ get: () => 'мусор' })).toEqual([{ id: 'default', name: 'Основной аккаунт' }]);
    });
    it('чужой отправитель ничего не переключает, не удаляет и не применяет', async () => {
        const { ipc, store, app, page, proxy } = setup({}, { network: true, reload: true });
        const stranger = fakeEvent();
        await expect(ipc.invoke('get-accounts', stranger)).rejects.toThrow('Недопустимый отправитель IPC');
        for (const channel of ['switch-account', 'add-account', 'logout-account', 'apply-changes']) await ipc.send(channel, stranger, 'acc_1');
        // Имя профиля принимается только от сайта, своя страница клиента его не шлёт
        await ipc.send('soundcloud:profile-update', stranger, 'hacker');
        expect(store.set).not.toHaveBeenCalled();
        expect(app.relaunch).not.toHaveBeenCalled();
        expect(page.session.clearStorageData).not.toHaveBeenCalled();
        expect(proxy.apply).not.toHaveBeenCalled();
    });
    it('переключение только на известный аккаунт, с перезапуском', async () => {
        const { ipc, own, store, app } = setup();
        await ipc.send('switch-account', own, 'acc_999');
        await ipc.send('switch-account', own, { id: 'acc_1' });
        expect(app.relaunch).not.toHaveBeenCalled();
        await ipc.send('switch-account', own, 'acc_1');
        expect(store.values.get('currentAccountId')).toBe('acc_1');
        expect(app.relaunch).toHaveBeenCalledOnce();
        expect(app.quit).toHaveBeenCalledOnce();
    });
    it('выход из дополнительного аккаунта убирает его из списка, из основного только перезагружает страницу', async () => {
        const extra = setup({ currentAccountId: 'acc_1' });
        await extra.ipc.send('logout-account', extra.own);
        expect(extra.page.session.clearStorageData).toHaveBeenCalledOnce();
        expect(extra.store.values.get('accounts')).toEqual([{ id: 'default', name: 'Основной' }]);
        expect(extra.store.values.get('currentAccountId')).toBe('default');
        expect(extra.app.relaunch).toHaveBeenCalledOnce();
        const main = setup();
        await main.ipc.send('logout-account', main.own);
        expect(main.page.reload).toHaveBeenCalledOnce();
        expect(main.app.relaunch).not.toHaveBeenCalled();
    });
    it('«Применить»: сеть применяется и ведёт к перезагрузке, флаги снимаются, ошибка уходит в уведомление', async () => {
        const pending = { network: true, reload: false };
        const { ipc, own, proxy, adblock, page, presence } = setup({ adBlocker: true, discordRichPresence: true }, pending);
        await ipc.send('apply-changes', own);
        expect(proxy.apply).toHaveBeenCalledOnce();
        expect(adblock.setEnabled).toHaveBeenCalledWith(true);
        expect(page.reload).toHaveBeenCalledOnce();
        expect(pending).toEqual({ network: false, reload: false });
        expect(presence.updatePresence).toHaveBeenCalledOnce();
        await ipc.send('apply-changes', own);
        expect(page.reload).toHaveBeenCalledOnce();
        const failing = setup({}, { network: true, reload: false });
        failing.proxy.apply.mockRejectedValueOnce(new Error('прокси недоступен'));
        await failing.ipc.send('apply-changes', failing.own);
        expect(failing.deps.toast).toHaveBeenCalledWith('Error: прокси недоступен');
        expect(failing.deps.pending.network).toBe(true);
    });
    it('имя из профиля сайта: только допустимые символы, F1 узнаёт о смене', async () => {
        const { ipc, site, store, settingsView } = setup();
        await ipc.send('soundcloud:profile-update', site, '<script>');
        await ipc.send('soundcloud:profile-update', site, 'a'.repeat(101));
        expect(store.set).not.toHaveBeenCalled();
        await ipc.send('soundcloud:profile-update', site, 'dj_name');
        expect(store.values.get('accounts')).toEqual([{ id: 'default', name: 'dj_name' }, { id: 'acc_1', name: 'Второй' }]);
        expect(settingsView.send).toHaveBeenCalledWith('accounts-updated');
    });
});
