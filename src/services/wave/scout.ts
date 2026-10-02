// Разведка (Ф4) вместо «Находок дня»: каждый трек карточки играет 20 секунд с самого яркого места по форме волны и сам
// уступает следующему. «Оставить» (Enter) и лайк дают дослушать трек и поднимают его в сессии, «Дальше» (стрелка вправо)
// пропускает сразу. Сам переход разведки сделан не человеком, поэтому во вкусе пропуском не считается. После списка
// играет обычная волна карточки. Раздел страницы волны: installScout уходит на страницу текстом вместе с волной
// (pageHelpers в wave.ts) и зовёт scoutStart и fillText по голому имени
import * as waveTexts from '../waveTexts';
import type { SitePlayer, SiteQueueItem } from '../wave';
import type { WaveCandidate, WaveTexts, WaveTrack } from '../waveTypes';

const { fillText } = waveTexts;

/** Самое яркое место по сглаженной форме волны (0,1-1): первое окно в 4 с, которое не тише 85% самого громкого,
 *  начиная с 8% трека, на секунду раньше, чтобы был слышен подъём. Хвост на 20 с остаётся; короткий трек с начала */
export function scoutStart(samples: number[], duration: number, span = 20000): number {
    if (!(duration >= 40000) || samples.length < 50) return 0;
    const step = duration / samples.length;
    const width = Math.max(1, Math.round(4000 / step));
    const means: number[] = [];
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
        sum += samples[i];
        if (i >= width) sum -= samples[i - width];
        if (i >= width - 1) means.push(sum / width);
    }
    const peak = Math.max(...means);
    const from = Math.floor(samples.length * 0.08);
    const at = means.findIndex((value, i) => i >= from && value >= peak * 0.85);
    const start = at < 0 ? duration * 0.3 : at * step - 1000;
    return Math.round(Math.max(0, Math.min(start, duration - span - 2000)));
}

export interface ScoutCore {
    texts: WaveTexts;
    player(): SitePlayer | null;
    /** Разведка идёт, пока волна играет свою очередь с этой подборкой */
    running(): boolean;
    /** Элемент очереди сайта поставлен волной */
    ours(item: SiteQueueItem): boolean;
    /** Сглаженная форма волны трека; null, пока грузится. Вызов сам запускает загрузку */
    samples(track: WaveTrack): number[] | null;
    candidate(id: number): WaveCandidate | undefined;
    liked(): boolean;
    /** «Оставить»: трек поднимается в сессии, как от лайка */
    keep(candidate: WaveCandidate): void;
    render(): void;
    el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K];
    disposed(): boolean;
}
export interface ScoutSection {
    /** Новая разведка по трекам подборки; kept: трек, выбранный в списке руками, он звучит целиком */
    start(ids: number[], kept?: number): void;
    stop(): void;
    active(): boolean;
    /** Панель разведки в блоке волны; null, если играющий трек не из неё */
    panel(currentId: number): HTMLElement | null;
    /** Кнопка панели: true, если действие её */
    act(name: string): boolean;
    dispose(): void;
}

