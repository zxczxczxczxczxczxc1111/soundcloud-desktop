import { expect, it, vi } from 'vitest';
import { flushOnSessionEnd, type Flushable } from './sessionEnd';

it('выключение Windows (28.10.2026): буферы ложатся по session-end, созданные после окна тоже, пустые пропускаются', () => {
    const listeners: Array<() => void> = [];
    const window = { on: vi.fn((_event: 'session-end', listener: () => void) => listeners.push(listener)) };
    const diagnostics: Flushable = { flush: vi.fn() };
    let journal: Flushable | null = null;
    flushOnSessionEnd(window, () => [journal, null, diagnostics]);
    expect(window.on).toHaveBeenCalledWith('session-end', expect.any(Function));
    expect(diagnostics.flush).not.toHaveBeenCalled();
    // Журнал волны появился после того, как окно подписалось
    journal = { flush: vi.fn() };
    for (const listener of listeners) listener();
    expect(journal.flush).toHaveBeenCalledTimes(1);
    expect(diagnostics.flush).toHaveBeenCalledTimes(1);
});
