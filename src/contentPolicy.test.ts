import { describe, expect, it } from 'vitest';
import { isSoundCloudUrl, isWebUrl } from './contentPolicy';
describe('navigation boundaries', () => {
    it('accepts real HTTPS origins only', () => {
        for (const url of ['https://soundcloud.com/a/b', 'https://secure.soundcloud.com/']) expect(isSoundCloudUrl(url)).toBe(true);
        for (const url of ['https://soundcloud.com.evil.test', 'https://soundcloud.com@evil.test', 'http://soundcloud.com', 'file:///C:/test', 'javascript:alert(1)', 'https://user:pass@soundcloud.com']) expect(isSoundCloudUrl(url)).toBe(false);
        expect(isWebUrl('https://accounts.google.com')).toBe(true);
        expect(isWebUrl('ms-settings:')).toBe(false);
    });
});
