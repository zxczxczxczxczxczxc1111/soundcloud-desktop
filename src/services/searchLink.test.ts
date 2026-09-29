// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installSearchLink, pastedLink, searchLinkScript } from './searchLink';

it('ссылка из Telegram с метками, без https, мобильная и с www ведёт на чистую страницу soundcloud.com', () => {
    expect(pastedLink(' https://soundcloud.com/griffith_lifts/anabolic-rage-broly?si=90952bb974864cd1b46fb35e04b6a786&utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing\n'))
        .toBe('https://soundcloud.com/griffith_lifts/anabolic-rage-broly');
    expect(pastedLink('soundcloud.com/Griffith_Lifts/Anabolic-Rage-Broly/')).toBe('https://soundcloud.com/griffith_lifts/anabolic-rage-broly');
    expect(pastedLink('https://m.soundcloud.com/griffith_lifts/anabolic-rage-broly#t=1:05')).toBe('https://soundcloud.com/griffith_lifts/anabolic-rage-broly');
    expect(pastedLink('http://www.soundcloud.com/harleyvexx')).toBe('https://soundcloud.com/harleyvexx');
});

it('профиль, плейлист и секретная ссылка сохраняются, регистр ключа s-... не меняется', () => {
    expect(pastedLink('https://soundcloud.com/harleyvexx?ref=clipboard&p=a&c=1')).toBe('https://soundcloud.com/harleyvexx');
    expect(pastedLink('https://soundcloud.com/griffith_lifts/sets/gym-mix')).toBe('https://soundcloud.com/griffith_lifts/sets/gym-mix');
    expect(pastedLink('https://soundcloud.com/User/Track/s-AbCdEf')).toBe('https://soundcloud.com/user/track/s-AbCdEf');
    expect(pastedLink('https://soundcloud.com/user/sets/mix/s-AbCdEf')).toBe('https://soundcloud.com/user/sets/mix/s-AbCdEf');
});

it('короткая ссылка on.soundcloud.com остаётся короткой: её раскрывает клиент', () => {
    expect(pastedLink('https://on.soundcloud.com/9BWtqT2nIcIiAubq3X')).toBe('https://on.soundcloud.com/9BWtqT2nIcIiAubq3X');
    expect(pastedLink('on.soundcloud.com/9BWtqT2nIcIiAubq3X/')).toBe('https://on.soundcloud.com/9BWtqT2nIcIiAubq3X');
    expect(pastedLink('https://on.soundcloud.com/a/b')).toBeNull();
});

it('обычный запрос, чужие сайты, вход и выход остаются поиском', () => {
    for (const text of [
        '', '   ', 'anabolic rage broly', 'griffith lifts soundcloud.com/x', 'soundcloud.com', 'https://soundcloud.com/',
        'https://soundcloud.com.evil.test/user/track', 'https://evil.test/soundcloud.com/user/track', 'https://user:pass@soundcloud.com/a',
        'https://soundcloud.com:8443/a', 'https://soundcloud.com/logout', 'https://soundcloud.com/SignIn', 'https://soundcloud.com/a/b/c/d/e',
        'https://soundcloud.com/discover/sets/personalized-tracks::user:1', 'javascript:alert(1)', 'https://soundcloud.com/' + 'a'.repeat(1000),
    ]) expect(pastedLink(text)).toBeNull();
});

const navigate = vi.fn((path: string) => /^\/[a-z0-9_-]+(\/[a-z0-9_-]+)?$/.test(path));
const assign = vi.fn();
let input: HTMLInputElement;
beforeEach(() => {
    navigate.mockClear();
    assign.mockClear();
    document.body.innerHTML = '<form class="headerSearch"><input class="headerSearch__input" name="q" type="search"></form><input id="other">';
    input = document.querySelector<HTMLInputElement>('input[name="q"]')!;
    Object.assign(window, { __scNavigate: navigate });
    Object.defineProperty(window, 'location', { configurable: true, value: { assign } });
    installSearchLink(pastedLink);
});
afterEach(() => {
    window.dispatchEvent(new Event('pagehide'));
    document.body.innerHTML = '';
});

function paste(target: HTMLInputElement, text: string): Event {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => (type === 'text/plain' ? text : '') } });
    target.dispatchEvent(event);
    return event;
}

it('вставка ссылки в пустой поиск сразу открывает страницу переходом внутри сайта и очищает поле', () => {
    input.focus();
    const event = paste(input, 'https://soundcloud.com/griffith_lifts/anabolic-rage-broly?si=1');
    expect(event.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/griffith_lifts/anabolic-rage-broly');
    expect(assign).not.toHaveBeenCalled();
    expect(input.value).toBe('');
    expect(document.activeElement).not.toBe(input);
});

it('секретную и короткую ссылку, которые не берёт переход внутри сайта, открывает клиент', () => {
    paste(input, 'https://soundcloud.com/user/track/s-AbCdEf');
    expect(assign).toHaveBeenLastCalledWith('https://soundcloud.com/user/track/s-AbCdEf');
    paste(input, 'https://on.soundcloud.com/9BWtqT2nIcIiAubq3X');
    expect(navigate).not.toHaveBeenCalledWith(expect.stringContaining('9BWtqT2nIcIiAubq3X'));
    expect(assign).toHaveBeenLastCalledWith('https://on.soundcloud.com/9BWtqT2nIcIiAubq3X');
});

it('текст, вставка в середину запроса и другие поля не трогаются', () => {
    expect(paste(input, 'anabolic rage').defaultPrevented).toBe(false);
    input.value = 'broly ';
    input.setSelectionRange(6, 6);
    expect(paste(input, 'https://soundcloud.com/griffith_lifts/anabolic-rage-broly').defaultPrevented).toBe(false);
    expect(paste(document.querySelector<HTMLInputElement>('#other')!, 'https://soundcloud.com/griffith_lifts/anabolic-rage-broly').defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
});

it('вставка поверх выделенного целиком запроса открывает ссылку', () => {
    input.value = 'old query';
    input.setSelectionRange(0, input.value.length);
    expect(paste(input, 'soundcloud.com/harleyvexx').defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/harleyvexx');
});

it('набранная руками ссылка открывается по Enter, сайт своего Enter не получает; обычный запрос уходит сайту', () => {
    const siteEnter = vi.fn();
    input.addEventListener('keydown', siteEnter);
    input.value = 'soundcloud.com/harleyvexx';
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(siteEnter).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/harleyvexx');
    input.value = 'harley vexx';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(siteEnter).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledOnce();
});

it('отправка формы кнопкой поиска со ссылкой тоже открывает страницу', () => {
    input.value = 'https://soundcloud.com/griffith_lifts/sets/gym-mix';
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    input.form!.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/griffith_lifts/sets/gym-mix');
});

it('повторная установка снимает старые обработчики, страница получает самостоятельный текст', () => {
    installSearchLink(pastedLink);
    paste(input, 'soundcloud.com/harleyvexx');
    expect(navigate).toHaveBeenCalledOnce();
    expect(searchLinkScript()).not.toMatch(/require\(|exports\.|_1\./);
});
