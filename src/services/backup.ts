import { createHash } from 'node:crypto';
import { closeSync, copyFileSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { PlaySignal } from '../types';
import { cleanBackupSettings, ioReason, pruneBackups, type BackupReason } from './backupPolicy';
import type { HistoryIndex } from './historyIndex';
import { cleanMixes, type LocalMix, type PlaybackStore } from './playbackStore';
import { cleanRecommendBackup, type RecommendBackup, type RecommendStore } from './recommendStore';
import { cleanTasteOverrides, type TasteOverrides, type TasteService } from './tasteModel';
import { cleanExclusionList, type WaveExclusionList } from './waveExclusions';
import { cleanJournal } from './waveJournal';
import { signalMonth, text, validateSignal, WaveSignals } from './waveSignals';

// Резервная копия профиля (раздел 4.5 плана): один файл, сжатый gzip. Внутри строка «SCBACKUP <версия>», манифест
// одной строкой JSON и части подряд. Работает в worker: главный поток журнал не читает и не разбирает.
// Файл недоверенный: пределы размера, белый список частей, SHA-256 каждой части и те же проверки, что при обычном чтении.
// Отметки волны и журнал «Нового» сливает главный процесс: у него их кэш и запись

export const BACKUP_VERSION = 1;
const FORMAT = 'soundcloud-desktop-backup';
const MB = 1024 * 1024;
export const BACKUP_LIMITS = { file: 256 * MB, unpacked: 1024 * MB, part: 256 * MB, parts: 5000, manifest: MB };
export type BackupLimits = typeof BACKUP_LIMITS;
const PART_NAME = /^(?:settings|exclusions|taste-overrides|journal|mixes|recommend|signals-\d{4}-\d{2})$/;
const SIGNAL_FILE = /^signals-(\d+)-(\d{4}-\d{2})\.jsonl$/;
const ACCOUNT_FILE = /^(?:signals-(\d+)-\d{4}-\d{2}\.jsonl|(?:exclusions|taste-overrides|journal|mixes)-(\d+)\.json|recommend-(\d+)\.sqlite)$/;
const GUARD_FILE = /^(?:signals-\d+-\d{4}-\d{2}\.jsonl|taste-overrides-\d+\.json|mixes-\d+\.json)$/;
const GUARD = 'restore-guard';

const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');
const signalKey = (signal: PlaySignal): string => signal.at + ':' + signal.id;
const errorCode = (error: unknown): unknown => (error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined);

export interface BackupPart {
    name: string;
    /** 0 у настроек, у остальных id пользователя SoundCloud */
    account: number;
    size: number;
    count: number;
    sha256: string;
}
export interface BackupManifest {
    format: string;
    version: number;
    app: { version: string; build: string };
    created: number;
    accounts: number[];
    parts: BackupPart[];
}
export interface BackupAccount {
    id: number;
    signals: PlaySignal[];
    exclusions: WaveExclusionList | null;
    overrides: TasteOverrides | null;
    journal: number[] | null;
    mixes: LocalMix[] | null;
    recommend: RecommendBackup | null;
}
export interface ParsedBackup {
    manifest: BackupManifest;
    /** SHA-256 всего файла: восстановление пишет только тот файл, который человек видел в сводке */
    hash: string;
    size: number;
    settings: Record<string, unknown> | null;
    accounts: BackupAccount[];
}
export type BackupFailure = { ok: false; reason: BackupReason };
const fail = (reason: BackupReason): BackupFailure => ({ ok: false, reason });

export interface BackupAccountSummary {
    id: number;
    plays: number;
    /** Прослушиваний, которых в журнале ещё нет */
    newPlays: number;
    firstAt: number;
    lastAt: number;
    marks: number;
    tasteRemoved: number;
    journal: number;
    mixes: number;
    newMixes: number;
    editions: number;
    newEditions: number;
    links: number;
}
export interface BackupSummary {
    version: number;
    created: number;
    app: { version: string; build: string };
    size: number;
    accounts: BackupAccountSummary[];
    settings: number;
}
export type BackupSaveOutcome = { ok: true; file: string; size: number; accounts: number; plays: number } | BackupFailure;
export type BackupInspectOutcome = { ok: true; hash: string; summary: BackupSummary; settings: Record<string, unknown> } | BackupFailure;
export interface RestoredAccount {
    id: number;
    /** Отметки и журнал «Нового» сливает главный процесс */
    exclusions: WaveExclusionList | null;
    journal: number[] | null;
    plays: number;
    tasteRemoved: number;
    mixes: number;
    editions: number;
    links: number;
}
export type BackupRestoreOutcome = { ok: true; accounts: RestoredAccount[]; settings: Record<string, unknown> | null } | BackupFailure;

function cleanManifest(value: unknown, version: number, limits: BackupLimits): BackupManifest | BackupReason {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'damaged';
    const source = value as Record<string, unknown>;
    const app = source.app && typeof source.app === 'object' ? (source.app as Record<string, unknown>) : {};
    if (source.format !== FORMAT || source.version !== version || !isId(source.created)) return 'damaged';
    if (!Array.isArray(source.accounts) || source.accounts.length > 1000 || !source.accounts.every(isId)) return 'damaged';
    const accounts = new Set<number>(source.accounts);
    if (accounts.size !== source.accounts.length || !Array.isArray(source.parts)) return 'damaged';
    if (source.parts.length > limits.parts) return 'too-big';
    const parts: BackupPart[] = [];
    const seen = new Set<string>();
    for (const raw of source.parts) {
        const part = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        if (typeof part.name !== 'string' || part.name.length > 64) return 'damaged';
        if (!PART_NAME.test(part.name)) return 'unknown-part';
        const account = part.account;
        if (!isCount(account) || (part.name === 'settings' ? account !== 0 : !accounts.has(account))) return 'damaged';
        if (!isCount(part.size) || !isCount(part.count) || typeof part.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(part.sha256)) return 'damaged';
        if (part.size > limits.part) return 'too-big';
        const key = part.name + ':' + account;
        if (seen.has(key)) return 'damaged';
        seen.add(key);
        parts.push({ name: part.name, account, size: part.size, count: part.count, sha256: part.sha256 });
    }
    return { format: FORMAT, version, app: { version: text(app.version, 40), build: text(app.build, 64) }, created: source.created, accounts: [...accounts], parts };
}

// Часть проходит проверку своего владельца: журнал построчно, как WaveSignals, остальное как при чтении файла
function readPart(part: BackupPart, bytes: Buffer, settings: { value: Record<string, unknown> | null }, account: BackupAccount | undefined): boolean {
    const content = bytes.toString('utf8');
    if (part.name.startsWith('signals-')) {
        if (!account) return false;
        for (const line of content.split('\n')) {
            if (!line) continue;
            let parsed: unknown;
            try {
                parsed = JSON.parse(line);
            } catch {
                return false;
            }
            // Запись, которую эта версия не понимает, пропускается, как при обычном чтении журнала
            const signal = validateSignal(parsed, Infinity);
            if (signal) account.signals.push(signal);
        }
        return true;
    }
    let value: unknown;
    try {
        value = JSON.parse(content);
    } catch {
        return false;
    }
    const isObject = !!value && typeof value === 'object' && !Array.isArray(value);
    if (part.name === 'settings') {
        if (!isObject) return false;
        settings.value = cleanBackupSettings(value);
        return true;
    }
    if (!account) return false;
    switch (part.name) {
        case 'exclusions': account.exclusions = cleanExclusionList(value); return isObject;
        case 'taste-overrides': account.overrides = cleanTasteOverrides(value); return isObject;
        case 'journal': account.journal = cleanJournal(value); return Array.isArray(value);
        case 'mixes': account.mixes = cleanMixes(value); return Array.isArray(value);
        case 'recommend': account.recommend = cleanRecommendBackup(value); return account.recommend !== null;
        default: return false;
    }
}

/** Прочитать и проверить файл копии целиком. Ничего не пишет */
export function readBackup(file: string, limits: BackupLimits = BACKUP_LIMITS): { ok: true; backup: ParsedBackup } | BackupFailure {
    let raw: Buffer;
    try {
        if (statSync(file).size > limits.file) return fail('too-big');
        raw = readFileSync(file);
    } catch (error) {
        return fail(ioReason(error));
    }
    if (raw.length > limits.file) return fail('too-big');
    if (raw.length < 2 || raw[0] !== 0x1f || raw[1] !== 0x8b) return fail('not-backup');
    let data: Buffer;
    try {
        data = gunzipSync(raw, { maxOutputLength: limits.unpacked });
    } catch (error) {
        return fail(errorCode(error) === 'ERR_BUFFER_TOO_LARGE' || error instanceof RangeError ? 'too-big' : 'damaged');
    }
    const magic = /^SCBACKUP (\d{1,6})\n/.exec(data.subarray(0, 16).toString('latin1'));
    if (!magic) return fail('not-backup');
    const version = Number(magic[1]);
    if (version > BACKUP_VERSION) return fail('newer-format');
    if (version < 1) return fail('not-backup');
    const start = magic[0].length;
    const end = data.indexOf(0x0a, start);
    if (end < 0 || end - start > limits.manifest) return fail('damaged');
    let manifest: BackupManifest | BackupReason;
    try {
        manifest = cleanManifest(JSON.parse(data.subarray(start, end).toString('utf8')), version, limits);
    } catch {
        return fail('damaged');
    }
    if (typeof manifest === 'string') return fail(manifest);
    let offset = end + 1;
    if (offset + manifest.parts.reduce((sum, part) => sum + part.size, 0) !== data.length) return fail('damaged');
    const accounts = new Map<number, BackupAccount>(manifest.accounts.map((id) => [id, { id, signals: [], exclusions: null, overrides: null, journal: null, mixes: null, recommend: null }]));
    const settings: { value: Record<string, unknown> | null } = { value: null };
    for (const part of manifest.parts) {
        const bytes = data.subarray(offset, offset + part.size);
        offset += part.size;
        if (sha256(bytes) !== part.sha256) return fail('damaged');
        if (!readPart(part, bytes, settings, accounts.get(part.account))) return fail('bad-part');
    }
    return { ok: true, backup: { manifest, hash: sha256(raw), size: raw.length, settings: settings.value, accounts: [...accounts.values()] } };
}

function writeDurable(file: string, data: Buffer): void {
    const handle = openSync(file, 'w');
    try {
        let written = 0;
        while (written < data.length) written += writeSync(handle, data, written, data.length - written);
        fsyncSync(handle);
    } finally {
        closeSync(handle);
    }
}

interface GuardRecord {
    accounts: number[];
    files: Array<{ name: string; saved: boolean }>;
    recommend: Array<{ account: number; saved: boolean }>;
}
function cleanGuard(value: unknown): GuardRecord | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as Record<string, unknown>;
    if (!Array.isArray(source.accounts) || !source.accounts.every(isId) || !Array.isArray(source.files) || !Array.isArray(source.recommend)) return null;
    const files: GuardRecord['files'] = [];
    for (const raw of source.files) {
        const file = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        // Имена только свои: откат не пишет туда, куда указал бы испорченный файл
        if (typeof file.name !== 'string' || !GUARD_FILE.test(file.name) || typeof file.saved !== 'boolean') return null;
        files.push({ name: file.name, saved: file.saved });
    }
    const recommend: GuardRecord['recommend'] = [];
    for (const raw of source.recommend) {
        const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        if (!isId(item.account) || typeof item.saved !== 'boolean') return null;
        recommend.push({ account: item.account, saved: item.saved });
    }
    return { accounts: source.accounts, files, recommend };
}

