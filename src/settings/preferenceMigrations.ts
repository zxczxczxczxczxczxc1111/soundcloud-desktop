import { HOME_BLOCK_KEYS, homeBlockDefaults } from '../services/homeBlocks';

interface PreferenceStore {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
}

// В 0.2.1 и раньше блокировка была выключена по умолчанию и попадала в файл при первом запуске,
// поэтому выбор от умолчания не отличить. Блокировка включается один раз, дальше выбор за человеком.
// Раскладка главной из 0.6.0 (волна и лайки справа) применяется так же, один раз
export function applyPreferenceMigrations(store: PreferenceStore): void {
    if (store.get('adBlockerDefaultApplied') !== true) {
        store.set('adBlocker', true);
        store.set('adBlockerDefaultApplied', true);
    }
    if (store.get('homeLayoutApplied') !== true) {
        for (const key of HOME_BLOCK_KEYS) store.set(key, homeBlockDefaults[key]);
        store.set('homeLayoutApplied', true);
    }
}
