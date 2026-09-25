import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, expect, it } from 'vitest';
import type { PlaySignal } from '../types';
import { BACKUP_LIMITS, BackupService, readBackup } from './backup';
import { AUTO_BACKUP_KEEP, autoBackupDue, backupFileName, ioReason } from './backupPolicy';
import { HistoryIndex } from './historyIndex';
import { PlaybackStore } from './playbackStore';
import type { RadarEdition } from './radar';
import { RecommendStore } from './recommendStore';
import { TasteService } from './tasteModel';
import { WaveExclusions } from './waveExclusions';
import { WaveJournal } from './waveJournal';
import { WaveSignals } from './waveSignals';

const DAY = 86400000;
const T0 = Date.parse('2026-06-10T12:00:00Z');
const USER = 77;
const OTHER = 88;
const APP = { version: '0.7.0', build: 'abc1234' };
// Настройки главного процесса как есть: в копию должны попасть только разрешённые и проверенные
const SETTINGS = {
    adBlocker: false, siteLanguage: 'en', radarDay: 5, proxyHost: 'proxy.local', proxyPassword: 'secret-pass', proxyPasswordEncrypted: 'djEw-cipher',
    webhookUrl: 'https://hook.example/private', accounts: [{ id: 'acc_1', name: 'Второй' }], currentAccountId: 'acc_1', gpuCompatibilityMode: 'on',
    homeLayoutApplied: true, statusDisplayType: 7,
};

const folders: string[] = [];
const closers: Array<() => void> = [];
const folder = (prefix = 'sc-backup-'): string => {
    const created = mkdtempSync(join(tmpdir(), prefix));
    folders.push(created);
    return created;
};
afterEach(() => {
    for (const close of closers.splice(0)) close();
    for (const created of folders.splice(0)) rmSync(created, { recursive: true, force: true });
});

function profile(directory = folder(), onStep?: (step: string) => void, limits = BACKUP_LIMITS) {
    const signals = new WaveSignals(directory);
    const index = new HistoryIndex(directory, signals);
    const playback = new PlaybackStore(directory);
    const recommend = new RecommendStore(directory);
    const taste = new TasteService(directory, index, () => []);
    closers.push(() => {
        index.close();
        recommend.close();
    });
    const backup = new BackupService(directory, { playback, recommend, index, taste }, limits, onStep);
    return { directory, signals, index, playback, recommend, taste, backup, exclusions: new WaveExclusions(directory), journal: new WaveJournal(directory, 0) };
}
type Profile = ReturnType<typeof profile>;

const play = (at: number, id: number): PlaySignal => ({
    at, id, artist: 5, dur: 180000, pos: 180000, heard: 180000, end: 'done', source: 'wave:similar', why: '', liked: false, likedNow: false,
    disliked: false, hiddenArtist: false, genre: 'phonk', tags: '', v: 2, tz: 180, title: 'Трек ' + id, artistName: 'Artist', path: '/artist/track-' + id, artwork: '', away: false,
});
const track = (id: number): object => ({ id, title: 'T' + id, user: { id: 5, username: 'artist' }, duration: 180000, permalink_url: 'https://soundcloud.com/artist/t' + id });
const edition = (period: string, created: number): RadarEdition => ({
    period, revision: 0, created, cutoff: created - 1000, status: 'complete', coverage: { accounts: 1, checked: 1, failed: 0, searches: 0, searchesDone: 0 },
    algorithm: 1, taste: 2, uploads: [],
    items: [{ key: 'sc:track:31', id: 31, title: 'Release', artist: 'A', kind: 'release', at: created - DAY, heard: false, score: 0.5, base: 0.5, bonus: 0, penalty: 0, direction: 'phonk', reason: { kind: 'taste' } }],
});

