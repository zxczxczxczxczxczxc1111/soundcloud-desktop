// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installPageFeatures } from './pageFeatures';
const send = vi.fn();
beforeEach(() => {
    vi.useFakeTimers();
    send.mockClear();
    document.body.innerHTML =
        '<div class="header__userNav"><a data-menu-name="profile" href="https://soundcloud.com/first">First</a></div>';
    Object.assign(window, { soundcloudAPI: { sendProfileUpdate: send } });
});
afterEach(() => {
    window.dispatchEvent(new Event('pagehide'));
    vi.useRealTimers();
    document.body.innerHTML = '';
});
it('сообщает изменение аккаунта по событию, без постоянного таймера', async () => {
    installPageFeatures(false);
    expect(send).toHaveBeenCalledExactlyOnceWith('first');
    document.querySelector('a')!.href = 'https://soundcloud.com/second';
    await Promise.resolve();
    expect(send).toHaveBeenLastCalledWith('second');
    expect(vi.getTimerCount()).toBe(0);
});
it('восстанавливает наблюдение после замены шапки', async () => {
    installPageFeatures(false);
    document.body.innerHTML =
        '<div class="header__userNav"><a data-menu-name="profile" href="https://soundcloud.com/second">Second</a></div>';
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(250);
    expect(send).toHaveBeenLastCalledWith('second');
    expect(vi.getTimerCount()).toBe(0);
});
it('отключение функции удаляет CSS iframe и наблюдение', () => {
    const frame = document.createElement('iframe');
    frame.title = 'Artist tools';
    document.body.appendChild(frame);
    installPageFeatures(true);
    expect(frame.contentDocument!.head.querySelector('style')).not.toBeNull();
    installPageFeatures(false);
    expect(frame.contentDocument!.head.querySelector('style')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
});
it('узнаёт врезку Artist tools после перевода title', () => {
    const container = document.createElement('div');
    container.className = 'webiEmbeddedModuleContainer';
    const frame = document.createElement('iframe');
    frame.title = 'Что-то переведённое';
    container.appendChild(frame);
    document.body.appendChild(container);
    installPageFeatures(true);
    const doc = frame.contentDocument!;
    doc.body.innerHTML = '<svg aria-label="Paywalled feature"></svg>';
    frame.dispatchEvent(new Event('load'));
    expect(container.style.display).toBe('none');
});
