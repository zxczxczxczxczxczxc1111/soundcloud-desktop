import { expect, it } from 'vitest';
import { HOME_BLOCK_KEYS } from '../services/homeBlocks';
import { applyPreferenceMigrations } from './preferenceMigrations';
function memoryStore(values: Record<string, unknown>) {
    return { values, get: (key: string) => values[key], set: (key: string, value: unknown) => { values[key] = value; } };
}
it('новый профиль и прежнее умолчание NVIDIA переходят в автоматический режим', () => {
    for (const values of [{}, { gpuCompatibility: false }]) {
        const store = memoryStore(values);
        applyPreferenceMigrations(store);
        expect(store.values.gpuCompatibilityMode).toBe('auto');
    }
});
it('сохраняет прежнее включение NVIDIA и новый ручной выбор после перезапуска', () => {
    const store = memoryStore({ gpuCompatibility: true });
    applyPreferenceMigrations(store);
    expect(store.values.gpuCompatibilityMode).toBe('on');
    for (const mode of ['off', 'auto', 'on']) {
        store.set('gpuCompatibilityMode', mode);
        applyPreferenceMigrations(store);
        expect(store.values.gpuCompatibilityMode).toBe(mode);
    }
});
it('зону радара записывает один раз из системной, выбранную после этого не трогает', () => {
    const store = memoryStore({});
    applyPreferenceMigrations(store);
    expect(store.values.radarZone).toBe(new Intl.DateTimeFormat().resolvedOptions().timeZone);
    store.set('radarZone', 'Asia/Tokyo');
    applyPreferenceMigrations(store);
    expect(store.values.radarZone).toBe('Asia/Tokyo');
});
it('включает блокировку рекламы один раз, а выключенную после этого не трогает', () => {
    const store = memoryStore({ adBlocker: false });
    applyPreferenceMigrations(store);
    expect(store.values).toMatchObject({ adBlocker: true, adBlockerDefaultApplied: true });
    store.set('adBlocker', false);
    applyPreferenceMigrations(store);
    expect(store.values.adBlocker).toBe(false);
});
it('раскладку главной применяет один раз, возвращённую после этого полку не трогает', () => {
    const store = memoryStore(Object.fromEntries(HOME_BLOCK_KEYS.map((key) => [key, true])));
    applyPreferenceMigrations(store);
    expect(HOME_BLOCK_KEYS.filter((key) => store.values[key] === true)).toEqual(['homeWave', 'homeLikes']);
    expect(store.values.homeLayoutApplied).toBe(true);
    store.set('homeRecent', true);
    applyPreferenceMigrations(store);
    expect(store.values.homeRecent).toBe(true);
});
