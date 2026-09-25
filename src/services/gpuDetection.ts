import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { GpuDetection } from './gpuProcessMode';

type RegistryQuery = (key: string, value?: string) => string;

// DEVICEMAP содержит подключённые адаптеры. Остатки DLL и старые ветки Control\Video не учитываются.
export function mappedVideoAdapters(output: string): string[] {
    const adapters = new Set<string>();
    for (const match of output.matchAll(/^\s*\\Device\\Video\d+\s+REG_SZ\s+\\Registry\\Machine\\(System\\(?:CurrentControlSet|ControlSet\d{3})\\Control\\Video\\\{[a-f0-9-]{36}\})\\\d{4}\s*$/gmi)) {
        adapters.add('HKLM\\' + match[1].toLowerCase() + '\\0000');
    }
    return [...adapters];
}

export function detectNvidiaAdapter(platform: NodeJS.Platform, query?: RegistryQuery): GpuDetection {
    if (platform !== 'win32') return 'unsupported';
    // Флаги нужны до app.ready. Чтение реестра ограничено общим бюджетом, не запускает PowerShell/WMI.
    const deadline = Date.now() + 500;
    const read: RegistryQuery = query ?? ((key, value) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('GPU detection timeout');
        return execFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe'),
            ['query', key, ...(value ? ['/v', value] : [])],
            { encoding: 'utf8', windowsHide: true, timeout: remaining, maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    });
    let failed = false;
    try {
        const adapters = mappedVideoAdapters(read('HKLM\\HARDWARE\\DEVICEMAP\\VIDEO'));
        if (!adapters.length) return 'unknown';
        for (const key of adapters) {
            try {
                const id = read(key, 'MatchingDeviceId');
                if (/^\s*MatchingDeviceId\s+REG_SZ\s+pci\\ven_10de(?:&|\s*$)/mi.test(id)) return 'nvidia';
                if (!/^\s*MatchingDeviceId\s+REG_SZ\s+pci\\ven_[a-f0-9]{4}(?:&|\s*$)/mi.test(id)) failed = true;
            } catch (error) {
                failed = true;
                console.warn('Не удалось определить видеоадаптер:', error instanceof Error ? error.name : 'Error');
            }
        }
    } catch (error) {
        console.warn('Не удалось прочитать список видеоадаптеров:', error instanceof Error ? error.name : 'Error');
        return 'unknown';
    }
    return failed ? 'unknown' : 'other';
}
