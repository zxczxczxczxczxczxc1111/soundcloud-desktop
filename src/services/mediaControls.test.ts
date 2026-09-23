// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { installMediaControls } from './mediaControls';
afterEach(() => { vi.unstubAllGlobals(); });
it('routes four Windows actions through the playback API', () => {
    const handlers = new Map<string, () => void>();
    const playback = vi.fn();
    vi.stubGlobal('navigator', { mediaSession: { setActionHandler: (action: string, handler: () => void) => handlers.set(action, handler) } });
    vi.stubGlobal('window', { soundcloudAPI: { playback } });
    installMediaControls();
    installMediaControls();
    expect(handlers.size).toBe(4);
    for (const handler of handlers.values()) handler();
    expect(playback.mock.calls).toEqual([['play'], ['pause'], ['next'], ['previous']]);
});
