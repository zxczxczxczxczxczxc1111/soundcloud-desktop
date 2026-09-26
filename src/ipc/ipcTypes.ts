// Общее для обработчиков запросов из страниц: регистратор в форме ipcMain и узкие формы того, что они трогают.
// Значения из Electron сюда не импортируются: main передаёт настоящие, тесты подставляют свои
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';

/** Проверка отправителя: своя страница клиента (шапка, F1, история) или сайт в главной рамке */
export type SenderCheck = (event: Pick<IpcMainEvent, 'sender' | 'senderFrame'>) => boolean;

export interface IpcRegistry {
    on(channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void): unknown;
    handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void;
    removeHandler(channel: string): void;
    removeAllListeners(channel: string): unknown;
}

/** Настройки клиента (electron-store) */
export interface Settings {
    get(key: string, fallback?: unknown): unknown;
    set(key: string, value: unknown): void;
    delete(key: string): void;
}

/** Страница, которой main шлёт сообщение: шапка, F1 */
export interface MessageTarget {
    send(channel: string, ...args: unknown[]): void;
}

/** Страница сайта: main выполняет в ней скрипты */
export interface SitePage {
    isDestroyed(): boolean;
    executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
}
