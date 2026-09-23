import * as ru from '../i18n/ru.json';

// Интерфейс только на русском.
type Lang = 'ru';

type TranslationKeys = keyof typeof ru;

export class TranslationService {
    getLanguage(): Lang {
        return 'ru';
    }

    translate(key: TranslationKeys): string {
        return (ru as Record<string, string>)[key as string] ?? (key as string);
    }
}
