/** Буфер, который пишется на диск по требованию */
export interface Flushable {
    flush(): void;
}

/**
 * Выключение, перезагрузка и выход из системы: before-quit и will-quit на Windows не приходят, буферы ложатся по session-end
 * окна. Буферы берутся в момент события: журналы волны создаются уже после окна
 */
export function flushOnSessionEnd(window: { on(event: 'session-end', listener: () => void): unknown }, buffers: () => Array<Flushable | null | undefined>): void {
    window.on('session-end', () => {
        for (const buffer of buffers()) buffer?.flush();
    });
}
