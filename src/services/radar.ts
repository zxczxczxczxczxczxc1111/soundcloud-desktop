// Пятничный радар (раздел 8 плана): свежесть конкретной версии, оценка по вкусу, отбор до 50 записей с мягким
// разнообразием, план обхода источников и покрытие. Чистые функции получают время, профиль и историю аргументами;
// RadarService в worker только собирает их из хранилищ
import type { CatalogCheck, CatalogStatus, EditionSummary, RecommendStore, StoredUpload } from './recommendStore';
import type { HistoryIndex, TastePlay } from './historyIndex';
import type { TasteProfile, TasteService } from './tasteModel';
import type { ExclusionEntry, WaveExclusionList } from './waveExclusions';
import { confirmedCopies, confirmedGroups, copyKeys, familyKey, nameKey, performerKey, trackCredits, versionKey, type TrackCredit } from './trackIdentity';
import { tagShares, tasteMaps, tasteScore, type TasteMaps, type WaveTrack } from './wave';
import { RADAR_FRESH_MS } from './radarSchedule';

const DAY = 86400000;

/** Параметры радара; version растёт при каждом изменении их смысла и попадает в выпуск.
 *  4: потолок аккаунта и в «Новых загрузках» (26.09.2026) */
export const RADAR_PARAMS = {
    version: 4,
    /** Окно свежести версии, дни до отсечки. Неделя между выпусками (решение владельца 25.09.2026, было 28) */
    windowDays: 7,
    /** Последние дни окна получают небольшую прибавку (приоритет последней неделе внутри разных вкусов) */
    recentDays: 7,
    recentBonus: 0.05,
    size: 50,
    /** Потолок одного аккаунта в основном списке (решение владельца 25.09.2026): остальное видно в «Всех найденных» */
    perUploader: 3,
    /** Пачка (решение владельца 25.09.2026): больше bulkSize записей аккаунта без даты релиза за bulkDays это выгрузка
     *  каталога, а не релизы; релизами остаются bulkKeep лучших, прочее уходит в «Новые загрузки» */
    bulkSize: 6,
    bulkDays: 7,
    bulkKeep: 2,
    /** Открытия (решение владельца 25.09.2026): записи без связи со вкусом, только по жанру, занимают в конце
     *  основного списка не больше стольких мест; остальное место у связанных */
    discoveries: 10,
    /** Аккаунт или участник связан со вкусом с этого веса: один лайк или одно прослушивание дают около 0.1 */
    linkWeight: 0.3,
    /** Сколько «Новых загрузок» показывать отдельно */
    uploadsSize: 30,
    /** «Все найденные»: не больше */
    foundSize: 300,
    /** Прибавка недопредставленному направлению не больше этой величины (раздел 6.2) */
    diversityCap: 0.1,
    /** Для разнообразия на шаге рассматриваются записи не ниже лучшей оставшейся на эту величину */
    diversityWindow: 0.15,
    /** Штраф за повтор семьи версий или аккаунта в выпуске, с пределом */
    repeatPenalty: 0.04,
    repeatCap: 0.1,
    /** Отметка «слышано»: доля уникального покрытия, у записей короче 30 секунд строже */
    heardShare: 0.7,
    heardShareShort: 0.8,
    /** Аккаунты-кураторы из вкуса в обходе: не больше и не слабее */
    curators: 100,
    curatorWeight: 0.3,
    follows: 2000,
    /** Поиск свежего по любимым участникам */
    searches: 20,
    searchWeight: 0.5,
};

export type Freshness = 'release' | 'upload' | 'old' | 'future';
/** Свежесть конкретной версии в окне [from, to]. release: дата версии доказана и в окне; upload: свежа только
 *  публикация (перезалив, чужой канал без даты релиза, старая дата релиза) и место ей в «Новых загрузках» */
export function freshness(upload: Pick<StoredUpload, 'createdAt' | 'displayAt' | 'releaseDay' | 'uploaderName' | 'credits'>, earlierCopy: boolean, from: number, to: number): { kind: Freshness; at: number } {
    const published = upload.displayAt || upload.createdAt;
    const release = /^\d{4}-\d{2}-\d{2}$/.test(upload.releaseDay) ? Date.parse(upload.releaseDay + 'T00:00:00Z') : NaN;
    // К отсечке запись ещё не была опубликована: её место в следующем выпуске, какой бы ни была дата релиза
    if (published > to) return { kind: 'future', at: published };
    if (Number.isFinite(release)) {
        // Будущий релиз ждёт своей даты; заявленная старая дата делает свежую публикацию перезаливом
        if (release > to) return { kind: 'future', at: release };
        if (release >= from) return { kind: 'release', at: release };
        return published >= from && published <= to ? { kind: 'upload', at: published } : { kind: 'old', at: release };
    }
    if (!published || published < from) return { kind: 'old', at: published };
    if (earlierCopy) return { kind: 'upload', at: published };
    // Дата публикации доказывает версию, только если аккаунт выложил своё: исполнитель или автор этой переделки.
    // Сборный канал с чужой песней без даты релиза даёт лишь свежую загрузку
    const uploader = nameKey(upload.uploaderName);
    const credits: TrackCredit[] = Array.isArray(upload.credits) ? upload.credits : [];
    const foreign = credits.some((credit) => credit.role === 'artist' && credit.key !== uploader);
    const ownRework = credits.some((credit) => credit.role === 'remixer' && credit.key === uploader);
    return { kind: !foreign || ownRework ? 'release' : 'upload', at: published };
}

