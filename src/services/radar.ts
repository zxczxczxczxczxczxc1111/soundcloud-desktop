// Радар релизов (раздел 8 плана): свежесть конкретной версии, оценка по вкусу, отбор до 50 записей с мягким
// разнообразием, план обхода источников и покрытие. Чистые функции получают время, профиль и историю аргументами;
// RadarService в worker только собирает их из хранилищ
import type { CatalogCheck, CatalogStatus, EditionSummary, RecommendStore, StoredUpload } from './recommendStore';
import type { HistoryIndex, TastePlay } from './historyIndex';
import type { TasteProfile, TasteService } from './tasteModel';
import type { ExclusionEntry, WaveExclusionList } from './waveExclusions';
import {
    confirmedCopies, confirmedGroups, copyKey, copyKeys, familyKey, identityText, nameKey, parseTrackTitle, performerKey, splitNames, trackCredits, trackDuration, versionKey,
    type TrackCredit,
} from './trackIdentity';
import { tagShares, tasteMaps, tasteScore, type TasteMaps, type WaveTrack } from './wave';
import { RADAR_FRESH_MS } from './radarSchedule';
import { isWaveEligible } from './wavePicks';
import { buildRegistry, REGISTRY_PARAMS, type RegistryArtist } from './artistRegistry';

const DAY = 86400000;

/** Параметры радара; version растёт при каждом изменении их смысла и попадает в выпуск.
 *  4: потолок аккаунта и в «Новых загрузках» (26.09.2026).
 *  5: прибавка свежести только последним трём дням окна, недобор открытий отдаётся связанным (28.09.2026).
 *  6: фанатские работы отдельной карточкой, архивные записи вниз своего списка (02.10.2026).
 *  7 (28.10.2026): окно от отсечки прошлого выпуска, опоздавшие к нему записи и без повторов показанного; дата релиза
 *  доказывает только с ISRC или у своего аккаунта; фит любимого у незнакомого аккаунта и слив «Название - Исполнитель»
 *  это фанатские работы; одна песня с разных аккаунтов одной строкой; каналы без любимых исполнителей уходят на полку;
 *  обход строится от реестра исполнителей (artistRegistry): их аккаунты, найденные поиском по имени, и поиск свежего по
 *  самым весомым, кураторов из вкуса меньше */
export const RADAR_PARAMS = {
    version: 7,
    /** Окно свежести версии у первого выпуска, дни до отсечки; дальше окно начинается с отсечки прошлого выпуска */
    windowDays: 7,
    /** Окно не длиннее: после пропущенных недель выпуск не тянет давнее */
    maxWindowDays: 14,
    /** Опоздавшая запись (опубликована до окна, но впервые увидена после сборки прошлого выпуска) входит в выпуск,
     *  если вышла не раньше стольких дней до отсечки: так релиз за час до прошлой сборки не теряется навсегда */
    lateDays: 14,
    /** Сколько прошлых выпусков смотреть, чтобы показанное не повторялось */
    shownEditions: 4,
    /** Последние дни окна получают небольшую прибавку. Меньше окна: при равных днях она доставалась всем */
    recentDays: 3,
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
    /** Фанатские работы (перезалив, ремикс, эдит чужой песни не подписки без ISRC и даты релиза): своя карточка, до стольких */
    fansSize: 30,
    /** Архив: год в названии старше стольких лет у записи без даты релиза в окне, штраф к оценке */
    archiveYears: 5,
    archivePenalty: 0.3,
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
    /** Аккаунты-кураторы из вкуса в обходе, кроме аккаунтов реестра: не больше и не слабее. Главное за реестром
     *  исполнителей, кураторы нужны каналам для полки и фанатским работам */
    curators: 40,
    curatorWeight: 0.3,
    follows: 2000,
    /** Поиск свежего по самым весомым исполнителям реестра: находит их участие в чужих релизах */
    searches: 20,
    /** И по стольким исполнителям без аккаунта: каждый поиск держит полноту выпуска, их не может быть сотни */
    orphanSearches: 20,
    /** Поиск аккаунтов исполнителя по точному имени повторяется раз в столько дней */
    resolveDays: 30,
    /** Канал: среди последних сохранённых загрузок аккаунта (не меньше channelMin) чужих исполнителей от этой доли */
    channelMin: 5,
    channelShare: 0.6,
    /** Свежих загрузок каналов для жанровых карточек полки, не больше */
    shelfChannels: 40,
};

export type Freshness = 'release' | 'upload' | 'old' | 'future';
type Provenance = Pick<StoredUpload, 'releaseDay' | 'isrc' | 'uploaderName' | 'credits'>;
/** Аккаунт выложил своё: чужого исполнителя в титрах нет, загрузчик среди исполнителей или это его переделка */
export function ownWork(upload: Pick<StoredUpload, 'uploaderName' | 'credits'>): boolean {
    const uploader = nameKey(upload.uploaderName);
    const credits: TrackCredit[] = Array.isArray(upload.credits) ? upload.credits : [];
    const foreign = credits.some((credit) => credit.role === 'artist' && credit.key !== uploader);
    return !foreign || credits.some((credit) => credit.role === 'remixer' && credit.key === uploader);
}
/** Заявленная дата релиза доказывает версию только вместе с ISRC или у своего аккаунта: дату ставит любой загрузчик,
 *  сливы и перезаливы тоже (разбор 28.10.2026). У канала своего нет: доказывает только ISRC */
export function provenDate(upload: Provenance, channel = false): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(upload.releaseDay) && (!!upload.isrc || (!channel && ownWork(upload)));
}
/** Свежесть конкретной версии в окне [from, to]. release: дата версии доказана и в окне; upload: свежа только
 *  публикация (перезалив, чужой канал, старая дата релиза) и место ей в «Новых загрузках». channel: загрузчик канал (channelSet) */