function seed(p: Profile, user = USER): void {
    // Два месяца журнала: июнь и июль
    p.signals.add(user, [play(T0, 1), play(T0 + DAY, 2), play(T0 + 40 * DAY, 3)]);
    p.signals.flush();
    p.exclusions.set(user, 'track', { id: 10, title: 'Bad', artist: 'X', url: 'https://soundcloud.com/x/bad' }, true, T0);
    p.exclusions.set(user, 'more', { id: 11, title: 'Good', artist: 'Y', artistId: 5, genre: 'phonk' }, true, T0 + 1);
    p.journal.add(user, [1, 2, 3]);
    p.journal.flush();
    expect(p.taste.setRemoved(user, 'artist', 9, true)).toBe(true);
    p.playback.saveMix(user, 'Вечер', [track(1), track(2)]);
    expect(p.recommend.saveEdition(user, edition('2026-09-18', T0 + 100 * DAY), false)).not.toBeNull();
    expect(p.recommend.setRecordingLink(user, 'sc:track:1', 'sc:track:2', true, T0)).toBe(true);
}
function save(p: Profile, target = join(folder('sc-backup-out-'), 'copy.scbackup')): string {
    expect(p.backup.save(target, SETTINGS, APP, 0, T0 + 120 * DAY)).toMatchObject({ ok: true });
    return target;
}
// То, что делает main после worker: отметки и журнал «Нового», затем пересборка индекса
function restoreAll(p: Profile, file: string) {
    const inspected = p.backup.inspect(file);
    if (!inspected.ok) throw new Error('Копия не прочитана: ' + inspected.reason);
    const restored = p.backup.restore(file, inspected.hash);
    if (!restored.ok) throw new Error('Копия не восстановлена: ' + restored.reason);
    for (const account of restored.accounts) {
        if (account.exclusions) expect(p.exclusions.merge(account.id, account.exclusions)).not.toBeNull();
        if (account.journal) expect(p.journal.merge(account.id, account.journal)).not.toBeNull();
    }
    p.backup.finish(restored.accounts.map((account) => account.id));
    return { inspected, restored };
}
// Всё, что человек потерял бы с диском: файлы как есть и хранилище рекомендаций через свой API
function snapshot(p: Profile, user = USER): Record<string, unknown> {
    p.index.sync(user);
    const files: Record<string, string> = {};
    for (const name of readdirSync(p.directory).sort())
        if (/\.(json|jsonl)$/.test(name) && !name.endsWith('.tmp')) files[name] = readFileSync(join(p.directory, name), 'utf8');
    return { files, recommend: p.recommend.exportBackup(user), plays: p.index.tastePlays(user, 0).length };
}
function craft(parts: Array<{ name: string; account: number; bytes: Buffer }>, patch: Record<string, unknown> = {}, head = 'SCBACKUP 1'): Buffer {
    const manifest = {
        format: 'soundcloud-desktop-backup', version: 1, app: APP, created: T0, accounts: [USER],
        parts: parts.map((part) => ({ name: part.name, account: part.account, size: part.bytes.length, count: 1, sha256: createHash('sha256').update(part.bytes).digest('hex') })),
        ...patch,
    };
    return gzipSync(Buffer.concat([Buffer.from(head + '\n' + JSON.stringify(manifest) + '\n', 'utf8'), ...parts.map((part) => part.bytes)]));
}