/** Строка хранилища обратно в трек для оценки вкусом; участники из метаданных возвращаются туда же, откуда их берёт разбор */
export function uploadTrack(upload: StoredUpload): WaveTrack {
    const names = (role: TrackCredit['role']): string | null =>
        upload.credits.filter((credit) => credit.source === 'metadata' && credit.role === role).map((credit) => credit.name).join(', ') || null;
    return {
        id: upload.id, kind: 'track', title: upload.title, user_id: upload.uploader, user: { id: upload.uploader, username: upload.uploaderName },
        duration: upload.duration, genre: upload.genre, tag_list: upload.tags,
        publisher_metadata: { artist: names('artist'), writer_composer: names('writer'), isrc: upload.isrc || null },
    };
}

export type RadarReason = { kind: 'artist'; name: string } | { kind: 'follow'; name: string } | { kind: 'tag'; tag: string } | { kind: 'taste' };
/** Кандидат с оценкой: base 0..1 из вкуса, direction для разнообразия, family и uploader для штрафа повтора */
export interface RadarCandidate {
    key: string;
    id: number;
    base: number;
    direction: string;
    family: string;
    uploader: number;
    kind: Freshness;
    at: number;
    heard: boolean;
    /** Связь со вкусом: подписка, аккаунт или участник из вкуса, сама запись или другая версия любимой песни.
     *  Без неё запись это открытие по жанру */
    linked: boolean;
    reason: RadarReason;
    /** Исполнитель для группы выпуска (performerKey): свой загрузчик или исполнитель у сборного канала */
    performer: string;
}
export interface RadarPick extends RadarCandidate {
    bonus: number;
    penalty: number;
    score: number;
}

// Оценка по вкусу в 0..1: насыщение, чтобы один огромный вес не делал остальное неразличимым
export const baseScore = (score: number): number => (score > 0 ? 1 - Math.exp(-score / 2) : 0);

/** Кандидат из загрузки или null, если вкус против неё (сильный минус трека) или связи со вкусом нет вовсе */
export function scoreUpload(upload: StoredUpload, kind: Freshness, at: number, maps: TasteMaps, follows: Set<number>, heard: boolean, to: number): RadarCandidate | null {
    const track = uploadTrack(upload);
    const score = tasteScore(track, maps);
    if (score.track <= -1) return null;
    const followed = follows.has(upload.uploader);
    // Подписка без истории всё равно слабая связь: её релиз может войти, если остальное не против
    const raw = score.score + (followed && score.artist <= 0 ? 0.5 : 0);
    if (raw <= 0) return null;
    const base = Math.min(1, baseScore(raw) + (to - at <= RADAR_PARAMS.recentDays * DAY ? RADAR_PARAMS.recentBonus : 0));
    const reason: RadarReason = score.creditName && score.creditBest >= Math.max(score.artist, score.tag, 0.3)
        ? { kind: 'artist', name: score.creditName }
        : followed
            ? { kind: 'follow', name: upload.uploaderName }
            : score.artist >= Math.max(score.tag, 0.3) && upload.uploaderName
                ? { kind: 'artist', name: upload.uploaderName }
                : score.tagKey
                    ? { kind: 'tag', tag: score.tagKey }
                    : { kind: 'taste' };
    const linked = followed || score.artist >= RADAR_PARAMS.linkWeight || score.creditBest >= RADAR_PARAMS.linkWeight || score.track > 0 || score.family > 0;
    return {
        key: upload.key, id: upload.id, base, direction: score.tagKey || tagShares(upload.genre, upload.tags, [upload.uploaderName])[0]?.[0] || '', family: familyKey(track) || upload.key,
        uploader: upload.uploader, kind, at, heard, linked, reason, performer: performerKey(upload.uploader, upload.uploaderName, Array.isArray(upload.credits) ? upload.credits : []),
    };
}

/** Группы выпуска (решение владельца 26.09.2026): записи одного исполнителя одного вида одной строкой, как один трек
 *  артиста в Release Radar. Ведёт лучшая по оценке, в group все записи группы по дате, при равенстве по id */