export function freshness(
    upload: Provenance & Pick<StoredUpload, 'createdAt' | 'displayAt'>, earlierCopy: boolean, from: number, to: number, channel = false,
): { kind: Freshness; at: number } {
    const published = upload.displayAt || upload.createdAt;
    // Недоказанная дата релиза не в счёт: запись оценивается по публикации
    const release = provenDate(upload, channel) ? Date.parse(upload.releaseDay + 'T00:00:00Z') : NaN;
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
    // Сборный канал с чужой песней даёт лишь свежую загрузку, канал с фитом без исполнителя в названии тоже
    return { kind: ownWork(upload) && !channel ? 'release' : 'upload', at: published };
}

/** «Название - Исполнитель» (так выкладывают сливы): во второй части известный вкусу исполнитель, в первой никого
 *  известного. Тогда части меняются местами, хвост в скобках остаётся у названия; иначе null */
export function reversedTitle(title: string, known: (key: string) => boolean): string | null {
    const match = /^(.+?)\s+-\s+([^()[\]{}|]+?)(\s*[([{|].*)?$/.exec(identityText(title));
    if (!match) return null;
    const names = (text: string): string[] => splitNames(text).map(nameKey).filter(Boolean);
    const first = names(match[1]);
    const second = names(match[2]);
    if (!first.length || !second.length || first.some(known) || !second.some(known)) return null;
    return match[2] + ' - ' + match[1] + (match[3] ?? '');
}

/** Строка хранилища обратно в трек для оценки вкусом; участники из метаданных возвращаются туда же, откуда их берёт разбор */
export function uploadTrack(upload: StoredUpload): WaveTrack {
    const names = (role: TrackCredit['role']): string | null =>
        upload.credits.filter((credit) => credit.source === 'metadata' && credit.role === role).map((credit) => credit.name).join(', ') || null;
    return {
        id: upload.id, kind: 'track', title: upload.title, user_id: upload.uploader, user: { id: upload.uploader, username: upload.uploaderName },
        duration: upload.duration, genre: upload.genre, tag_list: upload.tags, ...(upload.policy ? { policy: upload.policy } : {}),
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
    /** Фанатская работа у аккаунта не из подписок без ISRC: чужая песня или связь со вкусом только через участника */
    fan: boolean;
    /** Связь со вкусом через исполнителя, участника или ремиксера в титрах, а не через сам аккаунт или жанр */
    credited: boolean;
    /** Архивная запись: в названии год старше archiveYears, даты релиза в окне нет */
    archive: boolean;
}
export interface RadarPick extends RadarCandidate {
    bonus: number;
    penalty: number;
    score: number;
}

// Оценка по вкусу в 0..1: насыщение, чтобы один огромный вес не делал остальное неразличимым
export const baseScore = (score: number): number => (score > 0 ? 1 - Math.exp(-score / 2) : 0);

/** Кандидат из загрузки или null, если вкус против неё (сильный минус трека) или связи со вкусом нет вовсе.
 *  channel: загрузчик канал, его вес во вкусе не делает загрузку своей работой */
export function scoreUpload(
    upload: StoredUpload, kind: Freshness, at: number, maps: TasteMaps, follows: Set<number>, heard: boolean, to: number, channel = false,
): RadarCandidate | null {
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
    const P = RADAR_PARAMS;
    const linked = followed || score.artist >= P.linkWeight || score.creditBest >= P.linkWeight || score.track > 0 || score.family > 0;
    const credits = Array.isArray(upload.credits) ? upload.credits : [];
    const uploader = nameKey(upload.uploaderName);
    const weight = (key: string): number => maps.credits.get(key) ?? 0;
    // Участник в титрах (не продюсер и не автор слов) весит во вкусе. Загрузчик известен: аккаунт или его имя
    // как исполнитель весят во вкусе, тогда это второй аккаунт артиста, а не фанат. Канал известным так не становится
    const credited = credits.some((credit) => credit.role !== 'producer' && credit.role !== 'writer' && credit.key !== uploader && weight(credit.key) >= P.linkWeight);
    const knownUploader = !channel && (score.artist >= P.linkWeight || weight(uploader) >= P.linkWeight);
    const archive = !(kind === 'release' && provenDate(upload, channel)) && archiveTitle(upload.title, to);
    return {
        key: upload.key, id: upload.id, base: archive ? Math.max(0, base - P.archivePenalty) : base,
        direction: score.tagKey || tagShares(upload.genre, upload.tags, [upload.uploaderName])[0]?.[0] || '', family: familyKey(track) || upload.key,
        uploader: upload.uploader, kind, at, heard, linked, reason, performer: performerKey(upload.uploader, upload.uploaderName, credits),
        // Фит или ремикс любимого артиста у незнакомого аккаунта без ISRC это тоже фанатская работа (разбор 28.10.2026):
        // «Painkillers! feat. Lil Peep», «No Fame (feat. Juice WRLD)»
        fan: !followed && !upload.isrc && (fanWork(upload.uploaderName, credits) || (credited && !knownUploader)), credited, archive,
    };
}

/** Чужая песня: исполнители в титрах есть, загрузчика среди них нет. Ремикс и эдит чужой песни сюда же, даже если
 *  загрузчик указан ремиксером (П10): это переделка, а не релиз исполнителя */
export function fanWork(uploaderName: string, credits: TrackCredit[]): boolean {
    const own = nameKey(uploaderName);
    const artists = credits.filter((credit) => credit.role === 'artist' && credit.key);
    return artists.length > 0 && !artists.some((credit) => credit.key === own);
}

/** Архив по названию: год 1950-2099 отдельным числом не позже чем archiveYears лет до года отсечки («1979», «(Live 2008)») */
export function archiveTitle(title: string, to: number): boolean {
    const limit = new Date(to).getUTCFullYear() - RADAR_PARAMS.archiveYears;
    return Array.from(title.matchAll(/(?<!\d)(19[5-9]\d|20\d\d)(?!\d)/g), (match) => Number(match[1])).some((year) => year <= limit);
}

/** Архивные записи вниз своего списка, порядок внутри частей прежний */
export function archiveLast<T extends { archive: boolean }>(items: T[]): T[] {
    return [...items.filter((item) => !item.archive), ...items.filter((item) => item.archive)];
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
 *  discoveries открытий по жанру, которые всегда ниже связанных. Потолок аккаунта общий для обеих частей.
 *  Открытий набралось меньше отложенных под них мест (потолок аккаунта их срезал): места возвращаются связанным.
 *  Отбор жадный, поэтому первые N записей полного списка связанных совпадают с отбором на N мест */
export function selectEdition(releases: RadarCandidate[], history: string[][]): RadarPick[] {
    const P = RADAR_PARAMS;
    const open = releases.filter((candidate) => !candidate.linked);
    const reserve = Math.min(P.discoveries, open.length);
    const linkedAll = selectRadar(releases.filter((candidate) => candidate.linked), history, P.size, P.perUploader);
    const linked = linkedAll.slice(0, P.size - reserve);
    const used = new Map<number, number>();
    for (const pick of linked) used.set(pick.uploader, (used.get(pick.uploader) ?? 0) + 1);
    const discoveries = selectRadar(open.filter((candidate) => (used.get(candidate.uploader) ?? 0) < P.perUploader), history, Math.min(P.discoveries, P.size - linked.length), P.perUploader);
    for (const pick of discoveries) used.set(pick.uploader, (used.get(pick.uploader) ?? 0) + 1);
    for (const pick of linkedAll.slice(linked.length)) {
        if (linked.length + discoveries.length >= P.size) break;
        if ((used.get(pick.uploader) ?? 0) >= P.perUploader) continue;
        linked.push(pick);
        used.set(pick.uploader, (used.get(pick.uploader) ?? 0) + 1);
    }
    return [...linked, ...discoveries];
}
/** Уже слышанное и лайкнутое в конец выпуска (решение владельца 28.09.2026), порядок внутри частей прежний */
export function heardLast<T extends { heard: boolean }>(items: T[]): T[] {
    return [...items.filter((item) => !item.heard), ...items.filter((item) => item.heard)];
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

/** Источник обхода: каталог аккаунта (подписка, аккаунт исполнителя реестра, куратор из вкуса), поиск свежего
 *  по исполнителю или поиск аккаунтов исполнителя по точному имени (artist) */
export interface RadarSource {
    key: string;
    kind: 'user' | 'search' | 'artist';
    id: number;
    q: string;
    label: string;
    checked: number;
    status: CatalogStatus | '';
    /** Порядок при равной давности: подписки и любимые раньше */
    weight: number;
}
/** Найденные аккаунты исполнителя реестра (artistAccounts хранилища) */
export type ResolvedArtists = Map<string, { name: string; accounts: Array<{ id: number; name: string }>; resolved: number }>;
/**
 * План обхода (разбор 28.10.2026): подписки, все аккаунты исполнителей реестра (свои по загрузкам и найденные поиском
 * по имени), поиск аккаунтов для тех, кого не искали месяц, поиск свежего по самым весомым и по исполнителям без
 * аккаунта, и немного кураторов из вкуса для полки и фанатских работ
 */
export function radarSources(
    follows: number[], profile: TasteProfile | null, registry: RegistryArtist[], resolved: ResolvedArtists, checks: CatalogCheck[], hidden: Set<number>, now: number,
): RadarSource[] {
    const P = RADAR_PARAMS;
    const known = new Map(checks.map((check) => [check.key, check]));
    const sources: RadarSource[] = [];
    const add = (source: Omit<RadarSource, 'checked' | 'status' | 'label'> & { label: string }): void => {
        const check = known.get(source.key);
        sources.push({ ...source, label: check?.label || source.label, checked: check?.checked ?? 0, status: check?.status ?? '' });
    };
    const accounts = new Map<number, { weight: number; label: string }>();
    const account = (id: number, weight: number, label: string): void => {
        if (hidden.has(id)) return;
        const current = accounts.get(id);
        accounts.set(id, { weight: Math.max(current?.weight ?? 0, weight), label: current?.label || label });
    };
    // Скрытые не занимают место в пределе. Подписок больше предела: остаются те, что весят во вкусе, а не первые
    // по номеру аккаунта (дата подписки у сайта неизвестна, хранилище отдаёт их по ключу)
    const followed = follows.filter((id) => !hidden.has(id));
    const taste = new Map(profile?.artists ?? []);
    const kept = followed.length > P.follows
        ? new Set(followed.map((id, order) => ({ id, order, weight: taste.get(id) ?? 0 })).sort((a, b) => b.weight - a.weight || a.order - b.order).slice(0, P.follows).map((entry) => entry.id))
        : null;
    for (const id of followed) if (!kept || kept.has(id)) account(id, 1, '');
    const searches = new Map<string, { name: string; weight: number }>();
    for (const artist of registry.slice(0, P.searches)) searches.set(artist.key, { name: artist.name, weight: artist.weight });
    let orphans = 0;
    for (const artist of registry) {
        const found = resolved.get(artist.key);
        for (const id of artist.accounts) account(id, artist.weight, artist.name);
        for (const item of found?.accounts ?? []) account(item.id, artist.weight, item.name);
        if (!found || found.resolved < now - P.resolveDays * DAY) {
            // Отказ поиска повторяется через сутки, а не каждым сбором: недоступный поиск не съедает бюджет
            const check = known.get('artist:' + artist.key);
            if (check?.status !== 'failed' || check.checked < now - DAY) add({ key: 'artist:' + artist.key, kind: 'artist', id: 0, q: artist.name, label: artist.name, weight: artist.weight });
        } else if (!artist.accounts.length && !found.accounts.length && !searches.has(artist.key) && orphans < P.orphanSearches) {
            // Аккаунта нет и поиск его не нашёл: остаётся поиск свежего по имени, для самых весомых из таких
            searches.set(artist.key, { name: artist.name, weight: artist.weight });
            orphans++;
        }
    }
    // Вес во вкусе поднимает и уже взятые аккаунты; в предел кураторов идут только новые
    const curators = (profile?.artists ?? []).filter(([id, weight]) => weight >= P.curatorWeight && !hidden.has(id)).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    let added = 0;
    for (const [id, weight] of curators) {
        if (accounts.has(id)) account(id, weight, '');
        else if (added < P.curators) {
            account(id, weight, '');
            added++;
        }
    }
    for (const [id, { weight, label }] of accounts) add({ key: 'user:' + id, kind: 'user', id, q: '', label, weight });
    for (const [key, { name, weight }] of searches) if (name.length >= 2) add({ key: 'search:' + key, kind: 'search', id: 0, q: name, label: name, weight });
    return sources;
}

export interface RadarCoverage {
    /** Аккаунты радара: подписки, аккаунты исполнителей реестра и кураторы из вкуса */
    accounts: number;
    /** Проверены не раньше чем за сутки до слота (или аккаунта больше нет) */
    checked: number;
    /** Источники с ошибкой при последней проверке */
    failed: number;
    /** Поиск свежего по исполнителям реестра */
    searches: number;
    searchesDone: number;
}
export function radarCoverage(sources: RadarSource[], since: number): RadarCoverage {
    const coverage: RadarCoverage = { accounts: 0, checked: 0, failed: 0, searches: 0, searchesDone: 0 };
    for (const source of sources) {
        // Поиск аккаунтов исполнителя выпуск не держит: найденные аккаунты войдут в план и покрытие следующей проверкой
        if (source.kind === 'artist') continue;
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
    /** Фанатская работа: в выпуске лежит в uploads и показывается карточкой «Ремиксы и эдиты» (алгоритм 6) */
    fan?: true;
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
        ...(item.fan === true ? { fan: true as const } : {}),
    };
}

/** Прошлый выпуск: отсечка, время сборки, показанные записи вместе с группами и направления основного списка */
export interface PreviousEdition {
    cutoff: number;
    created: number;
    ids: number[];
    directions: string[];
}
/** Окно отбора выпуска */
export interface RadarWindow {
    /** Начало окна публикации: отсечка прошлого выпуска, но не дальше maxWindowDays до отсечки */
    from: number;
    /** Начало окна для опоздавших */
    lateFrom: number;
    /** Впервые увиденное позже этого опоздало к прошлому выпуску; без прошлого выпуска опоздавших нет */
    seenAfter: number;
    /** Показанное в прошлых выпусках: не повторяется */
    shown: Set<number>;
    /** Ключи вероятных копий показанного (copyKey): тот же трек с другого аккаунта тоже не повторяется */
    shownCopies: Set<string>;
}
/** Выпуск с отсечкой ближе этого та же неделя (после смены дня или зоны), а не прошлая: так же считает хранилище */
const SAME_WEEK = 3 * DAY;
/** Окно выпуска с отсечкой cutoff; previous: прошлые выпуски новые сверху (последняя ревизия каждого периода).
 *  Выпуск той же недели окно не сдвигает и показанным не считается: пересборка после смены дня собирает ту же неделю */
export function radarWindow(cutoff: number, previous: PreviousEdition[]): RadarWindow {
    const P = RADAR_PARAMS;
    const earlier = previous.filter((edition) => edition.cutoff <= cutoff - SAME_WEEK);
    const last = earlier[0];
    return {
        from: last ? Math.max(cutoff - P.maxWindowDays * DAY, last.cutoff) : cutoff - P.windowDays * DAY,
        lateFrom: cutoff - P.lateDays * DAY,
        seenAfter: last ? last.created : Infinity,
        shown: new Set(earlier.flatMap((edition) => edition.ids)),
        shownCopies: new Set(),
    };
}

export interface RadarInput {
    period: string;
    now: number;
    cutoff: number;
    window: RadarWindow;
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
    /** Каналы: аккаунты, где большинство загрузок это чужие исполнители (премьеры, сборники, перезаливы) */
    channels: Set<number>;
    history: string[][];
    coverage: RadarCoverage;
}
const round = (value: number): number => Math.round(value * 1000) / 1000;
const asItem = (pick: RadarPick, upload: StoredUpload, group: RadarCandidate[] = []): RadarItem => ({
    ...(pick.fan ? { fan: true as const } : {}),
    key: pick.key, id: pick.id, title: upload.title, artist: upload.uploaderName, kind: pick.kind === 'upload' ? 'upload' : 'release', at: pick.at,
    heard: pick.heard, score: round(pick.score), base: round(pick.base), bonus: round(pick.bonus), penalty: round(pick.penalty), direction: pick.direction, reason: pick.reason,
    ...(group.length > 1 ? { group: group.map((member) => member.id) } : {}),
});

/** Кандидаты окна выпуска до to после запретов, показанного раньше и склейки копий: и для выпуска, и для «Всех найденных» */
export function radarCandidates(input: RadarInput, to: number): RadarCandidate[] {
    const maps = tasteMaps(input.profile) ?? tasteMaps({});
    if (!maps) return [];
    const follows = new Set(input.follows);
    const { window } = input;
    // Показанное раньше не повторяется ни подтверждённой, ни вероятной копией
    const shown = confirmedCopies(window.shown, input.groups);
    const known = knownCredit(maps);
    // Копии в выпуске одной строкой. Ключи: подтверждённая группа, вероятная копия той же версии (copyKeys) и одна
    // песня с разных аккаунтов без общего ISRC: то же ядро названия и пометки, длительность рядом и общий исполнитель
    // среди загрузчика и титров («ROMEO» у Pepel Nahudi и «ROMEO (feat. Pepel Nahudi)» у SLATTCRANK). Остаётся релиз
    // раньше перезалива, затем копия с ISRC, затем своя у исполнителя, затем лучшая оценка, при равенстве меньший id.
    // Запись отмечается серединами ключей, новая ищет свои с соседними шагами длительности: порядок входа не решает
    interface Entry { candidate: RadarCandidate; isrc: boolean; performers: Set<string>; centers: string[] }
    const index = new Map<string, Entry>();
    const better = (a: Entry, b: Entry): boolean =>
        a.candidate.kind !== b.candidate.kind ? a.candidate.kind === 'release'
            : a.isrc !== b.isrc ? a.isrc
                : a.candidate.performer.startsWith('u:') !== b.candidate.performer.startsWith('u:') ? a.candidate.performer.startsWith('u:')
                    : a.candidate.base !== b.candidate.base ? a.candidate.base > b.candidate.base : a.candidate.id < b.candidate.id;
    for (const stored of input.uploads.slice().sort((a, b) => a.id - b.id)) {
        if (input.excluded(stored) || shown.has(stored.id)) continue;
        const upload = reorderedUpload(stored, known);
        const track = uploadTrack(upload);
        // Недоступное и отрывки сразу мимо: страница всё равно их спрячет, а место в выпуске будет занято
        if (!isWaveEligible(track)) continue;
        const from = upload.firstSeen > window.seenAfter ? window.lateFrom : window.from;
        const channel = input.channels.has(upload.uploader);
        const { kind, at } = freshness(upload, input.reuploads.has(upload.key), from, to, channel);
        if (kind !== 'release' && kind !== 'upload') continue;
        const copies = copyKeys(track);
        if (copies.some((key) => window.shownCopies.has(key))) continue;
        const candidate = scoreUpload(upload, kind, at, maps, follows, input.heard.has(upload.id), to, channel);
        if (!candidate) continue;
        // Канал (премьеры, сборники) связан со вкусом только собой или жанром: это не релизы, их место на полке
        // в жанровой карточке (решение владельца 28.10.2026). Запись любимого исполнителя на канале остаётся
        if (channel && !candidate.credited) continue;
        const root = input.groups.get(upload.key);
        const loose = songKeys(track);
        const entry: Entry = {
            candidate, isrc: !!upload.isrc, performers: performersOf(upload),
            centers: [...(root ? ['g:' + root] : []), copies.length === 3 ? copies[1] : copies[0], ...(loose.length ? [loose[1]] : [])],
        };
        const rivals = new Set<Entry>();
        for (const key of root ? ['g:' + root, ...copies] : copies) {
            const rival = index.get(key);
            if (rival) rivals.add(rival);
        }
        for (const key of loose) {
            const rival = index.get(key);
            if (rival && [...rival.performers].some((name) => entry.performers.has(name))) rivals.add(rival);
        }
        if ([...rivals].some((rival) => better(rival, entry))) continue;
        for (const rival of rivals) for (const key of rival.centers) if (index.get(key) === rival) index.delete(key);
        for (const key of entry.centers) index.set(key, entry);
    }
    return demoteBulk([...new Set(index.values())].map((entry) => entry.candidate), input.uploads);
}

/** Каналы среди аккаунтов по их последним загрузкам: премьеры и сборники выкладывают чужих исполнителей */
export function channelSet(works: Array<Pick<StoredUpload, 'uploader' | 'uploaderName' | 'credits'>>): Set<number> {
    const counts = new Map<number, { total: number; foreign: number }>();
    for (const work of works) {
        const count = counts.get(work.uploader) ?? { total: 0, foreign: 0 };
        count.total++;
        if (fanWork(work.uploaderName, work.credits)) count.foreign++;
        counts.set(work.uploader, count);
    }
    const P = RADAR_PARAMS;
    return new Set([...counts].filter(([, count]) => count.total >= P.channelMin && count.foreign >= count.total * P.channelShare).map(([uploader]) => uploader));
}
/** Свежие загрузки каналов, которые радар не берёт (связь только каналом или жанром), для жанровых карточек полки:
 *  ещё не слышанные, лучшие по оценке */
export function channelPicks(input: Pick<RadarInput, 'uploads' | 'profile' | 'follows' | 'heard' | 'excluded' | 'channels'>, from: number, to: number): Array<{ id: number; base: number }> {
    const maps = tasteMaps(input.profile) ?? tasteMaps({});
    if (!maps) return [];
    const follows = new Set(input.follows);
    const known = knownCredit(maps);
    const picks: Array<{ id: number; base: number }> = [];
    for (const stored of input.uploads) {
        if (!input.channels.has(stored.uploader) || input.excluded(stored) || input.heard.has(stored.id)) continue;
        // Тот же разворот «Название - Исполнитель», что у радара: иначе запись встала бы и туда, и сюда
        const upload = reorderedUpload(stored, known);
        if (!isWaveEligible(uploadTrack(upload))) continue;
        const { kind, at } = freshness(upload, false, from, to, true);
        if (kind !== 'release' && kind !== 'upload') continue;
        const candidate = scoreUpload(upload, kind, at, maps, follows, false, to, true);
        if (candidate && !candidate.credited) picks.push({ id: upload.id, base: round(candidate.base) });
    }
    return picks.sort((a, b) => b.base - a.base || a.id - b.id).slice(0, RADAR_PARAMS.shelfChannels);
}

/** Исполнитель известен вкусу: его вес как участника от порога связи */
const knownCredit = (maps: TasteMaps) => (key: string): boolean => (maps.credits.get(key) ?? 0) >= RADAR_PARAMS.linkWeight;
/** Загрузка с исправленным порядком «Название - Исполнитель» (reversedTitle): разбор, семья и участники заново */
export function reorderedUpload(upload: StoredUpload, known: (key: string) => boolean): StoredUpload {
    const title = reversedTitle(upload.title, known);
    if (!title) return upload;
    const track = { ...uploadTrack(upload), title };
    const parsed = parseTrackTitle(title);
    return { ...upload, title, familyKey: familyKey(track, parsed), versionKey: versionKey(track, parsed), version: parsed.version, credits: trackCredits(track, parsed) };
}
/** Ключи одной песни с разных аккаунтов: ядро названия без участников и скобок, пометки версии, длительность шагом
 *  2 секунды с соседями. Безымянную переделку так не склеить: два разных ремикса бывают одной длины */
export function songKeys(track: WaveTrack): string[] {
    const parsed = parseTrackTitle(track.title);
    const duration = trackDuration(track);
    if (!parsed.baseKey || parsed.anonymous || !duration) return [];
    const step = Math.round(duration / 2000);
    return [step - 1, step, step + 1].map((value) => 's:' + parsed.baseKey + '|' + parsed.version.join('+') + '|' + value);
}
/** Исполнители записи для склейки копий: загрузчик, исполнители и гости из титров и метаданных */
export function performersOf(upload: Pick<StoredUpload, 'uploaderName' | 'credits'>): Set<string> {
    const names = new Set<string>();
    const own = nameKey(upload.uploaderName);
    if (own) names.add(own);
    for (const credit of upload.credits) if ((credit.role === 'artist' || credit.role === 'featured') && credit.key) names.add(credit.key);
    return names;
}

/** Пачка без дат релиза (решение владельца 25.09.2026): аккаунт, выложивший за bulkDays больше bulkSize записей, чья
 *  свежесть доказана только публикацией, скорее выгружает старый каталог. Релизами остаются bulkKeep лучших по оценке,
 *  остальные становятся «Новыми загрузками». Записи с датой релиза в счёт не идут и не трогаются */
export function demoteBulk(candidates: RadarCandidate[], uploads: StoredUpload[]): RadarCandidate[] {
    const P = RADAR_PARAMS;
    const dated = new Set(uploads.filter((upload) => provenDate(upload)).map((upload) => upload.key));
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
    const fans: RadarCandidate[] = [];
    for (const candidate of radarCandidates(input, input.cutoff)) (candidate.fan ? fans : candidate.kind === 'release' ? releases : fresh).push(candidate);
    const complete = coverageComplete(input.coverage);
    if (!releases.length && !complete) return null;
    // Отбор идёт по ведущим групп: потолок аккаунта считает группы, остальные записи исполнителя едут в group
    const releaseGroups = performerGroups(releases);
    const freshGroups = performerGroups(fresh);
    const fanGroups = performerGroups(fans);
    const groupOf = new Map([...releaseGroups, ...freshGroups, ...fanGroups].map((entry) => [entry.lead.key, entry.group]));
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
        items: archiveLast(selectEdition(releaseGroups.map((entry) => entry.lead), input.history)).map(item).filter((entry): entry is RadarItem => entry !== null),
        // Тот же потолок аккаунта, что в основном списке: сборный канал с тридцатью исполнителями иначе занимает все места.
        // Фанатские работы лежат там же с пометкой fan, без смены схемы хранилища
        uploads: [
            ...archiveLast(selectRadar(freshGroups.map((entry) => entry.lead), [], P.uploadsSize, P.perUploader)),
            ...archiveLast(selectRadar(fanGroups.map((entry) => entry.lead), [], P.fansSize, P.perUploader)),
        ].map(item).filter((entry): entry is RadarItem => entry !== null),
    };
}

export interface RadarBuildOutcome {
    published: boolean;
    /** Обход не завершён, а публиковать пустоту или неполное до бюджета нельзя */
    waiting: boolean;
    edition: RadarEdition | null;
    /** Только у записанного выпуска: состав для журнала диагностики */
    composition?: RadarComposition;
}
/** Состав выпуска для журнала диагностики (разбор 28.10.2026, шаг 7): видно, что радар держит своё исполнителей, а не каналы */
export interface RadarComposition {
    releases: number;
    /** Релизы с аккаунтов исполнителей реестра и подписок */
    own: number;
    /** Позиции с каналов: остаются только записи любимых исполнителей, остальное уходит на полку */
    channel: number;
    /** Новые загрузки чужих аккаунтов, без фанатских работ */
    uploads: number;
    fan: number;
    /** Записи вместе с группами, которые обычное окно выпуска не взяло бы и которые найдены после прошлого: пришли через окно опоздавших */
    late: number;
}
export function radarComposition(edition: RadarEdition, uploads: StoredUpload[], channels: Set<number>, own: Set<number>, window: RadarWindow): RadarComposition {
    const byKey = new Map(uploads.map((upload) => [upload.key, upload]));
    const all = [...edition.items, ...edition.uploads];
    const uploader = (item: RadarItem): number => byKey.get(item.key)?.uploader ?? 0;
    return {
        releases: edition.items.length,
        own: edition.items.filter((item) => own.has(uploader(item))).length,
        channel: all.filter((item) => channels.has(uploader(item))).length,
        uploads: edition.uploads.filter((item) => !item.fan).length,
        fan: edition.uploads.filter((item) => item.fan).length,
        late: all.flatMap((item) => item.group ?? [item.id]).filter((id) => {
            const upload = byKey.get('sc:track:' + id);
            if (!upload || upload.firstSeen <= window.seenAfter) return false;
            // Свежесть та же, что у отбора: доказанная дата релиза в окне делает запись обычной, а не опоздавшей
            const { kind } = freshness(upload, false, window.from, edition.cutoff, channels.has(upload.uploader));
            return kind !== 'release' && kind !== 'upload';
        }).length,
    };
}
const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const memberIds = (keys: Array<{ key: string }>, prefix: string): number[] =>
    keys.map((member) => Number(member.key.slice(prefix.length))).filter(isId);

// Радар в worker: план обхода для страницы и сборка выпуска из хранилищ
export class RadarService {
    private registries = new Map<number, { at: number; hidden: string; artists: RegistryArtist[] }>();
    private channelMarks = new Map<number, Map<number, { at: number; channel: boolean }>>();

    constructor(
        private store: RecommendStore,
        private index: HistoryIndex,
        private taste: TasteService,
        private exclusions: (userId: number) => WaveExclusionList,
    ) {}

    public plan(userId: unknown, now = Date.now()): RadarSource[] {
        if (!isId(userId)) return [];
        const profile = this.taste.profile(userId);
        const hidden = new Set(this.exclusions(userId).artists.map((entry) => entry.id));
        const follows = memberIds(this.store.libraryMembers(userId, 'followings'), 'sc:user:');
        return radarSources(follows, profile, this.registry(userId, hidden, now), this.store.artistAccounts(userId), this.store.catalogState(userId), hidden, now);
    }
    /** Реестр исполнителей (artistRegistry) с кэшем на 6 часов: разбор полугода истории на каждой проверке не нужен */
    public registry(userId: number, hidden: Set<number>, now: number): RegistryArtist[] {
        const signature = [...hidden].sort((a, b) => a - b).join(',');
        const cached = this.registries.get(userId);
        if (cached && cached.hidden === signature && now - cached.at <= 6 * 3600000) return cached.artists;
        const plays = this.index.tastePlays(userId, now - REGISTRY_PARAMS.playsDays * DAY);
        const library = this.store.tasteLibrary(userId, plays.map((play) => play.id));
        const names = this.store.uploaderNames(userId, library.follows);
        // Каналы проверяются среди загрузчиков, с которыми есть касания: их имя не делается исполнителем
        const uploaders = [
            ...library.likes.flatMap((like) => (like.upload ? [like.upload.uploader] : [])),
            ...library.playlists.flatMap((track) => (track.upload ? [track.upload.uploader] : [])),
            ...plays.map((play) => play.artist),
            ...library.follows,
        ];
        const artists = buildRegistry({
            likes: library.likes, playlists: library.playlists, plays, uploads: new Map(library.uploads.map((upload) => [upload.id, upload])),
            follows: library.follows.map((id) => ({ id, name: names.get(id) ?? '' })), channels: this.channelsOf(userId, uploaders, now), hidden, now,
        });
        this.registries.set(userId, { at: now, hidden: signature, artists });
        return artists;
    }
    /** Собрать и записать выпуск периода. force: бюджет сбора вышел, неполный выпуск с релизами допустим */
    public build(userId: unknown, period: unknown, cutoff: unknown, force: unknown, manual: unknown, now = Date.now()): RadarBuildOutcome {
        const idle: RadarBuildOutcome = { published: false, waiting: false, edition: null };
        if (!isId(userId) || typeof period !== 'string' || !isId(cutoff) || cutoff > now) return idle;
        if (manual !== true && this.store.radarStatus(userId, period, cutoff).published) return idle;
        const coverage = radarCoverage(this.plan(userId, now), cutoff - RADAR_FRESH_MS);
        if (!coverageComplete(coverage) && force !== true && manual !== true) return { ...idle, waiting: true };
        const { window, history } = this.window(userId, period, cutoff);
        const inputs = this.inputs(userId, window.lateFrom, cutoff, now);
        const edition = buildRadar({ ...inputs, period, cutoff, window, history, coverage });
        if (!edition) return { ...idle, waiting: true };
        const saved = this.store.saveEdition(userId, edition, manual === true);
        if (!saved) return idle;
        // Выпуск уже записан: сбой подсчёта для журнала не должен превращать его в ошибку сборки
        try {
            // Реестр уже собран планом выше и лежит в кэше
            const hidden = new Set(this.exclusions(userId).artists.map((entry) => entry.id));
            const own = new Set([...this.registry(userId, hidden, now).flatMap((artist) => artist.accounts), ...inputs.follows]);
            return { published: true, waiting: false, edition: saved, composition: radarComposition(saved, inputs.uploads, inputs.channels, own, window) };
        } catch (error) {
            console.warn('Радар: состав выпуска для журнала не посчитан', error);
            return { published: true, waiting: false, edition: saved };
        }
    }
    /** Выпуск для страницы: последний или выбранный из архива с отметками «Уже слышал» на сейчас, и список архива */
    public view(userId: unknown, period?: unknown, revision?: unknown, now = Date.now()): RadarView {
        if (!isId(userId)) return { edition: null, editions: [] };
        const editions = this.store.editions(userId, 60);
        const target = typeof period === 'string' && period ? period : editions[0]?.period;
        const edition = target ? this.store.edition(userId, target, revision) : null;
        if (!edition) return { edition: null, editions };
        // Отметка ставится по прослушиваниям и лайкам после выпуска тоже; сама позиция из выпуска не уходит,
        // а опускается в конец своего списка
        const heard = this.inputs(userId, edition.cutoff - RADAR_PARAMS.lateDays * DAY, now, now, false).heard;
        const mark = (item: RadarItem): RadarItem => ({ ...item, heard: item.heard || heard.has(item.id) });
        return { edition: { ...edition, items: heardLast(edition.items.map(mark)), uploads: heardLast(edition.uploads.map(mark)) }, editions };
    }
    /** «Все найденные»: остальной каталог окна выпуска, включая найденное после него (after), лучшие по оценке */
    public found(userId: unknown, period: unknown, revision?: unknown, now = Date.now()): RadarItem[] {
        if (!isId(userId)) return [];
        const edition = this.store.edition(userId, period, revision);
        if (!edition) return [];
        // Окно то же, что у выпуска; показанное в нём и в прошлых выпусках вместе с группами не повторяется
        const { window } = this.window(userId, edition.period, edition.cutoff, [...edition.items, ...edition.uploads].flatMap((item) => [item.id, ...(item.group ?? [])]));
        const input = { ...this.inputs(userId, window.lateFrom, now, now), period: edition.period, cutoff: now, window, history: [], coverage: edition.coverage };
        const byKey = new Map(input.uploads.map((upload) => [upload.key, upload]));
        return performerGroups(radarCandidates(input, now))
            .sort((a, b) => b.lead.base - a.lead.base || a.lead.id - b.lead.id)
            .slice(0, RADAR_PARAMS.foundSize)
            .flatMap(({ lead, group }) => {
                const upload = byKey.get(lead.key);
                if (!upload) return [];
                const item = asItem({ ...lead, bonus: 0, penalty: 0, score: lead.base }, upload, group);
                return [lead.at > edition.cutoff || upload.firstSeen > edition.created ? { ...item, after: true } : item];
            });
    }
    // Окно выпуска периода по прошлым выпускам и их направления для разнообразия; also: что ещё считать показанным (сам выпуск
    // для «Всех найденных»). Ключи вероятных копий берутся из сохранённых загрузок показанного
    private window(userId: number, period: string, cutoff: number, also: number[] = []): { window: RadarWindow; history: string[][] } {
        const previous = this.store.radarPrevious(userId, period, RADAR_PARAMS.shownEditions);
        const window = radarWindow(cutoff, previous);
        for (const id of also) window.shown.add(id);
        for (const upload of this.store.uploads(userId, [...window.shown].map((id) => 'sc:track:' + id))) window.shownCopies.add(copyKey(uploadTrack(upload)));
        return { window, history: previous.map((edition) => edition.directions) };
    }
    // Всё, что нужно отбору, кроме истории выпусков и покрытия: окно загрузок, вкус, подписки, «Уже слышал», запреты
    private inputs(userId: number, from: number, to: number, now: number, withUploads = true): Omit<RadarInput, 'period' | 'cutoff' | 'window' | 'history' | 'coverage'> {
        try {
            this.index.sync(userId);
        } catch (error) {
            console.warn('Радар: журнал не перенесён в индекс, отметки «Уже слышал» по прежнему индексу', error);
        }
        const window = withUploads ? this.store.radarUploads(userId, from, to) : { uploads: [], reuploads: [] };
        const groups = confirmedGroups(this.store.recordingLinks(userId));
        const heard = heardIds(this.index.tastePlays(userId, from - 30 * DAY), memberIds(this.store.libraryMembers(userId, 'likes'), 'sc:track:'), groups);
        const profile = withUploads ? this.taste.profile(userId) : null;
        const channels = this.channelsOf(userId, window.uploads.map((upload) => upload.uploader), now);
        return {
            now, uploads: window.uploads, reuploads: new Set(window.reuploads), profile, tasteVersion: profile?.version ?? 0,
            follows: memberIds(this.store.libraryMembers(userId, 'followings'), 'sc:user:'), heard, excluded: exclusionFilter(this.exclusions(userId), groups, now), groups, channels,
        };
    }
    // Каналы среди загрузчиков: признак аккаунта кэшируется на 6 часов, из хранилища читаются только новые и устаревшие.
    // Без кэша каждая сборка, «Все найденные» и полка читали бы последние загрузки сотен аккаунтов
    private channelsOf(userId: number, uploaders: number[], now: number): Set<number> {
        const marks = this.channelMarks.get(userId) ?? new Map<number, { at: number; channel: boolean }>();
        this.channelMarks.set(userId, marks);
        const wanted = [...new Set(uploaders)];
        const stale = wanted.filter((id) => (marks.get(id)?.at ?? -Infinity) < now - 6 * 3600000);
        if (stale.length) {
            const found = channelSet(this.store.recentWorks(userId, stale));
            for (const id of stale) marks.set(id, { at: now, channel: found.has(id) });
        }
        return new Set(wanted.filter((id) => marks.get(id)?.channel === true));
    }
    /** Свежие загрузки каналов за две недели для жанровых карточек полки (решение владельца 28.10.2026) */
    public channels(userId: unknown, now = Date.now()): Array<{ id: number; base: number }> {
        if (!isId(userId)) return [];
        const from = now - RADAR_PARAMS.lateDays * DAY;
        return channelPicks(this.inputs(userId, from, now, now), from, now);
    }
}
export interface RadarView {
    edition: RadarEdition | null;
    editions: EditionSummary[];
}
