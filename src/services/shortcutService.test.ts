import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import { expect, it, vi } from 'vitest';
import { ShortcutService } from './shortcutService';
it('handles separate F1 presses but ignores held-key repeat', () => {
    const contents = new EventEmitter();
    const shortcuts = new ShortcutService();
    const toggle = vi.fn();
    shortcuts.register('settings', 'F1', 'Settings', toggle);
    shortcuts.attachToWebContents(contents as unknown as WebContents);
    const event = { preventDefault: vi.fn() };
    const input = { type: 'keyDown', key: 'F1', control: false, shift: false, alt: false, meta: false, isAutoRepeat: false };
    contents.emit('before-input-event', event, input);
    contents.emit('before-input-event', event, { ...input, isAutoRepeat: true });
    expect(toggle).toHaveBeenCalledTimes(1);
    contents.emit('before-input-event', event, input);
    expect(toggle).toHaveBeenCalledTimes(2);
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
});

it('letter shortcuts work in any keyboard layout by physical key', () => {
    const contents = new EventEmitter();
    const shortcuts = new ShortcutService();
    const history = vi.fn();
    shortcuts.register('history', 'CommandOrControl+H', 'History', history);
    shortcuts.attachToWebContents(contents as unknown as WebContents);
    const event = { preventDefault: vi.fn() };
    const input = { type: 'keyDown', key: 'р', code: 'KeyH', control: process.platform !== 'darwin', shift: false, alt: false, meta: process.platform === 'darwin', isAutoRepeat: false };
    contents.emit('before-input-event', event, input);
    expect(history).toHaveBeenCalledTimes(1);
    // Раскладка, где H на другой клавише, срабатывает по букве; чужая клавиша с кириллицей нет
    contents.emit('before-input-event', event, { ...input, key: 'h', code: 'KeyJ' });
    expect(history).toHaveBeenCalledTimes(2);
    contents.emit('before-input-event', event, { ...input, key: 'о', code: 'KeyJ' });
    expect(history).toHaveBeenCalledTimes(2);
});
