// Резервная копия профиля: файл пишет и читает worker. Главный процесс держит диалоги, путь к выбранному файлу,
// отметки волны, журнал «Нового» и настройки: у них здесь кэш и запись
import path from 'path';
import { randomUUID } from 'crypto';
import type { BackupRestoreOutcome, BackupSaveOutcome } from '../services/backup';
import {
    AUTO_BACKUP_KEEP, BACKUP_EXTENSION, BACKUP_MIGRATION_MARKS, BACKUP_REASONS, BACKUP_SETTING_KEYS, autoBackupDue, backupFileName, isInside,
    type BackupReason,
} from '../services/backupPolicy';
import type { DiagnosticJournal } from '../services/diagnosticJournal';
import type { LibraryService } from '../services/libraryService';
import type { TranslationKeys } from '../services/translationService';
import type { WaveExclusions } from '../services/waveExclusions';
import type { WaveJournal } from '../services/waveJournal';
import type { WaveSignals } from '../services/waveSignals';
import type { HistoryManager } from '../history/historyManager';
import { validateSettingChange, type SettingChange } from '../settings/validateSetting';
import type { IpcRegistry, MessageTarget, SenderCheck, Settings, SitePage } from './ipcTypes';

export interface BackupIpcDeps {
    trustedLocal: SenderCheck;
    store: Settings;
    diagnostics: Pick<DiagnosticJournal, 'record'>;
    library: Pick<LibraryService, 'request' | 'invalidate'>;
    exclusions: Pick<WaveExclusions, 'load' | 'merge' | 'restore' | 'currentUser'>;
    /** Журнал и сигналы пересоздаются при повторном init: берутся в момент операции */
    journal(): Pick<WaveJournal, 'flush' | 'merge' | 'restore'> | null;
    signals(): Pick<WaveSignals, 'flush' | 'pause' | 'resume'> | null;
    history(): Pick<HistoryManager, 'changed'> | null;
    settingsView(): MessageTarget | undefined;
    page(): SitePage | null;
    /** Скрипт на странице сайта: так спрашивается вошедший аккаунт */
    ask(script: string): Promise<unknown>;
    translate(key: TranslationKeys): string;
    dialogs: {
        save(options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue>;
        open(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue>;
    };
    documentsFolder(): string;
    profilePath: string;
    about: { version: string; build: string };
    applySettingChange(change: SettingChange): void;
    /** После восстановления нужна перезагрузка страницы: ждёт язык сайта или сеть */
    reloadNeeded(): boolean;
}

export function registerBackupIpc(ipc: IpcRegistry, deps: BackupIpcDeps): { runAutoBackup(): Promise<void> } {
    const { trustedLocal: isTrustedLocalSender, store, diagnostics, library, exclusions, profilePath } = deps;
    let backupBusy = false;
    let backupPending: { token: string; file: string; hash: string } | null = null;
    const backupState = () => {
        const folder = store.get('backupFolder');
        const lastAt = store.get('backupLastAt');
        const lastError = store.get('backupLastError');
        return {
            folder: typeof folder === 'string' ? folder : '',
            auto: store.get('backupAuto') === true && typeof folder === 'string' && !!folder,
            lastAt: typeof lastAt === 'number' && Number.isFinite(lastAt) ? lastAt : 0,
            lastError: BACKUP_REASONS.find((reason) => reason === lastError) ?? '',
            busy: backupBusy,
        };
    };
    const tasteMarks = (userId: number) => exclusions.load(userId).more.map((entry) => ({ id: entry.id, artist: entry.artistId ?? 0, genre: entry.genre ?? '', tags: entry.tags ?? '', at: entry.at }));
    const backupSettings = (): Record<string, unknown> => {
        const values: Record<string, unknown> = {};
        for (const key of [...BACKUP_SETTING_KEYS, ...BACKUP_MIGRATION_MARKS]) {
            const value = store.get(key);
            if (value !== undefined) values[key] = value;
        }
        return values;
    };
    async function saveBackup(target: string, auto: boolean): Promise<BackupSaveOutcome> {
        if (backupBusy) return { ok: false, reason: 'busy' };
        // Копия внутри папки данных погибла бы вместе с ними
        if (isInside(target, profilePath)) return { ok: false, reason: 'inside-profile' };
        backupBusy = true;
        const started = Date.now();
        try {
            const outcome = await library.request('backupSave', target, backupSettings(), deps.about, auto ? AUTO_BACKUP_KEEP : 0);
            if (outcome.ok) diagnostics.record('backup.saved', { auto, backupMs: Date.now() - started, backupKiB: outcome.size / 1024 });
            else diagnostics.record('backup.failed', { auto, reason: outcome.reason });
            return outcome;
        } catch (error) {
            console.warn('Резервная копия не сохранена', error);
            diagnostics.record('backup.failed', { auto, reason: 'io-error' });
            return { ok: false, reason: 'io-error' };
        } finally {
            backupBusy = false;
        }
    }
    // Автокопия: раз в неделю при запуске, если включена и папка выбрана. Сбой виден в F1, повтор при следующем запуске
    async function runAutoBackup(): Promise<void> {
        const state = backupState();
        if (!autoBackupDue(state.auto, state.folder, store.get('backupLastAt'), Date.now())) return;
        const outcome = await saveBackup(path.join(state.folder, backupFileName(Date.now())), true);
        if (outcome.ok) {
            store.set('backupLastAt', Date.now());
            store.delete('backupLastError');
        } else if (outcome.reason !== 'busy') store.set('backupLastError', outcome.reason);
        deps.settingsView()?.send('backup-state-changed', backupState());
    }
    // Настройки из копии: только прошедшие проверку ключи, отметки переноса напрямую. previous собирает прежние значения для отката
    function applyBackupSettings(values: Record<string, unknown>, previous: Record<string, unknown>): void {
        for (const [key, value] of Object.entries(values)) {
            const before = store.get(key);
            if (before === value) continue;
            if (BACKUP_MIGRATION_MARKS.includes(key)) {
                previous[key] = before;
                if (value === undefined) store.delete(key);
                else store.set(key, value === true);
                continue;
            }
            const change = { key, value };
            if (!validateSettingChange(change)) continue;
            previous[key] = before;
            deps.applySettingChange(change);
        }
    }
    async function restoreBackup(file: string, hash: string): Promise<{ ok: true; plays: number; mixes: number; editions: number; reload: boolean } | { ok: false; reason: BackupReason }> {
        if (backupBusy) return { ok: false, reason: 'busy' };
        backupBusy = true;
        const started = Date.now();
        const failed = (reason: BackupReason): { ok: false; reason: BackupReason } => {
            diagnostics.record('backup.restore-failed', { reason });
            return { ok: false, reason };
        };
        const rollback = (): Promise<void> => library.request('backupRollback').then((clean) => {
            if (!clean) console.warn('Резервная копия: откат прошёл не полностью');
        }, (error: unknown) => console.warn('Резервная копия: откат не выполнен', error));
        // Журнал сигналов пишет только его владелец: на время слияния запись ждёт, события копятся в памяти
        deps.signals()?.flush();
        deps.journal()?.flush();
        deps.signals()?.pause();
        try {
            let outcome: BackupRestoreOutcome;
            try {
                outcome = await library.request('backupRestore', file, hash);
            } catch (error) {
                console.warn('Резервная копия: worker не восстановил данные', error);
                await rollback();
                return failed('io-error');
            }
            if (!outcome.ok) return failed(outcome.reason);
            const undo: Array<() => boolean> = [];
            const previous: Record<string, unknown> = {};
            try {
                for (const account of outcome.accounts) {
                    if (account.exclusions) {
                        const before = exclusions.merge(account.id, account.exclusions);
                        if (!before) throw new Error('Отметки волны не записаны');
                        undo.push(() => exclusions.restore(account.id, before));
                    }
                    const journal = deps.journal();
                    if (account.journal?.length && journal) {
                        const before = journal.merge(account.id, account.journal);
                        if (!before) throw new Error('Журнал «Нового» не записан');
                        undo.push(() => journal.restore(account.id, before));
                    }
                }
                undo.push(() => {
                    applyBackupSettings(previous, {});
                    return true;
                });
                if (outcome.settings) applyBackupSettings(outcome.settings, previous);
            } catch (error) {
                // Сбой посередине: всё возвращается к состоянию до восстановления
                console.warn('Резервная копия: восстановление отменено, данные возвращаются', error);
                for (const step of undo.reverse()) {
                    try {
                        if (!step()) console.warn('Резервная копия: часть отката не записана');
                    } catch (cause) {
                        console.warn('Резервная копия: часть отката не выполнена', cause);
                    }
                }
                await rollback();
                return failed('io-error');
            }
            const ids = outcome.accounts.map((account) => account.id);
            await library.request('backupFinish', ids).catch((error: unknown) => console.warn('Резервная копия: индекс истории не пересобран', error));
            // Волна, история и F1 перечитывают данные; играющий трек не трогается
            for (const id of ids) library.invalidate(id, tasteMarks(id));
            deps.settingsView()?.send('wave-exclusions-changed');
            const page = deps.page();
            if (page && !page.isDestroyed())
                void page.executeJavaScript('window.__scWaveExclusionsChanged?.();window.__scRadarReload?.()').catch((error: unknown) => {
                    console.warn('Волна не перечитала восстановленные данные', error);
                });
            deps.history()?.changed();
            diagnostics.record('backup.restored', { backupMs: Date.now() - started });
            const restored = outcome.accounts;
            const sum = (pick: (account: (typeof restored)[number]) => number): number => restored.reduce((total, account) => total + pick(account), 0);
            return { ok: true, plays: sum((account) => account.plays), mixes: sum((account) => account.mixes), editions: sum((account) => account.editions), reload: deps.reloadNeeded() };
        } finally {
            deps.signals()?.resume();
            backupBusy = false;
        }
    }
    const backupFilter = (): Electron.FileFilter[] => [{ name: deps.translate('backupFileType'), extensions: [BACKUP_EXTENSION] }];
    ipc.handle('backup-state', (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        return backupState();
    });
    ipc.handle('backup-save', async (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        const result = await deps.dialogs.save({
            title: deps.translate('backupSaveTitle'),
            defaultPath: path.join(backupState().folder || deps.documentsFolder(), backupFileName(Date.now())),
            filters: backupFilter(),
        });
        if (result.canceled || !result.filePath) return null;
        const target = path.extname(result.filePath).toLowerCase() === '.' + BACKUP_EXTENSION ? result.filePath : result.filePath + '.' + BACKUP_EXTENSION;
        return saveBackup(target, false);
    });
    // Выбор файла: worker проверяет его и считает, что нового; путь остаётся здесь за одноразовым ключом
    ipc.handle('backup-pick', async (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        const result = await deps.dialogs.open({
            title: deps.translate('backupOpenTitle'),
            defaultPath: backupState().folder || deps.documentsFolder(),
            properties: ['openFile'],
            filters: backupFilter(),
        });
        const file = result.canceled ? undefined : result.filePaths[0];
        if (!file) return null;
        if (backupBusy) return { ok: false, reason: 'busy' };
        backupBusy = true;
        backupPending = null;
        try {
            const outcome = await library.request('backupInspect', file);
            if (!outcome.ok) return outcome;
            const token = randomUUID();
            backupPending = { token, file, hash: outcome.hash };
            let current = 0;
            try {
                const id = await deps.ask('window.__scWhoAmI ? window.__scWhoAmI() : 0');
                current = typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : exclusions.currentUser();
            } catch (error) {
                console.warn('Резервная копия: вошедший аккаунт не определён', error);
                current = exclusions.currentUser();
            }
            const settingsChanged = Object.entries(outcome.settings).filter(([key, value]) => !BACKUP_MIGRATION_MARKS.includes(key) && store.get(key) !== value).length;
            return { ok: true, token, summary: outcome.summary, current, settingsChanged };
        } catch (error) {
            console.warn('Резервная копия не проверена', error);
            return { ok: false, reason: 'io-error' };
        } finally {
            backupBusy = false;
        }
    });
    ipc.handle('backup-restore', async (event, token: unknown) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        const pending = backupPending;
        if (!pending || typeof token !== 'string' || token !== pending.token) return { ok: false, reason: 'changed' };
        backupPending = null;
        return restoreBackup(pending.file, pending.hash);
    });
    ipc.handle('backup-folder', async (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        const result = await deps.dialogs.open({
            title: deps.translate('backupFolderTitle'),
            defaultPath: backupState().folder || deps.documentsFolder(),
            properties: ['openDirectory', 'createDirectory'],
        });
        const folder = result.canceled ? undefined : result.filePaths[0];
        if (!folder) return backupState();
        if (isInside(folder, profilePath)) return { ...backupState(), rejected: 'inside-profile' };
        store.set('backupFolder', folder);
        store.delete('backupLastError');
        return backupState();
    });
    ipc.handle('backup-auto', (event, value: unknown) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        if (typeof value !== 'boolean') throw new Error('Неверное значение автокопии');
        if (value && !backupState().folder) return backupState();
        store.set('backupAuto', value);
        // Включили впервые или давно не было копии: первая делается сразу, а не при следующем запуске
        if (value) void runAutoBackup().catch((error: unknown) => console.warn('Автокопия не выполнена', error));
        return backupState();
    });
    return { runAutoBackup };
}
