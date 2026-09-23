import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, expect, it } from 'vitest';
import { WaveJournal } from './waveJournal';

const dirs: string[] = [];
const dir = (): string => {
    const created = mkdtempSync(join(tmpdir(), 'wave-journal-'));
    dirs.push(created);
    return created;
};
afterEach(() => {
    for (const created of dirs.splice(0)) rmSync(created, { recursive: true, force: true });
});

it('хранит только id треков по пользователю и переживает перезапуск', () => {
    const directory = dir();
    const journal = new WaveJournal(directory);
    journal.add(42, [1, 2, 2, -5, 1.5, '3', 3]);
    journal.add(7, [9]);
    journal.flush();
    expect(JSON.parse(readFileSync(join(directory, 'journal-42.json'), 'utf8'))).toEqual([1, 2, 3]);
    const reopened = new WaveJournal(directory);
    expect(reopened.load(42)).toEqual([1, 2, 3]);
    expect(reopened.load(7)).toEqual([9]);
    expect(reopened.load(8)).toEqual([]);
});

it('отклоняет чужой ввод и не падает на испорченном файле', () => {
    const directory = dir();
    writeFileSync(join(directory, 'journal-5.json'), '{broken', 'utf8');
    const journal = new WaveJournal(directory);
    expect(journal.load(5)).toEqual([]);
    expect(journal.load('../5')).toEqual([]);
    journal.add('../x', [1]);
    journal.add(5, 'not a list');
    journal.add(5, [4]);
    journal.flush();
    expect(journal.load(5)).toEqual([4]);
});
