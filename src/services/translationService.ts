import * as ru from '../i18n/ru.json';
import * as en from '../i18n/en.json';

// Язык приложения это настройка siteLanguage из F1: сайт, панель, трей, уведомления и Discord
export type AppLanguage = 'ru' | 'en';

export type TranslationKeys = Exclude<keyof typeof ru, 'default'>;

// Английский словарь обязан закрывать все ключи русского: пропуск ловит компилятор
const TABLES: Record<AppLanguage, Record<TranslationKeys, string>> = { ru, en };

export class TranslationService {
    constructor(private language: () => AppLanguage = () => 'ru') {}

    getLanguage(): AppLanguage {
        return this.language();
    }

    translate(key: TranslationKeys): string {
        return TABLES[this.getLanguage()][key] ?? TABLES.ru[key] ?? key;
    }
}
