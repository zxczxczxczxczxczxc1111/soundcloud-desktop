import { EventEmitter } from 'events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FIRST_CHECK_DELAY_MS, RELEASES_URL, UpdateService, isNewerVersion, type UpdateMode, type UpdateServiceOptions } from './updateService';

const values = new Map<string, unknown>();
const store = { get: (key: string, fallback?: unknown) => values.get(key) ?? fallback };

class FakeUpdater extends EventEmitter {
    autoDownload = false;
    autoInstallOnAppQuit = false;
    checkForUpdates = vi.fn(async () => null);
    quitAndInstall = vi.fn();
}

function release(tag: string, url = 'https://github.com/zxczxczxczxczxczxc1111/soundcloud-desktop/releases/tag/' + tag): Response {
    return new Response(JSON.stringify({ tag_name: tag, html_url: url }), { status: 200 });
}

function create(mode: UpdateMode, extra: Partial<UpdateServiceOptions> = {}) {
    const updater = new FakeUpdater();
    const notify = vi.fn();
    const onState = vi.fn();
    const service = new UpdateService({
        mode,
        version: '0.1.0',
        store,
        notify,
        onState,
        loadUpdater: () => updater as unknown as ReturnType<UpdateServiceOptions['loadUpdater']>,
        ...extra,
    });
    return { service, updater, notify, onState };
}

beforeEach(() => {
    values.clear();
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

it('сравнивает версии по числам, а не строкам', () => {
    expect(isNewerVersion('v0.1.1', '0.1.0')).toBe(true);
    expect(isNewerVersion('0.10.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('v1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('0.0.9', '0.1.0')).toBe(false);
    expect(isNewerVersion('latest', '0.1.0')).toBe(false);
});

it('portable сообщает о новой версии один раз и даёт ссылку на её релиз', async () => {
    const fetch = vi.fn(async () => release('v0.2.0'));
    const { service, notify } = create('portable', { fetch });
    await service.check();
    await service.check();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toContain('0.2.0');
    const state = service.getState();
    expect(state.status).toContain('Вышла версия 0.2.0');
    expect(state.releaseUrl).toBe('https://github.com/zxczxczxczxczxczxc1111/soundcloud-desktop/releases/tag/v0.2.0');
});

it('portable молчит, если версия та же, и не берёт чужую ссылку', async () => {
    const same = create('portable', { fetch: vi.fn(async () => release('v0.1.0')) });
    await same.service.check();
    expect(same.notify).not.toHaveBeenCalled();
    expect(same.service.getState().status).toBe('Установлена последняя версия.');

    const foreign = create('portable', { fetch: vi.fn(async () => release('v0.3.0', 'https://evil.example/download')) });
    await foreign.service.check();
    expect(foreign.service.getState().releaseUrl).toBe(RELEASES_URL);
});

it('ошибка GitHub не роняет проверку и не шлёт уведомление', async () => {
    const { service, notify } = create('portable', { fetch: vi.fn(async () => new Response('{}', { status: 404 })) });
    await expect(service.check()).resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
    expect(service.getState().status).toContain('Не удалось проверить обновления');
});

it('установщик проверяет сразу при запуске, качает сам и ставит при выходе', async () => {
    const { service, updater, notify } = create('installer');
    service.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    updater.emit('update-available', { version: '0.2.0' });
    updater.emit('download-progress', { percent: 42.7 });
    expect(service.getState().status).toBe('Скачивается версия 0.2.0: 42%');
    updater.emit('update-downloaded', { version: '0.2.0' });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(service.getState().status).toContain('установится при выходе');
    expect(service.getState().canInstall).toBe(true);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    service.dispose();
});

it('portable первую проверку по-прежнему откладывает', async () => {
    const fetch = vi.fn(async () => release('v0.1.0'));
    const { service } = create('portable', { fetch });
    service.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(fetch).toHaveBeenCalledTimes(1);
    service.dispose();
});

it('скачанную версию ставит сейчас с перезапуском и не обещает поставить её при выходе', async () => {
    const statuses: string[] = [];
    let service: UpdateService | null = null;
    const created = create('installer', {
        onStatus: (status) => {
            statuses.push(status.key + (status.percent === undefined ? '' : ':' + status.percent));
            // Так делает main: версия, найденная при запуске, ставится сразу
            if (status.key === 'downloaded') expect(service?.installNow()).toBe(true);
        },
    });
    service = created.service;
    const { updater, notify } = created;
    expect(service.installNow()).toBe(false);
    await service.check();
    updater.emit('update-available', { version: '0.2.0' });
    updater.emit('download-progress', { percent: 99.9 });
    expect(service.getState().canInstall).toBe(false);
    updater.emit('update-downloaded', { version: '0.2.0' });
    expect(statuses).toEqual(['downloading', 'progress:99', 'downloaded']);
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect(notify).not.toHaveBeenCalled();
    // Второй раз установщик не запускается
    expect(service.installNow()).toBe(false);
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
});

it('без автообновления поставить сейчас нельзя', async () => {
    const { service, updater } = create('installer');
    await service.check();
    updater.emit('update-downloaded', { version: '0.2.0' });
    values.set('autoUpdateEnabled', false);
    expect(service.getState().canInstall).toBe(false);
    expect(service.installNow()).toBe(false);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
});

it('выключенная настройка не проверяет и снимает установку при выходе', async () => {
    const { service, updater } = create('installer');
    await service.check();
    values.set('autoUpdateEnabled', false);
    service.setEnabled(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    service.start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS * 2);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(service.getState().status).toBe('Автообновление выключено.');
});

it('пишет статус и подсказку на выбранном языке и переключается без новой проверки', async () => {
    let language: 'ru' | 'en' = 'ru';
    const { service } = create('portable', { fetch: vi.fn(async () => release('v0.2.0')), language: () => language });
    await service.check();
    expect(service.getState().status).toBe('Вышла версия 0.2.0. Скачать её можно на странице релиза.');
    language = 'en';
    expect(service.getState().status).toBe('Version 0.2.0 is out. You can download it from the release page.');
    expect(service.getState().hint).toContain('portable version');
});

it('в режиме разработки ничего не проверяет', async () => {
    const fetch = vi.fn(async () => release('v9.0.0'));
    const { service } = create('dev', { fetch });
    service.start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    await service.check();
    expect(fetch).not.toHaveBeenCalled();
});
