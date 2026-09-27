// Предсказывает ли оценка вкуса ранний пропуск в волне: доля правильно упорядоченных пар «пропущен до 0:30 / дослушан».
// 0.5 это монетка, 1 это идеальный порядок. Инструмент разработки: прогон до и после каждой правки модели или оценки.
// Читает копию данных клиента (журнал, индекс истории, хранилище рекомендаций, отметки) и удаляет её в конце.
// Профиль для каждого дня собирается по данным до начала этого дня, иначе исход трека подсказывал бы ему оценку.
// Нужна свежая сборка tsc/: pnpm exec tsc, затем node scripts/wave-score-check.cjs [--user id] [--dir путь] [--days N]
const { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');

const out = resolve(__dirname, '..', 'tsc', 'services');
if (!existsSync(join(out, 'tasteModel.js'))) throw new Error('Нет сборки tsc/: сначала pnpm exec tsc');
const { HistoryIndex, loopedPlays, localDayStart, COUNTED_MS } = require(join(out, 'historyIndex.js'));
const { WaveSignals } = require(join(out, 'waveSignals.js'));
const { buildTaste, cleanTasteOverrides } = require(join(out, 'tasteModel.js'));
const { RecommendStore } = require(join(out, 'recommendStore.js'));
const { WaveExclusions } = require(join(out, 'waveExclusions.js'));
const { tasteMaps, tasteScore } = require(join(out, 'waveTaste.js'));

const arg = (name, fallback) => {
    const at = process.argv.indexOf('--' + name);
    return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const source = arg('dir', join(process.env.APPDATA ?? '', 'soundcloud-desktop', 'wave'));
const days = Number(arg('days', '30'));
const users = readdirSync(source).map((name) => /^signals-(\d+)-/.exec(name)?.[1]).filter(Boolean);
const user = Number(arg('user', users[0] ?? '0'));
if (!Number.isSafeInteger(user) || user <= 0) throw new Error('Не найден журнал сигналов в ' + source);

const DAY = 86400000;
const CEILING = 3;
// Доля правильно упорядоченных пар: оценка дослушанного выше оценки пропущенного, ничья пополам
function auc(skipped, done) {
    if (!skipped.length || !done.length) return null;
    let good = 0;
    for (const a of skipped) for (const b of done) good += b > a ? 1 : b === a ? 0.5 : 0;
    return good / (skipped.length * done.length);
}
const fmt = (value) => (value === null ? 'нет пар' : value.toFixed(3));
const clamp = (value) => Math.max(-CEILING, Math.min(CEILING, value));

const dir = mkdtempSync(join(tmpdir(), 'wave-score-'));
const index = new HistoryIndex(dir, new WaveSignals(dir));
const recommend = new RecommendStore(dir);
try {
    const mine = (name) => name.includes('-' + user + '.') || name.includes('-' + user + '-');
    for (const name of readdirSync(source).filter(mine)) copyFileSync(join(source, name), join(dir, name));
    const signals = new WaveSignals(dir).load(user, Date.now() - days * DAY);
    const loops = loopedPlays(signals);
    // Оцениваемые: рекомендации волны с известной причиной смены (v3 и новее), без простоя, закрытия и кругов повтора.
    // Оценка в журнале есть только у v4, текущий код пересчитывает её для всех
    const judged = signals.filter((s) => s.source.startsWith('wave:') && !['library', 'seedTrack'].includes(s.why) &&
        s.endedBy !== undefined && !s.away && s.end !== 'stop' && !(s.end === 'skip' && s.endedBy === 'auto') && !loops.has(s));
    const early = (s) => s.end === 'skip' && s.endedBy === 'user' && s.heard < COUNTED_MS;
    const rows = judged.filter((s) => early(s) || s.end === 'done');
    index.sync(user);
    const plays = index.tastePlays(user, Date.now() - 365 * DAY - days * DAY);
    const marks = new WaveExclusions(dir).load(user).more.map((entry) => ({ id: entry.id, artist: entry.artistId ?? 0, genre: entry.genre ?? '', tags: entry.tags ?? '', at: entry.at }));
    let overrides = { artists: [], tags: [] };
    const overridesFile = join(dir, 'taste-overrides-' + user + '.json');
    if (existsSync(overridesFile)) overrides = cleanTasteOverrides(JSON.parse(readFileSync(overridesFile, 'utf8')));
    const library = recommend.tasteLibrary(user, [...new Set(plays.map((play) => play.id))]);

    // Профиль на начало каждого дня: лайки и отметки после этого момента в него не попадают
    const profiles = new Map();
    const profileAt = (at) => {
        const start = localDayStart(at);
        if (!profiles.has(start)) {
            const before = { ...library, likes: library.likes.filter((like) => !like.added || like.added < start) };
            const { profile } = buildTaste(plays.filter((play) => play.at < start), marks.filter((mark) => mark.at < start), overrides, start, before);
            profiles.set(start, tasteMaps(profile));
        }
        return profiles.get(start);
    };
    const scored = rows.map((s) => {
        const track = { id: s.id, title: s.title ?? '', genre: s.genre, tag_list: s.tags, user_id: s.artist, user: { id: s.artist, username: s.artistName ?? '' }, duration: s.dur };
        const now = tasteScore(track, profileAt(s.at));
        return { early: early(s), stored: typeof s.score === 'number' ? s.score : null, now: now.score, known: now.known };
    });
    const split = (list, key, map = (v) => v) => [list.filter((r) => r.early).map((r) => map(r[key])), list.filter((r) => !r.early).map((r) => map(r[key]))];
    const count = (list) => list.filter((r) => r.early).length + ' пропущено до 0:30, ' + list.filter((r) => !r.early).length + ' дослушано';
    const withStored = scored.filter((r) => r.stored !== null);
    console.log('Пользователь ' + user + ', журнал за ' + days + ' дн., треки волны: ' + count(scored));
    console.log('Оценка текущим кодом по профилю на начало дня: ' + fmt(auc(...split(scored, 'now'))) + ', с потолком ±' + CEILING + ': ' + fmt(auc(...split(scored, 'now', clamp))));
    console.log('Записи v4 с оценкой в журнале (' + count(withStored) + '): в журнале ' + fmt(auc(...split(withStored, 'stored'))) +
        ', с потолком ' + fmt(auc(...split(withStored, 'stored', clamp))) + '; текущим кодом ' + fmt(auc(...split(withStored, 'now'))));
    const atCeiling = scored.filter((r) => r.now >= CEILING).length;
    console.log('На потолке (оценка от ' + CEILING + '): ' + atCeiling + ' из ' + scored.length + (scored.length ? ' (' + Math.round((100 * atCeiling) / scored.length) + '%)' : ''));
    for (const known of [true, false]) {
        const part = scored.filter((r) => r.known === known);
        const a = auc(part.filter((r) => r.early).map((r) => r.now), part.filter((r) => !r.early).map((r) => r.now));
        console.log((known ? '  знакомые артисты: ' : '  незнакомые:       ') + part.length + ' треков, пропущено ' + part.filter((r) => r.early).length + ', пары ' + fmt(a));
    }
} finally {
    index.close();
    recommend.close();
    rmSync(dir, { recursive: true, force: true });
}