export interface BackupDeps {
    playback: PlaybackStore;
    recommend: RecommendStore;
    index: HistoryIndex;
    taste: TasteService;
}

export class BackupService {
    /** onStep: для проверки сбоя посреди восстановления */
    constructor(private directory: string, private deps: BackupDeps, private limits: BackupLimits = BACKUP_LIMITS, private onStep: (step: string) => void = () => undefined) {}

    private names(): string[] {
        try {
            return readdirSync(this.directory);
        } catch (error) {
            if (errorCode(error) === 'ENOENT') return [];
            throw error;
        }
    }
    private accountsOnDisk(names: string[]): number[] {
        const ids = new Set<number>();
        for (const name of names) {
            const match = ACCOUNT_FILE.exec(name);
            const id = Number(match?.slice(1).find(Boolean));
            if (isId(id)) ids.add(id);
        }
        return [...ids].sort((a, b) => a - b);
    }
    /** JSON-файл аккаунта; нет файла или он испорчен, как при обычном чтении: null */
    private readJson(name: string): unknown {
        try {
            return JSON.parse(readFileSync(join(this.directory, name), 'utf8'));
        } catch (error) {
            if (errorCode(error) === 'ENOENT') return null;
            if (error instanceof SyntaxError) {
                console.warn('Резервная копия: файл испорчен и пропущен: ' + name, error);
                return null;
            }
            throw error;
        }
    }
    private collect(settings: unknown): Array<{ name: string; account: number; bytes: Buffer; count: number }> {
        const parts: Array<{ name: string; account: number; bytes: Buffer; count: number }> = [];
        const json = (name: string, account: number, value: unknown, count: number): void => {
            if (count || name === 'settings') parts.push({ name, account, bytes: Buffer.from(JSON.stringify(value), 'utf8'), count });
        };
        const cleanSettings = cleanBackupSettings(settings);
        json('settings', 0, cleanSettings, Object.keys(cleanSettings).length);
        const names = this.names().sort();
        for (const id of this.accountsOnDisk(names)) {
            for (const name of names) {
                const match = SIGNAL_FILE.exec(name);
                if (!match || Number(match[1]) !== id) continue;
                const lines: string[] = [];
                for (const line of readFileSync(join(this.directory, name), 'utf8').split('\n')) {
                    if (!line.trim()) continue;
                    try {
                        const signal = validateSignal(JSON.parse(line), Infinity);
                        if (signal) lines.push(JSON.stringify(signal));
                    } catch {
                        // Строка, оборванная сбоем при записи: обычное чтение журнала её тоже пропускает
                        continue;
                    }
                }
                if (lines.length) parts.push({ name: 'signals-' + match[2], account: id, bytes: Buffer.from(lines.join('\n') + '\n', 'utf8'), count: lines.length });
            }
            const exclusions = this.readJson('exclusions-' + id + '.json');
            if (exclusions !== null) {
                const list = cleanExclusionList(exclusions);
                json('exclusions', id, list, Object.values(list).reduce((sum: number, entries: unknown[]) => sum + entries.length, 0));
            }
            const overrides = this.readJson('taste-overrides-' + id + '.json');
            if (overrides !== null) {
                const value = cleanTasteOverrides(overrides);
                json('taste-overrides', id, value, value.artists.length + value.tags.length);
            }
            const journal = this.readJson('journal-' + id + '.json');
            if (journal !== null) {
                const ids = cleanJournal(journal);
                json('journal', id, ids, ids.length);
            }
            const mixes = this.deps.playback.listMixes(id);
            json('mixes', id, mixes, mixes.length);
            const recommend = this.deps.recommend.exportBackup(id);
            json('recommend', id, recommend, recommend.editions.length + recommend.links.length);
        }
        return parts;
    }

