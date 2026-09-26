// Модули webpack сайта: поиск для скриптов страницы и проверка в main того, что страница о них сообщила.
// siteRequires уходит на страницу текстом рядом со скриптом, поэтому без импортов и констант снаружи функции

export interface WebpackRequire {
    c?: Record<string, { exports?: unknown } | undefined>;
}
/** Что страница нашла у сайта. У английского сайта перевод не нужен и считается вставшим */
export interface SiteState {
    player: boolean;
    api: boolean;
    sound: boolean;
    translation: boolean;
}

// require сайта через пробный модуль: старый формат webpackJsonp (webpack 4) и новый webpackChunk<имя> (webpack 5).
// Рантаймов у сайта два, больший по числу модулей идёт первым
export function siteRequires(host: Record<string, unknown>, prefix: string): WebpackRequire[] {
    type ChunkList = { push(chunk: unknown): unknown };
    const found: WebpackRequire[] = [];
    const probe = prefix + Date.now() + Math.random().toString(36).slice(2);
    const legacy = host.webpackJsonp as ChunkList | undefined;
    if (Array.isArray(legacy)) legacy.push([[], { [probe]: (_module: unknown, _exports: unknown, require: WebpackRequire) => { found.push(require); } }, [[probe]]]);
    if (!found.length) {
        for (const key of Object.keys(host)) {
            const chunks = host[key] as ChunkList | undefined;
            if (key.startsWith('webpackChunk') && Array.isArray(chunks)) chunks.push([[probe], {}, (require: WebpackRequire) => { found.push(require); }]);
        }
    }
    return found.sort((a, b) => Object.keys(b.c ?? {}).length - Object.keys(a.c ?? {}).length);
}

/** Ответ страницы недоверенный: только четыре флага */
export function cleanSiteState(value: unknown): SiteState | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as Record<string, unknown>;
    const { player, api, sound, translation } = source;
    if (typeof player !== 'boolean' || typeof api !== 'boolean' || typeof sound !== 'boolean' || typeof translation !== 'boolean') return null;
    return { player, api, sound, translation };
}

export function siteBroken(state: SiteState): boolean {
    return !state.player || !state.api || !state.sound || !state.translation;
}
