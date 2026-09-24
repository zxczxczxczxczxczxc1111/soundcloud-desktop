import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, expect, it, vi } from 'vitest';
import { DiagnosticJournal, safeFields } from './diagnosticJournal';
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
it('пустая волна: в журнал попадают только числа по источникам', () => {
    const { root, journal } = create();
    journal.record('wave.empty', { waveSeen: 12, waveArtistTracks: 0, waveMoodTags: 2, title: 'кровью', url: 'https://soundcloud.com/a/b' });
    journal.exportTo(join(root, 'export.log'));
    const line = JSON.parse(readFileSync(join(root, 'export.log'), 'utf8').trim().split('\n').pop() ?? '{}') as Record<string, unknown>;
    expect(line).toMatchObject({ event: 'wave.empty', waveSeen: 12, waveArtistTracks: 0, waveMoodTags: 2 });
    expect(line.title).toBeUndefined();
    expect(line.url).toBeUndefined();
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
