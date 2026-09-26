// Хранилища в фоновом потоке для страницы: сессия, каталог и свои подборки, хранилище рекомендаций.
// Ввод проверяет worker, здесь только отправитель и пользователь
import type { LibraryService } from '../services/libraryService';
import type { IpcRegistry, SenderCheck } from './ipcTypes';

export interface LibraryIpcDeps {
    trustedSite: SenderCheck;
    library: Pick<LibraryService, 'request'>;
}

export function registerLibraryIpc(ipc: IpcRegistry, deps: LibraryIpcDeps): void {
    const { trustedSite: isTrustedSoundCloudSender, library } = deps;
    const playbackChannels = ['loadSession', 'saveSession', 'loadCatalog', 'saveCatalog', 'listMixes', 'saveMix', 'removeMix'] as const;
    for (const method of playbackChannels) {
        const channel = 'soundcloud:library:' + method;
        ipc.removeHandler(channel);
        ipc.handle(channel, (event, userId: unknown, value: unknown, tracks: unknown) => {
            if (!isTrustedSoundCloudSender(event)) throw new Error('Недопустимый отправитель библиотеки');
            if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) throw new Error('Пользователь не определён');
            switch (method) {
                case 'loadSession': return library.request(method, userId);
                case 'saveSession': return library.request(method, userId, value);
                case 'loadCatalog': return library.request(method, userId);
                case 'saveCatalog': return library.request(method, userId, value);
                case 'listMixes': return library.request(method, userId);
                case 'saveMix': return library.request(method, userId, value, tracks);
                case 'removeMix': return library.request(method, userId, value);
            }
        });
    }
    // Хранилище рекомендаций: загрузки с версиями, связи записей и обход источников. Ввод проверяет worker,
    // аккаунт задаёт файл, ответ прошлого прогона обхода отклоняется по номеру прогона
    const recommendChannels = [
        'recordUploads', 'uploads', 'recordingLinks', 'setRecordingLink', 'syncStart', 'syncPage', 'syncFinish', 'syncState', 'libraryMembers', 'radarPlan', 'catalogChecked',
    ] as const;
    for (const method of recommendChannels) {
        const channel = 'soundcloud:recommend:' + method;
        ipc.removeHandler(channel);
        ipc.handle(channel, (event, userId: unknown, ...args: unknown[]) => {
            if (!isTrustedSoundCloudSender(event)) throw new Error('Недопустимый отправитель рекомендаций');
            if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) throw new Error('Пользователь не определён');
            // Время операций ставит worker: страница передаёт только данные
            const [a, b, c, d, e] = args;
            switch (method) {
                case 'recordUploads': return library.request(method, userId, a);
                case 'uploads': return library.request(method, userId, a);
                case 'recordingLinks': return library.request(method, userId);
                case 'setRecordingLink': return library.request(method, userId, a, b, c);
                case 'syncStart': return library.request(method, userId, a, b);
                case 'syncPage': return library.request(method, userId, a, b, c, d);
                case 'syncFinish': return library.request(method, userId, a, b, c, d);
                case 'syncState': return library.request(method, userId);
                case 'libraryMembers': return library.request(method, userId, a);
                case 'radarPlan': return library.request(method, userId);
                case 'catalogChecked': return library.request(method, userId, a, b, c, d, e);
            }
        });
    }
}