export function performerGroups(candidates: RadarCandidate[]): Array<{ lead: RadarCandidate; group: RadarCandidate[] }> {
    const byPerformer = new Map<string, RadarCandidate[]>();
    for (const candidate of candidates) {
        const key = candidate.kind + '|' + candidate.performer;
        const list = byPerformer.get(key) ?? [];
        list.push(candidate);
        byPerformer.set(key, list);
    }
    return [...byPerformer.values()].map((list) => ({
        lead: list.reduce((best, item) => (item.base > best.base || (item.base === best.base && item.id < best.id) ? item : best)),
        group: list.slice().sort((a, b) => a.at - b.at || a.id - b.id),
    }));
}

/** Отбор с мягким разнообразием (раздел 6.2): на каждом шаге среди записей не ниже лучшей оставшейся на diversityWindow
 *  берётся максимум базовой оценки плюс прибавка недопредставленному направлению минус ограниченный штраф повтора.
 *  history: направления прошлых выпусков. Квот и потолков жанра нет; perUploader: потолок одного аккаунта в списке,
 *  его остаток список не добивает. Один ввод даёт один результат */
export function selectRadar(candidates: RadarCandidate[], history: string[][], size: number = RADAR_PARAMS.size, perUploader = Infinity): RadarPick[] {
    const P = RADAR_PARAMS;
    let rest = candidates.slice().sort((a, b) => b.base - a.base || a.id - b.id);
    const past = new Map<string, number>();
    for (const edition of history) for (const direction of edition) past.set(direction, (past.get(direction) ?? 0) + 1 / Math.max(1, edition.length));
    const directions = new Map<string, number>();
    const families = new Map<string, number>();
    const uploaders = new Map<number, number>();
    const picked: RadarPick[] = [];
    while (picked.length < size && rest.length) {
        const best = rest[0].base;
        let chosen = -1;
        let chosenPick: RadarPick | null = null;
        for (let i = 0; i < rest.length && rest[i].base >= best - P.diversityWindow; i++) {
            const item = rest[i];
            // Первое появление направления получает полную прибавку, дальше она убывает. Доля направления в прошлых
            // выпусках тоже уменьшает прибавку: редкое там и здесь получает её полностью
            const seen = (directions.get(item.direction) ?? 0) + 4 * (past.get(item.direction) ?? 0) / Math.max(1, history.length);
            const bonus = item.direction ? P.diversityCap / (1 + seen) : 0;
            const repeats = (families.get(item.family) ?? 0) + (uploaders.get(item.uploader) ?? 0);
            const penalty = Math.min(P.repeatCap, P.repeatPenalty * repeats);
            const score = item.base + bonus - penalty;
            if (!chosenPick || score > chosenPick.score || (score === chosenPick.score && item.id < chosenPick.id)) {
                chosen = i;
                chosenPick = { ...item, bonus, penalty, score };
            }
        }
        if (!chosenPick || chosen < 0) break;
        const pick = chosenPick;
        rest.splice(chosen, 1);
        picked.push(pick);
        directions.set(pick.direction, (directions.get(pick.direction) ?? 0) + 1);
        families.set(pick.family, (families.get(pick.family) ?? 0) + 1);
        const count = (uploaders.get(pick.uploader) ?? 0) + 1;
        uploaders.set(pick.uploader, count);
        // Аккаунт набрал свой потолок: остальные его записи в этом списке больше не рассматриваются
        if (count >= perUploader) rest = rest.filter((item) => item.uploader !== pick.uploader);
    }
    return picked;
}

/** Основной список выпуска (решение владельца 25.09.2026): сначала записи со связью со вкусом, в конце не больше
 *  discoveries открытий по жанру, которые всегда ниже связанных. Потолок аккаунта общий для обеих частей */
export function selectEdition(releases: RadarCandidate[], history: string[][]): RadarPick[] {
    const P = RADAR_PARAMS;
    const open = releases.filter((candidate) => !candidate.linked);
    const reserve = Math.min(P.discoveries, open.length);
    const linked = selectRadar(releases.filter((candidate) => candidate.linked), history, P.size - reserve, P.perUploader);
    const used = new Map<number, number>();
    for (const pick of linked) used.set(pick.uploader, (used.get(pick.uploader) ?? 0) + 1);
    const discoveries = selectRadar(open.filter((candidate) => (used.get(candidate.uploader) ?? 0) < P.perUploader), history, Math.min(P.discoveries, P.size - linked.length), P.perUploader);
    return [...linked, ...discoveries];
}

/** Слышано ли по доле покрытия: от 70%, у записей короче 30 секунд от 80% */
export function heardShare(share: number, duration: number): boolean {
    return share >= (duration > 0 && duration < 30000 ? RADAR_PARAMS.heardShareShort : RADAR_PARAMS.heardShare);
}
/** Слышанные загрузки: покрытие по интервалам (у старых событий по heard), лайк, и их подтверждённые копии.
 *  Вероятные копии отметку не получают */
