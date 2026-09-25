import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs';
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
    expect(store.load(5)).toEqual({ tracks: [], artists: [], laterTracks: [], laterArtists: [], more: [], families: [] });
    expect(store.load('../5')).toEqual({ tracks: [], artists: [], laterTracks: [], laterArtists: [], more: [], families: [] });
    expect(store.set('../x', 'track', { id: 1 }, true)).toBe(false);
    expect(store.set(5, 'playlist', { id: 1 }, true)).toBe(false);
    expect(store.set(5, 'track', { id: -1 }, true)).toBe(false);
    expect(store.set(5, 'track', { id: 3 }, 'yes')).toBe(false);
    expect(store.set(5, 'track', { id: 3, url: 'javascript:alert(1)' }, true)).toBe(true);
    expect(store.load(5).tracks[0].url).toBe('');
    expect(cleanExclusionUrl('http://soundcloud.com/a')).toBe('');
    expect(cleanExclusionUrl('https://evil.com/a')).toBe('');
});

it('«Не сейчас» живёт 7 дней, «Больше такого» хранит метки трека и снимает «Не нравится»', () => {
    const directory = dir();
    const store = new WaveExclusions(directory);
    const t0 = Date.UTC(2026, 8, 24);
    expect(store.set(9, 'later-track', { id: 1, title: 'Позже', until: 1 }, true, t0)).toBe(true);
    expect(store.set(9, 'later-artist', { id: 5, title: 'Артист' }, true, t0)).toBe(true);
    expect(store.load(9, t0 + 6 * 86400000).laterTracks.map((entry) => [entry.id, entry.until])).toEqual([[1, t0 + 7 * 86400000]]);
    expect(store.load(9, t0 + 7 * 86400000)).toMatchObject({ laterTracks: [], laterArtists: [] });

    expect(store.set(9, 'track', { id: 2, title: 'Не то' }, true, t0)).toBe(true);
    expect(store.set(9, 'more', { id: 2, title: 'То', artistId: 70, genre: 'Drum & Bass', tags: '"liquid dnb" chill', until: 5 }, true, t0)).toBe(true);
    const list = new WaveExclusions(directory).load(9, t0);
    expect(list.tracks).toEqual([]);
    expect(list.more).toEqual([{ id: 2, title: 'То', artist: '', url: '', at: t0, artistId: 70, genre: 'Drum & Bass', tags: '"liquid dnb" chill' }]);
    // «Не сейчас» по треку снимает «Больше такого»
    expect(store.set(9, 'later-track', { id: 2 }, true, t0)).toBe(true);
    expect(store.load(9, t0).more).toEqual([]);
});

it('старый файл без семей открывается как был; первая запись семьи сохраняет его копию один раз', () => {
    const directory = dir();
    const old = '{"tracks":[{"id":1,"title":"Song","artist":"A","url":"","at":5}],"artists":[{"id":7,"title":"A","artist":"","url":"","at":6}]}';
    writeFileSync(join(directory, 'exclusions-3.json'), old, 'utf8');
    const store = new WaveExclusions(directory);
    // Прежние отметки не переосмысляются: трек это запрет загрузки, артист это скрытый аккаунт
    expect(store.load(3)).toMatchObject({ tracks: [{ id: 1, at: 5 }], artists: [{ id: 7 }], families: [] });
    expect(store.set(3, 'track', { id: 2, title: 'Other' }, true, 10)).toBe(true);
    expect(existsSync(join(directory, 'exclusions-3.v1.json'))).toBe(false);
    expect(store.set(3, 'family', { id: 4, title: 'Artist - Song (Slowed)', artist: 'fan', artistId: 40 }, true, 20)).toBe(true);
    expect(JSON.parse(readFileSync(join(directory, 'exclusions-3.v1.json'), 'utf8')).tracks.map((entry: { id: number }) => entry.id)).toEqual([2, 1]);
    expect(new WaveExclusions(directory).load(3).families).toEqual([{ id: 4, title: 'Artist - Song (Slowed)', artist: 'fan', url: '', at: 20, artistId: 40 }]);
    expect(store.set(3, 'family', { id: 5, title: 'X' }, true, 30)).toBe(true);
    // Копия снята один раз, до первой семьи
    expect(JSON.parse(readFileSync(join(directory, 'exclusions-3.v1.json'), 'utf8')).families ?? []).toEqual([]);
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
