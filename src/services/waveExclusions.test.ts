import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanExclusionUrl, WaveExclusions } from './waveExclusions';

const dirs: string[] = [];
const dir = (): string => {
    const created = mkdtempSync(join(tmpdir(), 'wave-exclusions-'));
    dirs.push(created);
    return created;
};
afterEach(() => {
    for (const created of dirs.splice(0)) rmSync(created, { recursive: true, force: true });
    vi.restoreAllMocks();
});

it('ставит и снимает отметки, новые сверху, и переживает перезапуск', () => {
    const directory = dir();
    const store = new WaveExclusions(directory);
    expect(store.set(42, 'track', { id: 1, title: ' Первый\n трек ', url: 'https://soundcloud.com/a/one?in=x#t' }, true)).toBe(true);
    expect(store.set(42, 'track', { id: 2, title: 'Второй', artist: { name: 'x' }, url: 'https://soundcloud.com/a/two' }, true)).toBe(true);
    expect(store.set(42, 'artist', { id: 7, title: 'A', url: 'https://soundcloud.com/A/' }, true)).toBe(true);
    expect(store.load(42).tracks.map((entry) => [entry.id, entry.title])).toEqual([[2, 'Второй'], [1, 'Первый трек']]);
    expect(store.set(42, 'track', { id: 1 }, false)).toBe(true);
    const reopened = new WaveExclusions(directory).load(42);
    expect(reopened.tracks.map((entry) => [entry.id, entry.title, entry.artist, entry.url])).toEqual([[2, 'Второй', '', 'https://soundcloud.com/a/two']]);
    expect(reopened.artists.map((entry) => [entry.id, entry.url])).toEqual([[7, 'https://soundcloud.com/a']]);
    expect(JSON.parse(readFileSync(join(directory, 'exclusions-42.json'), 'utf8')).tracks).toHaveLength(1);
});

it('отклоняет чужой ввод и не пускает ссылки мимо soundcloud.com', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const directory = dir();
    writeFileSync(join(directory, 'exclusions-5.json'), '{broken', 'utf8');
    const store = new WaveExclusions(directory);
    expect(store.load(5)).toEqual({ tracks: [], artists: [] });
    expect(store.load('../5')).toEqual({ tracks: [], artists: [] });
    expect(store.set('../x', 'track', { id: 1 }, true)).toBe(false);
    expect(store.set(5, 'playlist', { id: 1 }, true)).toBe(false);
    expect(store.set(5, 'track', { id: -1 }, true)).toBe(false);
    expect(store.set(5, 'track', { id: 3 }, 'yes')).toBe(false);
    expect(store.set(5, 'track', { id: 3, url: 'javascript:alert(1)' }, true)).toBe(true);
    expect(store.load(5).tracks[0].url).toBe('');
    expect(cleanExclusionUrl('http://soundcloud.com/a')).toBe('');
    expect(cleanExclusionUrl('https://evil.com/a')).toBe('');
});

it('знает текущего пользователя: последнего со страницы, иначе по самому свежему файлу', () => {
    const directory = dir();
    writeFileSync(join(directory, 'exclusions-11.json'), '{"tracks":[],"artists":[]}', 'utf8');
    writeFileSync(join(directory, 'exclusions-12.json'), '{"tracks":[],"artists":[]}', 'utf8');
    utimesSync(join(directory, 'exclusions-11.json'), new Date(2026, 0, 1), new Date(2026, 0, 1));
    const store = new WaveExclusions(directory);
    expect(store.currentUser()).toBe(12);
    store.load(11);
    expect(store.currentUser()).toBe(11);
    expect(new WaveExclusions(join(directory, 'missing')).currentUser()).toBe(0);
});
