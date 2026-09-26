// Обновления: экран обновления при запуске, ручная проверка, страница выпуска, папка данных
import type { WebContents } from 'electron';
import type { UpdateService } from '../services/updateService';
import type { IpcRegistry, SenderCheck } from './ipcTypes';

export interface UpdateIpcDeps {
    trustedLocal: SenderCheck;
    updates(): Pick<UpdateService, 'installNow' | 'getState' | 'check'> | null;
    /** Экран обновления открыт и это его страница */
    screenOwns(sender: WebContents): boolean;
    /** «Позже» на экране обновления: экран закрывается и в этом запуске больше не открывается */
    later(): void;
    openExternal(url: string): Promise<void>;
    /** Открыть папку; пустая строка, если открылась, иначе текст ошибки */
    openPath(path: string): Promise<string>;
    dataFolder(): string;
}

export function registerUpdateIpc(ipc: IpcRegistry, deps: UpdateIpcDeps): void {
    const { trustedLocal: isTrustedLocalSender } = deps;
    ipc.on('update-screen-later', (event) => {
        if (!deps.screenOwns(event.sender) || !isTrustedLocalSender(event)) return;
        deps.later();
    });
    ipc.handle('install-update-now', (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        return deps.updates()?.installNow() ?? false;
    });
    ipc.handle('get-update-state', (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        return deps.updates()?.getState() ?? null;
    });
    ipc.handle('open-release-page', async (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        const url = deps.updates()?.getState().releaseUrl;
        if (url) await deps.openExternal(url);
    });
    ipc.handle('check-updates', async (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        await deps.updates()?.check();
    });
    ipc.handle('open-data-folder', async (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        const error = await deps.openPath(deps.dataFolder());
        if (error) throw new Error(error);
    });
}
