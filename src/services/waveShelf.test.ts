import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanShelf, WaveShelf } from './waveShelf';

const dirs: string[] = [];
const dir = (): string => {
    const created = mkdtempSync(join(tmpdir(), 'wave-shelf-'));
    dirs.push(created);
    return created;
};
afterEach(() => {
    for (const created of dirs.splice(0)) rmSync(created, { recursive: true, force: true });
    vi.restoreAllMocks();
});

const card = (fields: Record<string, unknown> = {}): Record<string, unknown> => ({
    kind: 'group', title: 'Techno и industrial', sub: 'A, B', ids: [1, 2, 3], seeds: [1], keys: ['techno', 'industrial'],
    art: ['https://i1.sndcdn.com/artworks-1-t300x300.jpg'], ...fields,
});

it('хранит подборки дня и переживает перезапуск', () => {
    const directory = dir();
    expect(new WaveShelf(directory).save(42, { day: '2026-09-24', v: 2, cards: [card({ kind: 'daily', title: '' })] })).toBe(true);
    expect(existsSync(join(directory, 'shelf-42.json.tmp'))).toBe(false);
    expect(new WaveShelf(directory).load(42)).toEqual({ day: '2026-09-24', v: 2, cards: [{ ...card({ kind: 'daily', title: '' }) }] });
    expect(new WaveShelf(directory).load(43)).toBeNull();
});

it('держит находки, «Давно не слушал» и восемь жанров; снимок без номера формата это формат 1', () => {
    const cards = [card({ kind: 'daily', title: '' }), card({ kind: 'forgotten', title: '' }), ...Array.from({ length: 9 }, (_, i) => card({ title: 'Жанр ' + i }))];
    const cleaned = cleanShelf({ day: '2026-09-26', cards });
    expect(cleaned?.v).toBe(1);
    expect(cleaned?.cards).toHaveLength(10);
    expect(cleaned?.cards[9].title).toBe('Жанр 7');
});

it('отбрасывает чужое и неверное со страницы', () => {
    expect(cleanShelf({ day: '24.09.2026', cards: [] })).toBeNull();
    expect(cleanShelf(null)).toBeNull();
    const cleaned = cleanShelf({
        day: '2026-09-24',
        cards: [
            card({ kind: 'playlist' }),
            card({ ids: [] }),
            card({ title: '' }),
            card({ ids: [1, 1, -2, 'x', 3.5, 2], art: ['http://i1.sndcdn.com/a.jpg', 'https://evil.com/a.jpg', 'https://i1.sndcdn.com/a.jpg")', 'https://i1.sndcdn.com/ok.jpg'] }),
        ],
    });
    expect(cleaned?.cards).toHaveLength(1);
    expect(cleaned?.cards[0].ids).toEqual([1, 2]);
    expect(cleaned?.cards[0].art).toEqual(['https://i1.sndcdn.com/ok.jpg']);
    expect(new WaveShelf(dir()).save(0, { day: '2026-09-24', cards: [] })).toBe(false);
});

it('битый файл читается как пустой, без падения', () => {
    const directory = dir();
    writeFileSync(join(directory, 'shelf-42.json'), '{', 'utf8');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(new WaveShelf(directory).load(42)).toBeNull();
});
