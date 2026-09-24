import { beforeEach, expect, it, vi } from 'vitest';
import type { WebContents, AuthInfo, Event, LoginAuthenticationResponseDetails } from 'electron';
const storage = vi.hoisted(() => ({
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn(() => Buffer.from('encrypted')),
    decryptString: vi.fn(() => 'secret'),
}));
vi.mock('electron', () => ({ safeStorage: storage }));
import { ProxyService } from './proxyService';
import { TranslationService } from './translationService';

type Login = (
    event: Event,
    details: LoginAuthenticationResponseDetails,
    auth: AuthInfo,
    callback: (user?: string, password?: string) => void,
) => void;
const values = new Map<string, unknown>();
let login: Login;
const session = { setProxy: vi.fn(), clearAuthCache: vi.fn(), closeAllConnections: vi.fn() };
let service: ProxyService;
beforeEach(() => {
    vi.clearAllMocks();
    values.clear();
    values.set('proxyEnabled', true);
    values.set('proxyHost', 'proxy.local');
    values.set('proxyPort', '8080');
    values.set('proxyUsername', 'user');
    const contents = {
        session,
        on: (_event: string, callback: Login) => {
            login = callback;
        },
        removeListener: vi.fn(),
    };
    service = new ProxyService(
        contents as unknown as WebContents,
        {
            get: (key, fallback) => values.get(key) ?? fallback,
            set: (key, value) => {
                values.set(key, value);
            },
            delete: (key) => {
                values.delete(key);
            },
        },
        vi.fn(),
        (key) => new TranslationService(() => 'ru').translate(key),
    );
});
it('использует переданную сессию и отключает прокси', async () => {
    await service.apply();
    expect(session.setProxy).toHaveBeenLastCalledWith({ mode: 'fixed_servers', proxyRules: 'http://proxy.local:8080' });
    values.set('proxyEnabled', false);
    await service.apply();
    expect(session.setProxy).toHaveBeenLastCalledWith({ mode: 'direct' });
    expect(session.closeAllConnections).toHaveBeenCalledTimes(2);
});
it('не сохраняет пароль открытым текстом и отвечает только своему прокси', () => {
    service.setPassword('secret');
    expect(values.get('proxyPasswordEncrypted')).toBe(Buffer.from('encrypted').toString('base64'));
    const event = { preventDefault: vi.fn() } as unknown as Event;
    const details = {} as LoginAuthenticationResponseDetails;
    const auth: AuthInfo = { isProxy: true, host: 'proxy.local', port: 8080, realm: '', scheme: 'basic' };
    const callback = vi.fn();
    login(event, details, { ...auth, isProxy: false }, callback);
    login(event, details, { ...auth, host: 'other.local' }, callback);
    expect(callback).not.toHaveBeenCalled();
    login(event, details, auth, callback);
    expect(callback).toHaveBeenCalledExactlyOnceWith('user', 'secret');
});
it('отклоняет подстановку правил через адрес', async () => {
    values.set('proxyHost', 'proxy.local;direct://');
    await expect(service.apply()).rejects.toThrow('Некорректные');
    expect(session.setProxy).not.toHaveBeenCalled();
});
it('не заменяет шифрование открытым текстом при недоступном хранилище', () => {
    storage.isEncryptionAvailable.mockReturnValueOnce(false);
    expect(() => service.setPassword('secret')).toThrow('недоступно');
    expect(values.has('proxyPasswordEncrypted')).toBe(false);
});
