// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: vi.fn(), executeInMainWorld: vi.fn() }, ipcRenderer: { sendSync: vi.fn(), on: vi.fn() } }));
import { installEarlyBlocks } from '../preload';
import { ARTIST_TOOLS_CSS } from './pageFeatures';
import { homeBlockDefaults, homeBlocksCss } from './homeBlocks';
afterEach(() => {
    window.dispatchEvent(new Event('pagehide'));
    Reflect.deleteProperty(window, '__scEarlyBlocks'); document.getElementById('sc-early-blocks')?.remove(); document.body.innerHTML = '';
    history.replaceState(null, '', '/');
});
it('до появления страницы ставит правила, а полки размечает до кадра', async () => {
    history.replaceState(null, '', '/discover');
    installEarlyBlocks('html[data-sc-home] [data-sc-shelf="more"]{display:none!important}');
    expect(document.documentElement.hasAttribute('data-sc-home')).toBe(true);
    expect(document.getElementById('sc-early-blocks')?.textContent).toContain('visibility:hidden');
    document.body.innerHTML = '<li class="mixedModularHome__item"><h2 class="mixedSelectionModule__titleText">More of what you like</h2></li>';
    await Promise.resolve();
    expect(document.querySelector('li')?.getAttribute('data-sc-shelf')).toBe('more');
    expect(getComputedStyle(document.querySelector('li')!).display).toBe('none');
    history.pushState(null, '', '/feed');
    expect(document.documentElement.hasAttribute('data-sc-home')).toBe(false);
    history.pushState(null, '', '/discover');
    expect(document.documentElement.hasAttribute('data-sc-home')).toBe(true);
});
it('новая музыка от артиста скрывается до кадра, включая поздний заголовок', async () => {
    history.replaceState(null, '', '/discover');
    installEarlyBlocks(homeBlocksCss((key) => homeBlockDefaults[key]));
    document.body.innerHTML = '<li class="mixedModularHome__item"><h2 class="mixedSelectionModule__titleText"></h2></li>';
    await Promise.resolve();
    const item = document.querySelector('li')!;
    expect(getComputedStyle(item).visibility).toBe('hidden');
    document.querySelector('h2')!.textContent = 'New Music From Drake 🦉';
    await Promise.resolve();
    expect(item.getAttribute('data-sc-shelf')).toBe('newmusic');
    expect(getComputedStyle(item).display).toBe('none');
    installEarlyBlocks(homeBlocksCss((key) => key === 'homeNewMusic' || homeBlockDefaults[key]));
    expect(getComputedStyle(item).display).not.toBe('none');
    expect(getComputedStyle(item).visibility).not.toBe('hidden');
    history.pushState(null, '', '/feed');
    installEarlyBlocks(homeBlocksCss((key) => homeBlockDefaults[key]));
    expect(getComputedStyle(item).display).not.toBe('none');
});

it('неизвестная полка скрывается до кадра и показывается переключателем других полок', async () => {
    installEarlyBlocks(homeBlocksCss((key) => homeBlockDefaults[key]));
    document.body.innerHTML = '<li class="mixedModularHome__item"><h2 class="mixedSelectionModule__titleText">Something new</h2></li><section id="sc-wave">Моя волна</section>';
    await Promise.resolve();
    const item = document.querySelector('li')!;
    expect(item.getAttribute('data-sc-shelf')).toBe('other');
    expect(getComputedStyle(item).display).toBe('none');
    expect(getComputedStyle(document.querySelector('#sc-wave')!).display).not.toBe('none');
    installEarlyBlocks(homeBlocksCss((key) => key === 'homeOther' || homeBlockDefaults[key]));
    expect(getComputedStyle(item).display).not.toBe('none');
    expect(getComputedStyle(item).visibility).not.toBe('hidden');
    expect(document.querySelectorAll('#sc-early-blocks')).toHaveLength(1);
    installEarlyBlocks('');
    expect(document.getElementById('sc-early-blocks')?.textContent).not.toContain('display:none');
});
it('скрывает Artist Tools до загрузки iframe на любой странице, сохраняя другие врезки', () => {
    installEarlyBlocks(ARTIST_TOOLS_CSS);
    for (const path of ['/discover', '/feed', '/you/library', '/artist/track']) {
        history.pushState(null, '', path);
        document.body.innerHTML = '<div class="webiEmbeddedModuleContainer"><iframe src="/n/embeds/credit-tracker" title="Artist tools"></iframe></div><div id="other" class="webiEmbeddedModuleContainer"><iframe src="about:blank" title="Sidebar modules"></iframe></div>';
        expect(getComputedStyle(document.querySelector('iframe')!).display).toBe('none');
        expect(getComputedStyle(document.querySelector('.webiEmbeddedModuleContainer')!).display).toBe('none');
        expect(getComputedStyle(document.querySelector('#other')!).display).not.toBe('none');
    }
    installEarlyBlocks('');
    expect(getComputedStyle(document.querySelector('iframe')!).display).not.toBe('none');
});
