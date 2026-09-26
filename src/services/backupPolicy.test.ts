import { expect, it } from 'vitest';
import { BACKUP_MIGRATION_MARKS, BACKUP_SETTING_KEYS, backupFileName, cleanBackupSettings, isInside } from './backupPolicy';

it('настройки копии: только свои ключи с проверенными значениями, секреты и служебное отбрасываются', () => {
    expect(cleanBackupSettings({
        adBlocker: true, siteLanguage: 'de', radarTime: '25:00', radarZone: 'Europe/Moscow', proxyPort: '99999', proxyHost: 'a\nb', discordLine1: '{track}',
        proxyPassword: 'secret', proxyPasswordEncrypted: 'cipher', webhookUrl: 'https://hook.example', accounts: [], currentAccountId: 'acc_1',
        gpuCompatibilityMode: 'on', gpuCompatibility: true, theme: 'light', backupFolder: 'D:/x', adBlockerDefaultApplied: true, homeLayoutApplied: 'yes',
        homeWave: false, statusDisplayType: 2, webhookTriggerPercentage: 101,
    })).toEqual({ adBlocker: true, radarZone: 'Europe/Moscow', discordLine1: '{track}', adBlockerDefaultApplied: true, homeWave: false, statusDisplayType: 2 });
    // «Моя музыка» в копии: выбор источников и режим, битый выбор отбрасывается целиком
    expect(cleanBackupSettings({ myMusic: { mode: 'smart', pick: { 77: ['likes', 'playlist:8'] } } })).toEqual({ myMusic: { mode: 'smart', pick: { 77: ['likes', 'playlist:8'] } } });
    expect(cleanBackupSettings({ myMusic: { mode: 'smart', pick: { 77: ['../x'] } } })).toEqual({});
    expect(cleanBackupSettings(null)).toEqual({});
    expect(cleanBackupSettings(['adBlocker'])).toEqual({});
    for (const key of ['proxyPassword', 'webhookUrl', 'accounts', 'currentAccountId', 'gpuCompatibilityMode', 'theme']) expect(BACKUP_SETTING_KEYS).not.toContain(key);
    expect(BACKUP_MIGRATION_MARKS).toEqual(['adBlockerDefaultApplied', 'homeLayoutApplied']);
});

it('папка данных клиента и всё внутри неё не годятся для копии, соседняя папка с похожим именем годится', () => {
    const profile = 'C:\\Users\\me\\AppData\\Roaming\\soundcloud-desktop';
    expect(isInside(profile, profile, true)).toBe(true);
    expect(isInside('c:\\users\\ME\\appdata\\roaming\\SoundCloud-Desktop\\wave\\x.scbackup', profile, true)).toBe(true);
    expect(isInside('C:\\Users\\me\\AppData\\Roaming\\soundcloud-desktop-backups\\x.scbackup', profile, true)).toBe(false);
    expect(isInside('D:\\Backups\\x.scbackup', profile, true)).toBe(false);
    expect(isInside(profile + '\\..data\\x.scbackup', profile, true)).toBe(true);
    expect(isInside('C:\\Users\\me\\AppData\\Roaming\\x.scbackup', profile, true)).toBe(false);
    expect(isInside('/home/me/.config/soundcloud-desktop/x', '/home/me/.config/soundcloud-desktop', false)).toBe(true);
    expect(isInside('/home/me/.config/SoundCloud-desktop/x', '/home/me/.config/soundcloud-desktop', false)).toBe(false);
});

it('имя автокопии по местному времени до минуты', () => {
    expect(backupFileName(new Date(2026, 8, 5, 7, 3).getTime())).toBe('soundcloud-backup-2026-09-05-0703.scbackup');
});
