import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, expect, it, vi } from 'vitest';
import { DiagnosticJournal, loopDelayStats, metricsDue, safeFields } from './diagnosticJournal';
const roots: string[] = [];
const journals: DiagnosticJournal[] = [];
function create(limit?: number) {
    const root = mkdtempSync(join(tmpdir(), 'sc-journal-'));
    roots.push(root);
    const journal = new DiagnosticJournal(join(root, 'logs'), { version: '0.1.0', build: 'abcdef0' }, limit);
    journals.push(journal);
    return { root, journal };
}
afterEach(() => { for (const journal of journals.splice(0)) journal.close(); for (const root of roots.splice(0)) { if (!root.startsWith(join(tmpdir(), 'sc-journal-'))) throw new Error('Unexpected test directory'); rmSync(root, { recursive: true, force: true }); } vi.restoreAllMocks(); });
it('allows diagnostics but drops secrets, URLs and arbitrary strings', () => {
    expect(safeFields({ version: '0.1.0', build: 'abcdef0', cpuPercent: 3.14159, playing: true, url: 'https://private.test/token', title: 'private song', password: 'secret', token: 'secret', reason: 'secret', errorType: 'secret', component: 'C:/Users/name/file', bad: 'secret' })).toEqual({ version: '0.1.0', build: 'abcdef0', cpuPercent: 3.14, playing: true });
    const { root, journal } = create();
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    journal.captureConsole();
    console.error('https://secret.test?token=secret', new TypeError('password=secret'));
    journal.exportTo(join(root, 'export.log'));
    const text = readFileSync(join(root, 'export.log'), 'utf8');
    expect(text).not.toContain('secret');
    expect(text).toContain('TypeError');
    expect(stderr).toHaveBeenCalled();
});
it('задержка цикла пишется превышением над шагом замера, показатели в простое раз в 5 минут', () => {
    // Замер 26.09.2026 на Node 24 под Windows: пустой процесс при шаге 100 мс даёт p95 110.9 и максимум 111.1
    const quiet = loopDelayStats({ percentile: () => 110.9e6, max: 111.1e6 }, 100);
    expect(quiet.loopP95Ms).toBeCloseTo(10.9);
    expect(quiet.loopMaxMs).toBeCloseTo(11.1);
    expect(loopDelayStats({ percentile: () => 109.3e6, max: 181e6 }, 100).loopMaxMs).toBeCloseTo(81);
    expect(loopDelayStats({ percentile: () => 0, max: 0 }, 100)).toEqual({ loopP95Ms: 0, loopMaxMs: 0 });
    expect(metricsDue(60_000, 30_000, false)).toBe(true);
    expect(metricsDue(299_000, 0, true)).toBe(false);
    expect(metricsDue(300_000, 0, true)).toBe(true);
});
it('пустая волна: в журнал попадают только числа по источникам', () => {
    const { root, journal } = create();
    journal.record('wave.empty', { waveSeen: 12, waveArtistTracks: 0, waveMoodTags: 2, title: 'кровью', url: 'https://soundcloud.com/a/b' });
    journal.exportTo(join(root, 'export.log'));
    const line = JSON.parse(readFileSync(join(root, 'export.log'), 'utf8').trim().split('\n').pop() ?? '{}') as Record<string, unknown>;
    expect(line).toMatchObject({ event: 'wave.empty', waveSeen: 12, waveArtistTracks: 0, waveMoodTags: 2 });
    expect(line.title).toBeUndefined();
    expect(line.url).toBeUndefined();
});
it('резервная копия: причина отказа и время без пути к файлу и содержимого', () => {
    const { root, journal } = create();
    journal.record('backup.failed', { auto: true, reason: 'no-space', file: 'D:/Backups/soundcloud-backup.scbackup', title: 'кровью' });
    journal.record('backup.saved', { auto: false, backupMs: 812.456, backupKiB: 96.5, path: 'C:/Users/name' });
    journal.record('backup.failed', { reason: 'D:/private' });
    journal.exportTo(join(root, 'export.log'));
    const lines = readFileSync(join(root, 'export.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => String(line.event).startsWith('backup.'));
    expect(lines.map(({ event, auto, reason, backupMs, backupKiB, file, title, path }) => ({ event, auto, reason, backupMs, backupKiB, file, title, path }))).toEqual([
        { event: 'backup.failed', auto: true, reason: 'no-space', backupMs: undefined, backupKiB: undefined, file: undefined, title: undefined, path: undefined },
        { event: 'backup.saved', auto: false, reason: undefined, backupMs: 812.46, backupKiB: 96.5, file: undefined, title: undefined, path: undefined },
        { event: 'backup.failed', auto: undefined, reason: undefined, backupMs: undefined, backupKiB: undefined, file: undefined, title: undefined, path: undefined },
    ]);
});
it('предупреждение Node пишется предупреждением процесса, а не ошибкой без источника', () => {
    const { root, journal } = create();
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    journal.captureConsole();
    console.error('(node:4924) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.');
    journal.exportTo(join(root, 'export.log'));
    const events = readFileSync(join(root, 'export.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events[events.length - 1]).toMatchObject({ event: 'runtime.warn', component: 'process' });
    expect(events.some((event) => event.event === 'runtime.error')).toBe(false);
    expect(stderr).toHaveBeenCalledOnce();
});
it('rotates three files and exports them in chronological order', () => {
    const { root, journal } = create(250);
    for (let i = 0; i < 12; i++) { journal.record('performance', { updates: i }); journal.flush(); }
    expect(readdirSync(join(root, 'logs')).filter(name => name.endsWith('.log'))).toHaveLength(3);
    journal.exportTo(join(root, 'export.log'));
    const values = readFileSync(join(root, 'export.log'), 'utf8').trim().split('\n').map(line => JSON.parse(line).updates as number);
    expect(values[values.length - 1]).toBe(11);
    expect(values).toEqual([...values].sort((a,b) => a-b));
    expect(() => journal.exportTo(join(root, 'logs/current.log'))).toThrow();
});
it('detects an unclean previous session and removes the marker on normal exit', () => {
    const { root, journal } = create();
    const second = new DiagnosticJournal(join(root, 'logs'), { version: '0.1.0' });
    journals.push(second);
    second.close();
    expect(readFileSync(join(root, 'logs/current.log'), 'utf8')).toContain('"previousUnclean":true');
    expect(existsSync(join(root, 'logs/active-session'))).toBe(false);
    journal.close();
});
it('bounds a burst of repeated errors', () => {
    const { root, journal } = create();
    for (let i = 0; i < 1000; i++) journal.record('runtime.error', { errorType: 'Error', component: 'main' });
    journal.flush();
    expect(journal.droppedEvents).toBe(999);
    expect(readFileSync(join(root, 'logs/current.log'), 'utf8').trim().split('\n')).toHaveLength(2);
});

it('does not crash the app when the log directory cannot be created', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const root = mkdtempSync(join(tmpdir(), 'sc-journal-'));
    roots.push(root);
    const blocked = join(root, 'file');
    writeFileSync(blocked, 'fixture');
    const journal = new DiagnosticJournal(blocked, { version: '0.1.0' });
    journals.push(journal);
    expect(() => journal.record('performance', { processes: 6 })).not.toThrow();
    expect(() => journal.exportTo(join(root, 'out.log'))).toThrow('недоступен');
});
