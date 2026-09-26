export type GpuCompatibilityMode = 'auto' | 'on' | 'off';
export type GpuDetection = 'nvidia' | 'other' | 'unknown' | 'unsupported';
export interface GpuRuntimeState {
    mode: GpuCompatibilityMode;
    detection: GpuDetection;
    active: boolean;
    interrupted: boolean;
}

export function isGpuCompatibilityMode(value: unknown): value is GpuCompatibilityMode {
    return value === 'auto' || value === 'on' || value === 'off';
}

// Ручной выбор сохраняется; после вылета на старте один запуск проходит с отдельным GPU.
export function shouldRunGpuInProcess(platform: NodeJS.Platform, mode: GpuCompatibilityMode, detection: GpuDetection, argv: readonly string[], interrupted = false): boolean {
    return platform === 'win32' && !interrupted && !argv.includes('--separate-gpu-process') &&
        (argv.includes('--in-process-gpu') || mode === 'on' || (mode === 'auto' && detection === 'nvidia'));
}

// Страховка от клиента, который с GPU в главном процессе не может даже открыться. Отметка живёт первую минуту:
// обрыв позже (установщик обновления, выключение ПК, где Windows не даёт will-quit) видеокарта не вызывала.
export function guardGpuStartup(active: boolean, mark: (running: boolean) => void): void {
    mark(active);
    if (active) setTimeout(() => mark(false), 60 * 1000).unref();
}
