// Аккаунты и «Применить»: список, переключение, добавление, выход, имя из профиля сайта, применение сети и перезагрузки
import type { AdblockService } from '../services/adblockService';
import type { PresenceService } from '../services/presenceService';
import type { ProxyService } from '../services/proxyService';
import type { PlaybackState } from './pageIpc';
import type { IpcRegistry, MessageTarget, SenderCheck, Settings } from './ipcTypes';

export interface Account { id: string; name: string }
export function getAccounts(store: Pick<Settings, 'get'>): Account[] {
    const value = store.get('accounts');
    if (!Array.isArray(value)) return [{ id: 'default', name: 'Основной аккаунт' }];
    const accounts = value.filter((item): item is Account =>
        item !== null && typeof item === 'object' &&
        typeof item.id === 'string' && /^(default|acc_[0-9]+)$/.test(item.id) &&
        typeof item.name === 'string');
    if (!accounts.some((item) => item.id === 'default')) accounts.unshift({ id: 'default', name: 'Основной аккаунт' });
    return accounts;
}

/** Ждёт кнопки «Применить»: сеть (прокси, блокировщик) и перезагрузка страницы (язык сайта встаёт только при загрузке) */
export interface PendingChanges {
    network: boolean;
    reload: boolean;
}

export interface AccountsIpcDeps {
    trustedLocal: SenderCheck;
    trustedSite: SenderCheck;
    store: Settings;
    app: { relaunch(): void; quit(): void };
    /** Страница сайта; до создания окна её нет */
    page(): { session: { clearStorageData(): Promise<void> }; reload(): void } | null;
    proxy(): Pick<ProxyService, 'apply'>;
    adblock(): Pick<AdblockService, 'setEnabled'>;
    presence(): Pick<PresenceService, 'updatePresence' | 'clearActivity'>;
    playback: PlaybackState;
    pending: PendingChanges;
    toast(message: string): void;
    settingsView(): MessageTarget | undefined;
}

export function registerAccountsIpc(ipc: IpcRegistry, deps: AccountsIpcDeps): void {
    const { trustedLocal: isTrustedLocalSender, trustedSite: isTrustedSoundCloudSender, store, app, pending } = deps;
    // handle account switching
    ipc.handle('get-accounts', (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        return {
            accounts: getAccounts(store),
            currentAccountId: store.get('currentAccountId', 'default'),
        };
    });

    ipc.on('switch-account', (_, accountId: unknown) => {
        if (!isTrustedLocalSender(_)) return;
        const accounts = getAccounts(store);
        if (typeof accountId !== 'string' || !accounts.some((account) => account.id === accountId)) return;
        store.set('currentAccountId', accountId);
        app.relaunch();
        app.quit();
    });

    ipc.on('add-account', (event) => {
        if (!isTrustedLocalSender(event)) return;
        const newId = `acc_${Date.now()}`;
        const accounts = getAccounts(store);
        accounts.push({ id: newId, name: 'Новый аккаунт' });
        store.set('accounts', accounts);
        store.set('currentAccountId', newId);
        app.relaunch();
        app.quit();
    });

    ipc.on('logout-account', async (event) => {
        if (!isTrustedLocalSender(event)) return;

        const currentId = store.get('currentAccountId', 'default');
        const page = deps.page();

        if (page) {
            // log out of session
            await page.session.clearStorageData();
        }

        // if not default account, remove from list
        if (currentId !== 'default') {
            const accounts = getAccounts(store);
            const filteredAccounts = accounts.filter((a: { id: string }) => a.id !== currentId);

            store.set('accounts', filteredAccounts);
            store.set('currentAccountId', 'default'); // Switch back to main

            app.relaunch();
            app.quit();
        } else {
            // if default account, reload page logged out
            if (page) page.reload();
        }
    });

    // handle applying all changes
    ipc.on('apply-changes', async (event) => {
        if (!isTrustedLocalSender(event)) return;

        try {
            if (pending.network) {
                await deps.proxy().apply();
                await deps.adblock().setEnabled(store.get('adBlocker') === true);
                pending.network = false;
                pending.reload = true;
            }
            if (pending.reload) {
                pending.reload = false;
                deps.page()?.reload();
            }
            if (store.get('discordRichPresence')) await deps.presence().updatePresence(deps.playback.info);
            else deps.presence().clearActivity();
        } catch (error) { deps.toast(String(error)); }
    });

    ipc.on('soundcloud:profile-update', (event, username: unknown) => {
        if (!isTrustedSoundCloudSender(event) || typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(username)) return;
        const accounts = getAccounts(store);
        const currentId = store.get('currentAccountId', 'default');
        const account = accounts.find((item) => item.id === currentId);
        if (account && account.name !== username) {
            account.name = username;
            store.set('accounts', accounts);
            deps.settingsView()?.send('accounts-updated');
        }
    });
}
