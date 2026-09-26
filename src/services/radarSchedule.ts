// Расписание пятничного радара: период выпуска в часовом поясе пользователя и планировщик в main.
// Время, сеть, страница и хранилище приходят зависимостями: так планировщик проверяется без Electron

const MINUTE = 60000;

export interface RadarSchedule {
    /** День недели 0-6, воскресенье 0; пятница 5 */
    day: number;
    /** Время «ЧЧ:ММ» */
    time: string;
    /** IANA-зона, например Europe/Moscow */
    zone: string;
}
export const DEFAULT_RADAR_SCHEDULE: RadarSchedule = { day: 5, time: '09:00', zone: 'Europe/Moscow' };
/** Бюджет сбора перед публикацией от старта задачи периода (раздел 8 плана) */
export const RADAR_BUDGET_MS = 180000;
/** Источник считается проверенным для выпуска, если его проверили не раньше чем за сутки до слота */
export const RADAR_FRESH_MS = 24 * 3600000;

export function isTimeZone(value: unknown): value is string {
    if (typeof value !== 'string' || !value || value.length > 64) return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
    } catch {
        return false;
    }
}
export const isRadarTime = (value: unknown): value is string => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export const isRadarDay = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
/** Системная зона; на случай странной среды без неё Москва, как у владельца */
export function systemTimeZone(): string {
    try {
        const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
        return isTimeZone(zone) ? zone : DEFAULT_RADAR_SCHEDULE.zone;
    } catch {
        return DEFAULT_RADAR_SCHEDULE.zone;
    }
}
export function cleanSchedule(day: unknown, time: unknown, zone: unknown): RadarSchedule {
    return {
        day: isRadarDay(day) ? day : DEFAULT_RADAR_SCHEDULE.day,
        time: isRadarTime(time) ? time : DEFAULT_RADAR_SCHEDULE.time,
        zone: isTimeZone(zone) ? zone : DEFAULT_RADAR_SCHEDULE.zone,
    };
}

interface Wall {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    weekday: number;
}
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
// Местные часы в зоне: Intl знает переходы на летнее время, своя арифметика смещений не нужна
function wallClock(at: number, zone: string): Wall {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    }).formatToParts(at);
    const part = (type: string): string => parts.find((item) => item.type === type)?.value ?? '';
    return {
        year: Number(part('year')), month: Number(part('month')), day: Number(part('day')), hour: Number(part('hour')) % 24, minute: Number(part('minute')),
        weekday: WEEKDAYS[part('weekday')] ?? 0,
    };
}
// Момент UTC, когда в зоне наступают эти местные часы: два шага по смещению зоны. Время из пропущенного
// переводом часа сдвигается вперёд на величину перевода, повторённый час берётся по зимнему смещению
function zonedTime(year: number, month: number, day: number, hour: number, minute: number, zone: string): number {
    const target = Date.UTC(year, month - 1, day, hour, minute);
    const offset = (at: number): number => {
        const wall = wallClock(at, zone);
        return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - Math.floor(at / MINUTE) * MINUTE;
    };
    return target - offset(target - offset(target));
}
const dayKey = (year: number, month: number, day: number): string => year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');

/** Период выпуска: последний наступивший слот расписания. key это местная дата слота, по ней выпуск не дублируется */
export function radarPeriod(now: number, schedule: RadarSchedule): { key: string; at: number } {
    const clean = cleanSchedule(schedule.day, schedule.time, schedule.zone);
    const [hour, minute] = clean.time.split(':').map(Number);
    const wall = wallClock(now, clean.zone);
    let back = (wall.weekday - clean.day + 7) % 7;
    if (back === 0 && wall.hour * 60 + wall.minute < hour * 60 + minute) back = 7;
    // Шаг назад по календарной дате, а не по часам: сутки перевода часов дату не сдвигают
    const date = new Date(Date.UTC(wall.year, wall.month - 1, wall.day - back));
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    return { key: dayKey(year, month, day), at: zonedTime(year, month, day, hour, minute, clean.zone) };
}

export type RadarPhase = 'idle' | 'offline' | 'no-session' | 'collecting' | 'published' | 'error';
export interface RadarState {
    phase: RadarPhase;
    /** Период последней проверки, пусто до первой */
    period: string;
    error: string;
    updated: number;
}
export interface RadarStatus {
    /** Автоматический выпуск периода уже есть */
    published: boolean;
    /** Когда начата задача периода; 0, если ещё не начата */
    started: number;
}
export interface RadarCollectResult {
    user: number;
    /** Проверено источников за вызов */
    checked: number;
    /** Остались несвежие источники */
    remaining: number;
    /** Сбор прерван: вход пропал или сменился аккаунт */
    stopped: '' | 'auth' | 'account-changed' | 'no-api';
}
/** Ответ страницы недоверенный: берутся только числа и известные причины остановки */
export function cleanCollectResult(value: unknown): RadarCollectResult | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as Record<string, unknown>;
    const count = (item: unknown): number => (typeof item === 'number' && Number.isSafeInteger(item) && item >= 0 ? item : 0);
    const stopped = source.stopped === 'auth' || source.stopped === 'account-changed' || source.stopped === 'no-api' ? source.stopped : '';
    return { user: count(source.user), checked: count(source.checked), remaining: count(source.remaining), stopped };
}
export interface RadarBuildResult {
    /** Выпуск записан */
    published: boolean;
    /** Отказ публиковать: обход не завершён и релизов пока нет */
    waiting: boolean;
}
export interface RadarSchedulerDeps {
    now(): number;
    schedule(): RadarSchedule;
    online(): boolean;
    /** Вошедший аккаунт по странице; 0: нет входа или страница не готова */
    user(): Promise<number>;
    status(user: number, period: string, at: number): Promise<RadarStatus>;
    /** Задача периода: создаётся один раз, после перезапуска возвращается та же с прежним стартом */
    task(user: number, period: string, at: number, zone: string): Promise<{ started: number }>;
    /** Сбор несвежих источников страницей в пределах бюджета; null, если страница не ответила */
    collect(user: number, budgetMs: number, staleBefore: number): Promise<RadarCollectResult | null>;
    build(user: number, period: string, at: number, force: boolean): Promise<RadarBuildResult>;
    changed(state: RadarState): void;
}

