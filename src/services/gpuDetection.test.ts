import { expect, it, vi } from 'vitest';
import { detectNvidiaAdapter, mappedVideoAdapters } from './gpuDetection';

const first = String.raw`\Registry\Machine\System\CurrentControlSet\Control\Video\{11111111-1111-1111-1111-111111111111}`;
const second = String.raw`\Registry\Machine\System\ControlSet001\Control\Video\{22222222-2222-2222-2222-222222222222}`;
const map = (path: string, index: number, child = '0000'): string => `    \\Device\\Video${index}    REG_SZ    ${path}\\${child}\r\n`;
const id = (vendor: string): string => `    MatchingDeviceId    REG_SZ    pci\\ven_${vendor}&dev_2803\r\n`;

it('читает только отображённые адаптеры, объединяя выходы одной карты', () => {
    const output = map(first, 0) + map(first.toUpperCase(), 1, '0001') + map(second, 2) +
        String.raw`    \Device\Video3    REG_SZ    \REGISTRY\MACHINE\SYSTEM\ControlSet001\Services\BasicDisplay`;
    expect(mappedVideoAdapters(output)).toEqual([
        String.raw`HKLM\system\currentcontrolset\control\video\{11111111-1111-1111-1111-111111111111}\0000`,
        String.raw`HKLM\system\controlset001\control\video\{22222222-2222-2222-2222-222222222222}\0000`,
    ]);
});

it('определяет NVIDIA по PCI vendor ID подключённой карты, включая гибридные системы', () => {
    const query = vi.fn((key: string, value?: string) => value ? id(key.includes('22222222') ? '10DE' : '8086') : map(first, 0) + map(second, 1));
    expect(detectNvidiaAdapter('win32', query)).toBe('nvidia');
    expect(query).toHaveBeenCalledTimes(3);
});

it('не принимает чужую карту или произвольное упоминание NVIDIA за подходящую', () => {
    for (const value of [id('8086'), id('1002')]) {
        expect(detectNvidiaAdapter('win32', (_key, field) => field ? value : map(first, 0))).toBe('other');
    }
    expect(detectNvidiaAdapter('win32', (_key, field) => field ? 'DriverDesc REG_SZ NVIDIA' : map(first, 0))).toBe('unknown');
    expect(detectNvidiaAdapter('win32', () => 'nvapi64.dll')).toBe('unknown');
});

it('не читает реестр на другой ОС', () => {
    const query = vi.fn();
    expect(detectNvidiaAdapter('linux', query)).toBe('unsupported');
    expect(query).not.toHaveBeenCalled();
});

it('при ошибке определения возвращает неизвестное состояние, а не включает обход', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
        expect(detectNvidiaAdapter('win32', () => { throw new Error('timeout'); })).toBe('unknown');
        expect(detectNvidiaAdapter('win32', (_key, value) => { if (value) throw new Error('missing value'); return map(first, 0); })).toBe('unknown');
        expect(warning).toHaveBeenCalledTimes(2);
    } finally { warning.mockRestore(); }
});
