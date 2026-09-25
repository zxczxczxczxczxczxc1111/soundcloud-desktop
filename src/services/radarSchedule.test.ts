import { expect, it, vi } from 'vitest';
import {
    RADAR_BUDGET_MS, RadarScheduler, cleanCollectResult, cleanSchedule, isRadarTime, isTimeZone, radarPeriod,
    type RadarCollectResult, type RadarSchedulerDeps, type RadarState,
} from './radarSchedule';

const MSK = { day: 5, time: '09:00', zone: 'Europe/Moscow' };

it('период выпуска: последняя наступившая пятница 09:00 по Москве', () => {
    // 25.09.2026 пятница; 09:00 МСК это 06:00 UTC
    expect(radarPeriod(Date.parse('2026-09-25T05:59:00Z'), MSK)).toEqual({ key: '2026-09-18', at: Date.parse('2026-09-18T06:00:00Z') });
    expect(radarPeriod(Date.parse('2026-09-25T06:00:00Z'), MSK)).toEqual({ key: '2026-09-25', at: Date.parse('2026-09-25T06:00:00Z') });
    expect(radarPeriod(Date.parse('2026-09-27T20:00:00Z'), MSK).key).toBe('2026-09-25');
    expect(radarPeriod(Date.parse('2026-10-02T05:00:00Z'), MSK).key).toBe('2026-09-25');
    // Переход через месяц и год
    expect(radarPeriod(Date.parse('2027-01-03T12:00:00Z'), MSK).key).toBe('2027-01-01');
});

it('A17: перевод часов не сдвигает дату и не повторяет выпуск, время слота остаётся местным', () => {
    const berlin = { day: 5, time: '09:00', zone: 'Europe/Berlin' };
    // Летнее время до 25.10.2026, зимнее после
    expect(radarPeriod(Date.parse('2026-10-24T12:00:00Z'), berlin)).toEqual({ key: '2026-10-23', at: Date.parse('2026-10-23T07:00:00Z') });
    expect(radarPeriod(Date.parse('2026-10-25T01:30:00Z'), berlin).key).toBe('2026-10-23');
    expect(radarPeriod(Date.parse('2026-10-26T12:00:00Z'), berlin).key).toBe('2026-10-23');
    expect(radarPeriod(Date.parse('2026-10-30T12:00:00Z'), berlin)).toEqual({ key: '2026-10-30', at: Date.parse('2026-10-30T08:00:00Z') });
    // Слот в пропущенный переводом час сдвигается вперёд, в повторённый берётся зимний
    expect(radarPeriod(Date.parse('2026-03-29T12:00:00Z'), { day: 0, time: '02:30', zone: 'Europe/Berlin' }).at).toBe(Date.parse('2026-03-29T01:30:00Z'));
    expect(radarPeriod(Date.parse('2026-10-25T12:00:00Z'), { day: 0, time: '02:30', zone: 'Europe/Berlin' }).at).toBe(Date.parse('2026-10-25T01:30:00Z'));
});

