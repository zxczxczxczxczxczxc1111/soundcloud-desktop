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
