import { expect, it } from 'vitest';
import { validateSettingChange } from './validateSetting';
it('разрешает обычные настройки и отклоняет неизвестные ключи и неверные типы', () => {
    for (const input of [{ key: 'proxyEnabled', value: true }, { key: 'theme', value: 'light' }, { key: 'webhookTriggerPercentage', value: 0 }, { key: 'proxyPassword', value: 'secret' }, { key: 'siteLanguage', value: 'en' }, { key: 'homeWave', value: false }, { key: 'homeMobile', value: true }]) expect(validateSettingChange(input)).toBe(true);
    for (const input of [null, [], { key: '__proto__', value: {} }, { key: 'currentAccountId', value: '../other' }, { key: 'proxyEnabled', value: 'false' }, { key: 'webhookTriggerPercentage', value: NaN }, { key: 'proxyPort', value: '65536' }, { key: 'webhookUrl', value: 'file:///C:/file' }, { key: 'siteLanguage', value: 'de' }, { key: 'homeWave', value: 'false' }, { key: 'homeUnknown', value: true }]) expect(validateSettingChange(input)).toBe(false);
});
