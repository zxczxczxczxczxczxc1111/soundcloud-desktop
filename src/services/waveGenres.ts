// Жанры и метки: свободный текст сайта в ключи для вкуса, полки, фильтра по жанру и топа жанров.
// Функции уходят на страницу текстом вместе с волной (pageHelpers в wave.ts) и зовут друг друга по голому имени
import type { WaveTrack } from './waveTypes';

// Жанр и теги на SoundCloud свободный текст: сравниваются без регистра, пробелов и знаков
export function normalizeTag(text: string): string {
    return text.toLowerCase().replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '');
}

// Ключи жанра и тегов трека для модели вкуса: одни и те же в main и на странице, не больше шести
export function tagKeys(genre: string | null | undefined, tagList: string | null | undefined): string[] {
    const keys: string[] = [];
    const add = (label: string): void => {
        const key = normalizeTag(label);
        if (key.length >= 2 && keys.length < 6 && !keys.includes(key)) keys.push(key);
    };
    add(genre ?? '');
    for (const match of (tagList ?? '').matchAll(/"([^"]+)"|(\S+)/g)) add(match[1] ?? match[2] ?? '');
    return keys;
}

// Жанр и метки трека с долями для модели вкуса: одинаково в main, на странице и в радаре. Жанр весит 1 на все свои части
// («Hip Hop/Rap - Trap» это hiphop и trap по 0.5), метки вместе 0.5 поровну, не больше пяти; у трека без жанра метки весят 1.
// Раньше каждая из шести меток весила как жанр, и артист, который пишет к каждому треку Alternative, Hip Hop, Ambient, Dark,
// раздувал эти метки во вкусе. Написания склеиваются genreCanon. Имя исполнителя (names) и числа вкус не описывают:
// свой ник в метках у каждого трека артиста копил бы «жанр» из ника
export function tagShares(genre: string | null | undefined, tagList: string | null | undefined, names: Array<string | null | undefined> = []): Array<[string, number]> {
    const skip = new Set(names.map((name) => normalizeTag(name ?? '')).filter((key) => key.length >= 2));
    const usable = (key: string): boolean => key.length >= 2 && !/^\d+$/.test(key) && !skip.has(key);
    const genres = genreParts(genre).filter(usable);
    const tags: string[] = [];
    for (const match of (tagList ?? '').matchAll(/"([^"]+)"|(\S+)/g)) {
        const key = genreCanon(normalizeTag(match[1] ?? match[2] ?? ''));
        if (usable(key) && !genres.includes(key) && !tags.includes(key) && tags.length < 5) tags.push(key);
    }
    const tagTotal = genres.length ? 0.5 : 1;
    return [...genres.map((key): [string, number] => [key, 1 / genres.length]), ...tags.map((key): [string, number] => [key, tagTotal / tags.length])];
}

export function genreKeys(genre: string): string[] {
    const groups = [
        ['witchhouse', 'wtchhs', 'witchhaus'],
        ['drumandbass', 'dnb', 'drumnbass', 'dandb'],
        ['rnb', 'randb', 'rhythmandblues'],
        ['lofi', 'lowfi'],
        ['ukgarage', 'ukg'],
        ['hiphop', 'hiphoprap'],
    ];
    const key = normalizeTag(genre);
    if (!key) return [];
    const group = groups.find((list) => list.includes(key));
    return group ? [key, ...group.filter((item) => item !== key)] : [key];
}

// Одно написание жанра для полки и истории: «Hip-hop & Rap», «hiphoprap» и «rap» это hiphop.
// Таблица внутри функции: на страницу функция уходит текстом
export function genreCanon(key: string): string {
    const same: Record<string, string> = {
        hiphoprap: 'hiphop', hiphopandrap: 'hiphop', raphiphop: 'hiphop', rapandhiphop: 'hiphop', rap: 'hiphop', rockalternative: 'alternativerock', altrock: 'alternativerock',
        dnb: 'drumandbass', drumnbass: 'drumandbass', dandb: 'drumandbass', randb: 'rnb', rhythmandblues: 'rnb', randbandsoul: 'rnb', rnbandsoul: 'rnb', lowfi: 'lofi',
        ukg: 'ukgarage', edm: 'danceandedm', wtchhs: 'witchhouse', witchhaus: 'witchhouse', fonk: 'phonk',
    };
    return same[key] ?? key;
}

