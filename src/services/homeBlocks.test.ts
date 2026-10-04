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

it('по умолчанию на главной только волна и лайки справа', () => {
    const shown = HOME_BLOCK_KEYS.filter((key) => homeBlockDefaults[key]);
    expect(shown).toEqual(['homeWave', 'homeLikes']);
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
    const shelvesOff = homeBlocksCss((key) => !/^home(More|Recent|Mixed|Stations|Trending|Made|Curated|Albums|Liked|Buzzing|VoiceNotes|NewMusic|Other)$/.test(key));
    expect(shelvesOff).toContain('html[data-sc-home] .modular-home-mixed-selection>.loading{display:none!important}');
});

it('метит известные полки по заголовку, незнакомую относит к другим полкам без перевода', () => {
    history.replaceState(null, '', '/discover');
    document.body.innerHTML = shelf('More of what you like') + shelf('Mixed for someone') + shelf('Something new');
    installHomePage();
    expect(document.documentElement.hasAttribute('data-sc-home')).toBe(true);
    const items = [...document.querySelectorAll('li')];
    expect(items.map((item) => item.getAttribute('data-sc-shelf'))).toEqual(['more', 'mixed', 'other']);
    expect(items[0].textContent).toBe('More of what you like');
});

it('полка, пришедшая позже, получает метку до отрисовки', async () => {
    history.replaceState(null, '', '/discover');
    installHomePage();
    document.body.insertAdjacentHTML('beforeend', shelf('Artists to watch out for'));
    await vi.waitFor(() => expect(document.querySelector('li')?.getAttribute('data-sc-shelf')).toBe('buzzing'));
});

it('будущая полка автоматически скрывается, другие полки включаются независимо от известных', async () => {
    history.replaceState(null, '', '/discover');
    document.body.innerHTML = shelf('More of what you like') + '<section id="sc-wave">Моя волна</section><aside class="l-sidebar-right"><div class="likesModule">Лайки</div></aside>';
    installHomePage();
    const style = document.createElement('style');
    style.textContent = homeBlocksCss((key) => homeBlockDefaults[key]);
    document.body.append(style);
    document.body.insertAdjacentHTML('beforeend', shelf('Something new'));
    const unknown = document.querySelector('li:last-of-type')!;
    await vi.waitFor(() => expect(unknown.getAttribute('data-sc-shelf')).toBe('other'));
    expect(getComputedStyle(unknown).display).toBe('none');
    expect(unknown.textContent).toBe('Something new');
    expect(getComputedStyle(document.querySelector('#sc-wave')!).display).not.toBe('none');
    expect(getComputedStyle(document.querySelector('.likesModule')!).display).not.toBe('none');
    style.textContent = homeBlocksCss((key) => key === 'homeOther' || homeBlockDefaults[key]);
    expect(getComputedStyle(unknown).display).not.toBe('none');
    expect(getComputedStyle(document.querySelector('li')!).display).toBe('none');
    history.pushState(null, '', '/feed');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(document.documentElement.hasAttribute('data-sc-home')).toBe(false));
    style.textContent = homeBlocksCss((key) => homeBlockDefaults[key]);
    expect(getComputedStyle(unknown).display).not.toBe('none');
});

it('полка голосовых от артистов метится и по умолчанию скрыта', () => {
    history.replaceState(null, '', '/discover');
    document.body.innerHTML = shelf('Exclusive Voice Notes');
    installHomePage();
    expect(document.querySelector('li')?.getAttribute('data-sc-shelf')).toBe('voicenotes');
    expect(homeBlocksCss((key) => homeBlockDefaults[key])).toContain('html[data-sc-home] [data-sc-shelf="voicenotes"]');
});

it('новая музыка от любого артиста скрыта по умолчанию и включается отдельно', () => {
    history.replaceState(null, '', '/discover');
    document.body.innerHTML = shelf('New Music From Drake 🦉') + shelf('New Music From Another Artist');
    installHomePage();
    const style = document.createElement('style');
    style.textContent = homeBlocksCss((key) => homeBlockDefaults[key]);
    document.body.append(style);
    const items = [...document.querySelectorAll('li')];
    expect(items.map((item) => item.getAttribute('data-sc-shelf'))).toEqual(['newmusic', 'newmusic']);
    expect(items.map((item) => getComputedStyle(item).display)).toEqual(['none', 'none']);
    style.textContent = homeBlocksCss((key) => key === 'homeNewMusic' || homeBlockDefaults[key]);
    expect(items.every((item) => getComputedStyle(item).display !== 'none')).toBe(true);
    expect(style.textContent).toContain('[data-sc-shelf="more"]');
});

it('перевод новой музыки сохраняет ссылку на артиста и эмодзи', () => {
    page.__scSiteTranslation = { language: 'ru' };
    history.replaceState(null, '', '/discover');
    document.body.innerHTML = shelf('New Music From <a href="/octobersveryown">Drake</a> 🦉');
    installHomePage();
    expect(document.querySelector('li')?.getAttribute('data-sc-shelf')).toBe('newmusic');
    expect(document.querySelector('h2')?.textContent).toBe('Новая музыка от Drake 🦉');
    expect(document.querySelector('a')?.getAttribute('href')).toBe('/octobersveryown');
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
