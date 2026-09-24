// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { playerAreaScript } from './playerArea';

// Тот же текст, что main отправляет на страницу: ссылка на что-то вне функции здесь упадёт
const installPlayerArea = (): void => new Function(playerAreaScript())();

const report = vi.fn();
// jsdom не считает раскладку: прямоугольники задаются по классу элемента
const boxes = new Map<string, { top: number; height: number }>();
beforeEach(() => {
    vi.useFakeTimers();
    report.mockClear();
    boxes.clear();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        const box = boxes.get(this.classList[0] ?? '') ?? { top: 0, height: 0 };
        return { top: box.top, height: box.height, width: box.height ? 100 : 0, left: 0, right: 100, bottom: box.top + box.height, x: 0, y: box.top, toJSON: () => ({}) } as DOMRect;
    });
    document.body.innerHTML =
        '<div class="playControls"><div class="playControls__queue" style="opacity: 0"><div class="queue"></div></div>' +
        '<div class="volume"><div class="volume__sliderWrapper"></div></div></div>';
    Object.assign(window, { soundcloudAPI: { reportPlayerArea: report } });
});
afterEach(() => {
    window.dispatchEvent(new Event('pagehide'));
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
});
const bottom = window.innerHeight;

it('считает плеер, но не закрытую очередь и свёрнутый ползунок', async () => {
    boxes.set('playControls', { top: bottom - 48, height: 48 });
    boxes.set('playControls__queue', { top: bottom - 580, height: 532 });
    installPlayerArea();
    await vi.runAllTimersAsync();
    expect(report).toHaveBeenCalledExactlyOnceWith(48, bottom);
});

it('ползунок громкости и открытая очередь поднимают границу, повтор не пересылается', async () => {
    boxes.set('playControls', { top: bottom - 48, height: 48 });
    boxes.set('playControls__queue', { top: bottom - 580, height: 532 });
    installPlayerArea();
    await vi.runAllTimersAsync();
    boxes.set('volume__sliderWrapper', { top: bottom - 202, height: 154 });
    document.querySelector('.volume')!.className = 'volume expanded';
    await vi.runAllTimersAsync();
    expect(report).toHaveBeenLastCalledWith(202, bottom);
    (document.querySelector('.playControls__queue') as HTMLElement).style.opacity = '1';
    await vi.runAllTimersAsync();
    expect(report).toHaveBeenLastCalledWith(580, bottom);
    document.querySelector('.volume')!.className = 'volume';
    await vi.runAllTimersAsync();
    expect(report).toHaveBeenCalledTimes(3);
});

it('плеер за нижним краем до первого трека даёт ноль', async () => {
    boxes.set('playControls', { top: bottom, height: 48 });
    installPlayerArea();
    await vi.runAllTimersAsync();
    expect(report).toHaveBeenCalledExactlyOnceWith(0, bottom);
});
