import { expect, it } from 'vitest';
import * as ru from '../i18n/ru.json';
import * as en from '../i18n/en.json';
import { TranslationService } from './translationService';

const own = (table: object): Record<string, unknown> => Object.fromEntries(Object.entries(table).filter(([key]) => key !== 'default'));

it('словари на двух языках с одними ключами, английский без кириллицы', () => {
    const ruTable = own(ru);
    const enTable = own(en);
    expect(Object.keys(enTable).sort()).toEqual(Object.keys(ruTable).sort());
    for (const [key, value] of Object.entries(enTable)) {
        expect(typeof value === 'string' && value.trim(), key).toBeTruthy();
        expect(/[А-Яа-яЁё]/.test(String(value)), key).toBe(false);
    }
});

it('язык берётся в момент перевода: смена в F1 действует без перезапуска', () => {
    let language: 'ru' | 'en' = 'ru';
    const service = new TranslationService(() => language);
    expect(service.translate('trayQuit')).toBe('Выход');
    language = 'en';
    expect(service.getLanguage()).toBe('en');
    expect(service.translate('trayQuit')).toBe('Quit');
    expect(service.translate('githubBadge')).toBe('SoundCloud on GitHub');
});
