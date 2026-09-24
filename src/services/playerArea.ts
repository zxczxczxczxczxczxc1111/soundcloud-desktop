interface PlayerAreaWindow extends Window {
    __disposePlayerArea?: () => void;
    soundcloudAPI?: { reportPlayerArea?(height: number, viewport: number): void };
}

// Сколько места снизу страницы занимает плеер сайта вместе с тем, что из него выехало. Окно истории кончается выше,
// иначе накрывает громкость и очередь. Пересчёт по изменениям внутри плеера, без таймера
export function installPlayerArea(): void {
    const host = window as PlayerAreaWindow;
    host.__disposePlayerArea?.();
    // На страницу уходит только текст функции, поэтому всё нужное объявлено внутри неё.
    // То, что выезжает из плеера вверх: очередь треков и ползунок громкости. Закрытая очередь прозрачная, ползунок нулевой высоты
    const OVERLAYS = '.playControls__queue, .volume__sliderWrapper';
    let last = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let observed: Element | null = null;
    const shown = (node: Element, root: Element): DOMRect | null => {
        const box = node.getBoundingClientRect();
        if (box.width < 1 || box.height < 1 || box.top >= innerHeight) return null;
        // Прозрачный предок прячет и потомка: у закрытой очереди opacity 0 стоит на обёртке
        for (let current: Element | null = node; current && current !== root.parentElement; current = current.parentElement) {
            const style = getComputedStyle(current);
            if (style.display === 'none' || Number(style.opacity) === 0) return null;
        }
        return box;
    };
    const mutations = new MutationObserver(() => schedule());
    const watch = (root: Element | null): void => {
        if (root === observed) return;
        mutations.disconnect();
        observed = root;
        if (root) mutations.observe(root, { attributes: true, subtree: true, attributeFilter: ['class', 'style'] });
    };
    const measure = (): void => {
        timer = undefined;
        const root = document.querySelector('.playControls');
        watch(root);
        if (root) page.disconnect();
        let top = innerHeight;
        if (root) {
            for (const node of [root, ...root.querySelectorAll(OVERLAYS)]) {
                const box = shown(node, root);
                if (box) top = Math.min(top, box.top);
            }
        }
        const height = Math.max(0, Math.ceil(innerHeight - top));
        // Высота окна в отчёте: при смене масштаба страницы число точек плеера то же, а место в окне другое
        const key = height + ':' + innerHeight;
        if (key === last) return;
        last = key;
        try {
            host.soundcloudAPI?.reportPlayerArea?.(height, innerHeight);
        } catch (error) {
            console.warn('Место плеера не передано', error);
        }
    };
    // Таймер, а не кадр: страница, целиком накрытая окном истории, кадров не рисует, и плеер, выехавший
    // под окном, не был бы замечен никогда
    function schedule(): void {
        if (timer === undefined) timer = setTimeout(measure, 30);
    }
    // Разметки плеера может ещё не быть: до неё следим за всей страницей, потом только за плеером
    const page = new MutationObserver(() => schedule());
    page.observe(document.body, { childList: true, subtree: true });
    // Очередь выезжает с анимацией: окончательное место видно по её концу
    const settled = (event: Event): void => {
        if (observed && event.target instanceof Node && observed.contains(event.target)) schedule();
    };
    document.addEventListener('transitionend', settled, true);
    window.addEventListener('resize', schedule);
    const dispose = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        mutations.disconnect();
        page.disconnect();
        document.removeEventListener('transitionend', settled, true);
        window.removeEventListener('resize', schedule);
        window.removeEventListener('pagehide', dispose);
        delete host.__disposePlayerArea;
    };
    host.__disposePlayerArea = dispose;
    window.addEventListener('pagehide', dispose, { once: true });
    schedule();
}

export function playerAreaScript(): string {
    return '(' + installPlayerArea.toString() + ')();';
}
