import * as siteRu from '../i18n/site-ru.json';
import type { SiteDictionary } from '../types';

let cached: SiteDictionary | null = null;

// В страницу уходят только непустые строки и тройки форм: битая запись в JSON не должна ломать сайт
export function normalizeSiteDictionary(input: unknown): SiteDictionary {
    const phrases: Record<string, string> = {};
    const plurals: Record<string, string[]> = {};
    const source = input && typeof input === 'object' ? (input as { phrases?: unknown; plurals?: unknown }) : {};
    if (source.phrases && typeof source.phrases === 'object') {
        for (const [key, value] of Object.entries(source.phrases)) if (typeof value === 'string' && value) phrases[key] = value;
    }
    if (source.plurals && typeof source.plurals === 'object') {
        for (const [key, value] of Object.entries(source.plurals)) {
            if (Array.isArray(value) && value.length === 3 && value.every((form) => typeof form === 'string' && form)) plurals[key] = [...value];
        }
    }
    return { phrases, plurals };
}

export function getSiteDictionary(): SiteDictionary {
    cached ??= normalizeSiteDictionary(siteRu);
    return cached;
}
