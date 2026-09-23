import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BaseWindow: vi.fn() }));
import { watchHiddenPage } from './hiddenPageWatchdog';

type Listener = () => void;
function fakeWindow() {
    const listeners = new Map<string, Set<Listener>>();
    const state = { visible: true, minimized: false, destroyed: false };
    return {
        state,
        emit: (event: string) => listeners.get(event)?.forEach((listener) => listener()),
        count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
        isDestroyed: () => state.destroyed,
        isVisible: () => state.visible,
        isMinimized: () => state.minimized,
        getBounds: () => ({ x: 10, y: 20, width: 800, height: 600 }),
        on: (event: string, listener: Listener) => {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event)!.add(listener);
        },
        removeListener: (event: string, listener: Listener) => listeners.get(event)?.delete(listener),
    };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

it('будит страницу, оставшуюся скрытой после фокуса, и замолкает, когда она проснулась', async () => {
    const window = fakeWindow();
    let page = 'hidden';
    const nudge = vi.fn(() => { page = 'visible'; });
    watchHiddenPage(window, async () => page, nudge);
    window.emit('focus');
    await vi.advanceTimersByTimeAsync(1500);
    expect(nudge).toHaveBeenCalledExactlyOnceWith({ x: 10, y: 20, width: 800, height: 600 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(nudge).toHaveBeenCalledTimes(1);
});

it('на Windows ждёт настоящей активации окна, а не фокуса под другим окном', async () => {
    const hooks = new Map<number, (wParam: Buffer, lParam: Buffer) => void>();
    const window = Object.assign(fakeWindow(), {
        hookWindowMessage: (message: number, callback: (wParam: Buffer, lParam: Buffer) => void) => { hooks.set(message, callback); },
        unhookWindowMessage: (message: number) => { hooks.delete(message); },
    });
    const nudge = vi.fn();
    const stop = watchHiddenPage(window, async () => 'hidden', nudge, 1500, 'win32');
    window.emit('focus');
    hooks.get(0x86)!(Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]), Buffer.alloc(8));
    await vi.advanceTimersByTimeAsync(3000);
    expect(nudge).not.toHaveBeenCalled();
    hooks.get(0x86)!(Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]), Buffer.alloc(8));
    await vi.advanceTimersByTimeAsync(1500);
    expect(nudge).toHaveBeenCalledTimes(1);
    stop();
    expect(hooks.size).toBe(0);
});

it('не трогает видимую страницу, свёрнутое окно и сдаётся после двух попыток', async () => {
    const window = fakeWindow();
    const nudge = vi.fn();
    let page = 'visible';
    const stop = watchHiddenPage(window, async () => page, nudge);
    window.emit('show');
    await vi.advanceTimersByTimeAsync(3000);
    expect(nudge).not.toHaveBeenCalled();

    page = 'hidden';
    window.state.minimized = true;
    window.emit('restore');
    await vi.advanceTimersByTimeAsync(3000);
    expect(nudge).not.toHaveBeenCalled();

    window.state.minimized = false;
    window.emit('focus');
    await vi.advanceTimersByTimeAsync(10000);
    expect(nudge).toHaveBeenCalledTimes(2);

    stop();
    expect(window.count()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
});