    /**
     * Сохранить копию: части собираются из файлов на диске, файл пишется рядом с целью, читается обратно со сверкой
     * манифеста и только потом переименовывается. keep > 0 у автокопии: в её папке остаются keep последних
     */
    public save(target: string, settings: unknown, app: { version: string; build: string }, keep = 0, now = Date.now()): BackupSaveOutcome {
        const temp = target + '.part';
        try {
            const parts = this.collect(settings);
            const accounts = [...new Set(parts.filter((part) => part.account > 0).map((part) => part.account))].sort((a, b) => a - b);
            const manifest: BackupManifest = {
                format: FORMAT, version: BACKUP_VERSION, app: { version: text(app.version, 40), build: text(app.build, 64) }, created: now, accounts,
                parts: parts.map((part) => ({ name: part.name, account: part.account, size: part.bytes.length, count: part.count, sha256: sha256(part.bytes) })),
            };
            const head = Buffer.from('SCBACKUP ' + BACKUP_VERSION + '\n' + JSON.stringify(manifest) + '\n', 'utf8');
            const unpacked = head.length + parts.reduce((sum, part) => sum + part.bytes.length, 0);
            // Копию, которую не принял бы свой же разбор, не пишем
            if (unpacked > this.limits.unpacked || parts.length > this.limits.parts || parts.some((part) => part.bytes.length > this.limits.part)) return fail('too-big');
            const packed = gzipSync(Buffer.concat([head, ...parts.map((part) => part.bytes)]));
            if (packed.length > this.limits.file) return fail('too-big');
            writeDurable(temp, packed);
            const check = readBackup(temp, this.limits);
            if (!check.ok || JSON.stringify(check.backup.manifest.parts) !== JSON.stringify(manifest.parts)) {
                rmSync(temp, { force: true });
                return fail(check.ok ? 'damaged' : check.reason);
            }
            renameSync(temp, target);
            if (keep > 0) {
                try {
                    pruneBackups(dirname(target), keep, basename(target), now);
                } catch (error) {
                    console.warn('Резервная копия: старые копии не разобраны', error);
                }
            }
            const plays = parts.filter((part) => part.name.startsWith('signals-')).reduce((sum, part) => sum + part.count, 0);
            return { ok: true, file: target, size: packed.length, accounts: accounts.length, plays };
        } catch (error) {
            console.warn('Резервная копия не сохранена', error);
            try {
                rmSync(temp, { force: true });
            } catch (cleanup) {
                console.warn('Резервная копия: незаконченный файл не удалён', cleanup);
            }
            return fail(ioReason(error));
        }
    }

