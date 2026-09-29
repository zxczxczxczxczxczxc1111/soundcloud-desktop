import { describe, expect, it } from 'vitest';
import { isShortLink, isSoundCloudUrl, isWebUrl, shortLinkTarget, sitePagePath } from './contentPolicy';
describe('короткая ссылка on.soundcloud.com', () => {
    it('узнаётся только сама короткая ссылка', () => {
        expect(isShortLink('https://on.soundcloud.com/9BWtqT2nIcIiAubq3X')).toBe(true);
        expect(isShortLink('https://on.soundcloud.com/9BWtqT2nIcIiAubq3X/')).toBe(true);
        for (const url of ['https://on.soundcloud.com/', 'https://on.soundcloud.com/a/b', 'http://on.soundcloud.com/abc', 'https://x@on.soundcloud.com/abc',
            'https://on.soundcloud.com.evil.test/abc', 'https://soundcloud.com/abc', 'not a url']) expect(isShortLink(url)).toBe(false);
    });
    it('ведёт на страницу soundcloud.com без меток шаринга, другой адрес отбрасывается', () => {
        expect(shortLinkTarget('https://soundcloud.com/harleyvexx?ref=clipboard&p=a&c=1&si=0ef6&utm_source=clipboard')).toBe('https://soundcloud.com/harleyvexx');
        expect(shortLinkTarget('/griffith_lifts/anabolic-rage-broly/')).toBeNull();
        for (const url of ['https://evil.test/a', 'http://soundcloud.com/a', 'https://soundcloud.com/', 'https://on.soundcloud.com/abc', 'https://a@soundcloud.com/x', 'https://soundcloud.com:8443/a'])
            expect(shortLinkTarget(url)).toBeNull();
    });
});
describe('полная загрузка страницы сайта вместо перехода внутри него', () => {
    const here = 'https://soundcloud.com/discover';
    it('страницы пользователя, трека и плейлиста ведёт роутер сайта', () => {
        expect(sitePagePath('https://soundcloud.com/oslated', here)).toBe('/oslated');
        expect(sitePagePath('https://soundcloud.com/oslated/epsilon-concord', here)).toBe('/oslated/epsilon-concord');
        expect(sitePagePath('https://soundcloud.com/oslated/sets/presence-ii#top', here)).toBe('/oslated/sets/presence-ii');
        expect(sitePagePath('https://soundcloud.com/oslated/epsilon-concord?in=oslated/sets/presence-ii', here)).toBe('/oslated/epsilon-concord?in=oslated/sets/presence-ii');
    });
    it('служебные маршруты, чужие адреса, повтор текущей страницы и странные пути грузятся как просили', () => {
        for (const target of [
            'https://soundcloud.com/logout', 'https://soundcloud.com/signin/callback', 'https://soundcloud.com/connect',
            'https://secure.soundcloud.com/web-auth', 'https://soundcloud.com.evil.test/a', 'http://soundcloud.com/a', 'https://user@soundcloud.com/a', 'https://soundcloud.com:8443/a',
            'https://soundcloud.com/', 'https://soundcloud.com/a/b/download', 'https://soundcloud.com/A/b', 'https://soundcloud.com/a?q=(x)', 'https://soundcloud.com/discover', 'not a url',
        ]) expect(sitePagePath(target, here)).toBeNull();
        expect(sitePagePath('https://soundcloud.com/a', 'https://secure.soundcloud.com/web-auth')).toBeNull();
        expect(sitePagePath('https://soundcloud.com/a', 'about:blank')).toBeNull();
    });
});
describe('navigation boundaries', () => {
    it('accepts real HTTPS origins only', () => {
        for (const url of ['https://soundcloud.com/a/b', 'https://secure.soundcloud.com/']) expect(isSoundCloudUrl(url)).toBe(true);
        for (const url of ['https://soundcloud.com.evil.test', 'https://soundcloud.com@evil.test', 'http://soundcloud.com', 'file:///C:/test', 'javascript:alert(1)', 'https://user:pass@soundcloud.com']) expect(isSoundCloudUrl(url)).toBe(false);
        expect(isWebUrl('https://accounts.google.com')).toBe(true);
        expect(isWebUrl('ms-settings:')).toBe(false);
    });
});