export function heardIds(plays: Array<Pick<TastePlay, 'id' | 'heard' | 'dur' | 'covered'>>, liked: Iterable<number>, groups: Map<string, string>): Set<number> {
    const ids = new Set<number>(liked);
    for (const play of plays) {
        if (!play.dur || play.dur <= 0 || ids.has(play.id)) continue;
        const covered = play.covered ?? play.heard;
        if (heardShare(Math.min(covered, play.dur) / play.dur, play.dur)) ids.add(play.id);
    }
    return confirmedCopies(ids, groups);
}
/** Запрет рекомендаций: «Не нравится» с подтверждёнными копиями, скрытые аккаунты, «Не сейчас» до срока,
 *  «Скрыть другие версии»: семья версий без той версии, у которой скрыли остальные */
export function exclusionFilter(list: WaveExclusionList, groups: Map<string, string>, now: number): (upload: StoredUpload) => boolean {
    const active = (entry: ExclusionEntry): boolean => entry.until === undefined || entry.until > now;
    const tracks = confirmedCopies([...list.tracks, ...list.laterTracks.filter(active)].map((entry) => entry.id), groups);
    const accounts = new Set([...list.artists, ...list.laterArtists.filter(active)].map((entry) => entry.id));
    const families = hiddenFamilies(list.families);
    return (upload) => tracks.has(upload.id) || accounts.has(upload.uploader) || (families.size > 0 && otherVersion(uploadTrack(upload), families));
}
/** Семьи со скрытыми версиями: ключ семьи и версии, которые оставлены (те, на которых выбрали «Скрыть другие версии») */
export function hiddenFamilies(entries: Array<Pick<ExclusionEntry, 'id' | 'title' | 'artist' | 'artistId'>>): Map<string, Set<string>> {
    const families = new Map<string, Set<string>>();
    for (const entry of entries) {
        const track: WaveTrack = { id: entry.id, title: entry.title, user_id: entry.artistId, user: { id: entry.artistId, username: entry.artist } };
        const family = familyKey(track);
        if (!family) continue;
        const kept = families.get(family) ?? new Set<string>();
        kept.add(versionKey(track));
        families.set(family, kept);
    }
    return families;
}
export function otherVersion(track: WaveTrack, families: Map<string, Set<string>>): boolean {
    const kept = families.get(familyKey(track));
    return !!kept && !kept.has(versionKey(track));
}

