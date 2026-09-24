import { setTimeout, clearTimeout, setInterval } from 'timers';
import { createContext, Script } from 'vm';
import type { PluginCommand } from './pluginProcess';

interface PluginExports {
    onEnable?: () => unknown;
    onDisable?: () => unknown;
    onTrackChange?: (track: Record<string, unknown>) => unknown;
    contentScript?: () => unknown;
}
let plugin: PluginExports = {};
const timers = new Set<ReturnType<typeof setTimeout>>();
const clearTimers = (): void => { for (const timer of timers) clearTimeout(timer); timers.clear(); };
const clear = (timer: ReturnType<typeof setTimeout>): void => { clearTimeout(timer); timers.delete(timer); };

process.parentPort.on('message', async ({ data }: { data: { id: number; command: PluginCommand } }) => {
    const { id, command } = data;
    try {
        let value: unknown;
        if (command.kind === 'load') {
            clearTimers();
            const exported: PluginExports = {};
            const sandbox = {
                module: { exports: exported }, exports: exported, console,
                setTimeout: (callback: (...args: unknown[]) => void, delay: number, ...args: unknown[]) => {
                    const timer = setTimeout(() => { timers.delete(timer); callback(...args); }, delay);
                    timers.add(timer); return timer;
                },
                setInterval: (callback: (...args: unknown[]) => void, delay: number, ...args: unknown[]) => { const timer = setInterval(callback, delay, ...args); timers.add(timer); return timer; },
                clearTimeout: clear, clearInterval: clear,
            };
            // vm сохраняет совместимость API. Доверенный код выполняется в отдельном процессе.
            new Script(command.source, { filename: command.filename }).runInContext(createContext(sandbox), { timeout: 1000 });
            plugin = sandbox.module.exports;
            await plugin.onEnable?.();
            value = await plugin.contentScript?.();
            if (value !== undefined && typeof value !== 'string') throw new Error('contentScript должен возвращать строку');
        } else if (command.kind === 'track') value = await plugin.onTrackChange?.(command.track);
        else if (command.kind === 'disable') { await plugin.onDisable?.(); clearTimers(); plugin = {}; }
        process.parentPort.postMessage({ id, ok: true, value });
    } catch (error) {
        process.parentPort.postMessage({ id, ok: false, error: String(error) });
    }
});