    /** Проверить файл и собрать сводку для подтверждения: что в копии и сколько из этого нового. Ничего не пишет */
    public inspect(file: string): BackupInspectOutcome {
        const read = readBackup(file, this.limits);
        if (!read.ok) return read;
        const { backup } = read;
        const accounts = backup.accounts.map((account): BackupAccountSummary => {
            const known = new Set(new WaveSignals(this.directory).load(account.id).map(signalKey));
            const inCopy = new Set<string>();
            let newPlays = 0;
            let firstAt = 0;
            let lastAt = 0;
            for (const signal of account.signals) {
                const key = signalKey(signal);
                if (inCopy.has(key)) continue;
                inCopy.add(key);
                if (!known.has(key)) newPlays++;
                firstAt = firstAt ? Math.min(firstAt, signal.at) : signal.at;
                lastAt = Math.max(lastAt, signal.at);
            }
            const mixes = new Set(this.deps.playback.listMixes(account.id).map((mix) => mix.id));
            const editions = this.deps.recommend.editionKeys(account.id);
            const exclusions = account.exclusions ? Object.values(account.exclusions).reduce((sum: number, list: unknown[]) => sum + list.length, 0) : 0;
            return {
                id: account.id, plays: inCopy.size, newPlays, firstAt, lastAt, marks: exclusions,
                tasteRemoved: account.overrides ? account.overrides.artists.length + account.overrides.tags.length : 0, journal: account.journal?.length ?? 0,
                mixes: account.mixes?.length ?? 0, newMixes: account.mixes?.filter((mix) => !mixes.has(mix.id)).length ?? 0,
                editions: account.recommend?.editions.length ?? 0,
                newEditions: account.recommend?.editions.filter((edition) => !editions.has(edition.period + '|' + edition.created)).length ?? 0,
                links: account.recommend?.links.length ?? 0,
            };
        });
        const settings = backup.settings ?? {};
        return {
            ok: true, hash: backup.hash, settings,
            summary: { version: backup.manifest.version, created: backup.manifest.created, app: backup.manifest.app, size: backup.size, accounts, settings: Object.keys(settings).length },
        };
    }

