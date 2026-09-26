// Настройки и переключатели: F1, очередь, история, внешние ссылки, выгрузка журнала, смена настройки,
// трек для предпросмотра карточки и переводы F1
import path from 'path';
import type { DiagnosticJournal } from '../services/diagnosticJournal';
import type { PresenceService } from '../services/presenceService';
import type { TranslationKeys } from '../services/translationService';
import type { HistoryManager } from '../history/historyManager';
import type { SettingsManager } from '../settings/settingsManager';
import { validateSettingChange, type SettingChange } from '../settings/validateSetting';
import type { PlaybackState } from './pageIpc';
import type { IpcRegistry, SenderCheck, SitePage } from './ipcTypes';

export interface SettingsIpcDeps {
    trustedLocal: SenderCheck;
    settings(): Pick<SettingsManager, 'toggle' | 'getView'>;
    history(): Pick<HistoryManager, 'hide'> | null;
    page(): SitePage;
    toggleHistory(): void;
    openExternal(url: string): Promise<void>;
    saveDialog(options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue>;
    downloadsFolder(): string;
    diagnostics: Pick<DiagnosticJournal, 'exportTo'>;
    translate(key: TranslationKeys): string;
    applySettingChange(change: SettingChange): void;
    playback: PlaybackState;
    presence(): Pick<PresenceService, 'preview'>;
}

export function registerSettingsIpc(ipc: IpcRegistry, deps: SettingsIpcDeps): void {
    const { trustedLocal: isTrustedLocalSender } = deps;
    // Add settings toggle handler
    ipc.on('toggle-settings', (event) => {
        if (!isTrustedLocalSender(event)) return;
        deps.settings().toggle();
    });
    ipc.removeAllListeners('toggle-history');
    ipc.removeAllListeners('toggle-queue');
    ipc.on('toggle-queue', (event) => {
        if (!isTrustedLocalSender(event)) return;
        deps.history()?.hide();
        const settingsManager = deps.settings();
        if (settingsManager.getView()) settingsManager.toggle();
        void deps.page().executeJavaScript('window.__scQueue?.()').catch(console.error);
    });
    ipc.on('toggle-history', (event) => {
        if (isTrustedLocalSender(event)) deps.toggleHistory();
    });

    ipc.handle('open-external-url', async (_event, url: unknown) => {
        if (!isTrustedLocalSender(_event)) throw new Error('Недопустимый отправитель IPC');

        if (!url || typeof url !== 'string') return '';
        const normalizedUrl = url.trim();

        try {
            const parsed = new URL(normalizedUrl);
            if (parsed.protocol !== 'https:') return '';
            await deps.openExternal(parsed.toString());
            return '';
        } catch {
            return '';
        }
    });

    ipc.handle('export-diagnostics', async (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        const result = await deps.saveDialog({
            title: deps.translate('saveJournalTitle'),
            defaultPath: path.join(deps.downloadsFolder(), 'soundcloud-diagnostics-' + new Date().toISOString().slice(0, 10) + '.log'),
            filters: [{ name: deps.translate('journalFileType'), extensions: ['log'] }],
        });
        if (result.canceled || !result.filePath) return false;
        try { deps.diagnostics.exportTo(result.filePath); return true; }
        catch (error) { console.error('Не удалось сохранить журнал:', error); throw new Error('Не удалось сохранить журнал', { cause: error }); }
    });

    // Register settings related events
    ipc.on('setting-changed', (_event, data: unknown) => {
        if (!isTrustedLocalSender(_event)) return;
        if (!validateSettingChange(data)) return;
        deps.applySettingChange(data);
    });

    // Provide current track info to settings preview on demand
    ipc.handle('get-current-track', (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        return { track: deps.playback.info, ...deps.presence().preview() };
    });

    ipc.handle('get-translations', (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');

        return {
            client: deps.translate('client'),
            adBlocker: deps.translate('adBlocker'),
            enableAdBlocker: deps.translate('enableAdBlocker'),
            changesAppRestart: deps.translate('changesAppRestart'),
            proxy: deps.translate('proxy'),
            proxyHost: deps.translate('proxyHost'),
            proxyPort: deps.translate('proxyPort'),
            enableProxy: deps.translate('enableProxy'),
            webhooks: deps.translate('webhooks'),
            discord: deps.translate('discord'),
            enableWebhooks: deps.translate('enableWebhooks'),
            webhookUrl: deps.translate('webhookUrl'),
            webhookTrigger: deps.translate('webhookTrigger'),
            webhookDescription: deps.translate('webhookDescription'),
            showWebhookExample: deps.translate('showWebhookExample'),
            enableRichPresence: deps.translate('enableRichPresence'),
            displaySmallIcon: deps.translate('displaySmallIcon'),
            displayButtons: deps.translate('displayButtons'),
            useArtistInStatusLine: deps.translate('useArtistInStatusLine'),
            enableRichPresencePreview: deps.translate('enableRichPresencePreview'),
            richPresencePreview: deps.translate('richPresencePreview'),
            richPresencePreviewDescription: deps.translate('richPresencePreviewDescription'),
            applyChanges: deps.translate('applyChanges'),
            minimizeToTray: deps.translate('minimizeToTray'),
            enableNavigationControls: deps.translate('enableNavigationControls'),
            enableTrackParser: deps.translate('enableTrackParser'),
            trackParserDescription: deps.translate('trackParserDescription'),
            pressF1ToOpenSettings: deps.translate('pressF1ToOpenSettings'),
            closeSettings: deps.translate('closeSettings'),
            noActivityToShow: deps.translate('noActivityToShow'),
            richPresencePreviewTitle: deps.translate('richPresencePreviewTitle'),
            hidePromotions: deps.translate('hidePromotions'),
            hideEventsNearYou: deps.translate('hideEventsNearYou'),
            hideArtistUpsells: deps.translate('hideArtistUpsells'),
        };
    });
}
