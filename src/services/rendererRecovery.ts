import type { WebContents } from 'electron';

interface RecoveryActions {
    isQuitting(): boolean;
    /** Страница упала: сбросить то, что держало её состояние */
    onCrash(): void;
    /** Второе падение подряд: сообщение в окне, перезагрузка уже по паузе */
    onRepeatedCrash(): void;
    /** Есть ли сеть. Загрузка без сети повторяется, как только сеть появилась */
    online(): boolean;
    /** Паузы кончились: одно уведомление, дальше ждём сеть или ручной Ctrl+R */
    onGaveUp(): void;
}
export interface RecoveryTiming {
    /** Паузы перед повторами после первого сбоя */
    steps: number[];
    /** Сколько ждать ответа зависшей страницы */
    hang: number;
    /** Без сбоев столько времени: счётчик с начала */
    calm: number;
    /** Как часто проверять сеть, пока загрузка ждёт её */
    poll: number;
}
const TIMING: RecoveryTiming = { steps: [60000, 300000, 900000], hang: 30000, calm: 600000, poll: 15000 };

// Страница поднимается сама после падения, зависания и неудачной загрузки. Первое падение перезагружает сразу, дальше
// повторы через 1, 5 и 15 минут, счётчик сбрасывается после 10 минут без сбоев. Раньше второе падение за минуту,
// зависание и загрузка без сети оставляли пустое окно до ручного Ctrl+R
export function installRendererRecovery(contents: WebContents, actions: RecoveryActions, timing: RecoveryTiming = TIMING): () => void {
    let failures = 0;
    // Спокойствие считается от последнего сбоя или перезагрузки: страница, упавшая сразу после повтора, спокойной не была
    let lastTrouble = -Infinity;
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let hang: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    const alive = (): boolean => !disposed && !actions.isQuitting() && !contents.isDestroyed();
    const cancelRetry = (): void => { clearTimeout(retry); retry = undefined; };
    const stopPoll = (): void => { clearInterval(poll); poll = undefined; };
    // Одна попытка на всё: повтор по паузе и появление сети не перезагружают страницу дважды
    const reload = (): void => {
        cancelRetry();
        stopPoll();
        if (!alive()) return;
        lastTrouble = Date.now();
        contents.reload();
    };
    function incident(crash: boolean): void {
        const now = Date.now();
        if (now - lastTrouble > timing.calm) failures = 0;
        lastTrouble = now;
        failures++;
        cancelRetry();
        if (crash && failures === 1) {
            // Electron 41 падает при reload внутри незавершённого teardown renderer
            setImmediate(reload);
            return;
        }
        const step = failures - (crash ? 2 : 1);
        if (step >= timing.steps.length) {
            actions.onGaveUp();
            return;
        }
        retry = setTimeout(reload, timing.steps[step]);
    }
    contents.on('render-process-gone', (_event, details) => {
        clearTimeout(hang);
        hang = undefined;
        if (!alive() || details.reason === 'clean-exit') return;
        actions.onCrash();
        incident(true);
        if (failures === 2) actions.onRepeatedCrash();
    });
    contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
        // -3: загрузку отменила новая навигация или сам клиент
        if (!isMainFrame || code === -3 || !alive()) return;
        incident(false);
        if (!poll && !actions.online()) poll = setInterval(() => {
            if (!actions.online()) return;
            stopPoll();
            reload();
        }, timing.poll);
    });
    contents.on('did-finish-load', () => {
        stopPoll();
        cancelRetry();
    });
    contents.on('unresponsive', () => {
        if (hang || !alive()) return;
        // Перезапуск идёт обычным путём падения: render-process-gone и перезагрузка
        hang = setTimeout(() => {
            hang = undefined;
            if (alive()) contents.forcefullyCrashRenderer();
        }, timing.hang);
    });
    contents.on('responsive', () => {
        clearTimeout(hang);
        hang = undefined;
    });
    return () => {
        disposed = true;
        cancelRetry();
        clearTimeout(hang);
        stopPoll();
    };
}
