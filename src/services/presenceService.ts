import { ActivityType } from 'discord-api-types/v10';
import { Client as DiscordClient, type SetActivity } from '@xhayper/discord-rpc';
import type { TranslationService } from './translationService';
import { normalizeTrackInfo } from '../utils/trackParser';
import { genreKeys, normalizeTag, trackMatchesGenre } from './wave';
import type { TrackInfo, TrackMeta } from '../types';

interface Settings {
    get(key: string, fallback?: unknown): unknown;
}
export const PRESENCE_INTERVAL_MS = 5000;
export const GITHUB_REPOSITORY_URL = 'https://github.com/zxczxczxczxczxczxc1111/soundcloud-desktop';
export const GITHUB_ICON_URL = 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png';
/** Ассет приложения Discord: логотип вместо обложки, когда картинки нет */
export const LOGO_ASSET = 'soundcloud-logo';

/** Строки карточки по умолчанию; пустая строка в настройке значит «строку не показывать» */
export const TEMPLATE_DEFAULTS = { discordLine1: '{track}', discordLine2: '{artist}', discordCoverText: '' } as const;
export type TemplateKey = keyof typeof TEMPLATE_DEFAULTS;

/** Что увидит Discord: для предпросмотра в F1 */
export interface PresenceCard {
    details: string;
    state: string;
    largeText: string;
    /** Адрес картинки или ключ ассета приложения */
    image: string;
    /** Текст после «Listening to» под ником */
    statusLine: string;
}
/** Почему карточки нет: выключено, пауза, инкогнито или артист либо жанр в стоп-списке */
export type PresenceHidden = 'off' | 'idle' | 'incognito' | 'artist' | 'genre';
export interface PresencePreview {
    card: PresenceCard | null;
    hidden: PresenceHidden | null;
}

