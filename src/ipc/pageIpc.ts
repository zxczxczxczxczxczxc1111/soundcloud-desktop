// Страница сайта: команды плеера, словарь перевода, ранние правила скрытия, отчёт о модулях сайта, место плеера,
// открытие истории, метаданные и обновления играющего трека
import type { SiteDictionary, TrackInfo } from '../types';
import type { DiagnosticJournal } from '../services/diagnosticJournal';
import type { PlaybackController } from '../services/playbackController';
import type { PresenceService } from '../services/presenceService';
import type { WebhookService } from '../services/webhookService';
import type { SettingsManager } from '../settings/settingsManager';
import type { HistoryManager } from '../history/historyManager';
import { mediaControlsScript } from '../services/mediaControls';
import { cleanSiteState, siteBroken } from '../services/siteModules';
import { validateTrackMeta, validateTrackUpdatePayload } from '../validation';
import type { IpcRegistry, SenderCheck, Settings, SitePage } from './ipcTypes';

/** Что main знает о воспроизведении: последний трек со страницы и счётчики для журнала диагностики */
export interface PlaybackState {
    info: TrackInfo;
    /** Музыка в этом запуске уже звучала: после падения или перезагрузки страницы сессия играет дальше,
     * а сразу после запуска клиента встаёт на паузу */
    playedThisRun: boolean;
    updates: number;
    changes: number;
    lastUpdateAt: number;
    lastProgressAt: number;
}

export interface PageIpcDeps {
    trustedSite: SenderCheck;
    store: Settings;
    diagnostics: Pick<DiagnosticJournal, 'record'>;
    playback: PlaybackState;
    devMode: boolean;
    page(): SitePage;
    controller(): Pick<PlaybackController, 'execute'>;
    siteDictionary(): SiteDictionary;
    hiddenBlocksCss(): string;
    settings(): Pick<SettingsManager, 'setSiteState'> | undefined;
    history(): Pick<HistoryManager, 'setPlayerArea' | 'show' | 'setNowPlaying'> | null;
    presence(): Pick<PresenceService, 'updateMeta' | 'updatePresence'>;
    webhooks(): Pick<WebhookService, 'updateTrackInfo'>;
    /** Предпросмотр карточки Discord в F1 */
    previewPresence(): void;
    /** Кнопки на миниатюре панели задач Windows */
    updateThumbar(playing: boolean, liked: boolean): void;
}

export function registerPageIpc(ipc: IpcRegistry, deps: PageIpcDeps): void {
    const { trustedSite: isTrustedSoundCloudSender, store, diagnostics, playback } = deps;
    ipc.on('soundcloud:playback', (event, command: unknown) => {
        if (!isTrustedSoundCloudSender(event)) return;
        if (command !== 'play' && command !== 'pause' && command !== 'next' && command !== 'previous') return;
        void deps.controller().execute(command).catch(console.error);
    });
    // Словарь перевода сайта для preload. Запрос синхронный: ответ уходит при первом же присваивании
    // returnValue, поэтому оно одно и стоит на любом пути, иначе страница встанет
    ipc.on('soundcloud:site-translation', (event) => {
        let dictionary: SiteDictionary | null = null;
        try {
            if (isTrustedSoundCloudSender(event) && store.get('siteLanguage', 'ru') === 'ru') dictionary = deps.siteDictionary();
        } catch (error) {
            console.error('Словарь перевода сайта не загружен:', error);
        }
        event.returnValue = dictionary;
    });
    ipc.removeAllListeners('soundcloud:early-blocks');
    ipc.on('soundcloud:early-blocks', (event) => {
        let css = '';
        try { if (isTrustedSoundCloudSender(event)) css = deps.hiddenBlocksCss(); }
        catch (error) { console.warn('Правила скрытия не прочитаны', error); }
        event.returnValue = css;
    });
    // Сайт поменялся: чего страница не нашла. Событие в журнал и строка в F1; сообщение после находки снимает строку
    ipc.removeAllListeners('soundcloud:site-state');
    ipc.on('soundcloud:site-state', (event, value: unknown) => {
        const state = isTrustedSoundCloudSender(event) ? cleanSiteState(value) : null;
        if (!state) return;
        const broken = siteBroken(state);
        if (broken) diagnostics.record('site.modules-missing', { sitePlayer: state.player, siteApi: state.api, siteSound: state.sound, siteTranslation: state.translation });
        deps.settings()?.setSiteState(broken ? state : null);
    });
    // Место плеера сайта: окно истории не накрывает громкость и очередь
    ipc.removeAllListeners('soundcloud:player-area');
    ipc.on('soundcloud:player-area', (event, height: unknown, viewport: unknown) => {
        if (isTrustedSoundCloudSender(event)) deps.history()?.setPlayerArea(height, viewport);
    });
    ipc.removeAllListeners('soundcloud:open-history');
    ipc.on('soundcloud:open-history', (event) => {
        if (isTrustedSoundCloudSender(event)) deps.history()?.show();
    });
    // Жанр, счётчики и волна текущего трека для карточки Discord
    ipc.removeAllListeners('soundcloud:track-meta');
    ipc.on('soundcloud:track-meta', (event, payload: unknown) => {
        if (!isTrustedSoundCloudSender(event)) return;
        const meta = validateTrackMeta(payload);
        if (!meta) return;
        deps.history()?.setNowPlaying(meta.id);
        deps.presence().updateMeta(meta);
        deps.previewPresence();
    });
    // setup audio event handler for track updates
    ipc.on('soundcloud:track-update', async (event, payload: unknown) => {
        if (!isTrustedSoundCloudSender(event)) {
            console.warn('Rejected track update from untrusted sender');
            return;
        }

        const update = validateTrackUpdatePayload(payload);
        if (!update) {
            console.warn('Rejected invalid track update payload');
            return;
        }

        const { data: result, reason } = update;
        if (result.isPlaying) playback.playedThisRun = true;
        playback.updates++;
        playback.lastUpdateAt = Date.now();
        if (reason === 'track-change') playback.changes++;
        if (result.elapsed !== playback.info.elapsed || reason === 'track-change') playback.lastProgressAt = Date.now();

        if (deps.devMode) {
            console.debug(`Track update received: ${reason}`);
        }

        if (result.title && (reason === 'track-change' || !playback.info.title)) {
            void deps.page().executeJavaScript(mediaControlsScript).catch(console.error);
        }
        playback.info = result;

        void deps.webhooks().updateTrackInfo(result, result.isPlaying, reason).catch(console.error);
        void deps.presence().updatePresence(result).catch(console.error);

        // update rich presence preview in settings
        deps.previewPresence();
        deps.updateThumbar(result.isPlaying, result.isLiked);
    });
}
