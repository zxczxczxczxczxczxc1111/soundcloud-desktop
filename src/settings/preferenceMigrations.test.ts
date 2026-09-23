import { expect, it } from 'vitest';
import { applyPreferenceMigrations } from './preferenceMigrations';
function memoryStore(values: Record<string, unknown>) {
    return { values, get: (key: string) => values[key], set: (key: string, value: unknown) => { values[key] = value; } };
}
it('включает блокировку рекламы один раз, а выключенную после этого не трогает', () => {
    const store = memoryStore({ adBlocker: false });
    applyPreferenceMigrations(store);
    expect(store.values).toEqual({ adBlocker: true, adBlockerDefaultApplied: true });
    store.set('adBlocker', false);
    applyPreferenceMigrations(store);
    expect(store.values.adBlocker).toBe(false);
});