it('A23: копия переносит историю, вкус, отметки, подборки, архив радара и настройки на чистый профиль, индекс собирается заново', () => {
    const source = profile();
    seed(source);
    const file = save(source);
    expect(existsSync(file + '.part')).toBe(false);
    // В файле нет пароля и шифра прокси, адреса вебхука и списка аккаунтов клиента
    const unpacked = gunzipSync(readFileSync(file)).toString('utf8');
    for (const secret of ['secret-pass', 'djEw-cipher', 'hook.example', 'acc_1', 'currentAccountId', 'gpuCompatibilityMode']) expect(unpacked).not.toContain(secret);
    expect(unpacked.startsWith('SCBACKUP 1\n')).toBe(true);

    // Папка данных удалена: новый профиль пустой
    const fresh = profile();
    const { inspected, restored } = restoreAll(fresh, file);
    expect(inspected.summary).toMatchObject({
        version: 1, created: T0 + 120 * DAY, app: APP, settings: 5,
        accounts: [{ id: USER, plays: 3, newPlays: 3, firstAt: T0, lastAt: T0 + 40 * DAY, marks: 2, tasteRemoved: 1, journal: 3, mixes: 1, newMixes: 1, editions: 1, newEditions: 1, links: 1 }],
    });
    expect(restored.settings).toEqual({ adBlocker: false, siteLanguage: 'en', radarDay: 5, proxyHost: 'proxy.local', homeLayoutApplied: true });
    expect(restored.accounts[0]).toMatchObject({ id: USER, plays: 3, tasteRemoved: 1, mixes: 1, editions: 1, links: 1 });

    expect(new WaveSignals(fresh.directory).load(USER).map((signal) => signal.id)).toEqual([1, 2, 3]);
    expect(fresh.index.tastePlays(USER, 0).map((item) => item.id).sort()).toEqual([1, 2, 3]);
    const marks = fresh.exclusions.load(USER, T0 + 2);
    expect(marks.tracks.map((entry) => entry.id)).toEqual([10]);
    expect(marks.more.map((entry) => entry.id)).toEqual([11]);
    expect(fresh.journal.load(USER)).toEqual([1, 2, 3]);
    expect(JSON.parse(readFileSync(join(fresh.directory, 'taste-overrides-' + USER + '.json'), 'utf8'))).toEqual({ artists: [9], tags: [] });
    expect(fresh.playback.listMixes(USER).map((mix) => mix.title)).toEqual(['Вечер']);
    expect(fresh.recommend.editions(USER)).toMatchObject([{ period: '2026-09-18', revision: 1, items: 1 }]);
    expect(fresh.recommend.recordingLinks(USER)).toEqual([{ a: 'sc:track:1', b: 'sc:track:2', same: true, source: 'user', at: T0 }]);
});

it('A24: восстановление поверх живой истории без дублей, сделанное после копии не теряется, повтор ничего не меняет', () => {
    const p = profile();
    seed(p);
    const file = save(p);
    // После копии: новое прослушивание, «Больше такого» на трек из «Не нравится», новая подборка и ручная ревизия радара
    p.signals.add(USER, [play(T0 + 41 * DAY, 4)]);
    p.signals.flush();
    p.exclusions.set(USER, 'more', { id: 10, title: 'Bad', artist: 'X' }, true, T0 + 50 * DAY);
    p.playback.saveMix(USER, 'Утро', [track(3)]);
    expect(p.recommend.saveEdition(USER, edition('2026-09-18', T0 + 110 * DAY), true)).toMatchObject({ revision: 2 });

    const first = restoreAll(p, file);
    expect(first.inspected.summary.accounts[0]).toMatchObject({ plays: 3, newPlays: 0, newMixes: 0, newEditions: 0 });
    expect(first.restored.accounts[0]).toMatchObject({ plays: 0, mixes: 0, editions: 0, links: 0, tasteRemoved: 0 });
    expect(new WaveSignals(p.directory).load(USER).map((signal) => signal.id)).toEqual([1, 2, 3, 4]);
    expect(p.index.tastePlays(USER, 0)).toHaveLength(4);
    // Более поздняя отметка побеждает: трек остался в «Больше такого», из «Не нравится» не вернулся
    const marks = p.exclusions.load(USER);
    expect(marks.more.map((entry) => entry.id)).toEqual([10, 11]);
    expect(marks.tracks).toEqual([]);
    expect(p.playback.listMixes(USER).map((mix) => mix.title)).toEqual(['Утро', 'Вечер']);
    expect(p.recommend.editions(USER).map((item) => item.revision)).toEqual([2, 1]);

    const before = snapshot(p);
    restoreAll(p, file);
    expect(snapshot(p)).toEqual(before);
});

