// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { HOME_BLOCK_KEYS, homeBlockDefaults, homeBlocksCss, installHomePage, isHomeBlockKey } from './homeBlocks';

const page = window as Window & { __scSiteTranslation?: { language: string } };

function shelf(title: string, tile = ''): string {
    return `<li class="mixedModularHome__item"><div class="mixedSelectionModule"><h2 class="mixedSelectionModule__titleText">${title}</h2>${tile}</div></li>`;
}

afterEach(() => {
    window.dispatchEvent(new Event('pagehide'));
    delete page.__scSiteTranslation;
    document.body.innerHTML = '';
    history.replaceState(null, '', '/');
});

it('по умолчанию скрыты полки и подсказки, выбранные для волны', () => {
    const hidden = HOME_BLOCK_KEYS.filter((key) => !homeBlockDefaults[key]);
    expect(hidden).toEqual(['homeMore', 'homeMixed', 'homeStations', 'homeNewTracks', 'homeFollow', 'homeMobile']);
    expect(isHomeBlockKey('homeWave')).toBe(true);
    expect(isHomeBlockKey('hidePromotions')).toBe(false);
    expect(isHomeBlockKey('__proto__')).toBe(false);
});

it('CSS прячет только выключенные блоки и только под меткой главной', () => {
    expect(homeBlocksCss(() => true)).toBe('');
    const css = homeBlocksCss((key) => key !== 'homeFollow' && key !== 'homeMore' && key !== 'homeMobile');
    expect(css).toBe(
        'html[data-sc-home] [data-sc-shelf="more"],html[data-sc-home] .l-sidebar-right .whoToFollowModule,' +
            'html[data-sc-home] .l-sidebar-right .mobileApps,html[data-sc-home] .l-sidebar-right .l-footer{display:none!important}',
    );
    expect(css).not.toContain('.loading');
    // Все полки сайта выключены: заготовка загрузки полок под волной тоже не видна
    const shelvesOff = homeBlocksCss((key) => !/^home(More|Recent|Mixed|Stations|Trending|Made|Curated|Albums|Liked|Buzzing)$/.test(key));
    expect(shelvesOff).toContain('html[data-sc-home] .modular-home-mixed-selection>.loading{display:none!important}');
});

it('метит полки по заголовку, незнакомую оставляет видимой и без перевода', async () => {
    history.replaceState(null, '', '/discover');
    document.body.innerHTML = shelf('More of what you like') + shelf('Mixed for someone') + shelf('Something new');
    installHomePage();
    expect(document.documentElement.hasAttribute('data-sc-home')).toBe(true);
    const items = [...document.querySelectorAll('li')];
    expect(items.map((item) => item.getAttribute('data-sc-shelf'))).toEqual(['more', 'mixed', null]);
    expect(items[0].textContent).toBe('More of what you like');
});

it('полка, пришедшая позже, получает метку до отрисовки', async () => {
    history.replaceState(null, '', '/discover');
    installHomePage();
    document.body.insertAdjacentHTML('beforeend', shelf('Artists to watch out for'));
    await vi.waitFor(() => expect(document.querySelector('li')?.getAttribute('data-sc-shelf')).toBe('buzzing'));
});

it('с русским сайтом переводит серверные заголовки и подписи, не трогая ссылки', () => {
    page.__scSiteTranslation = { language: 'ru' };
    history.replaceState(null, '', '/discover');
    document.body.innerHTML =
        shelf('Made for you', '<div class="playableTile__heading">ximora\'s Picks</div>') +
        shelf('Mixed for <a href="/nick">nick</a>') +
        shelf('Discover with Stations', '<div class="playableTile__usernameHeading">Artist station</div><div class="playableTile__usernameHeading">Some Artist</div>');
    installHomePage();
    const titles = [...document.querySelectorAll('.mixedSelectionModule__titleText')].map((title) => title.textContent);
    expect(titles).toEqual(['Для тебя', 'Миксы для nick', 'Станции']);
    expect(document.querySelector('a')?.getAttribute('href')).toBe('/nick');
    expect(document.querySelector('.playableTile__heading')?.textContent).toBe('Выбор ximora');
    expect([...document.querySelectorAll('.playableTile__usernameHeading')].map((el) => el.textContent)).toEqual(['Станция артиста', 'Some Artist']);
    expect([...document.querySelectorAll('li')].map((item) => item.getAttribute('data-sc-shelf'))).toEqual(['made', 'mixed', 'stations']);
});

it('снимает метку главной на другой странице и при выгрузке', async () => {
    history.replaceState(null, '', '/discover');
    installHomePage();
    expect(document.documentElement.hasAttribute('data-sc-home')).toBe(true);
    history.pushState(null, '', '/feed');
    document.body.appendChild(document.createElement('div'));
    await vi.waitFor(() => expect(document.documentElement.hasAttribute('data-sc-home')).toBe(false));
    history.pushState(null, '', '/discover');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(document.documentElement.hasAttribute('data-sc-home')).toBe(true));
    window.dispatchEvent(new Event('pagehide'));
    expect(document.documentElement.hasAttribute('data-sc-home')).toBe(false);
});
