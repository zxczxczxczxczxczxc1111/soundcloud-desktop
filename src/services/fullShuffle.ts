interface QueueItem {
    explicit?: boolean;
}
interface PlayQueue {
    readonly length: number;
    slice(start?: number, end?: number): QueueItem[];
    reset(items: QueueItem[]): void;
}
interface PlayManager {
    getQueue(): PlayQueue;
    getQueueState(): { currentIndex: number };
    getState(name: string): boolean;
    hasMoreAhead(): boolean;
    hasFallback(): boolean;
    pullNext(count: number): void;
    on(event: string, callback: (value?: unknown) => void): unknown;
    off(event: string, callback: (value?: unknown) => void): unknown;
}
interface WebpackRequire {
    c?: Record<string, { exports?: unknown } | undefined>;
}
type ChunkList = { push(chunk: unknown): unknown };
interface ShuffleWindow extends Window {
    __disposeFullShuffle?: () => void;
}

// SoundCloud перемешивает только загруженную часть очереди, а остальное берёт из буфера на сто треков вперёд.
// Здесь очередь догружается целиком и всё, что после текущего трека, перемешивается заново.
export function installFullShuffle(enabled: boolean): void {
    const host = window as unknown as ShuffleWindow & Record<string, unknown>;
    host.__disposeFullShuffle?.();
    if (!enabled) return;

    const PULL_SIZE = 250;
    const MAX_TRACKS = 10000;
    const STALL_MS = 15000;
    const methods = ['getQueue', 'getQueueState', 'getState', 'hasMoreAhead', 'hasFallback', 'pullNext', 'toggleShuffle', 'on', 'off'];
    let manager: PlayManager | null = null;
    let resetEvent = 'queueReset';
    let run = 0;
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let status: HTMLDivElement | null = null;

    const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    function findRequire(): WebpackRequire[] {
        const found: WebpackRequire[] = [];
        const probe = '__fullShuffle' + Date.now() + Math.random().toString(36).slice(2);
        const legacy = host.webpackJsonp as ChunkList | undefined;
        if (Array.isArray(legacy))
            legacy.push([[], { [probe]: (_module: unknown, _exports: unknown, require: WebpackRequire) => { found.push(require); } }, [[probe]]]);
        if (found.length) return found;
        for (const key of Object.keys(host)) {
            const chunks = host[key] as ChunkList | undefined;
            if (key.startsWith('webpackChunk') && Array.isArray(chunks))
                chunks.push([[probe], {}, (require: WebpackRequire) => { found.push(require); }]);
        }
        return found;
    }

    function findManager(): PlayManager | null {
        for (const require of findRequire()) {
            let candidate: PlayManager | null = null;
            for (const entry of Object.values(require.c ?? {})) {
                const exports = entry?.exports as Record<string, unknown> | undefined;
                if (!exports || typeof exports !== 'object') continue;
                if (typeof exports.QUEUE_RESET === 'string') resetEvent = exports.QUEUE_RESET;
                if (!candidate && methods.every((name) => typeof exports[name] === 'function')) candidate = exports as unknown as PlayManager;
            }
            if (candidate) return candidate;
        }
        return null;
    }

    function showStatus(text: string, hideAfter?: number): void {
        if (hideTimer !== undefined) clearTimeout(hideTimer);
        hideTimer = undefined;
        if (!status) {
            status = document.createElement('div');
            status.setAttribute('role', 'status');
            status.style.cssText =
                'position:fixed;z-index:2147483000;transform:translateX(-50%);padding:6px 10px;border-radius:6px;font-family:inherit;font-size:12px;line-height:1.4;' +
                'pointer-events:none;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.3);transition:opacity .15s;opacity:0';
            document.body.appendChild(status);
        }
        const light = document.documentElement.classList.contains('theme-light');
        status.style.background = light ? '#ffffff' : '#2a2a2a';
        status.style.color = light ? 'rgba(0,0,0,.87)' : 'rgba(255,255,255,.87)';
        status.style.border = '1px solid ' + (light ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.08)');
        const button = document.querySelector('.shuffleControl');
        const rect = button?.getBoundingClientRect();
        status.style.left = (rect && rect.width ? rect.left + rect.width / 2 : window.innerWidth / 2) + 'px';
        status.style.bottom = (rect && rect.width ? window.innerHeight - rect.top + 8 : 64) + 'px';
        status.textContent = text;
        status.style.opacity = '1';
        if (hideAfter) hideTimer = setTimeout(hideStatus, hideAfter);
    }
    function hideStatus(): void {
        if (hideTimer !== undefined) clearTimeout(hideTimer);
        hideTimer = undefined;
        status?.remove();
        status = null;
    }

    function reshuffleAhead(player: PlayManager): void {
        const queue = player.getQueue();
        const items = queue.slice();
        // Треки, добавленные вручную в «Далее», остаются сразу после текущего
        let start = player.getQueueState().currentIndex + 1;
        while (start < items.length && items[start]?.explicit) start++;
        const rest = items.slice(start);
        for (let i = rest.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        queue.reset(items.slice(0, start).concat(rest));
    }

    function shouldLoad(player: PlayManager): boolean {
        // hasFallback во время живого потока значит автовоспроизведение похожих треков, оно бесконечное
        return player.getState('shuffle') && player.hasMoreAhead() && !player.hasFallback();
    }

    async function fillAndShuffle(): Promise<void> {
        const player = manager;
        const current = ++run;
        if (!player || !shouldLoad(player)) return;
        const queue = player.getQueue();
        // Новая очередь сначала ставит текущий трек, догрузка до этого сбила бы выбор трека
        for (let i = 0; i < 50 && player.getQueueState().currentIndex < 0; i++) await wait(200);
        if (current !== run || disposed || !shouldLoad(player)) return;
        const started = Date.now();
        let grewAt = started;
        let last = queue.length;
        let failure = '';
        while (current === run && !disposed && shouldLoad(player)) {
            if (queue.length >= MAX_TRACKS) {
                failure = 'В очереди больше ' + MAX_TRACKS + ' треков, перемешаны первые ' + queue.length;
                break;
            }
            player.pullNext(PULL_SIZE);
            await wait(150);
            if (queue.length > last) {
                last = queue.length;
                grewAt = Date.now();
            } else if (Date.now() - grewAt > STALL_MS) {
                failure = 'Сайт перестал отдавать треки, перемешаны загруженные: ' + queue.length;
                break;
            }
            if (Date.now() - started > 1000) showStatus('Загружаю очередь для перемешивания: ' + queue.length);
        }
        if (current !== run || disposed) return;
        if (!player.getState('shuffle')) {
            hideStatus();
            return;
        }
        reshuffleAhead(player);
        if (failure) {
            console.warn('Перемешивание всей очереди:', failure);
            showStatus(failure, 8000);
        } else hideStatus();
    }

    const onShuffle = (value?: unknown): void => {
        if (value === true) void fillAndShuffle().catch((error: unknown) => console.error('Не удалось перемешать очередь:', error));
        else {
            run++;
            hideStatus();
        }
    };
    const onReset = (): void => {
        if (manager?.getState('shuffle')) onShuffle(true);
        else run++;
    };
    const onMissingClick = (event: MouseEvent): void => {
        if (event.target instanceof Element && event.target.closest('.shuffleControl'))
            showStatus('Перемешивание всей очереди не работает с этой версией SoundCloud', 6000);
    };

    let attempts = 0;
    function attach(): void {
        retryTimer = undefined;
        if (disposed) return;
        manager = findManager();
        if (manager) {
            manager.on('state:shuffle', onShuffle);
            manager.on(resetEvent, onReset);
            if (manager.getState('shuffle')) onShuffle(true);
            return;
        }
        if (++attempts < 15) {
            retryTimer = setTimeout(attach, 1000);
            return;
        }
        console.warn('Перемешивание всей очереди: очередь SoundCloud не найдена');
        document.addEventListener('click', onMissingClick, true);
    }

    const dispose = (): void => {
        disposed = true;
        run++;
        if (retryTimer !== undefined) clearTimeout(retryTimer);
        manager?.off('state:shuffle', onShuffle);
        manager?.off(resetEvent, onReset);
        document.removeEventListener('click', onMissingClick, true);
        hideStatus();
        window.removeEventListener('pagehide', dispose);
        delete host.__disposeFullShuffle;
    };
    host.__disposeFullShuffle = dispose;
    window.addEventListener('pagehide', dispose, { once: true });
    attach();
}

export function fullShuffleScript(enabled: boolean): string {
    return '(' + installFullShuffle.toString() + ')(' + JSON.stringify(enabled) + ');';
}