it('A24: копия с другого компьютера сливается с живой историей: новые записи добавляются, выпуск той же недели встаёт следующей ревизией', () => {
    const laptop = profile();
    seed(laptop);
    laptop.signals.add(USER, [play(T0 + 2 * DAY, 5), play(T0 + 70 * DAY, 6)]);
    laptop.signals.flush();
    laptop.exclusions.set(USER, 'later-track', { id: 12, title: 'Later' }, true, T0 - 30 * DAY);
    const file = save(laptop);

    const desktop = profile();
    seed(desktop);
    // Своя сборка той же недели на втором компьютере: другое время создания
    expect(desktop.recommend.saveEdition(USER, edition('2026-09-25', T0 + 105 * DAY), false)).not.toBeNull();
    const { restored } = restoreAll(desktop, file);
    expect(restored.accounts[0]).toMatchObject({ plays: 2, editions: 0 });
    expect(new WaveSignals(desktop.directory).load(USER).map((signal) => signal.id).sort()).toEqual([1, 2, 3, 5, 6]);
    // Истёкшее «Не сейчас» из копии не возвращается
    expect(desktop.exclusions.load(USER).laterTracks).toEqual([]);
    // Файл нового месяца создан, июньский дописан без повторов
    expect(readdirSync(desktop.directory).filter((name) => name.startsWith('signals-')).sort()).toEqual(['signals-77-2026-06.jsonl', 'signals-77-2026-07.jsonl', 'signals-77-2026-08.jsonl']);
});

it('A25: битый, обрезанный, подменённый, чужой версии, с лишней частью и огромный файл отвергаются, данные не меняются', () => {
    const p = profile();
    seed(p);
    const file = save(p);
    const before = snapshot(p);
    const out = folder('sc-backup-bad-');
    const bad = (name: string, bytes: Buffer): string => {
        const target = join(out, name);
        writeFileSync(target, bytes);
        return target;
    };
    const good = readFileSync(file);
    const raw = gunzipSync(good);
    const reason = (target: string, service = p.backup): string => {
        const outcome = service.inspect(target);
        return outcome.ok ? 'ok' : outcome.reason;
    };
    expect(reason(bad('text.scbackup', Buffer.from('обычный текст')))).toBe('not-backup');
    expect(reason(bad('gzip-text.scbackup', gzipSync(Buffer.from('обычный текст'))))).toBe('not-backup');
    expect(reason(bad('cut.scbackup', good.subarray(0, good.length - 30)))).toBe('damaged');
    // Подмена байта внутри части при той же длине: не сходится SHA-256
    const tampered = Buffer.from(raw);
    tampered[tampered.length - 3] ^= 1;
    expect(reason(bad('tampered.scbackup', gzipSync(tampered)))).toBe('damaged');
    // Лишний байт в конце: размеры частей не сходятся с файлом
    expect(reason(bad('tail.scbackup', gzipSync(Buffer.concat([raw, Buffer.from('x')]))))).toBe('damaged');
    expect(reason(bad('newer.scbackup', gzipSync(Buffer.from(raw.toString('latin1').replace('SCBACKUP 1\n', 'SCBACKUP 2\n'), 'latin1'))))).toBe('newer-format');
    const journal = { name: 'journal', account: USER, bytes: Buffer.from('[1,2]') };
    expect(reason(bad('crafted.scbackup', craft([journal])))).toBe('ok');
    expect(reason(bad('plugins.scbackup', craft([journal, { name: 'plugins', account: USER, bytes: Buffer.from('{}') }])))).toBe('unknown-part');
    expect(reason(bad('path.scbackup', craft([{ name: '../exclusions', account: USER, bytes: Buffer.from('{}') }])))).toBe('unknown-part');
    expect(reason(bad('broken-part.scbackup', craft([{ name: 'mixes', account: USER, bytes: Buffer.from('[{"id":') }])))).toBe('bad-part');
    expect(reason(bad('wrong-type.scbackup', craft([{ name: 'exclusions', account: USER, bytes: Buffer.from('[1]') }])))).toBe('bad-part');
    expect(reason(bad('foreign-account.scbackup', craft([{ name: 'journal', account: OTHER, bytes: Buffer.from('[1]') }])))).toBe('damaged');
    expect(reason(bad('twice.scbackup', craft([journal, journal])))).toBe('damaged');
    expect(reason(bad('settings-account.scbackup', craft([{ name: 'settings', account: USER, bytes: Buffer.from('{}') }])))).toBe('damaged');
    // Предел файла и распакованного объёма; бомба из нулей не распаковывается целиком
    expect(reason(file, profile(undefined, undefined, { ...BACKUP_LIMITS, file: 100 }).backup)).toBe('too-big');
    expect(reason(file, profile(undefined, undefined, { ...BACKUP_LIMITS, unpacked: 200 }).backup)).toBe('too-big');
    const bomb = bad('bomb.scbackup', gzipSync(Buffer.concat([Buffer.from('SCBACKUP 1\n'), Buffer.alloc(8 * 1024 * 1024)])));
    expect(reason(bomb, profile(undefined, undefined, { ...BACKUP_LIMITS, unpacked: 1024 * 1024 }).backup)).toBe('too-big');
    expect(reason(join(out, 'missing.scbackup'))).toBe('no-folder');

    // Восстановление тех же файлов тоже отказывает и ничего не пишет; подмена после проверки ловится по хэшу
    expect(p.backup.restore(bad('text2.scbackup', Buffer.from('x')), 'hash')).toEqual({ ok: false, reason: 'not-backup' });
    expect(p.backup.restore(file, 'другой-хэш')).toEqual({ ok: false, reason: 'changed' });
    expect(snapshot(p)).toEqual(before);
    expect(existsSync(join(p.directory, 'restore-guard'))).toBe(false);
});

