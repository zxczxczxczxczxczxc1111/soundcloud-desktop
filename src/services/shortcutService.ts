import { BrowserWindow, Input, WebContents } from 'electron';

interface Shortcut {
    accelerator: string;
    action: () => void;
    description: string;
    enabled?: boolean;
}

interface ParsedAccelerator {
    control: boolean;
    shift: boolean;
    alt: boolean;
    meta: boolean;
    key: string;
}

export class ShortcutService {
    private shortcuts: Map<string, Shortcut> = new Map();

    constructor(window?: BrowserWindow) {
        if (window) this.setWindow(window);
    }

    setWindow(window: BrowserWindow) {
        this.attachToWebContents(window.webContents);
    }

    attachToWebContents(webContents: WebContents) {
        webContents.on('before-input-event', (event, input) => {
            this.handleInput(event, input);
        });
    }

    private handleInput(event: Electron.Event, input: Input) {
        if (input.type !== 'keyDown' || input.isAutoRepeat) return;

        for (const [id, shortcut] of this.shortcuts) {
            if (shortcut.enabled === false) continue;

            if (this.matches(input, shortcut.accelerator)) {
                event.preventDefault();
                try {
                    shortcut.action();
                } catch (error) {
                    console.error(`Shortcut '${id}' error:`, error);
                }
                break;
            }
        }
    }

    private matches(input: Input, accelerator: string): boolean {
        const parsed = this.parse(accelerator);
        // Буква узнаётся и по физической клавише: в русской раскладке Ctrl+H приходит с key «р»
        const keyMatch =
            input.key.toLowerCase() === parsed.key.toLowerCase() ||
            (/^[a-z]$/i.test(parsed.key) && input.code === 'Key' + parsed.key.toUpperCase());
        const modMatch =
            input.control === parsed.control &&
            input.shift === parsed.shift &&
            input.alt === parsed.alt &&
            input.meta === parsed.meta;
        return keyMatch && modMatch;
    }

    private parse(accelerator: string): ParsedAccelerator {
        const parts = accelerator.split('+').map((p) => p.trim());
        const result: ParsedAccelerator = {
            control: false,
            shift: false,
            alt: false,
            meta: false,
            key: '',
        };

        for (const part of parts) {
            const lower = part.toLowerCase();

            if (lower === 'commandorcontrol' || lower === 'cmdorctrl') {
                if (process.platform === 'darwin') {
                    result.meta = true;
                } else {
                    result.control = true;
                }
            } else if (lower === 'command' || lower === 'cmd') {
                result.meta = true;
            } else if (lower === 'control' || lower === 'ctrl') {
                result.control = true;
            } else if (lower === 'shift') {
                result.shift = true;
            } else if (lower === 'alt' || lower === 'option') {
                result.alt = true;
            } else if (lower === 'super' || lower === 'meta') {
                result.meta = true;
            } else {
                result.key = part;
            }
        }

        return result;
    }

    register(id: string, accelerator: string, description: string, action: () => void, enabled: boolean = true) {
        this.shortcuts.set(id, { accelerator, action, description, enabled });
    }

    setEnabled(id: string, enabled: boolean) {
        const shortcut = this.shortcuts.get(id);
        if (shortcut) shortcut.enabled = enabled;
    }

    clear() {
        this.shortcuts.clear();
    }

    get count(): number {
        return this.shortcuts.size;
    }

    destroy() {
        this.shortcuts.clear();
    }
}
