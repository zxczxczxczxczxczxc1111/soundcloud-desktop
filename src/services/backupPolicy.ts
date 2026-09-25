import { readdirSync, rmSync, statSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';
import { validateSettingChange } from '../settings/validateSetting';
import { HOME_BLOCK_KEYS } from './homeBlocks';

// Правила резервной копии профиля без чтения самих данных: что из настроек входит, как зовутся файлы
// автокопии и какие причины отказа видит человек. Файл общий для главного процесса и worker

/**
 * Настройки в копии: всё, что задаёт человек. Не входят пароль прокси (шифруется под эту установку Windows),
 * адрес вебхука, список аккаунтов, режим видеокарты, служебные отметки и сами настройки копии
 */
export const BACKUP_SETTING_KEYS: readonly string[] = [
    'adBlocker', 'proxyEnabled', 'proxyHost', 'proxyPort', 'proxyUsername', 'webhookEnabled', 'webhookTriggerPercentage',
    'discordRichPresence', 'displaySCSmallIcon', 'displayGithubLink', 'displayButtons', 'statusDisplayType', 'discordIncognito', 'richPresencePreviewEnabled',
    'discordLine1', 'discordLine2', 'discordCoverText', 'discordHiddenArtists', 'discordHiddenGenres',
    'minimizeToTray', 'navigationControlsEnabled', 'trackParserEnabled', 'autoUpdateEnabled', 'reduceMotion', 'fullShuffle', 'siteLanguage',
    'hidePromotions', 'hideEventsNearYou', 'hideArtistUpsells', 'hideHeaderExtras', ...HOME_BLOCK_KEYS, 'radarDay', 'radarTime', 'radarZone',
];
/** Отметки переноса настроек: без них перенос при следующем запуске затёр бы восстановленное */
export const BACKUP_MIGRATION_MARKS: readonly string[] = ['adBlockerDefaultApplied', 'homeLayoutApplied'];

/** Настройки из копии недоверенные: остаются только ключи из списка, прошедшие ту же проверку, что и смена в F1 */
export function cleanBackupSettings(input: unknown): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
    const source = input as Record<string, unknown>;
    const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(source, key);
    for (const key of BACKUP_SETTING_KEYS) if (has(key) && validateSettingChange({ key, value: source[key] })) result[key] = source[key];
    for (const key of BACKUP_MIGRATION_MARKS) if (has(key) && source[key] === true) result[key] = true;
    return result;
}

export const BACKUP_EXTENSION = 'scbackup';
export const AUTO_BACKUP_EVERY = 7 * 86400000;
export const AUTO_BACKUP_KEEP = 5;
/** Автокопия ждёт после запуска, чтобы не спорить со стартом страницы */
export const AUTO_BACKUP_DELAY = 60000;
const AUTO_NAME = /^soundcloud-backup-\d{4}-\d{2}-\d{2}-\d{4}\.scbackup$/;
const AUTO_PART = /^soundcloud-backup-\d{4}-\d{2}-\d{2}-\d{4}\.scbackup\.part$/;

/** Имя копии по местному времени: soundcloud-backup-ГГГГ-ММ-ДД-ЧЧММ.scbackup */
export function backupFileName(at: number): string {
    const date = new Date(at);
    const pad = (value: number): string => String(value).padStart(2, '0');
    return 'soundcloud-backup-' + date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + '-' + pad(date.getHours()) + pad(date.getMinutes()) + '.' + BACKUP_EXTENSION;
}
export function autoBackupDue(enabled: boolean, folder: unknown, lastAt: unknown, now: number): boolean {
    if (!enabled || typeof folder !== 'string' || !folder) return false;
    return typeof lastAt !== 'number' || !Number.isFinite(lastAt) || lastAt > now || now - lastAt >= AUTO_BACKUP_EVERY;
}

/** Путь внутри папки или совпадает с ней; на Windows без учёта регистра */
export function isInside(target: string, folder: string, windows = process.platform === 'win32'): boolean {
    const paths = windows ? win32 : posix;
    const path = paths.relative(windows ? folder.toLowerCase() : folder, windows ? target.toLowerCase() : target);
    return path === '' || (path !== '..' && !path.startsWith('..' + paths.sep) && !paths.isAbsolute(path));
}

/**
 * Хранить keep последних автокопий. Удаляются только свои файлы в этой папке по шаблону имени, чужие не трогаются.
 * Возвращает число удалённых
 */
export function pruneBackups(folder: string, keep: number, current: string, now = Date.now()): number {
    const names = readdirSync(folder);
    let removed = 0;
    const old = names.filter((name) => AUTO_NAME.test(name)).sort().reverse().slice(Math.max(keep, 1));
    // Обрывок копии, прерванной выходом из клиента, старше часа
    const parts = names.filter((name) => AUTO_PART.test(name) && name !== current + '.part').filter((name) => {
        try {
            return now - statSync(join(folder, name)).mtimeMs > 3600000;
        } catch (error) {
            console.warn('Резервная копия: обрывок не проверен', error);
            return false;
        }
    });
    for (const name of [...old, ...parts]) {
        if (name === current) continue;
        try {
            rmSync(join(folder, name), { force: true });
            removed++;
        } catch (error) {
            console.warn('Резервная копия: старая копия не удалена', error);
        }
    }
    return removed;
}

export type BackupReason =
    | 'not-backup' | 'newer-format' | 'damaged' | 'too-big' | 'unknown-part' | 'bad-part' | 'changed'
    | 'inside-profile' | 'no-folder' | 'no-space' | 'no-access' | 'io-error' | 'busy';
export const BACKUP_REASONS: readonly BackupReason[] = [
    'not-backup', 'newer-format', 'damaged', 'too-big', 'unknown-part', 'bad-part', 'changed', 'inside-profile', 'no-folder', 'no-space', 'no-access', 'io-error', 'busy',
];
/** Ошибка файловой системы в причину для человека: папки нет, диск полон, нет прав */
export function ioReason(error: unknown): BackupReason {
    const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'no-folder';
    if (code === 'ENOSPC' || code === 'EDQUOT') return 'no-space';
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || code === 'EBUSY') return 'no-access';
    return 'io-error';
}