function seconds(value: string): number {
    const parts = value.trim().replace(/^-/, '').split(':').map(Number);
    if (parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
    return parts.reduce((total, part) => total * 60 + part, 0) * (value.trim().startsWith('-') ? -1 : 1);
}
// Discord принимает строки от 2 до 128 символов; короче строка не отправляется вовсе
function label(value: string): string | undefined {
    const chars = Array.from(value.trim());
    if (!chars.length) return undefined;
    return (chars.length > 128 ? chars.slice(0, 125).join('') + '...' : chars.join('')).padEnd(2, ' ');
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
function sameTrack(a: string, b: string): boolean {
    const key = (value: string): string => value.split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
    return !!a && !!b && key(a) === key(b);
}

// Формы: 1 прослушивание, 2 прослушивания, 5 прослушиваний
function pluralIndex(count: number): number {
    const tail = Math.abs(count) % 100;
    const last = tail % 10;
    if (tail > 10 && tail < 20) return 2;
    if (last === 1) return 0;
    return last > 1 && last < 5 ? 1 : 2;
}
const COUNT_WORDS = {
    ru: { plays: ['прослушивание', 'прослушивания', 'прослушиваний'], likes: ['лайк', 'лайка', 'лайков'] },
    en: { plays: ['play', 'plays', 'plays'], likes: ['like', 'likes', 'likes'] },
};
/** Число со словом: «120,8 тыс. прослушиваний», «21 лайк», «1.2M plays». Ноль значит «неизвестно», и строка пустая */
export function formatCount(value: number, kind: 'plays' | 'likes', language: 'ru' | 'en'): string {
    if (!Number.isFinite(value) || value <= 0) return '';
    const words = COUNT_WORDS[language][kind];
    const count = Math.floor(value);
    if (count < 1000) return count + ' ' + (language === 'ru' ? words[pluralIndex(count)] : words[count === 1 ? 0 : 1]);
    const short = new Intl.NumberFormat(language === 'ru' ? 'ru-RU' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(count);
    return short + ' ' + words[2];
}

// Разделители, которые остаются висеть, когда поле шаблона пустое: «{artist} · {genre}» без жанра
const SEPARATORS = '·•|/,:\\-\\u2013\\u2014';
/** Подставляет поля и убирает следы пустых: висящие и сдвоенные разделители, пустые скобки */
export function renderTemplate(template: string, values: Record<string, string>): string {
    return template
        .replace(/\{(\w+)\}/g, (all, name: string) => (Object.prototype.hasOwnProperty.call(values, name) ? values[name] : all))
        .replace(/\(\s*\)|\[\s*\]/g, '')
        .replace(new RegExp('\\s*([' + SEPARATORS + '])(\\s*[' + SEPARATORS + '])+\\s*', 'g'), ' $1 ')
        .replace(new RegExp('^[\\s' + SEPARATORS + ']+|[\\s' + SEPARATORS + ']+$', 'g'), '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Стоп-лист из строки настроек: через запятую, точку с запятой или с новой строки */
export function parseList(value: unknown): string[] {
    if (typeof value !== 'string') return [];
    return [...new Set(value.split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean))].slice(0, 200);
}

export class PresenceService {
    private rpc: DiscordClient | null = null;
    private latest: { track: TrackInfo; observedAt: number } | null = null;
    private meta: TrackMeta | null = null;
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
    /** Жанр, счётчики и волна текущего трека со страницы: приходят отдельно от TrackInfo */
    public updateMeta(meta: TrackMeta): void {
        if (this.disposed) return;
        this.meta = { ...meta };
        this.revision++;
        if (!this.timer) void this.flush();
    }
    /** Настройки карточки поменялись (шаблоны, инкогнито, стоп-листы): пересобрать и отправить */
    public refresh(): void {
        this.revision++;
        void this.flush();
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
            return { smallImageKey: GITHUB_ICON_URL, smallImageText: this.translationService.translate('githubBadge'), smallImageUrl: GITHUB_REPOSITORY_URL };
        }
        return { smallImageKey: this.displaySCSmallIcon ? LOGO_ASSET : undefined, smallImageText: this.displaySCSmallIcon ? 'SoundCloud' : undefined };
    }
    private language(): 'ru' | 'en' {
        return this.store.get('siteLanguage', 'ru') === 'en' ? 'en' : 'ru';
    }
    private template(key: TemplateKey): string {
        const value = this.store.get(key, TEMPLATE_DEFAULTS[key]);
        return typeof value === 'string' ? value : TEMPLATE_DEFAULTS[key];
    }
    // Обложка трека; у трека без неё сайт сам ставит аватар артиста. Серая заглушка SoundCloud картинкой не считается
    private image(track: TrackInfo, meta: TrackMeta | null): string {
        const real = (url: string | undefined): url is string => !!url && !/\/images\/default_avatar/.test(url);
        if (real(track.artwork)) return track.artwork.replace('50x50.', '500x500.');
        const fallback = meta?.artwork || meta?.avatar;
        if (real(fallback)) return fallback.replace(/-large\.(jpg|png)/, '-t500x500.$1');
        return LOGO_ASSET;
    }
    private hiddenBy(track: TrackInfo, artist: string, meta: TrackMeta | null): PresenceHidden | null {
        if (this.store.get('discordIncognito', false) === true) return 'incognito';
        const artists = new Set(parseList(this.store.get('discordHiddenArtists', '')).map(normalizeTag).filter(Boolean));
        const names = [track.author, artist, meta?.artist ?? ''].map(normalizeTag).filter(Boolean);
        if (names.some((name) => artists.has(name))) return 'artist';
        const genres = parseList(this.store.get('discordHiddenGenres', ''));
        if (meta && genres.some((genre) => trackMatchesGenre({ id: meta.id, genre: meta.genre, tag_list: meta.tags }, genreKeys(genre)))) return 'genre';
        return null;
    }
    private evaluate(): { activity: SetActivity | null } & PresencePreview {
        if (this.store.get('discordRichPresence') !== true) return { activity: null, card: null, hidden: 'off' };
        const latest = this.latest;
        // На паузе статус не транслируется.
        if (!latest || !latest.track.isPlaying || !latest.track.title || !latest.track.author) return { activity: null, card: null, hidden: 'idle' };
        const { track, observedAt } = latest;
        const elapsed = Math.max(0, seconds(track.elapsed));
        const rawDuration = seconds(track.duration);
        const duration = rawDuration < 0 ? elapsed - rawDuration : rawDuration;
        if (duration <= 0) return { activity: null, card: null, hidden: 'idle' };
        const normalized = normalizeTrackInfo(track.title, track.author, this.store.get('trackParserEnabled', true) === true);
        // Сведения со страницы годятся, только если они про этот же трек
        const meta = this.meta && sameTrack(this.meta.url, track.url) ? this.meta : null;
        const hidden = this.hiddenBy(track, normalized.artist, meta);
        if (hidden) return { activity: null, card: null, hidden };
        const language = this.language();
        const values: Record<string, string> = {
            track: normalized.track,
            artist: normalized.artist,
            genre: meta?.genre ?? '',
            wave: meta?.wave ?? '',
            plays: formatCount(meta?.plays ?? 0, 'plays', language),
            likes: formatCount(meta?.likes ?? 0, 'likes', language),
        };
        const card: PresenceCard = {
            details: renderTemplate(this.template('discordLine1'), values),
            state: renderTemplate(this.template('discordLine2'), values),
            largeText: renderTemplate(this.template('discordCoverText'), values),
            image: this.image(track, meta),
            statusLine: '',
        };
        const details = label(card.details);
        const state = label(card.state);
        card.statusLine = (this.statusDisplayType === 1 ? state : this.statusDisplayType === 2 ? details : undefined)?.trim() || 'SoundCloud';
        const startTimestamp = observedAt - elapsed * 1000;
        const trackUrl = soundcloudLink(track.url);
        const activity: SetActivity = {
            type: ActivityType.Listening,
            // Заголовок карточки всегда «Listening to SoundCloud», строку под ником выбирает statusDisplayType.
            name: 'SoundCloud',
            details,
            detailsUrl: details ? trackUrl : undefined,
            state,
            stateUrl: state ? soundcloudLink(track.artistUrl) : undefined,
            largeImageKey: card.image,
            largeImageText: label(card.largeText),
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
        return { activity, card, hidden: null };
    }
    private activity(): SetActivity | null {
        return this.evaluate().activity;
    }
    /** Карточка, какой её сейчас видит Discord, или причина, почему её нет */
    public preview(): PresencePreview {
        const { card, hidden } = this.evaluate();
        return { card, hidden };
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
