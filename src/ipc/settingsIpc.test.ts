import { describe, expect, it, vi } from 'vitest';
import type { PresenceService } from '../services/presenceService';
import { FakeIpc, fakeEvent, trusting } from './fakeIpc.helper.test';
import type { PlaybackState } from './pageIpc';
import { registerSettingsIpc, type SettingsIpcDeps } from './settingsIpc';

function setup(savePath = '') {
    const ipc = new FakeIpc();
    const own = fakeEvent();
    const settings = { toggle: vi.fn(), getView: vi.fn(() => null) };
    const history = { hide: vi.fn() };
    const page = { isDestroyed: () => false, executeJavaScript: vi.fn(async () => null) };
    const playback: PlaybackState = {
        info: { title: 'Песня', author: 'Автор', artwork: '', elapsed: '', duration: '', isPlaying: true, isLiked: false, url: '', artistUrl: '' },
        playedThisRun: true, updates: 0, changes: 0, lastUpdateAt: 0, lastProgressAt: 0,
    };
    const deps: SettingsIpcDeps = {
        trustedLocal: trusting(own),
        settings: () => settings as unknown as ReturnType<SettingsIpcDeps['settings']>,
        history: () => history,
        page: () => page,
        toggleHistory: vi.fn(),
        openExternal: vi.fn(async () => {}),
        saveDialog: vi.fn(async () => (savePath ? { canceled: false, filePath: savePath } : { canceled: true, filePath: '' })),
        downloadsFolder: () => '/downloads',
        diagnostics: { exportTo: vi.fn() },
        translate: (key) => 'перевод:' + key,
        applySettingChange: vi.fn(),
        playback,
        presence: () => ({ preview: () => ({ details: 'карточка' }) }) as unknown as Pick<PresenceService, 'preview'>,
    };
    registerSettingsIpc(ipc, deps);
    return { ipc, own, settings, history, page, deps };
}

describe('обработчики настроек', () => {
    it('чужой отправитель: переключатели молчат, запросы отклонены, настройка не меняется', async () => {
        const { ipc, settings, history, page, deps } = setup();
        const stranger = fakeEvent();
        for (const channel of ['toggle-settings', 'toggle-queue', 'toggle-history']) await ipc.send(channel, stranger);
        await ipc.send('setting-changed', stranger, { key: 'fullShuffle', value: false });
        for (const channel of ['open-external-url', 'export-diagnostics', 'get-current-track', 'get-translations'])
            await expect(ipc.invoke(channel, stranger, 'https://soundcloud.com')).rejects.toThrow('Недопустимый отправитель IPC');
        expect([settings.toggle, history.hide, page.executeJavaScript, deps.toggleHistory, deps.applySettingChange, deps.openExternal].every((fn) => vi.mocked(fn).mock.calls.length === 0)).toBe(true);
    });
    it('смена настройки проходит только с верным ключом и типом значения', async () => {
        const { ipc, own, deps } = setup();
        await ipc.send('setting-changed', own, { key: 'fullShuffle', value: 'нет' });
        await ipc.send('setting-changed', own, { key: 'несуществующая', value: true });
        await ipc.send('setting-changed', own, 'fullShuffle=false');
        expect(deps.applySettingChange).not.toHaveBeenCalled();
        await ipc.send('setting-changed', own, { key: 'fullShuffle', value: false });
        expect(deps.applySettingChange).toHaveBeenCalledWith({ key: 'fullShuffle', value: false });
    });
    it('внешняя ссылка открывается только по https, мусор молча отбрасывается', async () => {
        const { ipc, own, deps } = setup();
        for (const url of ['http://example.com', 'file:///C:/Windows/system32/calc.exe', 'javascript:alert(1)', 'не ссылка', '', 42])
            await expect(ipc.invoke('open-external-url', own, url)).resolves.toBe('');
        expect(deps.openExternal).not.toHaveBeenCalled();
        await ipc.invoke('open-external-url', own, '  https://github.com/owner/repo  ');
        expect(deps.openExternal).toHaveBeenCalledWith('https://github.com/owner/repo');
    });
    it('очередь закрывает историю и F1, выгрузка журнала пишет в выбранный файл', async () => {
        const { ipc, own, settings, history, page, deps } = setup('/downloads/journal.log');
        settings.getView.mockReturnValue({} as never);
        await ipc.send('toggle-queue', own);
        expect(history.hide).toHaveBeenCalledOnce();
        expect(settings.toggle).toHaveBeenCalledOnce();
        expect(page.executeJavaScript).toHaveBeenCalledWith('window.__scQueue?.()');
        await expect(ipc.invoke('export-diagnostics', own)).resolves.toBe(true);
        expect(deps.diagnostics.exportTo).toHaveBeenCalledWith('/downloads/journal.log');
        const canceled = setup();
        await expect(canceled.ipc.invoke('export-diagnostics', canceled.own)).resolves.toBe(false);
        expect(canceled.deps.diagnostics.exportTo).not.toHaveBeenCalled();
    });
    it('трек для предпросмотра и переводы F1 собираются на языке приложения', async () => {
        const { ipc, own } = setup();
        await expect(ipc.invoke('get-current-track', own)).resolves.toMatchObject({ track: { title: 'Песня' }, details: 'карточка' });
        await expect(ipc.invoke('get-translations', own)).resolves.toMatchObject({ client: 'перевод:client', applyChanges: 'перевод:applyChanges' });
    });
});
