import { describe, expect, it, vi } from 'vitest';
import { radarPeriod, type RadarState } from '../services/radarSchedule';
import { FakeIpc, fakeEvent, trusting } from './fakeIpc.helper.test';
import { createRadarScheduler, registerRadarIpc, type RadarIpcDeps } from './radarIpc';

const schedule = { radarDay: 5, radarTime: '09:00', radarZone: 'Europe/Moscow' } as Record<string, unknown>;
const store = { get: (key: string) => schedule[key], set: vi.fn(), delete: vi.fn() };
const diagnostics = { record: vi.fn() };

function library(responses: Record<string, unknown> = {}) {
    const request = vi.fn(async (method: string) => responses[method] ?? null);
    return { request, library: { request } as unknown as RadarIpcDeps['library'] };
}

function setup(responses: Record<string, unknown> = {}, state: RadarState | null = { phase: 'published', period: '2026-09-25', error: '', updated: 1 }) {
    const ipc = new FakeIpc();
    const site = fakeEvent();
    const { request, library: lib } = library(responses);
    registerRadarIpc(ipc, { trustedSite: trusting(site), store, library: lib, diagnostics, scheduler: () => (state ? { getState: () => state } : null) });
    return { ipc, site, request };
}

describe('обработчики радара', () => {
    it('чужой отправитель и неверный пользователь отклонены до хранилища', async () => {
        const { ipc, site, request } = setup();
        const stranger = fakeEvent();
        for (const channel of ['soundcloud:radar:view', 'soundcloud:radar:found', 'soundcloud:radar:rebuild', 'soundcloud:radar:channels'])
            await expect(ipc.invoke(channel, stranger, 11)).rejects.toThrow('Недопустимый отправитель радара');
        await expect(ipc.invoke('soundcloud:radar:state', stranger)).rejects.toThrow('Недопустимый отправитель радара');
        for (const user of [0, -1, 1.5, '11', null])
            await expect(ipc.invoke('soundcloud:radar:view', site, user)).rejects.toThrow('Пользователь не определён');
        expect(request).not.toHaveBeenCalled();
    });
    it('выпуск и находки идут в хранилище с периодом и ревизией со страницы', async () => {
        const { ipc, site, request } = setup();
        await ipc.invoke('soundcloud:radar:view', site, 11, '2026-09-18', 2);
        await ipc.invoke('soundcloud:radar:found', site, 11, '2026-09-18', 1);
        await ipc.invoke('soundcloud:radar:channels', site, 11);
        expect(request).toHaveBeenNthCalledWith(1, 'radarView', 11, '2026-09-18', 2);
        expect(request).toHaveBeenNthCalledWith(2, 'radarFound', 11, '2026-09-18', 1);
        expect(request).toHaveBeenNthCalledWith(3, 'radarChannels', 11);
    });
    it('пересборка: при готовом выпуске новая ревизия, без него сборка сейчас', async () => {
        const period = radarPeriod(Date.now(), { day: 5, time: '09:00', zone: 'Europe/Moscow' });
        const published = setup({ radarStatus: { published: true, started: 1 }, radarBuild: { published: false, waiting: true, edition: null } });
        await published.ipc.invoke('soundcloud:radar:rebuild', published.site, 11);
        expect(published.request).toHaveBeenLastCalledWith('radarBuild', 11, period.key, period.at, true, true);
        const fresh = setup({ radarStatus: { published: false, started: 0 }, radarBuild: { published: false, waiting: true, edition: null } });
        await fresh.ipc.invoke('soundcloud:radar:rebuild', fresh.site, 11);
        expect(fresh.request).toHaveBeenLastCalledWith('radarBuild', 11, period.key, period.at, true, false);
    });
    it('состав записанного выпуска уходит в журнал диагностики числами, неудачная сборка не пишется', async () => {
        const edition = { status: 'partial', coverage: { accounts: 40, checked: 38, failed: 1, searches: 20, searchesDone: 20 } };
        const composition = { releases: 30, own: 24, channel: 1, uploads: 8, fan: 3, late: 2 };
        diagnostics.record.mockClear();
        const built = setup({ radarStatus: { published: true, started: 1 }, radarBuild: { published: true, waiting: false, edition, composition } });
        await built.ipc.invoke('soundcloud:radar:rebuild', built.site, 11);
        expect(diagnostics.record).toHaveBeenCalledOnce();
        expect(diagnostics.record).toHaveBeenCalledWith('radar.built', {
            manual: true, partial: true, radarReleases: 30, radarOwn: 24, radarChannel: 1, radarUploads: 8, radarFan: 3, radarLate: 2,
            radarAccounts: 40, radarChecked: 38, radarFailed: 1,
        });
        const waiting = setup({ radarStatus: { published: false, started: 0 }, radarBuild: { published: false, waiting: true, edition: null } });
        await waiting.ipc.invoke('soundcloud:radar:rebuild', waiting.site, 11);
        expect(diagnostics.record).toHaveBeenCalledOnce();
    });
    it('состояние сбора берётся у планировщика, до его запуска пусто', async () => {
        const running = setup();
        await expect(running.ipc.invoke('soundcloud:radar:state', running.site)).resolves.toMatchObject({ phase: 'published' });
        const none = setup({}, null);
        await expect(none.ipc.invoke('soundcloud:radar:state', none.site)).resolves.toBeNull();
    });
});

