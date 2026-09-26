// Пятничный радар: планировщик в main (расписание здесь, сбор каталога на странице сайта, выпуск считает и пишет
// worker) и запросы страницы: выпуск с архивом, «Все найденные», пересборка и состояние сбора
import type { LibraryService } from '../services/libraryService';
import { RadarScheduler, cleanCollectResult, cleanSchedule, radarPeriod } from '../services/radarSchedule';
import type { IpcRegistry, SenderCheck, Settings } from './ipcTypes';

export interface RadarWiring {
    store: Settings;
    library: Pick<LibraryService, 'request'>;
    online(): boolean;
    /** Скрипт на странице сайта; null, если страницы нет */
    page(script: string): Promise<unknown>;
}

export function createRadarScheduler({ store, library, online, page: radarPage }: RadarWiring): RadarScheduler {
    return new RadarScheduler({
        now: () => Date.now(),
        schedule: () => cleanSchedule(store.get('radarDay'), store.get('radarTime'), store.get('radarZone')),
        online,
        user: async () => {
            const id = await radarPage('window.__scWhoAmI ? window.__scWhoAmI() : 0');
            return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : 0;
        },
        status: (user, period, at) => library.request('radarStatus', user, period, at),
        task: async (user, period, at, zone) => {
            const task = await library.request('radarTask', user, period, at, zone);
            if (!task) throw new Error('Задача радара не создана');
            return task;
        },
        collect: async (_user, budgetMs, staleBefore) =>
            cleanCollectResult(await radarPage('window.__scRadarCollect ? window.__scRadarCollect(' + Math.round(budgetMs) + ', ' + Math.round(staleBefore) + ') : null')),
        build: async (user, period, at, force) => {
            const outcome = await library.request('radarBuild', user, period, at, force, false);
            return { published: outcome.published, waiting: outcome.waiting };
        },
        changed: (state) => {
            if (state.error) console.warn('Радар: ' + state.phase + ' ' + state.period + ' ' + state.error);
            // Страница сама решает, перечитывать ли выпуск: по смене периода или публикации
            void radarPage('window.__scRadarChanged?.(' + JSON.stringify(state) + ')').catch((error: unknown) => console.warn('Радар: страница не узнала о выпуске', error));
        },
    });
}

export interface RadarIpcDeps {
    trustedSite: SenderCheck;
    store: Settings;
    library: Pick<LibraryService, 'request'>;
    scheduler(): Pick<RadarScheduler, 'getState'> | null;
}

export function registerRadarIpc(ipc: IpcRegistry, deps: RadarIpcDeps): void {
    const { trustedSite: isTrustedSoundCloudSender, store, library } = deps;
    const radarUser = (event: Parameters<SenderCheck>[0], userId: unknown): number => {
        if (!isTrustedSoundCloudSender(event)) throw new Error('Недопустимый отправитель радара');
        if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) throw new Error('Пользователь не определён');
        return userId;
    };
    for (const channel of ['soundcloud:radar:view', 'soundcloud:radar:found', 'soundcloud:radar:rebuild', 'soundcloud:radar:state']) ipc.removeHandler(channel);
    ipc.handle('soundcloud:radar:view', (event, userId: unknown, period: unknown, revision: unknown) => library.request('radarView', radarUser(event, userId), period, revision));
    ipc.handle('soundcloud:radar:found', (event, userId: unknown, period: unknown, revision: unknown) => library.request('radarFound', radarUser(event, userId), period, revision));
    ipc.handle('soundcloud:radar:rebuild', async (event, userId: unknown) => {
        const user = radarUser(event, userId);
        const period = radarPeriod(Date.now(), cleanSchedule(store.get('radarDay'), store.get('radarTime'), store.get('radarZone')));
        // Недели ещё нет: это просто сборка сейчас, а не ревизия; иначе новая ревизия, прежняя остаётся в архиве
        const manual = (await library.request('radarStatus', user, period.key, period.at)).published;
        return library.request('radarBuild', user, period.key, period.at, true, manual);
    });
    ipc.handle('soundcloud:radar:state', (event) => {
        if (!isTrustedSoundCloudSender(event)) throw new Error('Недопустимый отправитель радара');
        return deps.scheduler()?.getState() ?? null;
    });
}
