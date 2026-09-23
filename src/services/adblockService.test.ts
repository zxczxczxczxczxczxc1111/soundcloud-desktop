import { beforeEach, expect, it, vi } from 'vitest';
import type { Session } from 'electron';
const mocks = vi.hoisted(() => ({ load: vi.fn(), enable: vi.fn(), disable: vi.fn() }));
vi.mock('@ghostery/adblocker-electron', () => ({ ElectronBlocker: { fromLists: mocks.load }, fullLists: [] }));
vi.mock('fs/promises', () => ({ mkdir: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() }));
import { AdblockService } from './adblockService';
const engine = { enableBlockingInSession: mocks.enable, disableBlockingInSession: mocks.disable };
beforeEach(() => {
    vi.clearAllMocks();
    mocks.load.mockResolvedValue(engine);
});
it('использует один движок и отключает блокировку в той же сессии', async () => {
    const session = {} as Session;
    const service = new AdblockService(session, 'cache/engine.bin');
    await service.setEnabled(true);
    await service.setEnabled(true);
    await service.setEnabled(false);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.enable).toHaveBeenCalledExactlyOnceWith(session);
    expect(mocks.disable).toHaveBeenCalledExactlyOnceWith(session);
});
it('не включает блокировку после отключения во время загрузки', async () => {
    let finish!: (value: typeof engine) => void;
    mocks.load.mockReturnValue(
        new Promise((resolve) => {
            finish = resolve;
        }),
    );
    const service = new AdblockService({} as Session, 'cache/engine.bin');
    const loading = service.setEnabled(true);
    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));
    await service.setEnabled(false);
    finish(engine);
    await loading;
    expect(mocks.enable).not.toHaveBeenCalled();
});
