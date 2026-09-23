import { beforeEach, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type ElectronStore from 'electron-store';

const mocks = vi.hoisted(() => ({
    created: vi.fn(),
    closed: vi.fn(),
    load: vi.fn().mockResolvedValue(undefined),
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
    removeListener: vi.fn(),
}));
vi.mock('electron', async () => {
    const { EventEmitter } = await import('node:events');
    return ({
    WebContentsView: class {
        webContents = Object.assign(new EventEmitter(), { loadFile: mocks.load, close: () => { mocks.closed(); this.webContents.emit('destroyed'); }, isDestroyed: () => false, setWindowOpenHandler() {} });
        constructor() {
            mocks.created();
        }
        setBounds() {}
        setVisible() {}
        setBackgroundColor() {}
    },
    ipcMain: {
        handle: mocks.handle,
        on: mocks.on,
        removeHandler: mocks.removeHandler,
        removeListener: mocks.removeListener,
    },
}); });
import { SettingsManager } from './settingsManager';

beforeEach(() => vi.clearAllMocks());
it('создаёт панель только при открытии и освобождает каждый экземпляр', () => {
    const parent = {
        on: vi.fn(),
        once: vi.fn(),
        removeListener: vi.fn(),
        contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
        isDestroyed: () => false,
        getContentBounds: () => ({ width: 1000, height: 800 }),
    };
    const restoreFocus = vi.fn();
    const manager = new SettingsManager(
        parent as unknown as BrowserWindow,
        { get: (_key: string, fallback: unknown) => fallback } as unknown as ElectronStore,
        restoreFocus,
    );
    expect(mocks.created).not.toHaveBeenCalled();
    for (let i = 0; i < 30; i++) {
        manager.toggle();
        expect(manager.getView()).not.toBeNull();
        manager.toggle();
        expect(manager.getView()).toBeNull();
    }
    expect(mocks.created).toHaveBeenCalledTimes(30);
    expect(mocks.closed).toHaveBeenCalledTimes(30);
    expect(restoreFocus).toHaveBeenCalledTimes(30);
    expect(parent.contentView.addChildView).toHaveBeenCalledTimes(30);
    expect(parent.contentView.removeChildView).toHaveBeenCalledTimes(30);
    manager.dispose();
    expect(mocks.removeHandler).toHaveBeenCalledWith('get-settings-state');
});
