import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { installRendererRecovery } from './rendererRecovery';
afterEach(() => vi.useRealTimers());

function setup(online = () => true, quitting = () => false) {
    vi.useFakeTimers();
    const contents = Object.assign(new EventEmitter(), { reload: vi.fn(), isDestroyed: () => false, forcefullyCrashRenderer: vi.fn() });
    const actions = { isQuitting: quitting, onCrash: vi.fn(), onRepeatedCrash: vi.fn(), online: vi.fn(online), onGaveUp: vi.fn() };
    const dispose = installRendererRecovery(contents as unknown as WebContents, actions);
    const crash = (): void => void contents.emit('render-process-gone', {}, { reason: 'crashed' });
    const failLoad = (code = -106): void => void contents.emit('did-fail-load', {}, code, 'ERR', 'https://soundcloud.com/', true);
    return { contents, actions, dispose, crash, failLoad };
}

it('первое падение перезагружает сразу, дальше через 1, 5 и 15 минут вместо пустого окна, потом одно уведомление', async () => {
    const { contents, actions, crash } = setup();
    crash();
    expect(contents.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(contents.reload).toHaveBeenCalledTimes(1);
    // Раньше второе падение за минуту оставляло страницу пустой до ручного Ctrl+R
    crash();
    expect(actions.onRepeatedCrash).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(contents.reload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(contents.reload).toHaveBeenCalledTimes(2);
    crash();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(contents.reload).toHaveBeenCalledTimes(3);
    crash();
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(contents.reload).toHaveBeenCalledTimes(4);
    crash();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(contents.reload).toHaveBeenCalledTimes(4);
    expect(actions.onGaveUp).toHaveBeenCalledTimes(1);
    expect(actions.onCrash).toHaveBeenCalledTimes(5);
    // Десять минут без сбоев: следующее падение снова перезагружает сразу
    crash();
    await vi.advanceTimersByTimeAsync(0);
    expect(contents.reload).toHaveBeenCalledTimes(5);
});

it('зависшая страница перезапускается через 30 секунд, ответившая раньше остаётся', async () => {
    const { contents } = setup();
    contents.emit('unresponsive');
    await vi.advanceTimersByTimeAsync(20_000);
    contents.emit('responsive');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(contents.forcefullyCrashRenderer).not.toHaveBeenCalled();
    contents.emit('unresponsive');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(contents.forcefullyCrashRenderer).toHaveBeenCalledTimes(1);
});

it('без сети загрузка повторяется, как только сеть появилась; при недоступном сайте по паузам, а не каждые 15 секунд', async () => {
    let online = false;
    const offline = setup(() => online);
    offline.failLoad();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(offline.contents.reload).not.toHaveBeenCalled();
    online = true;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(offline.contents.reload).toHaveBeenCalledTimes(1);
    offline.contents.emit('did-finish-load');
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(offline.contents.reload).toHaveBeenCalledTimes(1);

    const down = setup();
    down.failLoad();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(down.contents.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(down.contents.reload).toHaveBeenCalledTimes(1);
    down.failLoad();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(down.contents.reload).toHaveBeenCalledTimes(2);
    // Отмена загрузки новой навигацией и сбой вложенной рамки сбоем страницы не считаются
    down.contents.emit('did-fail-load', {}, -3, 'ABORTED', 'https://soundcloud.com/', true);
    down.contents.emit('did-fail-load', {}, -106, 'ERR', 'https://w.soundcloud.com/', false);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(down.contents.reload).toHaveBeenCalledTimes(2);
});

it('после начала выхода и после снятия восстановления страница не перезагружается', async () => {
    let quitting = false;
    const { contents, crash } = setup(() => true, () => quitting);
    crash();
    quitting = true;
    await vi.advanceTimersByTimeAsync(0);
    expect(contents.reload).not.toHaveBeenCalled();
    const other = setup();
    other.failLoad();
    other.contents.emit('unresponsive');
    other.dispose();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(other.contents.reload).not.toHaveBeenCalled();
    expect(other.contents.forcefullyCrashRenderer).not.toHaveBeenCalled();
});
