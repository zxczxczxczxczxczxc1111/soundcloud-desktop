import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const events = new Set(['session.start', 'session.end', 'performance', 'runtime.error', 'runtime.warn', 'renderer.gone', 'renderer.unresponsive', 'renderer.responsive', 'page.loaded', 'page.load-failed', 'system.suspend', 'system.resume', 'gpu.status', 'process.gone']);
const numbers = new Set(['cpuPercent', 'workingSetMiB', 'privateMiB', 'processes', 'loopP95Ms', 'loopMaxMs', 'updates', 'trackChanges', 'sinceUpdateMs', 'sinceProgressMs', 'exitCode', 'errorCode', 'line', 'droppedEvents', 'uptimeSeconds']);
const flags = new Set(['playing', 'hasTrack', 'windowVisible', 'windowMinimized', 'settingsOpen', 'previousUnclean', 'adblock', 'proxy', 'dirty', 'discord', 'githubBadge']);
const reasons = new Set(['clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure', 'memory-eviction']);
const errorTypes = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'AggregateError']);
const sourceFiles = new Set(['main', 'presenceService', 'proxyService', 'adblockService', 'webhookService', 'pluginService', 'pluginProcess', 'themeService', 'settingsManager', 'notificationManager', 'rendererRecovery', 'playbackController', 'viewStyles', 'gpu', 'utility', 'process']);
type Fields = Record<string, unknown>;

// В журнал попадают только перечисленные поля. Тексты ошибок, URL и настройки не сериализуются.
export function safeFields(input: Fields): Fields {
    const result: Fields = {};
    for (const [key, value] of Object.entries(input)) {
        if (numbers.has(key) && typeof value === 'number' && Number.isFinite(value)) result[key] = Math.round(value * 100) / 100;
        else if (flags.has(key) && typeof value === 'boolean') result[key] = value;
        else if (key === 'reason' && typeof value === 'string' && reasons.has(value)) result[key] = value;
        else if (key === 'errorType' && typeof value === 'string' && errorTypes.has(value)) result[key] = value;
        else if (key === 'component' && typeof value === 'string' && sourceFiles.has(value)) result[key] = value;
        else if (['version', 'electron', 'chrome', 'node', 'os'].includes(key) && typeof value === 'string' && /^\d[\d.a-z+-]{0,50}$/i.test(value)) result[key] = value;
        else if (key === 'build' && typeof value === 'string' && /^(?:[a-f0-9]{7,40}|development)$/.test(value)) result[key] = value;
        else if (['gpuCompositing', 'gpuRasterization'].includes(key) && typeof value === 'string' && /^(enabled|disabled|unavailable)(_[a-z]+)*$/.test(value) && value.length < 50) result[key] = value;
        else if (key === 'arch' && typeof value === 'string' && ['x64', 'arm64', 'ia32'].includes(String(value))) result[key] = value;
    }
    return result;
}

export class DiagnosticJournal {
    private queue: string[] = [];
    private size = 0;
    private failed = false;
    private closed = false;
    private lastError = new Map<string, number>();
    private timer: ReturnType<typeof setTimeout> | undefined;
    private originalWarn = console.warn.bind(console);
    private restoreConsole?: () => void;
    public droppedEvents = 0;
    private file: string;
    private marker: string;
    private metadata: Fields;

    constructor(private directory: string, versions: Fields, private maxBytes = 2 * 1024 * 1024) {
        this.metadata = safeFields(versions);
        this.file = join(directory, 'current.log');
        this.marker = join(directory, 'active-session');
        try {
            mkdirSync(directory, { recursive: true });
            const previousUnclean = existsSync(this.marker);
            this.size = existsSync(this.file) ? statSync(this.file).size : 0;
            writeFileSync(this.marker, 'active\n');
            this.record('session.start', { ...versions, previousUnclean });
            this.flush();
        } catch (error) { this.fail(error); }
    }
    private fail(error: unknown): void {
        if (!this.failed) this.originalWarn('Не удалось записать диагностический журнал:', error instanceof Error ? error.name : 'Error');
        this.failed = true;
        this.queue = [];
    }
    public record(event: string, fields: Fields = {}): void {
        if (this.failed || this.closed || !events.has(event)) return;
        const data = safeFields(fields);
        if (event === 'runtime.error' || event === 'runtime.warn') {
            const key = event + JSON.stringify(data);
            const now = Date.now();
            if (now - (this.lastError.get(key) ?? -Infinity) < 10000) { this.droppedEvents++; return; }
            if (this.lastError.size >= 128) this.lastError.clear();
            this.lastError.set(key, now);
        }
        if (this.queue.length >= 128) { this.droppedEvents++; return; }
        this.queue.push(JSON.stringify({ schema: 1, time: new Date().toISOString(), event, ...this.metadata, ...data }) + '\n');
        if (!this.timer) {
            this.timer = setTimeout(() => { this.timer = undefined; this.flush(); }, 1000);
            this.timer.unref();
        }
    }
    private rotate(): void {
        const oldest = join(this.directory, 'previous-2.log');
        const previous = join(this.directory, 'previous-1.log');
        if (existsSync(oldest)) unlinkSync(oldest);
        if (existsSync(previous)) renameSync(previous, oldest);
        if (existsSync(this.file)) renameSync(this.file, previous);
        this.size = 0;
    }
    public flush(): void {
        clearTimeout(this.timer);
        this.timer = undefined;
        if (this.failed || !this.queue.length) return;
        try {
            const batch = this.queue.join('');
            const bytes = Buffer.byteLength(batch);
            if (this.size && this.size + bytes > this.maxBytes) this.rotate();
            appendFileSync(this.file, batch);
            this.size += bytes;
            this.queue = [];
        } catch (error) { this.fail(error); }
    }
    public captureConsole(): void {
        if (this.restoreConsole) return;
        const error = console.error;
        const warn = console.warn;
        const capture = (event: string, args: unknown[]): void => {
            const problem = args.find((arg) => arg instanceof Error);
            const caller = new Error().stack ?? '';
            const match = caller.match(/[\\/]([a-zA-Z]+)\.js:(\d+):\d+/g)?.map(frame => /[\\/]([a-zA-Z]+)\.js:(\d+)/.exec(frame)).find(frame => frame && sourceFiles.has(frame[1]));
            this.record(event, { errorType: problem instanceof Error ? problem.name : 'Error', component: match?.[1], line: match ? Number(match[2]) : undefined });
        };
        console.error = (...args: unknown[]) => { capture('runtime.error', args); error(...args); };
        console.warn = (...args: unknown[]) => { capture('runtime.warn', args); warn(...args); };
        this.restoreConsole = () => { console.error = error; console.warn = warn; };
    }
    public exportTo(destination: string): void {
        if (['current.log', 'previous-1.log', 'previous-2.log', 'active-session'].some(name => resolve(destination).toLowerCase() === resolve(this.directory, name).toLowerCase())) throw new Error('Выберите файл вне служебного журнала');
        this.flush();
        if (this.failed) throw new Error('Диагностический журнал недоступен');
        const data = ['previous-2.log', 'previous-1.log', 'current.log'].map(name => {
            const file = join(this.directory, name);
            return existsSync(file) ? readFileSync(file, 'utf8') : '';
        }).join('');
        writeFileSync(destination, data, 'utf8');
    }
    public close(): void {
        if (this.closed) return;
        this.record('session.end');
        this.flush();
        this.closed = true;
        clearTimeout(this.timer);
        this.restoreConsole?.();
        try { if (!this.failed && existsSync(this.marker)) unlinkSync(this.marker); }
        catch (error) { this.fail(error); }
    }
}
