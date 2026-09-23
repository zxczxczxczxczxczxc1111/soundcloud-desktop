import { ActivityType } from 'discord-api-types/v10';
import { Client as DiscordClient, type SetActivity } from '@xhayper/discord-rpc';
import type { TranslationService } from './translationService';
import { normalizeTrackInfo } from '../utils/trackParser';
import type { TrackInfo } from '../types';

interface Settings {
    get(key: string, fallback?: unknown): unknown;
}
export const PRESENCE_INTERVAL_MS = 5000;
export const GITHUB_REPOSITORY_URL = 'https://github.com/zxczxczxczxczxczxc1111/soundcloud-desktop';
export const GITHUB_ICON_URL = 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png';

function seconds(value: string): number {
    const parts = value.trim().replace(/^-/, '').split(':').map(Number);
    if (parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
    return parts.reduce((total, part) => total * 60 + part, 0) * (value.trim().startsWith('-') ? -1 : 1);
}
function label(value: string): string {
    const chars = Array.from(value);
    return (chars.length > 128 ? chars.slice(0, 125).join('') + '...' : value).padEnd(2, ' ');
}
// Ссылки для кликабельных полей: только страницы SoundCloud.
function soundcloudLink(value: string): string | undefined {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && (url.hostname === 'soundcloud.com' || url.hostname.endsWith('.soundcloud.com'))
            ? url.toString()
            : undefined;
    } catch {
        return undefined;
    }
}

export class PresenceService {
    private rpc: DiscordClient | null = null;
    private latest: { track: TrackInfo; observedAt: number } | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private running: Promise<void> | null = null;
    private disposed = false;
    private revision = 0;
    private lastSentAt = -Infinity;
    private lastPayload: string | null = null;
    private retryMs = 2000;
    private displaySCSmallIcon: boolean;
    private displayButtons: boolean;
    private statusDisplayType: number;

    constructor(
        private store: Settings,
        private translationService: Pick<TranslationService, 'translate'>,
    ) {
        this.displaySCSmallIcon = store.get('displaySCSmallIcon', false) === true;
        this.displayButtons = store.get('displayButtons', false) === true;
        this.statusDisplayType = Number(store.get('statusDisplayType', 1));
    }
    public async updatePresence(track: TrackInfo): Promise<void> {
        if (this.disposed) return;
        this.latest = { track: { ...track }, observedAt: Date.now() };
        this.revision++;
        if (!this.timer) await this.flush();
    }
    private schedule(delay: number): void {
        if (this.disposed || this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.flush();
        }, delay);
        this.timer.unref?.();
    }
    private smallBadge(): Pick<SetActivity, 'smallImageKey' | 'smallImageText' | 'smallImageUrl'> {
        if (this.store.get('displayGithubLink', true) === true) {
            return { smallImageKey: GITHUB_ICON_URL, smallImageText: 'SoundCloud Desktop на GitHub', smallImageUrl: GITHUB_REPOSITORY_URL };
        }
        return { smallImageKey: this.displaySCSmallIcon ? 'soundcloud-logo' : undefined, smallImageText: this.displaySCSmallIcon ? 'SoundCloud' : undefined };
    }
    private activity(): SetActivity | null {
        if (this.store.get('discordRichPresence') !== true || !this.latest) return null;
        const { track, observedAt } = this.latest;
        // На паузе статус не транслируется.
        if (!track.isPlaying || !track.title || !track.author) return null;
        const elapsed = Math.max(0, seconds(track.elapsed));
        const rawDuration = seconds(track.duration);
        const duration = rawDuration < 0 ? elapsed - rawDuration : rawDuration;
        if (duration <= 0) return null;
        const normalized = normalizeTrackInfo(
            track.title,
            track.author,
            this.store.get('trackParserEnabled', true) === true,
        );
        const startTimestamp = observedAt - elapsed * 1000;
        const trackUrl = soundcloudLink(track.url);
        return {
            type: ActivityType.Listening,
            // Заголовок карточки всегда «Listening to SoundCloud», артиста показывает statusDisplayType.
            name: 'SoundCloud',
            details: label(normalized.track),
            detailsUrl: trackUrl,
            state: label(normalized.artist),
            stateUrl: soundcloudLink(track.artistUrl),
            largeImageKey: track.artwork ? track.artwork.replace('50x50.', '500x500.') : undefined,
            largeImageUrl: trackUrl,
            startTimestamp,
            endTimestamp: startTimestamp + duration * 1000,
            ...this.smallBadge(),
            statusDisplayType: this.statusDisplayType,
            buttons:
                this.displayButtons && track.url
                    ? [{ label: this.translationService.translate('listenOnSoundcloud'), url: track.url }]
                    : undefined,
        };
    }
    private async flush(): Promise<void> {
        if (this.disposed) return;
        if (this.running) return this.running;
        const delay = this.lastSentAt + PRESENCE_INTERVAL_MS - Date.now();
        if (delay > 0) {
            this.schedule(delay);
            return;
        }
        const revision = this.revision;
        this.running = this.send();
        try {
            await this.running;
        } finally {
            this.running = null;
            if (revision !== this.revision && !this.timer && this.activity()) this.schedule(0);
        }
    }
    private async send(): Promise<void> {
        try {
            if (this.activity() && !this.rpc?.isConnected) {
                const rpc = this.rpc ?? new DiscordClient({ clientId: '1552246011626389554' });
                if (!this.rpc) {
                    this.rpc = rpc;
                    rpc.on('disconnected', () => {
                        if (this.rpc !== rpc || this.disposed) return;
                        this.lastPayload = null;
                        if (this.activity()) this.schedule(2000);
                    });
                }
                await rpc.login();
            }
            if (this.disposed) return;
            // Пока шло подключение, трек или настройка могли измениться.
            const revision = this.revision;
            const activity = this.activity();
            const payload = JSON.stringify(activity);
            if (!this.rpc?.isConnected || !this.rpc.user || payload === this.lastPayload) return;
            if (activity) await this.rpc.user.setActivity(activity);
            else await this.rpc.user.clearActivity();
            this.lastPayload = payload;
            this.lastSentAt = Date.now();
            this.retryMs = 2000;
            if (revision !== this.revision) this.schedule(PRESENCE_INTERVAL_MS);
        } catch (error) {
            console.error('Discord: не удалось обновить активность:', error);
            const failed = this.rpc;
            this.rpc = null;
            this.lastPayload = null;
            if (failed)
                await failed.destroy().catch((cause: unknown) => console.error('Discord: ошибка закрытия:', cause));
            if (this.activity()) {
                this.schedule(this.retryMs);
                this.retryMs = Math.min(this.retryMs * 2, 30000);
            }
        }
    }
    public updateDisplaySettings(smallIcon: boolean, buttons?: boolean): void {
        this.displaySCSmallIcon = smallIcon;
        if (buttons !== undefined) this.displayButtons = buttons;
        this.revision++;
        void this.flush();
    }
    public setStatusDisplayType(value: number): void {
        this.statusDisplayType = value;
        this.revision++;
        void this.flush();
    }
    public async reconnect(): Promise<void> {
        this.lastPayload = null;
        await this.flush();
    }
    public isConnected(): boolean {
        return this.rpc?.isConnected ?? false;
    }
    public clearActivity(): void {
        this.latest = null;
        this.revision++;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        void this.flush();
    }
    public async dispose(): Promise<void> {
        this.disposed = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        const rpc = this.rpc;
        this.rpc = null;
        if (rpc) await rpc.destroy().catch((error: unknown) => console.error('Discord: ошибка закрытия:', error));
    }
}