// Планировщик: проверка при запуске, раз в 10 минут, после сна и по возвращении сети. Между слотами источники
// подновляются понемногу, в слот собирается выпуск: задача периода одна, её старт переживает перезапуск,
// публикация не позже бюджета от старта; пустота при незавершённом обходе не публикуется.
// Когда после выпуска обновлять нечего, проверка раз в час, но не позже минуты после следующего слота: проход за 20 с
// обновляет 10-20 источников, большой каталог так же обходится раз в 10 минут
export class RadarScheduler {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private running: Promise<void> | null = null;
    private stopped = false;
    private quiet = false;
    private state: RadarState = { phase: 'idle', period: '', error: '', updated: 0 };

    constructor(private deps: RadarSchedulerDeps, private interval = 10 * MINUTE, private backgroundBudget = 20000, private quietInterval = 60 * MINUTE) {}

    public getState(): RadarState {
        return this.state;
    }
    public start(delay = MINUTE): void {
        this.stopped = false;
        this.plan(delay);
    }
    public stop(): void {
        this.stopped = true;
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
    }
    /** Сон кончился или сеть вернулась: проверить скоро, а не через 10 минут */
    public wake(delay = 30000): void {
        if (!this.stopped) this.plan(delay);
    }
    private plan(delay: number): void {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.tick().finally(() => {
                // Без сети или входа проверка чаще: выпуск собирается вскоре после их возвращения
                const waiting = this.state.phase === 'offline' || this.state.phase === 'no-session';
                if (!this.stopped && this.timer === undefined) this.plan(waiting ? Math.min(MINUTE, this.interval) : this.quiet ? this.quietDelay() : this.interval);
            });
        }, delay);
    }
    private quietDelay(): number {
        const now = this.deps.now();
        const schedule = this.deps.schedule();
        // Следующий слот через неделю от текущего; полнедели запаса покрывает переход на летнее время
        const next = radarPeriod(radarPeriod(now, schedule).at + 7.5 * 24 * 3600000, schedule).at;
        return Math.min(this.quietInterval, Math.max(MINUTE, next - now + MINUTE));
    }
    private set(phase: RadarPhase, period: string, error = ''): void {
        this.state = { phase, period, error, updated: this.deps.now() };
        this.deps.changed(this.state);
    }
    /** Один проход; параллельный вызов ждёт идущий */
    public tick(): Promise<void> {
        this.running ??= this.run().catch((error: unknown) => {
            console.warn('Радар: проход не выполнен', error);
            this.set('error', this.state.period, error instanceof Error ? error.message : String(error));
        }).finally(() => { this.running = null; });
        return this.running;
    }
    private async run(): Promise<void> {
        this.quiet = false;
        if (this.stopped) return;
        const schedule = this.deps.schedule();
        const period = radarPeriod(this.deps.now(), schedule);
        if (!this.deps.online()) return this.set('offline', period.key);
        const user = await this.deps.user();
        if (!user) return this.set('no-session', period.key);
        const status = await this.deps.status(user, period.key, period.at);
        const staleBefore = period.at - RADAR_FRESH_MS;
        if (status.published) {
            // Между слотами каталог подновляется понемногу, чтобы к следующему выпуску почти всё было свежим
            const result = await this.deps.collect(user, this.backgroundBudget, this.deps.now() - 20 * 3600000);
            if (result?.stopped === 'auth') return this.set('no-session', period.key);
            this.quiet = !!result && !result.stopped && result.remaining === 0;
            return this.set('published', period.key);
        }
        const task = await this.deps.task(user, period.key, period.at, schedule.zone);
        const deadline = task.started + RADAR_BUDGET_MS;
        this.set('collecting', period.key);
        const budget = Math.max(deadline - this.deps.now(), 30000);
        const collected = await this.deps.collect(user, budget, staleBefore);
        if (!collected) return this.set('collecting', period.key, 'page');
        if (collected.stopped === 'auth' || collected.stopped === 'no-api') return this.set('no-session', period.key);
        if (collected.stopped === 'account-changed' || collected.user !== user) return this.set('collecting', period.key, 'account-changed');
        const built = await this.deps.build(user, period.key, period.at, this.deps.now() >= deadline);
        return this.set(built.published ? 'published' : 'collecting', period.key);
    }
}
