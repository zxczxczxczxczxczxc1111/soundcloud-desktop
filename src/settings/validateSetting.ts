import { HOME_BLOCK_KEYS, type HomeBlockKey } from '../services/homeBlocks';
import { isGpuCompatibilityMode, type GpuCompatibilityMode } from '../services/gpuProcessMode';
import { isRadarDay, isRadarTime, isTimeZone } from '../services/radarSchedule';

const booleanKeys = new Set(['adBlocker', 'proxyEnabled', 'webhookEnabled', 'displaySCSmallIcon', 'displayGithubLink', 'discordRichPresence', 'displayButtons', 'minimizeToTray', 'navigationControlsEnabled', 'trackParserEnabled', 'richPresencePreviewEnabled', 'hidePromotions', 'hideEventsNearYou', 'hideArtistUpsells', 'hideHeaderExtras', 'fullShuffle', 'autoUpdateEnabled', 'discordIncognito', 'reduceMotion', ...HOME_BLOCK_KEYS]);
type BooleanKey = 'adBlocker' | 'proxyEnabled' | 'webhookEnabled' | 'displaySCSmallIcon' | 'displayGithubLink' | 'discordRichPresence' | 'displayButtons' | 'minimizeToTray' | 'navigationControlsEnabled' | 'trackParserEnabled' | 'richPresencePreviewEnabled' | 'hidePromotions' | 'hideEventsNearYou' | 'hideArtistUpsells' | 'hideHeaderExtras' | 'fullShuffle' | 'autoUpdateEnabled' | 'discordIncognito' | 'reduceMotion' | HomeBlockKey;
type StringKey = 'proxyHost' | 'proxyPort' | 'proxyUsername' | 'proxyPassword' | 'webhookUrl' | DiscordTextKey;
/** Шаблоны строк карточки Discord и стоп-листы артистов и жанров */
export type DiscordTextKey = 'discordLine1' | 'discordLine2' | 'discordCoverText' | 'discordHiddenArtists' | 'discordHiddenGenres';
export const DISCORD_TEXT_KEYS: ReadonlySet<string> = new Set<DiscordTextKey>(['discordLine1', 'discordLine2', 'discordCoverText', 'discordHiddenArtists', 'discordHiddenGenres']);
export type SettingChange = { key: BooleanKey; value: boolean } | { key: StringKey; value: string } | { key: 'webhookTriggerPercentage' | 'statusDisplayType'; value: number } | { key: 'siteLanguage'; value: 'ru' | 'en' } | { key: 'gpuCompatibilityMode'; value: GpuCompatibilityMode }
    | { key: 'radarDay'; value: number } | { key: 'radarTime' | 'radarZone'; value: string };

export function validateSettingChange(input: unknown): input is SettingChange {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
    const { key, value } = input as Record<string, unknown>;
    if (typeof key !== 'string') return false;
    if (booleanKeys.has(key)) return typeof value === 'boolean';
    if (key === 'gpuCompatibilityMode') return isGpuCompatibilityMode(value);
    if (key === 'siteLanguage') return value === 'ru' || value === 'en';
    if (key === 'statusDisplayType') return value === 0 || value === 1 || value === 2;
    if (key === 'webhookTriggerPercentage') return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
    // Расписание радара: день недели, время «ЧЧ:ММ» и IANA-зона
    if (key === 'radarDay') return isRadarDay(value);
    if (key === 'radarTime') return isRadarTime(value);
    if (key === 'radarZone') return isTimeZone(value);
    if (typeof value !== 'string') return false;
    if (key === 'proxyPassword') return value.length <= 4096;
    if (key === 'proxyHost' || key === 'proxyUsername') return value.length <= 256 && !/[\r\n\0]/.test(value);
    // Шаблон это одна строка карточки; стоп-листы бывают в несколько строк
    if (key === 'discordLine1' || key === 'discordLine2' || key === 'discordCoverText') return value.length <= 256 && !/[\r\n\0]/.test(value);
    if (key === 'discordHiddenArtists' || key === 'discordHiddenGenres') return value.length <= 4000 && !value.includes('\0');
    if (key === 'proxyPort') return /^\d{0,5}$/.test(value) && (!value || (Number(value) >= 1 && Number(value) <= 65535));
    if (key === 'webhookUrl') {
        if (!value) return true;
        if (value.length > 2048) return false;
        try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
    }
    return false;
}
