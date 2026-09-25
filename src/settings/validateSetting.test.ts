import { expect, it } from 'vitest';
import { validateSettingChange } from './validateSetting';
it('режим NVIDIA принимает только три явных значения', () => {
    for (const value of ['auto', 'on', 'off']) expect(validateSettingChange({ key: 'gpuCompatibilityMode', value })).toBe(true);
    for (const value of [true, false, null, 'nvidia', 1]) expect(validateSettingChange({ key: 'gpuCompatibilityMode', value })).toBe(false);
    expect(validateSettingChange({ key: 'gpuCompatibility', value: true })).toBe(false);
});
it('разрешает обычные настройки и отклоняет неизвестные ключи и неверные типы', () => {
    for (const input of [{ key: 'proxyEnabled', value: true }, { key: 'webhookTriggerPercentage', value: 0 }, { key: 'proxyPassword', value: 'secret' }, { key: 'siteLanguage', value: 'en' }, { key: 'homeWave', value: false }, { key: 'homeMobile', value: true }, { key: 'reduceMotion', value: true }]) expect(validateSettingChange(input)).toBe(true);
    for (const input of [{ key: 'discordIncognito', value: true }, { key: 'discordLine1', value: '{track} · {genre}' }, { key: 'discordCoverText', value: '' }, { key: 'discordHiddenArtists', value: 'A,\nB' }, { key: 'discordHiddenGenres', value: 'x'.repeat(4000) }]) expect(validateSettingChange(input)).toBe(true);
    for (const input of [{ key: 'discordIncognito', value: 1 }, { key: 'discordLine2', value: 'a\nb' }, { key: 'discordLine1', value: 'x'.repeat(257) }, { key: 'discordCoverText', value: null }, { key: 'discordHiddenArtists', value: 'a\u0000' }, { key: 'discordHiddenGenres', value: 'x'.repeat(4001) }]) expect(validateSettingChange(input)).toBe(false);
    for (const input of [{ key: 'radarDay', value: 5 }, { key: 'radarDay', value: 0 }, { key: 'radarTime', value: '09:00' }, { key: 'radarZone', value: 'Europe/Moscow' }]) expect(validateSettingChange(input)).toBe(true);
    for (const input of [{ key: 'radarDay', value: 7 }, { key: 'radarDay', value: '5' }, { key: 'radarTime', value: '9:00' }, { key: 'radarTime', value: '24:00' }, { key: 'radarZone', value: 'Nowhere/Here' }, { key: 'radarZone', value: 3 }]) expect(validateSettingChange(input)).toBe(false);
    for (const input of [null, [], { key: '__proto__', value: {} }, { key: 'currentAccountId', value: '../other' }, { key: 'proxyEnabled', value: 'false' }, { key: 'webhookTriggerPercentage', value: NaN }, { key: 'proxyPort', value: '65536' }, { key: 'webhookUrl', value: 'file:///C:/file' }, { key: 'siteLanguage', value: 'de' }, { key: 'homeWave', value: 'false' }, { key: 'homeUnknown', value: true }, { key: 'reduceMotion', value: 'true' }, { key: 'theme', value: 'light' }]) expect(validateSettingChange(input)).toBe(false);
});
