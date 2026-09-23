import { existsSync } from 'fs';
import { win32 } from 'path';

// Драйвер NVIDIA с «Background Application Max Frame Rate» считает отдельный GPU-процесс Chromium
// фоновым и показывает его кадры не чаще лимита (по умолчанию 20 в секунду) даже у окна в фокусе.
// Исключения есть только для приложений с профилем в драйвере (Chrome, Discord).
// GPU внутри главного процесса показывает кадры от имени окна и в фокусе под ограничение не попадает.
// Флаг --separate-gpu-process возвращает обычный режим.
export function shouldRunGpuInProcess(
    platform: NodeJS.Platform,
    env: NodeJS.ProcessEnv,
    argv: readonly string[],
    exists: (file: string) => boolean = existsSync,
): boolean {
    if (platform !== 'win32' || argv.includes('--separate-gpu-process')) return false;
    return exists(win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'nvapi64.dll'));
}