it('настройки расписания проверяются, неверное заменяется умолчанием', () => {
    expect(isTimeZone('Europe/Moscow')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(isRadarTime('09:00')).toBe(true);
    expect(isRadarTime('24:00')).toBe(false);
    expect(isRadarTime('9:00')).toBe(false);
    expect(cleanSchedule(7, '25:00', 'x')).toEqual(MSK);
    expect(cleanSchedule(1, '18:30', 'Asia/Tokyo')).toEqual({ day: 1, time: '18:30', zone: 'Asia/Tokyo' });
    expect(cleanCollectResult({ user: 77, checked: 2, remaining: -1, stopped: 'evil' })).toEqual({ user: 77, checked: 2, remaining: 0, stopped: '' });
    expect(cleanCollectResult(null)).toBeNull();
});

function scheduler(start: number, overrides: Partial<RadarSchedulerDeps> = {}) {
    let now = start;
    const states: RadarState[] = [];
    const tasks = new Map<string, number>();
    const published = new Set<string>();
    const deps: RadarSchedulerDeps = {
        now: () => now,
        schedule: () => MSK,
        online: () => true,
        user: vi.fn(async () => 77),
        status: vi.fn(async (_user: number, period: string) => ({ published: published.has(period), started: tasks.get(period) ?? 0 })),
        task: vi.fn(async (_user: number, period: string) => {
            if (!tasks.has(period)) tasks.set(period, now);
            return { started: tasks.get(period)! };
        }),
        collect: vi.fn(async (user: number): Promise<RadarCollectResult | null> => ({ user, checked: 1, remaining: 0, stopped: '' })),
        build: vi.fn(async (_user: number, period: string, _at: number, force: boolean) => {
            if (!force) return { published: false, waiting: true };
            published.add(period);
            return { published: true, waiting: false };
        }),
        changed: (state) => states.push(state),
        ...overrides,
    };
    return { deps, states, tasks, published, advance: (ms: number) => { now += ms; } };
}

it('A17: сбор в слот ограничен бюджетом от старта задачи, старт переживает перезапуск, выпуск недели один', async () => {
    const slot = Date.parse('2026-09-25T06:00:00Z');
    const env = scheduler(slot + 60000);
    const first = new RadarScheduler(env.deps);
    await first.tick();
    expect(env.deps.collect).toHaveBeenLastCalledWith(77, RADAR_BUDGET_MS, slot - 24 * 3600000);
    // Обход не завершён, бюджет не вышел: неполное не публикуется
    expect(env.deps.build).toHaveBeenLastCalledWith(77, '2026-09-25', slot, false);
    expect(first.getState()).toMatchObject({ phase: 'collecting', period: '2026-09-25' });
    // Перезапуск клиента через минуту: та же задача, бюджет от прежнего старта
    env.advance(60000);
    const second = new RadarScheduler(env.deps);
    await second.tick();
    expect(env.deps.collect).toHaveBeenLastCalledWith(77, RADAR_BUDGET_MS - 60000, slot - 24 * 3600000);
    // Бюджет вышел: публикуется то, что есть
    env.advance(RADAR_BUDGET_MS);
    await second.tick();
    expect(env.deps.build).toHaveBeenLastCalledWith(77, '2026-09-25', slot, true);
    expect(second.getState().phase).toBe('published');
    // Дальше только понемногу подновляется каталог, повторной сборки нет
    env.advance(600000);
    const builds = vi.mocked(env.deps.build).mock.calls.length;
    await second.tick();
    expect(vi.mocked(env.deps.build).mock.calls.length).toBe(builds);
    expect(env.deps.collect).toHaveBeenLastCalledWith(77, 20000, env.deps.now() - 20 * 3600000);
    expect(env.tasks.size).toBe(1);
});

it('нет сети, нет входа, чужой аккаунт: состояние отдельно от пустой недели, сборки нет', async () => {
    const slot = Date.parse('2026-09-25T06:00:00Z');
    const offline = scheduler(slot, { online: () => false });
    const a = new RadarScheduler(offline.deps);
    await a.tick();
    expect(a.getState().phase).toBe('offline');
    expect(offline.deps.user).not.toHaveBeenCalled();
    const noUser = scheduler(slot, { user: vi.fn(async () => 0) });
    const b = new RadarScheduler(noUser.deps);
    await b.tick();
    expect(b.getState().phase).toBe('no-session');
    const lost = scheduler(slot, { collect: vi.fn(async (user: number) => ({ user, checked: 0, remaining: 3, stopped: 'auth' as const })) });
    const c = new RadarScheduler(lost.deps);
    await c.tick();
    expect(c.getState().phase).toBe('no-session');
    expect(lost.deps.build).not.toHaveBeenCalled();
    const other = scheduler(slot, { collect: vi.fn(async () => ({ user: 78, checked: 0, remaining: 3, stopped: '' as const })) });
    const d = new RadarScheduler(other.deps);
    await d.tick();
    expect(d.getState()).toMatchObject({ phase: 'collecting', error: 'account-changed' });
    expect(other.deps.build).not.toHaveBeenCalled();
});

it('параллельный вызов ждёт идущий проход, ошибка видна в состоянии и не роняет планировщик', async () => {
    const env = scheduler(Date.parse('2026-09-25T07:00:00Z'), { status: vi.fn(async () => { throw new Error('Библиотека не ответила вовремя'); }) });
    const radar = new RadarScheduler(env.deps);
    await Promise.all([radar.tick(), radar.tick()]);
    expect(env.deps.status).toHaveBeenCalledTimes(1);
    expect(radar.getState()).toMatchObject({ phase: 'error', error: 'Библиотека не ответила вовремя' });
});

it('таймер: первая проверка после запуска, дальше раз в интервал, без сети чаще; стоп гасит таймер', async () => {
    vi.useFakeTimers();
    try {
        let online = false;
        const env = scheduler(Date.parse('2026-09-25T07:00:00Z'), { online: () => online });
        const radar = new RadarScheduler(env.deps, 600000);
        radar.start(1000);
        await vi.advanceTimersByTimeAsync(1000);
        expect(radar.getState().phase).toBe('offline');
        online = true;
        await vi.advanceTimersByTimeAsync(60000);
        expect(env.deps.user).toHaveBeenCalledTimes(1);
        radar.stop();
        await vi.advanceTimersByTimeAsync(3600000);
        expect(env.deps.user).toHaveBeenCalledTimes(1);
    } finally {
        vi.useRealTimers();
    }
});
