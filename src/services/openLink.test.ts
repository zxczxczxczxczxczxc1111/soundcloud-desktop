import { expect, it } from 'vitest';
import { OPEN_PAGE_URL, openPageUrl, parseOpenLink, publicTrackPath } from './openLink';

it('путь публичного трека; приватный трек, чужой сайт и не трек пустые', () => {
    expect(publicTrackPath('https://soundcloud.com/Mighty_Mason/krovyu-1?in=x#t=1')).toBe('/mighty_mason/krovyu-1');
    expect(publicTrackPath('https://soundcloud.com/mighty_mason/krovyu-1/')).toBe('/mighty_mason/krovyu-1');
    expect(publicTrackPath('https://soundcloud.com/user/track/s-AbCdEf')).toBe('');
    expect(publicTrackPath('https://soundcloud.com/user')).toBe('');
    expect(publicTrackPath('https://soundcloud.com.evil.test/user/track')).toBe('');
    expect(publicTrackPath('https://user:pass@soundcloud.com/user/track')).toBe('');
    expect(publicTrackPath('not a url')).toBe('');
});

it('кнопка Discord ведёт на переходник, у приватного трека кнопки нет', () => {
    expect(openPageUrl('https://soundcloud.com/mighty_mason/krovyu-1')).toBe(OPEN_PAGE_URL + '?t=mighty_mason/krovyu-1');
    expect(openPageUrl('https://soundcloud.com/user/track/s-AbCdEf')).toBeUndefined();
    expect((openPageUrl('https://soundcloud.com/' + 'a'.repeat(100) + '/' + 'b'.repeat(255)) ?? '').length).toBeLessThanOrEqual(512);
});

it('ссылка протокола: при холодном старте и во втором экземпляре, после --', () => {
    expect(parseOpenLink(['C:\\SoundCloud.exe', '--', 'soundcloud-desktop://track/mighty_mason/krovyu-1'])).toBe('/mighty_mason/krovyu-1');
    // Браузер может дописать косую черту в конце
    expect(parseOpenLink(['SoundCloud.exe', 'soundcloud-desktop://track/mighty_mason/krovyu-1/'])).toBe('/mighty_mason/krovyu-1');
    expect(parseOpenLink(['SoundCloud.exe', '--dev'])).toBeNull();
});

it('ссылка протокола по белому списку: чужие действия, лишние части и подмены отбрасываются', () => {
    for (const bad of [
        'soundcloud-desktop://playlist/user/set', 'soundcloud-desktop://track/user', 'soundcloud-desktop://track/user/a/b',
        'soundcloud-desktop://track/../etc', 'soundcloud-desktop://track/user/track%2F..', 'soundcloud-desktop://x@track/user/track',
        'soundcloud-desktop://track:80/user/track', 'soundcloud-desktop://track/us er/track', 'https://soundcloud.com/user/track',
        'soundcloud-desktop://track/' + 'a'.repeat(700),
    ]) expect(parseOpenLink(['SoundCloud.exe', '--', bad])).toBeNull();
});