it('A26: копия другого аккаунта видна в сводке и ложится в его файлы, текущий аккаунт не смешивается', () => {
    const other = profile();
    seed(other, OTHER);
    const file = save(other);
    const mine = profile();
    seed(mine);
    const before = snapshot(mine);
    const { inspected } = restoreAll(mine, file);
    // Сводка называет аккаунт копии: F1 сравнивает его с вошедшим и предупреждает
    expect(inspected.summary.accounts.map((account) => account.id)).toEqual([OTHER]);
    const after = snapshot(mine) as { files: Record<string, string> };
    const own = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).filter(([name]) => name.includes('-' + USER)));
    expect(own(after.files)).toEqual(own((before as { files: Record<string, string> }).files));
    expect(new WaveSignals(mine.directory).load(OTHER).map((signal) => signal.id)).toEqual([1, 2, 3]);
    expect(new WaveSignals(mine.directory).load(USER).map((signal) => signal.id)).toEqual([1, 2, 3]);
});

it('A26: сбой посреди восстановления возвращает журнал, вкус, подборки, хранилище и индекс к состоянию до него', () => {
    const laptop = profile();
    seed(laptop);
    laptop.signals.add(USER, [play(T0 + 70 * DAY, 6)]);
    laptop.signals.flush();
    expect(laptop.taste.setRemoved(USER, 'tag', 'phonk', true)).toBe(true);
    laptop.playback.saveMix(USER, 'Дорога', [track(4)]);
    expect(laptop.recommend.saveEdition(USER, edition('2026-09-25', T0 + 107 * DAY), false)).not.toBeNull();
    const file = save(laptop);

    for (const failAt of ['taste', 'mixes', 'recommend']) {
        const directory = folder();
        let failing = false;
        const broken = profile(directory, (step) => {
            if (failing && step === failAt) throw Object.assign(new Error('диск полон'), { code: 'ENOSPC' });
        });
        seed(broken);
        failing = true;
        const before = snapshot(broken);
        const inspected = broken.backup.inspect(file);
        if (!inspected.ok) throw new Error(inspected.reason);
        expect(broken.backup.restore(file, inspected.hash)).toEqual({ ok: false, reason: 'no-space' });
        expect(snapshot(broken)).toEqual(before);
        expect(readdirSync(directory).filter((name) => name.startsWith('signals-')).sort()).toEqual(['signals-77-2026-06.jsonl', 'signals-77-2026-07.jsonl']);
    }
    // Без сбоя тот же файл ложится целиком; «Вечер» с ноутбука это другая подборка со своим id
    const healthy = profile();
    seed(healthy);
    expect(restoreAll(healthy, file).restored.accounts[0]).toMatchObject({ plays: 1, tasteRemoved: 1, mixes: 2, editions: 1 });
});

