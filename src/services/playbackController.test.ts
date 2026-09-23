// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { executePageCommand } from './playbackController';
afterEach(() => {
    document.body.innerHTML = '';
});
it('play и pause не превращаются в противоположное действие', () => {
    document.body.innerHTML = '<button class="playControls__play playing"></button>';
    const button = document.querySelector('button')!;
    const click = vi.fn();
    button.addEventListener('click', click);
    expect(executePageCommand('play')).toBe(true);
    expect(click).not.toHaveBeenCalled();
    executePageCommand('pause');
    expect(click).toHaveBeenCalledTimes(1);
    button.classList.remove('playing');
    executePageCommand('pause');
    expect(click).toHaveBeenCalledTimes(1);
});
it('отсутствующая или недоступная кнопка не считается успешной командой', () => {
    expect(executePageCommand('next')).toBe(false);
    document.body.innerHTML = '<button class="skipControl__next" disabled></button>';
    expect(executePageCommand('next')).toBe(false);
});
