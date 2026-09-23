const booleanKeys = new Set(['adBlocker', 'proxyEnabled', 'webhookEnabled', 'displaySCSmallIcon', 'displayGithubLink', 'discordRichPresence', 'displayButtons', 'minimizeToTray', 'navigationControlsEnabled', 'trackParserEnabled', 'richPresencePreviewEnabled', 'hidePromotions', 'hideEventsNearYou', 'hideArtistUpsells']);
type BooleanKey = 'adBlocker' | 'proxyEnabled' | 'webhookEnabled' | 'displaySCSmallIcon' | 'displayGithubLink' | 'discordRichPresence' | 'displayButtons' | 'minimizeToTray' | 'navigationControlsEnabled' | 'trackParserEnabled' | 'richPresencePreviewEnabled' | 'hidePromotions' | 'hideEventsNearYou' | 'hideArtistUpsells';
type StringKey = 'proxyHost' | 'proxyPort' | 'proxyUsername' | 'proxyPassword' | 'webhookUrl' | 'customTheme';
export type SettingChange = { key: BooleanKey; value: boolean } | { key: StringKey; value: string } | { key: 'webhookTriggerPercentage' | 'statusDisplayType'; value: number } | { key: 'theme'; value: 'dark' | 'light' };

export function validateSettingChange(input: unknown): input is SettingChange {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
    const { key, value } = input as Record<string, unknown>;
    if (typeof key !== 'string') return false;
    if (booleanKeys.has(key)) return typeof value === 'boolean';
    if (key === 'theme') return value === 'dark' || value === 'light';
    if (key === 'statusDisplayType') return value === 0 || value === 1 || value === 2;
    if (key === 'webhookTriggerPercentage') return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
    if (typeof value !== 'string') return false;
    if (key === 'proxyPassword') return value.length <= 4096;
    if (key === 'proxyHost' || key === 'proxyUsername' || key === 'customTheme') return value.length <= 256 && !/[\r\n\0]/.test(value);
    if (key === 'proxyPort') return /^\d{0,5}$/.test(value) && (!value || (Number(value) >= 1 && Number(value) <= 65535));
    if (key === 'webhookUrl') {
        if (!value) return true;
        if (value.length > 2048) return false;
        try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
    }
    return false;
}