/** Источник обхода: каталог аккаунта (подписка или куратор из вкуса) либо поиск свежего по любимому участнику */
export interface RadarSource {
    key: string;
    kind: 'user' | 'search';
    id: number;
    q: string;
    label: string;
    checked: number;
    status: CatalogStatus | '';
    /** Порядок при равной давности: подписки и любимые раньше */
    weight: number;
}
export function radarSources(follows: number[], profile: TasteProfile | null, names: Map<string, string>, checks: CatalogCheck[], hidden: Set<number>): RadarSource[] {
    const P = RADAR_PARAMS;
    const known = new Map(checks.map((check) => [check.key, check]));
    const sources: RadarSource[] = [];
    const add = (source: Omit<RadarSource, 'checked' | 'status' | 'label'> & { label: string }): void => {
        const check = known.get(source.key);
        sources.push({ ...source, label: check?.label || source.label, checked: check?.checked ?? 0, status: check?.status ?? '' });
    };
    const accounts = new Map<number, number>();
    for (const id of follows.slice(0, P.follows)) if (!hidden.has(id)) accounts.set(id, 1);
    const curators = (profile?.artists ?? []).filter(([id, weight]) => weight >= P.curatorWeight && !hidden.has(id)).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    for (const [id, weight] of curators.slice(0, P.curators)) accounts.set(id, Math.max(accounts.get(id) ?? 0, weight));
    for (const [id, weight] of accounts) add({ key: 'user:' + id, kind: 'user', id, q: '', label: '', weight });
    const credits = (profile?.credits ?? []).filter(([key, weight]) => weight >= P.searchWeight && names.has(key)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    for (const [key, weight] of credits.slice(0, P.searches)) {
        const name = names.get(key) ?? '';
        if (name.length >= 2) add({ key: 'search:' + key, kind: 'search', id: 0, q: name, label: name, weight });
    }
    return sources;
}
/** Имена любимых участников для поиска: ключ имени из разбора названий истории обратно в написанное имя */
export function creditNames(plays: Array<Pick<TastePlay, 'id' | 'title' | 'artistName'>>, wanted: Set<string>): Map<string, string> {
    const names = new Map<string, string>();
    const seen = new Set<number>();
    for (let i = plays.length - 1; i >= 0 && names.size < wanted.size; i--) {
        const play = plays[i];
        if (seen.has(play.id)) continue;
        seen.add(play.id);
        const uploader = play.artistName.split('|')[0].trim();
        const own = nameKey(uploader);
        if (own && wanted.has(own) && !names.has(own)) names.set(own, uploader);
        if (!play.title) continue;
        for (const credit of trackCredits({ id: play.id, title: play.title, user: { username: play.artistName } }))
            if (wanted.has(credit.key) && !names.has(credit.key)) names.set(credit.key, credit.name);
    }
    return names;
}

export interface RadarCoverage {
    /** Аккаунты радара: подписки и кураторы из вкуса */
    accounts: number;
    /** Проверены не раньше чем за сутки до слота (или аккаунта больше нет) */
    checked: number;
    /** Источники с ошибкой при последней проверке */
    failed: number;
    /** Поиск свежего по любимым участникам */
    searches: number;
    searchesDone: number;
}
export function radarCoverage(sources: RadarSource[], since: number): RadarCoverage {
    const coverage: RadarCoverage = { accounts: 0, checked: 0, failed: 0, searches: 0, searchesDone: 0 };
    for (const source of sources) {
        const fresh = source.checked >= since;
        if (source.kind === 'user') coverage.accounts++;
        else coverage.searches++;
        if (fresh && source.status === 'failed') coverage.failed++;
        else if (fresh && (source.status === 'ok' || source.status === 'gone')) {
            if (source.kind === 'user') coverage.checked++;
            else coverage.searchesDone++;
        }
    }
    return coverage;
}
/** Полный выпуск только при проверенных всех аккаунтах и поисках без ошибок; иначе partial с числами покрытия */
export const coverageComplete = (coverage: RadarCoverage): boolean =>
    coverage.failed === 0 && coverage.checked >= coverage.accounts && coverage.searchesDone >= coverage.searches;
export function cleanCoverage(value: unknown): RadarCoverage {
    const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    const count = (item: unknown): number => (typeof item === 'number' && Number.isSafeInteger(item) && item >= 0 ? item : 0);
    return { accounts: count(source.accounts), checked: count(source.checked), failed: count(source.failed), searches: count(source.searches), searchesDone: count(source.searchesDone) };
}

export interface RadarItem {
    key: string;
    id: number;
    title: string;
    artist: string;
    kind: 'release' | 'upload';
    at: number;
    heard: boolean;
    score: number;
    base: number;
    bonus: number;
    penalty: number;
    direction: string;
    reason: RadarReason;
    /** Только в «Всех найденных»: найдено или опубликовано после выпуска */
    after?: boolean;
    /** Все записи группы исполнителя по дате, включая эту; только если записей больше одной */
    group?: number[];
}
export interface RadarEdition {
    period: string;
    /** Ставит хранилище при записи */
    revision: number;
    created: number;
    cutoff: number;
    status: 'complete' | 'partial';
    coverage: RadarCoverage;
    algorithm: number;
    taste: number;
    items: RadarItem[];
    uploads: RadarItem[];
}
// Выпуск читается из файла, который могли восстановить из копии: каждая позиция проверяется
export function cleanRadarItem(value: unknown): RadarItem | null {
    if (!value || typeof value !== 'object') return null;
    const item = value as Record<string, unknown>;
    const id = item.id;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || item.key !== 'sc:track:' + id) return null;
    const text = (entry: unknown, max: number): string => (typeof entry === 'string' ? entry.slice(0, max) : '');
    const number = (entry: unknown): number => (typeof entry === 'number' && Number.isFinite(entry) ? entry : 0);
    const reason = item.reason && typeof item.reason === 'object' ? (item.reason as Record<string, unknown>) : {};
    const cleanReason: RadarReason = reason.kind === 'artist' || reason.kind === 'follow'
        ? { kind: reason.kind, name: text(reason.name, 200) }
        : reason.kind === 'tag' ? { kind: 'tag', tag: text(reason.tag, 80) } : { kind: 'taste' };
    // Группа: номера записей без повторов, сама позиция среди них; выпуск версии 2 группы не хранит
    const group = Array.isArray(item.group)
        ? [...new Set(item.group.filter((entry): entry is number => typeof entry === 'number' && Number.isSafeInteger(entry) && entry > 0))].slice(0, 200)
        : [];
    return {
        key: 'sc:track:' + id, id, title: text(item.title, 500), artist: text(item.artist, 200), kind: item.kind === 'upload' ? 'upload' : 'release',
        at: number(item.at), heard: item.heard === true, score: number(item.score), base: number(item.base), bonus: number(item.bonus),
        penalty: number(item.penalty), direction: text(item.direction, 80), reason: cleanReason,
        ...(group.length > 1 && group.includes(id) ? { group } : {}),
    };
}