export function installScout(core: ScoutCore): ScoutSection {
    const T = core.texts;
    // Сколько звучит каждый трек разведки, мс
    const WINDOW = 20000;
    let ids: number[] = [];
    let kept = new Set<number>();
    let soundId = 0;
    // С какого места идёт окно текущего трека, мс; null, пока место не найдено
    let windowFrom: number | null = null;
    let startedAt = 0;
    // Позиция и время прошлого шага: по ним видно перемотку человеком
    let expected = 0;
    let checkedAt = 0;
    let wasPlaying = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const running = (): boolean => ids.length > 0;
    const playingId = (): number => core.player()?.getCurrentSound()?.id ?? 0;
    const scouted = (id: number): boolean => running() && ids.includes(id) && !kept.has(id);

    function stop(): void {
        if (!running()) return;
        ids = [];
        kept = new Set();
        windowFrom = null;
        soundId = 0;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        core.render();
    }
    // Следующий трек волны в очереди сайта; нет его (очередь ещё не догружена или кончилась): разведка закончена
    function advance(): void {
        const player = core.player();
        if (!player) return;
        const items = player.getQueue().slice();
        const index = player.getQueueState().currentIndex;
        const next = items.slice(index + 1).find((item) => core.ours(item));
        if (!next) {
            stop();
            return;
        }
        windowFrom = null;
        player.setCurrentItem(next, {});
        if (!player.isPlaying()) player.playCurrent({ userInitiated: true });
    }
    // Лайк сессию уже поднял сам, «Оставить» поднимает так же
    function keep(byLike = false): void {
        const id = playingId();
        if (!scouted(id)) return;
        kept.add(id);
        const candidate = byLike ? undefined : core.candidate(id);
        if (candidate) core.keep(candidate);
        core.render();
    }
    function step(): number {
        if (!running()) return 0;
        const player = core.player();
        const sound = player?.getCurrentSound();
        if (!player || !sound || !core.running()) {
            stop();
            return 0;
        }
        const item = player.getCurrentQueueItem();
        // Свой трек кончился: дальше идёт обычная волна карточки, разведка своё отыграла
        if (sound.id !== soundId) {
            soundId = sound.id;
            windowFrom = null;
            startedAt = Date.now();
            if (item && core.ours(item) && !ids.includes(sound.id)) {
                stop();
                return 0;
            }
            core.render();
        }
        const playing = player.isPlaying();
        const position = typeof sound.currentTime === 'function' ? sound.currentTime() || 0 : 0;
        const now = Date.now();
        // Перемотка человеком: позиция ушла не на столько, сколько прошло времени. В свёрнутом окне таймеры редеют,
        // но позиция и время там уходят вместе
        const seeked = playing && wasPlaying && Math.abs(position - expected - (now - checkedAt)) > 3000;
        expected = position;
        checkedAt = now;
        wasPlaying = playing;
        if (!scouted(sound.id) || !playing) return 250;
        if (core.liked()) {
            keep(true);
            return 250;
        }
        if (windowFrom === null) {
            const track = sound.attributes;
            const samples = track ? core.samples(track) : null;
            const duration = typeof sound.getMediaDuration === 'function' ? sound.getMediaDuration() || 0 : 0;
            // Форма волны ещё грузится: полторы секунды ждём её, потом место по длине трека
            if (!samples && Date.now() - startedAt < 1500) return 150;
            const start = samples ? scoutStart(samples, duration) : Math.round(Math.max(0, Math.min(duration * 0.3, duration - WINDOW - 2000)));
            windowFrom = start;
            if (Math.abs(position - start) > 2000) {
                sound.seek(start);
                expected = start;
                return 250;
            }
        } else if (seeked) windowFrom = position;
        const left = windowFrom + WINDOW - position;
        const bar = document.querySelector<HTMLElement>('#sc-wave .scw-scout-bar > span');
        if (bar) bar.style.width = Math.round(Math.max(0, Math.min(1, 1 - left / WINDOW)) * 100) + '%';
        if (left <= 0) {
            advance();
            return 250;
        }
        return Math.min(250, left);
    }
    function loop(): void {
        timer = undefined;
        if (core.disposed() || !running()) return;
        let delay = 250;
        try {
            delay = step();
        } catch (error) {
            console.warn('Разведка: шаг не удался', error);
        }
        if (running()) timer = setTimeout(loop, delay || 250);
    }
    // Enter оставляет, стрелка вправо дальше. Не мешают полям ввода, кнопкам, ссылкам, меню и диалогам
    const onKey = (event: KeyboardEvent): void => {
        if (event.key !== 'Enter' && event.key !== 'ArrowRight') return;
        if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.repeat || !ids.includes(playingId())) return;
        // Оставленный трек дослушивается, Enter у него ничего не значит; дальше можно и от него
        if (event.key === 'Enter' && kept.has(playingId())) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest('input, textarea, select, button, a, [contenteditable="true"], [contenteditable=""], [role="slider"], [role="radio"], [role="menu"], [role="dialog"], .scw-menu, .scw-dialog')) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Enter') keep();
        else advance();
    };
    window.addEventListener('keydown', onKey, true);

    function panel(currentId: number): HTMLElement | null {
        if (!running() || !ids.includes(currentId)) return null;
        const box = core.el('div', 'scw-scout');
        box.setAttribute('role', 'group');
        box.setAttribute('aria-label', T.scoutTitle);
        const label = core.el('div', 'scw-scout-text', T.scoutTitle);
        const count = core.el('span', 'scw-scout-count', fillText(T.scoutCount, { n: String(ids.indexOf(currentId) + 1), total: String(ids.length) }));
        label.append(' ', count);
        const isKept = kept.has(currentId);
        const bar = core.el('div', 'scw-scout-bar');
        bar.setAttribute('aria-hidden', 'true');
        bar.append(core.el('span', ''));
        if (isKept) bar.hidden = true;
        const button = (act: string, text: string, title: string): HTMLButtonElement => {
            const node = core.el('button', 'scw-btn', text);
            node.type = 'button';
            node.dataset.act = act;
            node.title = title;
            return node;
        };
        const keepButton = button('scout-keep', isKept ? T.scoutKept : T.scoutKeep, T.scoutKeep + ', Enter');
        keepButton.setAttribute('aria-pressed', String(isKept));
        keepButton.disabled = isKept;
        box.append(label, bar, keepButton, button('scout-next', T.scoutNext, T.scoutNext + ', →'), button('scout-exit', T.scoutExit, T.scoutExit));
        return box;
    }
    return {
        start: (list, picked) => {
            if (timer !== undefined) clearTimeout(timer);
            ids = [...new Set(picked ? [picked, ...list] : list)];
            kept = new Set(picked ? [picked] : []);
            windowFrom = null;
            soundId = 0;
            timer = setTimeout(loop, 250);
        },
        stop,
        active: running,
        panel,
        act: (name) => {
            if (name === 'scout-keep') keep();
            else if (name === 'scout-next') advance();
            else if (name === 'scout-exit') stop();
            else return false;
            return true;
        },
        dispose: () => {
            if (timer !== undefined) clearTimeout(timer);
            timer = undefined;
            ids = [];
            window.removeEventListener('keydown', onKey, true);
        },
    };
}