// Ключи жанра для группировки. Составной жанр сайта («Hip Hop/Rap - Trap») режется по « - », /, запятой, ; и |,
// но не по &: иначе развалятся drum & bass и R&B. Вся строка остаётся ключом, только если это известное написание
export function genreParts(label: string | null | undefined): string[] {
    const text = (label ?? '').trim();
    const keys: string[] = [];
    const add = (part: string): void => {
        const key = genreCanon(normalizeTag(part));
        if (key.length >= 2 && !keys.includes(key)) keys.push(key);
    };
    const parts = text.split(/\s+-\s+|[/,;|]+/).filter((part) => part.trim());
    const whole = normalizeTag(text);
    if (parts.length < 2 || genreCanon(whole) !== whole) add(text);
    if (parts.length > 1) for (const part of parts) add(part);
    return keys;
}

// Главный жанр строки для топов: ключ склейки и подпись. У составного жанра главный это поджанр после « - »
// («Hip Hop/Rap - Trap» это trap), иначе первая часть («Phonk/Fonk» это phonk)
export function genreMain(label: string | null | undefined): { key: string; label: string } {
    const text = (label ?? '').replace(/\s+/g, ' ').trim();
    const whole = normalizeTag(text);
    if (!whole) return { key: '', label: '' };
    const canon = genreCanon(whole);
    if (canon !== whole) return { key: canon, label: text };
    const sub = text.split(/\s+-\s+/);
    const first = (sub.length > 1 ? sub[sub.length - 1] : text).split(/[/,;|]+/)[0].trim();
    const key = genreCanon(normalizeTag(first));
    return key.length >= 2 ? { key, label: first } : { key: whole, label: text };
}

// Несколько жанров через запятую, слэш, точку с запятой или черту: «techno / dark techno, industrial».
// & не разделитель, иначе развалятся drum & bass и r&b
export function parseGenres(input: string): string[] {
    const list: string[] = [];
    const seen = new Set<string>();
    for (const part of input.toLowerCase().split(/[/,;|]+/)) {
        const genre = part.replace(/\s+/g, ' ').trim().slice(0, 40);
        const key = normalizeTag(genre);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        list.push(genre);
        if (list.length >= 4) break;
    }
    return list;
}

export function formatGenres(list: string[]): string {
    return list.join(' / ');
}

export function genreKeysFor(genre: string | null): string[] {
    return genre ? [...new Set(parseGenres(genre).flatMap(genreKeys))] : [];
}

// strict: только поле жанра, метки лишь у трека без жанра. Так выбираются зёрна: артист с пачкой меток на все жанры
// иначе засевал бы волну Hip-hop своими роковыми треками. Кандидатов из поиска по жанру проверяют и метки:
// у нишевых жанров (witch house, phonk) в поле жанра часто стоит просто Electronic
export function trackMatchesGenre(track: WaveTrack, keys: string[], strict = false): boolean {
    if (!keys.length) return true;
    const parts: string[] = [];
    const genre = track.genre ?? '';
    parts.push(normalizeTag(genre));
    for (const part of genre.split(/[/,&|+;]/)) parts.push(normalizeTag(part));
    if (!strict || !parts.some(Boolean)) for (const match of (track.tag_list ?? '').matchAll(/"([^"]+)"|(\S+)/g)) parts.push(normalizeTag(match[1] ?? match[2] ?? ''));
    // Короткий ключ только целиком: rap не должен находиться в trap. Длинный ищется и внутри (darkwitchhouse это witch house),
    // кроме жанров, которые только звучат похоже: witch house не house
    const unlike: Record<string, string[]> = { house: ['witchhouse', 'wtchhs'] };
    return parts.some((part) => part && keys.some((key) => part === key || (key.length >= 5 && part.includes(key) && !(unlike[key] ?? []).some((other) => part.includes(other)))));
}

// Самые частые жанры лайков для выпадающего списка, в том написании, что встречается чаще
// Написания одного жанра склеены той же таблицей, что у полки и истории («Hip-hop & Rap», «Hip Hop», «rap» одна строка),
// подпись это самое частое написание
export function topGenres(tracks: WaveTrack[], limit: number): string[] {
    const counts = new Map<string, { count: number; labels: Map<string, number> }>();
    for (const track of tracks) {
        const main = genreMain(track.genre);
        if (main.key.length < 2) continue;
        const label = main.label.toLowerCase();
        const entry = counts.get(main.key) ?? { count: 0, labels: new Map<string, number>() };
        entry.count++;
        entry.labels.set(label, (entry.labels.get(label) ?? 0) + 1);
        counts.set(main.key, entry);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit).map((entry) => [...entry.labels].sort((a, b) => b[1] - a[1])[0][0]);
}