    /**
     * Восстановить свою часть: журнал, убранное из вкуса, подборки и хранилище рекомендаций. Файл перечитывается и должен
     * совпасть с проверенным. Перед записью всё затрагиваемое кладётся в защитную копию; сбой откатывает из неё
     */
    public restore(file: string, hash: string): BackupRestoreOutcome {
        const read = readBackup(file, this.limits);
        if (!read.ok) return read;
        const { backup } = read;
        if (backup.hash !== hash) return fail('changed');
        try {
            this.guard(backup.accounts.map((account) => account.id));
        } catch (error) {
            console.warn('Резервная копия: защитная копия не сделана, восстановление не начато', error);
            return fail(ioReason(error));
        }
        const restored: RestoredAccount[] = [];
        try {
            for (const account of backup.accounts) {
                this.onStep('signals');
                const plays = this.mergeSignals(account.id, account.signals);
                this.onStep('taste');
                const tasteRemoved = account.overrides ? this.deps.taste.mergeRemoved(account.id, account.overrides) : 0;
                if (tasteRemoved === null) throw new Error('Убранное из вкуса не записано');
                this.onStep('mixes');
                const mixes = account.mixes ? this.deps.playback.mergeMixes(account.id, account.mixes) : 0;
                this.onStep('recommend');
                const merged = account.recommend ? this.deps.recommend.importBackup(account.id, account.recommend) : { editions: 0, links: 0 };
                restored.push({ id: account.id, exclusions: account.exclusions, journal: account.journal, plays, tasteRemoved, mixes, editions: merged.editions, links: merged.links });
            }
        } catch (error) {
            console.warn('Резервная копия: восстановление прервано, данные возвращаются из защитной копии', error);
            if (!this.rollback()) console.warn('Резервная копия: откат прошёл не полностью');
            return fail(ioReason(error));
        }
        return { ok: true, accounts: restored, settings: backup.settings };
    }

