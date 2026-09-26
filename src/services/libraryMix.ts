// «Моя музыка» (Э7): выбор источников в настройках и порядок пула из лайков и плейлистов.
// Функции пула уходят на страницу текстом вместе с волной (libraryHelpers), поэтому не ссылаются на импорты
// и константы модуля: всё, что зависит от страницы (запреты, ключ версии, артист, слышанное), приходит параметрами

export type LibraryMode = 'order' | 'shuffle' | 'smart';
/** Выбор источников по id аккаунта SoundCloud: 'likes' и 'playlist:<id>' в порядке выбора; режим общий */
export interface MyMusicSetting { mode: LibraryMode; pick: Record<string, string[]> }
export interface LibrarySource<T> { key: string; name: string; tracks: T[] }
/** Трек пула и источник, из которого он пришёл: название источника идёт в строку «почему» */
export interface LibraryEntry<T> { track: T; from: string }

export function isLibrarySource(value: unknown): value is string {
    return typeof value === 'string' && /^(likes|playlist:[1-9]\d{0,11})$/.test(value);
}
export function isLibraryMode(value: unknown): value is LibraryMode {
    return value === 'order' || value === 'shuffle' || value === 'smart';
}

/** Настройка из F1, копии или со страницы недоверенная: режим, до 20 аккаунтов, до 100 источников без повторов */
export function isMyMusicSetting(value: unknown): value is MyMusicSetting {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const source = value as Record<string, unknown>;
    if (Object.keys(source).some((key) => key !== 'mode' && key !== 'pick') || !isLibraryMode(source.mode)) return false;
    const pick = source.pick;
    if (!pick || typeof pick !== 'object' || Array.isArray(pick)) return false;
    const users = Object.entries(pick as Record<string, unknown>);
    if (users.length > 20) return false;
    return users.every(([user, list]) => /^[1-9]\d{0,11}$/.test(user) && Array.isArray(list) && list.length <= 100 && list.every(isLibrarySource) && new Set(list).size === list.length);
}

/**
 * Пул из выбранных источников по порядку выбора: трек из лайков и нескольких плейлистов берётся один раз,
 * перезалив той же версии тоже (versionKeys это ключи вероятных копий, versionKey ключ проверки), другие версии остаются.
 * keep отсекает запреты и недоступное
 */
export function libraryPool<T extends { id: number }>(
    sources: LibrarySource<T>[], keep: (track: T) => boolean, versionKeys: (track: T) => string[], versionKey: (track: T) => string,
): LibraryEntry<T>[] {
    const ids = new Set<number>();
    const versions = new Set<string>();
    const pool: LibraryEntry<T>[] = [];
    for (const source of sources)
        for (const track of source.tracks) {
            if (ids.has(track.id)) continue;
            ids.add(track.id);
            if (!keep(track) || versions.has(versionKey(track))) continue;
            for (const key of versionKeys(track)) versions.add(key);
            pool.push({ track, from: source.name });
        }
    return pool;
}

/** Один артист не идёт подряд, пока есть кем разбавить: повтор меняется местами с ближайшим следующим другим */
export function spreadArtists<T>(list: T[], artistOf: (item: T) => number): T[] {
    const result = list.slice();
    for (let i = 1; i < result.length; i++) {
        const previous = artistOf(result[i - 1]);
        if (!previous || artistOf(result[i]) !== previous) continue;
        let j = i + 1;
        while (j < result.length && artistOf(result[j]) === previous) j++;
        if (j >= result.length) break;
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

/**
 * Порядок пула по режиму. «По порядку»: как собран, источники в порядке выбора, внутри родной порядок.
 * «Перемешать» и «Умное»: случайный порядок без одного артиста подряд, слышанное за 3 дня (heard) не играет;
 * если правило выбило весь пул, он играет без него. Похожие в «Умное» подмешивает волна, не пул
 */
export function libraryOrder<T extends { id: number }>(
    pool: LibraryEntry<T>[], mode: LibraryMode, artistOf: (track: T) => number, heard: (track: T) => boolean, random: () => number,
): LibraryEntry<T>[] {
    if (mode === 'order') return pool.slice();
    const fresh = pool.filter((entry) => !heard(entry.track));
    const list = fresh.length ? fresh : pool.slice();
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return spreadArtists(list, (entry) => artistOf(entry.track));
}

// Всё, что уходит на страницу: waveScript кладёт объявления рядом с волной
export const libraryHelpers = [isLibrarySource, isLibraryMode, libraryPool, spreadArtists, libraryOrder];
