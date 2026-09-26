import { expect, it, vi } from 'vitest';
import { guardGpuStartup, shouldRunGpuInProcess } from './gpuProcessMode';
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
it('вылетом считается только обрыв в первую минуту: обновление или выключение ПК позже обход не гасят', () => {
    vi.useFakeTimers();
    try {
        const marks: boolean[] = [];
        guardGpuStartup(true, running => marks.push(running));
        vi.advanceTimersByTime(59_000);
        expect(marks).toEqual([true]);
        vi.advanceTimersByTime(1_000);
        expect(marks).toEqual([true, false]);
        marks.length = 0;
        guardGpuStartup(false, running => marks.push(running));
        vi.runAllTimers();
        expect(marks).toEqual([false]);
    } finally { vi.useRealTimers(); }
});