it('A26: откат отметок волны и журнала «Нового» в главном процессе возвращает прежние списки', () => {
    const p = profile();
    seed(p);
    const list = p.exclusions.load(USER);
    const journal = p.journal.load(USER);
    const incoming = { ...list, tracks: [{ id: 50, title: 'New', artist: '', url: '', at: T0 + 60 * DAY }], more: [] };
    const previousMarks = p.exclusions.merge(USER, incoming);
    const previousJournal = p.journal.merge(USER, [40, 41]);
    expect(p.exclusions.load(USER).tracks.map((entry) => entry.id)).toEqual([50, 10]);
    expect(p.journal.load(USER)).toEqual([40, 41, 1, 2, 3]);
    if (!previousMarks || !previousJournal) throw new Error('Слияние не записано');
    expect(p.exclusions.restore(USER, previousMarks)).toBe(true);
    expect(p.journal.restore(USER, previousJournal)).toBe(true);
    expect(new WaveExclusions(p.directory).load(USER)).toEqual(list);
    expect(new WaveJournal(p.directory).load(USER)).toEqual(journal);
});

it('A27: автокопия по сроку, шестая копия вытесняет самую старую, чужие файлы не трогаются, ошибки папки и диска понятны', () => {
    const p = profile();
    seed(p);
    const out = folder('sc-backup-auto-');
    writeFileSync(join(out, 'my-notes.scbackup'), 'моё');
    writeFileSync(join(out, 'soundcloud-backup-notes.txt'), 'моё');
    const names: string[] = [];
    for (let i = 0; i < 6; i++) {
        const at = T0 + i * 60000;
        names.push(backupFileName(at));
        expect(p.backup.save(join(out, backupFileName(at)), SETTINGS, APP, AUTO_BACKUP_KEEP, at)).toMatchObject({ ok: true });
    }
    expect(readdirSync(out).sort()).toEqual([...names.slice(1), 'my-notes.scbackup', 'soundcloud-backup-notes.txt'].sort());
    expect(readBackup(join(out, names[5])).ok).toBe(true);

    expect(p.backup.save(join(out, 'missing', 'copy.scbackup'), SETTINGS, APP)).toEqual({ ok: false, reason: 'no-folder' });
    expect(ioReason(Object.assign(new Error('full'), { code: 'ENOSPC' }))).toBe('no-space');
    expect(ioReason(Object.assign(new Error('denied'), { code: 'EPERM' }))).toBe('no-access');
    expect(ioReason(new Error('other'))).toBe('io-error');

    const now = T0 + 30 * DAY;
    expect(autoBackupDue(true, out, undefined, now)).toBe(true);
    expect(autoBackupDue(true, out, now - 6 * DAY, now)).toBe(false);
    expect(autoBackupDue(true, out, now - 7 * DAY, now)).toBe(true);
    expect(autoBackupDue(false, out, undefined, now)).toBe(false);
    expect(autoBackupDue(true, '', undefined, now)).toBe(false);
    // Часы ушли назад: копия не откладывается навсегда
    expect(autoBackupDue(true, out, now + DAY, now)).toBe(true);
});

it('копия без данных волны сохраняет только настройки и читается обратно', () => {
    const p = profile();
    const file = save(p);
    const inspected = p.backup.inspect(file);
    expect(inspected).toMatchObject({ ok: true, summary: { accounts: [], settings: 5 } });
    expect(p.backup.restore(file, inspected.ok ? inspected.hash : '')).toMatchObject({ ok: true, accounts: [] });
});
