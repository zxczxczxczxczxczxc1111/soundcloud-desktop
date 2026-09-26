import { expect, it } from 'vitest';
import { cleanSiteState, siteBroken, siteRequires } from './siteModules';
import { safeFields } from './diagnosticJournal';

it('ответ страницы о сайте: только четыре флага, иначе отказ', () => {
    expect(cleanSiteState({ player: false, api: true, sound: true, translation: true, url: 'https://x' })).toEqual({ player: false, api: true, sound: true, translation: true });
    for (const value of [null, 'broken', { player: 'no', api: true, sound: true, translation: true }, { player: true, api: true, sound: true }]) expect(cleanSiteState(value)).toBeNull();
    expect(siteBroken({ player: true, api: true, sound: true, translation: true })).toBe(false);
    expect(siteBroken({ player: true, api: true, sound: true, translation: false })).toBe(true);
    expect(safeFields({ sitePlayer: false, siteApi: true, siteSound: true, siteTranslation: false })).toEqual({ sitePlayer: false, siteApi: true, siteSound: true, siteTranslation: false });
});

it('require сайта находится в старом и новом формате, больший рантайм первым', () => {
    const small = { c: { a: {} } };
    const big = { c: { a: {}, b: {}, c: {} } };
    const legacy: unknown[] = [];
    Object.defineProperty(legacy, 'push', {
        value: (chunk: [unknown, Record<string, (m: object, e: object, r: object) => void>, string[][]]) => {
            for (const [id] of chunk[2]) { chunk[1][id]({}, {}, small); chunk[1][id]({}, {}, big); }
        },
    });
    expect(siteRequires({ webpackJsonp: legacy }, 'probe')).toEqual([big, small]);
    const chunks: unknown[] = [];
    Object.defineProperty(chunks, 'push', { value: (chunk: [unknown, object, (require: object) => void]) => chunk[2](big) });
    expect(siteRequires({ webpackChunk_site: chunks, other: [] }, 'probe')).toEqual([big]);
    expect(siteRequires({}, 'probe')).toEqual([]);
});
