interface PreferenceStore {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
}

// В 0.2.1 и раньше блокировка была выключена по умолчанию и попадала в файл при первом запуске,
// поэтому выбор от умолчания не отличить. Блокировка включается один раз, дальше выбор за человеком.
export function applyPreferenceMigrations(store: PreferenceStore): void {
    if (store.get('adBlockerDefaultApplied') === true) return;
    store.set('adBlocker', true);
    store.set('adBlockerDefaultApplied', true);
}