export interface RadarInput {
    period: string;
    now: number;
    cutoff: number;
    uploads: StoredUpload[];
    /** Ключи загрузок, у которых есть копия той же версии раньше хотя бы на сутки */
    reuploads: Set<string>;
    profile: unknown;
    tasteVersion: number;
    follows: number[];
    /** Отметка «слышано» по id с подтверждёнными копиями */
    heard: Set<number>;
    /** Запрет: «Не нравится» с копиями, скрытые аккаунты и семьи */
    excluded: (upload: StoredUpload) => boolean;
    /** Подтверждённые группы записей: копии одной записи в выпуске одной строкой */
    groups: Map<string, string>;
    history: string[][];
    coverage: RadarCoverage;
}
const round = (value: number): number => Math.round(value * 1000) / 1000;
const asItem = (pick: RadarPick, upload: StoredUpload, group: RadarCandidate[] = []): RadarItem => ({
    key: pick.key, id: pick.id, title: upload.title, artist: upload.uploaderName, kind: pick.kind === 'upload' ? 'upload' : 'release', at: pick.at,
    heard: pick.heard, score: round(pick.score), base: round(pick.base), bonus: round(pick.bonus), penalty: round(pick.penalty), direction: pick.direction, reason: pick.reason,
    ...(group.length > 1 ? { group: group.map((member) => member.id) } : {}),
});

/** Кандидаты окна [from, to] после запретов и склейки копий: и для выпуска, и для «Всех найденных» */
export function radarCandidates(input: RadarInput, from: number, to: number): RadarCandidate[] {
    const maps = tasteMaps(input.profile) ?? tasteMaps({});
    if (!maps) return [];
    const follows = new Set(input.follows);
    // Вероятные и подтверждённые копии одной версии в выпуске одной строкой: остаётся релиз раньше перезалива,
    // затем лучшая оценка, при равенстве меньший id. Порядок входа не решает, какая копия остаётся
    // Запись отмечается ключом подтверждённой группы и серединой ключей вероятной копии; новая ищет свои ключи
    // с соседними шагами длительности. Так копия члена группы тоже склеивается с ним
    interface Entry { candidate: RadarCandidate; centers: string[] }
    const index = new Map<string, Entry>();
    const better = (a: RadarCandidate, b: RadarCandidate): boolean =>
        a.kind !== b.kind ? a.kind === 'release' : a.base !== b.base ? a.base > b.base : a.id < b.id;
    for (const upload of input.uploads.slice().sort((a, b) => a.id - b.id)) {
        if (input.excluded(upload)) continue;
        const { kind, at } = freshness(upload, input.reuploads.has(upload.key), from, to);
        if (kind !== 'release' && kind !== 'upload') continue;
        const candidate = scoreUpload(upload, kind, at, maps, follows, input.heard.has(upload.id), to);
        if (!candidate) continue;
        const root = input.groups.get(upload.key);
        const copies = copyKeys(uploadTrack(upload));
        const lookups = root ? ['g:' + root, ...copies] : copies;
        const entry: Entry = { candidate, centers: [...(root ? ['g:' + root] : []), copies.length === 3 ? copies[1] : copies[0]] };
        const rivals = new Set<Entry>();
        for (const key of lookups) {
            const rival = index.get(key);
            if (rival) rivals.add(rival);
        }
        if ([...rivals].some((rival) => better(rival.candidate, candidate))) continue;
        for (const rival of rivals) for (const key of rival.centers) if (index.get(key) === rival) index.delete(key);
        for (const key of entry.centers) index.set(key, entry);
    }
    return demoteBulk([...new Set(index.values())].map((entry) => entry.candidate), input.uploads);
}

/** Пачка без дат релиза (решение владельца 25.09.2026): аккаунт, выложивший за bulkDays больше bulkSize записей, чья
 *  свежесть доказана только публикацией, скорее выгружает старый каталог. Релизами остаются bulkKeep лучших по оценке,
 *  остальные становятся «Новыми загрузками». Записи с датой релиза в счёт не идут и не трогаются */
