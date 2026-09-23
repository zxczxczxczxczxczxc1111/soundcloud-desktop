import { expect, it, vi } from 'vitest';
import { shouldRunGpuInProcess } from './gpuProcessMode';

it('runs GPU in process on Windows with the NVIDIA driver', () => {
    const exists = vi.fn((file: string) => file === 'D:\\Win\\System32\\nvapi64.dll');
    expect(shouldRunGpuInProcess('win32', { SystemRoot: 'D:\\Win' }, [], exists)).toBe(true);
    expect(exists).toHaveBeenCalledWith('D:\\Win\\System32\\nvapi64.dll');
});

it('keeps the separate GPU process without NVIDIA, off Windows or on request', () => {
    const always = (): boolean => true;
    expect(shouldRunGpuInProcess('win32', { SystemRoot: 'C:\\Windows' }, [], () => false)).toBe(false);
    expect(shouldRunGpuInProcess('darwin', {}, [], always)).toBe(false);
    expect(shouldRunGpuInProcess('linux', {}, [], always)).toBe(false);
    expect(shouldRunGpuInProcess('win32', {}, ['--separate-gpu-process'], always)).toBe(false);
});

it('falls back to C:\\Windows when SystemRoot is missing', () => {
    const exists = vi.fn(() => true);
    shouldRunGpuInProcess('win32', {}, [], exists);
    expect(exists).toHaveBeenCalledWith('C:\\Windows\\System32\\nvapi64.dll');
});