    /** Журнал без дублей по (at, id), как в индексе. Новое дописывается в файл своего месяца заменой файла целиком */
    private mergeSignals(id: number, signals: readonly PlaySignal[]): number {
        const seen = new Set(new WaveSignals(this.directory).load(id).map(signalKey));
        const byMonth = new Map<string, PlaySignal[]>();
        for (const signal of signals) {
            const key = signalKey(signal);
            if (seen.has(key)) continue;
            seen.add(key);
            const month = signalMonth(signal.at);
            const list = byMonth.get(month) ?? [];
            list.push(signal);
            byMonth.set(month, list);
        }
        if (!byMonth.size) return 0;
        mkdirSync(this.directory, { recursive: true });
        let added = 0;
        for (const [month, list] of byMonth) {
            const target = join(this.directory, 'signals-' + id + '-' + month + '.jsonl');
            let current = '';
            try {
                current = readFileSync(target, 'utf8');
            } catch (error) {
                if (errorCode(error) !== 'ENOENT') throw error;
            }
            if (current && !current.endsWith('\n')) current += '\n';
            list.sort((a, b) => a.at - b.at);
            writeFileSync(target + '.tmp', current + list.map((signal) => JSON.stringify(signal)).join('\n') + '\n', 'utf8');
            renameSync(target + '.tmp', target);
            added += list.length;
        }
        return added;
    }

    /** Защитная копия всего, что пишет worker: файлы журнала, вкус, подборки и хранилище рекомендаций. Прежняя заменяется */
    private guard(ids: number[]): void {
        mkdirSync(this.directory, { recursive: true });
        const folder = join(this.directory, GUARD);
        rmSync(folder, { recursive: true, force: true });
        mkdirSync(folder, { recursive: true });
        const names = this.names();
        const record: GuardRecord = { accounts: ids, files: [], recommend: [] };
        for (const id of ids) {
            const own = names.filter((name) => Number(SIGNAL_FILE.exec(name)?.[1]) === id);
            for (const name of [...own, 'taste-overrides-' + id + '.json', 'mixes-' + id + '.json']) {
                const saved = names.includes(name);
                if (saved) copyFileSync(join(this.directory, name), join(folder, name));
                record.files.push({ name, saved });
            }
            record.recommend.push({ account: id, saved: this.deps.recommend.snapshot(id, join(folder, 'recommend-' + id + '.sqlite')) });
        }
        // Запись о защитной копии ложится последней: без неё откат не начнётся по половине копии
        writeFileSync(join(folder, 'guard.json.tmp'), JSON.stringify(record), 'utf8');
        renameSync(join(folder, 'guard.json.tmp'), join(folder, 'guard.json'));
    }

    /** Вернуть файлы worker из защитной копии. false, если её нет или часть файлов не вернулась */
    public rollback(): boolean {
        const folder = join(this.directory, GUARD);
        let record: GuardRecord | null;
        try {
            record = cleanGuard(JSON.parse(readFileSync(join(folder, 'guard.json'), 'utf8')));
        } catch (error) {
            console.warn('Резервная копия: защитной копии нет', error);
            return false;
        }
        if (!record) return false;
        let clean = true;
        const step = (label: string, work: () => void): void => {
            try {
                work();
            } catch (error) {
                clean = false;
                console.warn('Резервная копия: не откачено: ' + label, error);
            }
        };
        const saved = new Set(record.files.filter((file) => file.saved).map((file) => file.name));
        // Месяцы журнала, которых до восстановления не было
        for (const id of record.accounts)
            step('журнал ' + id, () => {
                for (const name of this.names()) if (Number(SIGNAL_FILE.exec(name)?.[1]) === id && !saved.has(name)) rmSync(join(this.directory, name), { force: true });
            });
        for (const file of record.files)
            step(file.name, () => {
                const target = join(this.directory, file.name);
                if (!file.saved) {
                    rmSync(target, { force: true });
                    return;
                }
                copyFileSync(join(folder, file.name), target + '.tmp');
                renameSync(target + '.tmp', target);
            });
        for (const item of record.recommend)
            step('рекомендации ' + item.account, () => this.deps.recommend.replaceWith(item.account, item.saved ? join(folder, 'recommend-' + item.account + '.sqlite') : null));
        for (const id of record.accounts) {
            this.deps.taste.forget(id);
            // Индекс мог успеть взять восстановленные записи: собирается заново
            step('индекс ' + id, () => this.deps.index.reindex(id, true));
        }
        return clean;
    }

    /** После удачного восстановления: индекс перечитывает журнал целиком, вкус считается заново */
    public finish(ids: readonly number[]): void {
        for (const id of ids) {
            if (!isId(id)) continue;
            this.deps.taste.forget(id);
            this.deps.index.reindex(id);
        }
    }
}
