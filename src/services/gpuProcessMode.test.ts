import { expect, it } from 'vitest';
import { shouldRunGpuInProcess } from './gpuProcessMode';
it('автоматически включает обход только на Windows с обнаруженной NVIDIA', () => {
    expect(shouldRunGpuInProcess('win32', 'auto', 'nvidia', [])).toBe(true);
    for (const detection of ['other', 'unknown', 'unsupported'] as const) {
        expect(shouldRunGpuInProcess('win32', 'auto', detection, [])).toBe(false);
    }
    expect(shouldRunGpuInProcess('linux', 'auto', 'nvidia', [])).toBe(false);
    expect(shouldRunGpuInProcess('darwin', 'on', 'nvidia', [])).toBe(false);
});
it('ручной выбор имеет приоритет над автоматическим определением', () => {
    expect(shouldRunGpuInProcess('win32', 'off', 'nvidia', [])).toBe(false);
    expect(shouldRunGpuInProcess('win32', 'on', 'unknown', [])).toBe(true);
    expect(shouldRunGpuInProcess('win32', 'off', 'other', ['--in-process-gpu'])).toBe(true);
});
it('после аварийного выхода и по ключу запуска остаётся отдельный процесс', () => {
    expect(shouldRunGpuInProcess('win32', 'auto', 'nvidia', [], true)).toBe(false);
    expect(shouldRunGpuInProcess('win32', 'on', 'nvidia', ['--separate-gpu-process', '--in-process-gpu'])).toBe(false);
    expect(shouldRunGpuInProcess('win32', 'on', 'nvidia', ['--in-process-gpu'], true)).toBe(false);
});
