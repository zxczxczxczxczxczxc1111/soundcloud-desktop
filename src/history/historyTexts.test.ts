import { readFileSync } from 'fs';
import { join } from 'path';
import { runInNewContext } from 'vm';
import { expect, it } from 'vitest';

// Словарь страницы истории живёт внутри history.js: берём объект TEXTS из исходника. Функциям нужны помощники
// форматирования страницы, для проверки их хватает упрощённых
type Texts = Record<string, unknown> & { sources: Record<string, string>; reasons: Record<string, string> };
function historyTexts(): { ru: Texts; en: Texts } {
    const lines = readFileSync(join(__dirname, 'history.js'), 'utf8').split('\n');
    const start = lines.findIndex((line) => line.includes('const TEXTS = {'));
    let end = start;
    while (end < lines.length && !/^ {4}};/.test(lines[end])) end++;
    const helpers = "const plural = (n, forms) => forms[0]; const fmt = new Intl.DateTimeFormat('en'); let fmtLong = fmt, fmtShort = fmt, fmtWd = fmt, fmtDayMonth = fmt, fmtWeekday = fmt;";
    return runInNewContext('(function(){' + helpers + lines.slice(start, end + 1).join('\n') + '; return TEXTS; })()', { Intl, String, Math, Number, Date }) as { ru: Texts; en: Texts };
}
// Виды из типов волны: так новая причина или подборка без подписи в истории роняет тест
function kindsFromTypes(): { sources: string[]; reasons: string[] } {
    const types = readFileSync(join(__dirname, '..', 'services', 'waveTypes.ts'), 'utf8');
    const literals = (text: string): string[] => [...text.matchAll(/'([a-zA-Z]+)'/g)].map((match) => match[1]);
    const line = (name: string): string => types.split('\n').find((item) => item.startsWith('export type ' + name + ' ='))?.split('=')[1] ?? '';
    // Варианты причины идут строками «| { kind: ... }» сразу под объявлением, между ними бывают комментарии
    const typeLines = types.split('\n');
    const from = typeLines.findIndex((item) => item.startsWith('export type WaveReason ='));
    let to = from + 1;
    while (to < typeLines.length && /^\s+(\||\/\*\*|\*)/.test(typeLines[to])) to++;
    const reasons = [...typeLines.slice(from, to).join('\n').matchAll(/kind: '([a-zA-Z]+)'/g)].map((match) => match[1]);
    return {
        sources: [...literals(line('WaveMode')), ...literals(line('WaveLinkKind')), ...literals(line('SeedKind'))],
        reasons: [...reasons, 'station'],
    };
}

it('словарь истории: у ru и en одни и те же ключи', () => {
    const { ru, en } = historyTexts();
    const keys = (value: unknown, at = ''): string[] => (value && typeof value === 'object' && !Array.isArray(value)
        ? Object.entries(value).flatMap(([key, inner]) => [at + key, ...keys(inner, at + key + '.')])
        : []);
    expect(keys(en).sort()).toEqual(keys(ru).sort());
});

it('словарь истории: каждый источник и каждая причина волны подписаны на обоих языках', () => {
    const { ru, en } = historyTexts();
    const { sources, reasons } = kindsFromTypes();
    expect(sources).toEqual(expect.arrayContaining(['similar', 'artistAll', 'liked', 'library']));
    expect(reasons).toEqual(expect.arrayContaining(['similar', 'neighbors', 'likedBy', 'station']));
    for (const texts of [ru, en]) {
        expect(sources.filter((kind) => !texts.sources[kind])).toEqual([]);
        expect(reasons.filter((kind) => !texts.reasons[kind])).toEqual([]);
    }
});