describe('планировщик радара в main', () => {
    it('ответ страницы «кто вошёл» недоверенный: не число значит нет входа', async () => {
        const { request, library: lib } = library();
        const page = vi.fn(async () => 'admin');
        const scheduler = createRadarScheduler({ store, library: lib, diagnostics, online: () => true, page });
        await scheduler.tick();
        expect(scheduler.getState().phase).toBe('no-session');
        expect(page).toHaveBeenCalledWith('window.__scWhoAmI ? window.__scWhoAmI() : 0');
        expect(request).not.toHaveBeenCalled();
    });
    it('после выпуска страница подновляет каталог, мусор из ответа сбора чистится', async () => {
        const { request, library: lib } = library({ radarStatus: { published: true, started: 1 } });
        const scripts: string[] = [];
        const page = vi.fn(async (script: string) => {
            scripts.push(script);
            if (script.startsWith('window.__scWhoAmI')) return 11;
            if (script.startsWith('window.__scRadarCollect')) return { user: 11, checked: 'много', remaining: 0, stopped: 'взлом' };
            return null;
        });
        const scheduler = createRadarScheduler({ store, library: lib, diagnostics, online: () => true, page });
        await scheduler.tick();
        expect(scheduler.getState().phase).toBe('published');
        expect(request).toHaveBeenCalledWith('radarStatus', 11, expect.any(String), expect.any(Number));
        expect(scripts.some((script) => /^window\.__scRadarCollect \? window\.__scRadarCollect\(20000, (\d+), \1\) : null$/.test(script))).toBe(true);
        // Страница узнаёт о новом состоянии
        expect(scripts.some((script) => script.startsWith('window.__scRadarChanged?.({"phase":"published"'))).toBe(true);
    });
    it('плановая сборка пишет состав выпуска в журнал', async () => {
        const edition = { status: 'complete', coverage: { accounts: 5, checked: 5, failed: 0, searches: 0, searchesDone: 0 } };
        const composition = { releases: 4, own: 4, channel: 0, uploads: 1, fan: 0, late: 0 };
        const { library: lib } = library({ radarStatus: { published: false, started: 0 }, radarTask: { started: Date.now() }, radarBuild: { published: true, waiting: false, edition, composition } });
        const page = vi.fn(async (script: string) => {
            if (script.startsWith('window.__scWhoAmI')) return 11;
            if (script.startsWith('window.__scRadarCollect')) return { user: 11, checked: 5, remaining: 0 };
            return null;
        });
        diagnostics.record.mockClear();
        const scheduler = createRadarScheduler({ store, library: lib, diagnostics, online: () => true, page });
        await scheduler.tick();
        expect(scheduler.getState().phase).toBe('published');
        expect(diagnostics.record).toHaveBeenCalledWith('radar.built', expect.objectContaining({ manual: false, partial: false, radarReleases: 4, radarOwn: 4 }));
    });
    it('без сети проход не трогает ни страницу, ни хранилище', async () => {
        const { request, library: lib } = library();
        const page = vi.fn<(script: string) => Promise<unknown>>(async () => 11);
        const scheduler = createRadarScheduler({ store, library: lib, diagnostics, online: () => false, page });
        await scheduler.tick();
        expect(scheduler.getState().phase).toBe('offline');
        expect(request).not.toHaveBeenCalled();
        expect(page.mock.calls.every(([script]) => String(script).startsWith('window.__scRadarChanged'))).toBe(true);
    });
});
