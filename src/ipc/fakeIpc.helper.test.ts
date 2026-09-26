// Помощник тестов обработчиков: файлы *.helper.test.ts vitest не запускает, в установщик они не попадают
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import type { IpcRegistry } from './ipcTypes';

type Listener = (event: IpcMainEvent, ...args: unknown[]) => void;
type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
export type FakeEvent = IpcMainEvent & IpcMainInvokeEvent;

// Регистратор в форме ipcMain для тестов обработчиков. Как в Electron, второй обработчик запроса на тот же канал
// без снятия первого падает: так видно, что повторная регистрация снимает прежние
export class FakeIpc implements IpcRegistry {
    readonly listeners = new Map<string, Listener[]>();
    readonly handlers = new Map<string, Handler>();
    public on(channel: string, listener: Listener): this {
        this.listeners.set(channel, [...(this.listeners.get(channel) ?? []), listener]);
        return this;
    }
    public handle(channel: string, handler: Handler): void {
        if (this.handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`);
        this.handlers.set(channel, handler);
    }
    public removeHandler(channel: string): void {
        this.handlers.delete(channel);
    }
    public removeAllListeners(channel: string): this {
        this.listeners.delete(channel);
        return this;
    }
    /** Сообщение от страницы: ждёт асинхронных слушателей и отдаёт ответ синхронного запроса */
    public async send(channel: string, event: IpcMainEvent, ...args: unknown[]): Promise<unknown> {
        const list = this.listeners.get(channel);
        if (!list?.length) throw new Error('Нет слушателя ' + channel);
        await Promise.all(list.map((listener) => listener(event, ...args)));
        return event.returnValue;
    }
    /** Запрос с ответом: синхронная ошибка обработчика становится отказом, как у ipcRenderer.invoke */
    public async invoke(channel: string, event: IpcMainInvokeEvent, ...args: unknown[]): Promise<unknown> {
        const handler = this.handlers.get(channel);
        if (!handler) throw new Error('Нет обработчика ' + channel);
        return handler(event, ...args);
    }
}

/** Событие-отправитель: проверки доверия в тестах сравнивают его по ссылке */
export function fakeEvent(): FakeEvent {
    return { sender: {}, senderFrame: null, returnValue: undefined } as unknown as FakeEvent;
}
/** Проверка отправителя, которая доверяет только этим событиям */
export function trusting(...trusted: object[]): (event: object) => boolean {
    return (event) => trusted.includes(event);
}
