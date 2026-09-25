import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { cleanPlaybackSnapshot, PlaybackStore, type PlaybackSnapshot } from './playbackStore';
const folders: string[] = [];
const open = (): PlaybackStore => { const folder = mkdtempSync(join(tmpdir(), 'sc-playback-test-')); folders.push(folder); return new PlaybackStore(folder); };
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
const snapshot = (): PlaybackSnapshot => ({ version: 1, at: Date.now(), items: [{ track: { id: 42, title: 'Music', duration: 200000 }, explicit: true, wave: false }], index: 0, position: 52000, paused: true, active: false, mode: 'similar', genre: null, seed: null, fallback: true });
it('сохраняет позицию, паузу и очередь отдельно для аккаунтов', () => {
    const store = open(); const saved = snapshot(); saved.items[0].reason = { kind: 'similar', seed: 'Original seed' };
    expect(store.saveSession(77, saved)).toBe(true);
    expect(store.loadSession(77)).toMatchObject({ position: 52000, paused: true, items: [{ explicit: true, track: { id: 42 }, reason: { kind: 'similar', seed: 'Original seed' } }] });
    expect(store.loadSession(78)).toBeNull();
});
it('не портит предыдущий снимок некорректным вводом', () => {
    const store = open(); store.saveSession(77, snapshot());
    expect(store.saveSession(77, { ...snapshot(), index: 4 })).toBe(false);
    expect(store.loadSession(77)?.index).toBe(0);
    expect(cleanPlaybackSnapshot({ ...snapshot(), items: [{ track: { id: '42' } }] })).toBeNull();
    expect(() => store.saveSession('../other', snapshot())).toThrow();
});
it('хранит локальные подборки и удаляет только выбранную', () => {
    const store = open(); const a = store.saveMix(77, 'A', [{ id: 1 }]); const b = store.saveMix(77, 'B', [{ id: 2 }]);
    expect(store.listMixes(78)).toEqual([]);
    expect(store.removeMix(77, a.id)).toBe(true);
    expect(store.listMixes(77).map((item) => item.id)).toEqual([b.id]);
});
it('каталог включает середину большой библиотеки', () => {
    const store = open(); const tracks = Array.from({ length: 6000 }, (_, i) => ({ id: i + 1, title: 'Track ' + i }));
    expect(store.saveCatalog(77, tracks)).toBe(true);
    expect(store.loadCatalog(77)?.tracks[3000].id).toBe(3001);
    expect(store.loadCatalog(77)?.tracks).toHaveLength(6000);
});
