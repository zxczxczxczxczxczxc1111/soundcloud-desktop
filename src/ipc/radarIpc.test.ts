import { describe, expect, it, vi } from 'vitest';
import { radarPeriod, type RadarState } from '../services/radarSchedule';
import { FakeIpc, fakeEvent, trusting } from './fakeIpc.helper.test';
import { createRadarScheduler, registerRadarIpc, type RadarIpcDeps } from './radarIpc';

const schedule = { radarDay: 5, radarTime: '09:00', radarZone: 'Europe/Moscow' } as Record<string, unknown>;
const store = { get: (key: string) => schedule[key], set: vi.fn(), delete: vi.fn() };

function library(responses: Record<string, unknown> = {}) {
    const request = vi.fn(async (method: string) => responses[method] ?? null);
    return { request, library: { request } as unknown as RadarIpcDeps['library'] };
}

function setup(responses: Record<string, unknown> = {}, state: RadarState | null = { phase: 'published', period: '2026-09-25', error: '', updated: 1 }) {
    const ipc = new FakeIpc();
    const site = fakeEvent();
    const { request, library: lib } = library(responses);
    registerRadarIpc(ipc, { trustedSite: trusting(site), store, library: lib, scheduler: () => (state ? { getState: () => state } : null) });
    return { ipc, site, request };
}

describe('обработчики радара', () => {
    it('чужой отправитель и неверный пользователь отклонены до хранилища', async () => {
        const { ipc, site, request } = setup();
        const stranger = fakeEvent();
        for (const channel of ['soundcloud:radar:view', 'soundcloud:radar:found', 'soundcloud:radar:rebuild'])
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
        expect(request).toHaveBeenNthCalledWith(1, 'radarView', 11, '2026-09-18', 2);
        expect(request).toHaveBeenNthCalledWith(2, 'radarFound', 11, '2026-09-18', 1);
    });
    it('пересборка: при готовом выпуске новая ревизия, без него сборка сейчас', async () => {
        const period = radarPeriod(Date.now(), { day: 5, time: '09:00', zone: 'Europe/Moscow' });
        const published = setup({ radarStatus: { published: true, started: 1 } });
        await published.ipc.invoke('soundcloud:radar:rebuild', published.site, 11);
        expect(published.request).toHaveBeenLastCalledWith('radarBuild', 11, period.key, period.at, true, true);
        const fresh = setup({ radarStatus: { published: false, started: 0 } });
        await fresh.ipc.invoke('soundcloud:radar:rebuild', fresh.site, 11);
        expect(fresh.request).toHaveBeenLastCalledWith('radarBuild', 11, period.key, period.at, true, false);
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
        const scheduler = createRadarScheduler({ store, library: lib, online: () => true, page });
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
        const scheduler = createRadarScheduler({ store, library: lib, online: () => true, page });
        await scheduler.tick();
        expect(scheduler.getState().phase).toBe('published');
        expect(request).toHaveBeenCalledWith('radarStatus', 11, expect.any(String), expect.any(Number));
        expect(scripts.some((script) => /^window\.__scRadarCollect \? window\.__scRadarCollect\(20000, \d+\) : null$/.test(script))).toBe(true);
        // Страница узнаёт о новом состоянии
        expect(scripts.some((script) => script.startsWith('window.__scRadarChanged?.({"phase":"published"'))).toBe(true);
    });
    it('без сети проход не трогает ни страницу, ни хранилище', async () => {
        const { request, library: lib } = library();
        const page = vi.fn<(script: string) => Promise<unknown>>(async () => 11);
        const scheduler = createRadarScheduler({ store, library: lib, online: () => false, page });
        await scheduler.tick();
        expect(scheduler.getState().phase).toBe('offline');
        expect(request).not.toHaveBeenCalled();
        expect(page.mock.calls.every(([script]) => String(script).startsWith('window.__scRadarChanged'))).toBe(true);
    });
});