export function demoteBulk(candidates: RadarCandidate[], uploads: StoredUpload[]): RadarCandidate[] {
    const P = RADAR_PARAMS;
    const dated = new Set(uploads.filter((upload) => /^\d{4}-\d{2}-\d{2}$/.test(upload.releaseDay)).map((upload) => upload.key));
    const undated = new Map<number, RadarCandidate[]>();
    for (const candidate of candidates) {
        if (candidate.kind !== 'release' || dated.has(candidate.key)) continue;
        const list = undated.get(candidate.uploader) ?? [];
        list.push(candidate);
        undated.set(candidate.uploader, list);
    }
    const demoted = new Set<string>();
    for (const list of undated.values()) {
        if (list.length <= P.bulkSize) continue;
        const times = list.map((candidate) => candidate.at).sort((a, b) => a - b);
        let bulk = false;
        for (let start = 0, end = 0; end < times.length && !bulk; end++) {
            while (times[end] - times[start] > P.bulkDays * DAY) start++;
            bulk = end - start + 1 > P.bulkSize;
        }
        if (!bulk) continue;
        const ranked = list.slice().sort((a, b) => b.base - a.base || a.id - b.id);
        for (const candidate of ranked.slice(P.bulkKeep)) demoted.add(candidate.key);
    }
    return candidates.map((candidate): RadarCandidate => (demoted.has(candidate.key) ? { ...candidate, kind: 'upload' } : candidate));
}

/** Выпуск целиком: релизы окна до 50 и отдельно новые загрузки. null, если релизов нет, а обход не завершён:
 *  такую пустоту нельзя выдать за неделю без релизов */
export function buildRadar(input: RadarInput): RadarEdition | null {
    const P = RADAR_PARAMS;
    const byKey = new Map(input.uploads.map((upload) => [upload.key, upload]));
    const releases: RadarCandidate[] = [];
    const fresh: RadarCandidate[] = [];
    for (const candidate of radarCandidates(input, input.cutoff - P.windowDays * DAY, input.cutoff)) (candidate.kind === 'release' ? releases : fresh).push(candidate);
    const complete = coverageComplete(input.coverage);
    if (!releases.length && !complete) return null;
    // Отбор идёт по ведущим групп: потолок аккаунта считает группы, остальные записи исполнителя едут в group
    const releaseGroups = performerGroups(releases);
    const freshGroups = performerGroups(fresh);
    const groupOf = new Map([...releaseGroups, ...freshGroups].map((entry) => [entry.lead.key, entry.group]));
    const item = (pick: RadarPick): RadarItem | null => {
        const upload = byKey.get(pick.key);
        return upload ? asItem(pick, upload, groupOf.get(pick.key)) : null;
    };
    return {
        period: input.period,
        revision: 0,
        created: input.now,
        cutoff: input.cutoff,
        status: complete ? 'complete' : 'partial',
        coverage: input.coverage,
        algorithm: P.version,
        taste: input.tasteVersion,
        items: selectEdition(releaseGroups.map((entry) => entry.lead), input.history).map(item).filter((entry): entry is RadarItem => entry !== null),
        // Тот же потолок аккаунта, что в основном списке: сборный канал с тридцатью исполнителями иначе занимает все места
        uploads: selectRadar(freshGroups.map((entry) => entry.lead), [], P.uploadsSize, P.perUploader).map(item).filter((entry): entry is RadarItem => entry !== null),
    };
}

export interface RadarBuildOutcome {
    published: boolean;
    /** Обход не завершён, а публиковать пустоту или неполное до бюджета нельзя */
    waiting: boolean;
    edition: RadarEdition | null;
}
const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const memberIds = (keys: Array<{ key: string }>, prefix: string): number[] =>
    keys.map((member) => Number(member.key.slice(prefix.length))).filter(isId);

// Радар в worker: план обхода для страницы и сборка выпуска из хранилищ. Имена участников для поиска
// кэшируются на 6 часов: разбор истории на каждой проверке раз в 10 минут не нужен
export class RadarService {
    private names = new Map<number, { at: number; wanted: string; names: Map<string, string> }>();

    constructor(
        private store: RecommendStore,
        private index: HistoryIndex,
        private taste: TasteService,
        private exclusions: (userId: number) => WaveExclusionList,
    ) {}

