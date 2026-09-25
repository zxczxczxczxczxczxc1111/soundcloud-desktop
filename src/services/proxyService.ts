import {
    safeStorage,
    type WebContents,
    type AuthInfo,
    type Event,
    type AuthenticationResponseDetails,
} from 'electron';

import type { TranslationKeys } from './translationService';

type ProxyTextKey = Extract<TranslationKeys, 'proxyPasswordUnreadable' | 'proxyAddressInvalid' | 'proxyStorageUnavailable'>;

interface Settings {
    get(key: string, fallback?: unknown): unknown;
    set(key: string, value: unknown): void;
    delete(key: string): void;
}

export class ProxyService {
    private pending = Promise.resolve();
    private login = (
        event: Event,
        _details: AuthenticationResponseDetails,
        auth: AuthInfo,
        callback: (username?: string, password?: string) => void,
    ): void => {
        if (!auth.isProxy || this.store.get('proxyEnabled') !== true) return;
        const host = String(this.store.get('proxyHost', ''))
            .replace(/^\[|\]$/g, '')
            .toLowerCase();
        if (
            auth.host.replace(/^\[|\]$/g, '').toLowerCase() !== host ||
            auth.port !== Number(this.store.get('proxyPort'))
        )
            return;
        event.preventDefault();
        try {
            const encrypted = this.store.get('proxyPasswordEncrypted', '');
            const password =
                typeof encrypted === 'string' && encrypted
                    ? safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
                    : '';
            callback(String(this.store.get('proxyUsername', '')), password);
        } catch (error) {
            console.error('Не удалось расшифровать пароль прокси:', error);
            this.notify(this.text('proxyPasswordUnreadable'));
            callback();
        }
    };
    constructor(
        private contents: WebContents,
        private store: Settings,
        private notify: (message: string) => void,
        // Сообщения пользователю на языке приложения
        private text: (key: ProxyTextKey) => string,
    ) {
        contents.on('login', this.login);
    }
    public apply(): Promise<void> {
        this.pending = this.pending
            .catch(() => undefined)
            .then(async () => {
                const session = this.contents.session;
                if (this.store.get('proxyEnabled') === true) {
                    const host = String(this.store.get('proxyHost', '')).trim();
                    const port = Number(this.store.get('proxyPort'));
                    if (
                        !/^(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)$/i.test(host) ||
                        !Number.isInteger(port) ||
                        port < 1 ||
                        port > 65535
                    )
                        throw new Error(this.text('proxyAddressInvalid'));
                    await session.setProxy({ mode: 'fixed_servers', proxyRules: 'http://' + host + ':' + port });
                } else await session.setProxy({ mode: 'direct' });
                await session.clearAuthCache();
                await session.closeAllConnections();
            });
        return this.pending;
    }
    public setPassword(password: string): void {
        if (!password) {
            this.store.delete('proxyPasswordEncrypted');
            return;
        }
        if (!safeStorage.isEncryptionAvailable()) throw new Error(this.text('proxyStorageUnavailable'));
        this.store.set('proxyPasswordEncrypted', safeStorage.encryptString(password).toString('base64'));
    }
    public dispose(): void {
        this.contents.removeListener('login', this.login);
    }
}
