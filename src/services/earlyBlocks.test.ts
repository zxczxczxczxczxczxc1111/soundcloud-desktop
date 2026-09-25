// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: vi.fn(), executeInMainWorld: vi.fn() }, ipcRenderer: { sendSync: vi.fn(), on: vi.fn() } }));
import { installEarlyBlocks } from '../preload';
import { ARTIST_TOOLS_CSS } from './pageFeatures';
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
it('смена настройки заменяет ранние правила, неизвестный блок виден', async () => {
    installEarlyBlocks('[data-sc-shelf="more"]{display:none!important}');
    document.body.innerHTML = '<li class="mixedModularHome__item"><h2 class="mixedSelectionModule__titleText">Something new</h2></li>';
    await Promise.resolve();
    expect(document.querySelector('li')?.getAttribute('data-sc-shelf')).toBe('other');
    installEarlyBlocks(''); expect(document.querySelectorAll('#sc-early-blocks')).toHaveLength(1);
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