    public plan(userId: unknown, now = Date.now()): RadarSource[] {
        if (!isId(userId)) return [];
        const profile = this.taste.profile(userId);
        const wanted = (profile?.credits ?? []).filter(([, weight]) => weight >= RADAR_PARAMS.searchWeight).map(([key]) => key).slice(0, RADAR_PARAMS.searches * 3);
        const signature = wanted.join(',');
        let cached = this.names.get(userId);
        if (!cached || cached.wanted !== signature || now - cached.at > 6 * 3600000) {
            cached = { at: now, wanted: signature, names: creditNames(this.index.tastePlays(userId, now - 180 * DAY), new Set(wanted)) };
            this.names.set(userId, cached);
        }
        const hidden = new Set(this.exclusions(userId).artists.map((entry) => entry.id));
        return radarSources(memberIds(this.store.libraryMembers(userId, 'followings'), 'sc:user:'), profile, cached.names, this.store.catalogState(userId), hidden);
    }
    /** Собрать и записать выпуск периода. force: бюджет сбора вышел, неполный выпуск с релизами допустим */
    public build(userId: unknown, period: unknown, cutoff: unknown, force: unknown, manual: unknown, now = Date.now()): RadarBuildOutcome {
        const idle: RadarBuildOutcome = { published: false, waiting: false, edition: null };
        if (!isId(userId) || typeof period !== 'string' || !isId(cutoff) || cutoff > now) return idle;
        if (manual !== true && this.store.radarStatus(userId, period, cutoff).published) return idle;
        const coverage = radarCoverage(this.plan(userId, now), cutoff - RADAR_FRESH_MS);
        if (!coverageComplete(coverage) && force !== true && manual !== true) return { ...idle, waiting: true };
        const edition = buildRadar({ ...this.inputs(userId, cutoff - RADAR_PARAMS.windowDays * DAY, cutoff, now), period, cutoff, history: this.store.radarDirections(userId, period), coverage });
        if (!edition) return { ...idle, waiting: true };
        const saved = this.store.saveEdition(userId, edition, manual === true);
        return { published: saved !== null, waiting: false, edition: saved };
    }
    /** Выпуск для страницы: последний или выбранный из архива с отметками «Уже слышал» на сейчас, и список архива */
    public view(userId: unknown, period?: unknown, revision?: unknown, now = Date.now()): RadarView {
        if (!isId(userId)) return { edition: null, editions: [] };
        const editions = this.store.editions(userId, 60);
        const target = typeof period === 'string' && period ? period : editions[0]?.period;
        const edition = target ? this.store.edition(userId, target, revision) : null;
        if (!edition) return { edition: null, editions };
        // Отметка ставится по прослушиваниям и лайкам после выпуска тоже; сама позиция из выпуска не уходит
        const heard = this.inputs(userId, edition.cutoff - RADAR_PARAMS.windowDays * DAY, now, now, false).heard;
        const mark = (item: RadarItem): RadarItem => ({ ...item, heard: item.heard || heard.has(item.id) });
        return { edition: { ...edition, items: edition.items.map(mark), uploads: edition.uploads.map(mark) }, editions };
    }
    /** «Все найденные»: остальной каталог окна выпуска, включая найденное после него (after), лучшие по оценке */
    public found(userId: unknown, period: unknown, revision?: unknown, now = Date.now()): RadarItem[] {
        if (!isId(userId)) return [];
        const edition = this.store.edition(userId, period, revision);
        if (!edition) return [];
        const from = edition.cutoff - RADAR_PARAMS.windowDays * DAY;
        const input = { ...this.inputs(userId, from, now, now), period: edition.period, cutoff: now, history: [], coverage: edition.coverage };
        // Показанное в выпуске вместе с группами не повторяется; остальное тоже группами исполнителей
        const shown = new Set([...edition.items, ...edition.uploads].flatMap((item) => [item.id, ...(item.group ?? [])]));
        const byKey = new Map(input.uploads.map((upload) => [upload.key, upload]));
        return performerGroups(radarCandidates(input, from, now).filter((candidate) => !shown.has(candidate.id)))
            .sort((a, b) => b.lead.base - a.lead.base || a.lead.id - b.lead.id)
            .slice(0, RADAR_PARAMS.foundSize)
            .flatMap(({ lead, group }) => {
                const upload = byKey.get(lead.key);
                if (!upload) return [];
                const item = asItem({ ...lead, bonus: 0, penalty: 0, score: lead.base }, upload, group);
                return [lead.at > edition.cutoff || upload.firstSeen > edition.created ? { ...item, after: true } : item];
            });
    }
    // Всё, что нужно отбору, кроме истории выпусков и покрытия: окно загрузок, вкус, подписки, «Уже слышал», запреты
    private inputs(userId: number, from: number, to: number, now: number, withUploads = true): Omit<RadarInput, 'period' | 'cutoff' | 'history' | 'coverage'> {
        try {
            this.index.sync(userId);
        } catch (error) {
            console.warn('Радар: журнал не перенесён в индекс, отметки «Уже слышал» по прежнему индексу', error);
        }
        const window = withUploads ? this.store.radarUploads(userId, from, to) : { uploads: [], reuploads: [] };
        const groups = confirmedGroups(this.store.recordingLinks(userId));
        const heard = heardIds(this.index.tastePlays(userId, from - 30 * DAY), memberIds(this.store.libraryMembers(userId, 'likes'), 'sc:track:'), groups);
        const profile = withUploads ? this.taste.profile(userId) : null;
        return {
            now, uploads: window.uploads, reuploads: new Set(window.reuploads), profile, tasteVersion: profile?.version ?? 0,
            follows: memberIds(this.store.libraryMembers(userId, 'followings'), 'sc:user:'), heard, excluded: exclusionFilter(this.exclusions(userId), groups, now), groups,
        };
    }
}
export interface RadarView {
    edition: RadarEdition | null;
    editions: EditionSummary[];
}
