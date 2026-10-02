// Тихое начало и мягкий конец трека (Ф2): по форме волны тишина в начале перематывается, тишина в конце
// перематывается к самому концу (дальше сайт сам решает: следующий трек, повтор или автоплей), а трек, который
// обрывается громко, плавно затихает в последние секунды. Действует на всё, что играет в клиенте, не только на волну.
// Раздел страницы волны: installQuiet уходит на страницу текстом вместе с волной (pageHelpers в wave.ts) и зовёт
// quietBounds по голому имени.
// Громкость меняется у звукового элемента сайта. Проверено 02.10.2026: сайт держит один элемент вне документа на все
// треки, на новом треке сам возвращает свою громкость, изменённую громкость не сохраняет и ползунок по ней не двигает
import type { SitePlayer, SiteSound } from '../wave';
import type { WaveTrack } from '../waveTypes';

/** Где кончается тишина в начале и начинается в конце, мс; fadeOut: последние секунды звука громкие, трек обрывается */
export interface QuietBounds { introEnd: number; loudEnd: number; fadeOut: boolean }
export interface QuietOptions { edges: boolean; fade: boolean }

/** Тишина по сырым отсчётам формы волны: ниже 4% от 90-го перцентиля. Звук считается начавшимся с трёх отсчётов подряд
 *  выше порога, одиночный щелчок тишину не прерывает. Треки короче 30 секунд и почти пустая форма не разбираются */
export function quietBounds(raw: number[], duration: number): QuietBounds | null {
    if (raw.length < 100 || !(duration >= 30000)) return null;
    const sorted = raw.slice().sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    if (!(p90 > 0)) return null;
    const floor = Math.max(1, p90 * 0.04);
    const loud = (i: number): boolean => raw[i] > floor;
    let first = -1;
    for (let i = 0; i + 2 < raw.length; i++) if (loud(i) && loud(i + 1) && loud(i + 2)) { first = i; break; }
    let last = -1;
    for (let i = raw.length - 1; i >= 2; i--) if (loud(i) && loud(i - 1) && loud(i - 2)) { last = i; break; }
    if (first < 0 || last <= first) return null;
    const step = duration / raw.length;
    const loudEnd = (last + 1) * step;
    // Средний уровень последних двух секунд звука от трети p90: трек не затихает сам
    const from = Math.max(first, Math.floor((loudEnd - 2000) / step));
    let sum = 0;
    for (let i = from; i <= last; i++) sum += raw[i];
    return { introEnd: first * step, loudEnd, fadeOut: sum / (last - from + 1) >= p90 * 0.35 };
}

export interface QuietCore {
    player(): SitePlayer | null;
    /** Сырые отсчёты формы волны трека; null, пока грузятся или их нет. Вызов сам запускает загрузку */
    rawSamples(track: WaveTrack): number[] | null;
    options(): QuietOptions;
    disposed(): boolean;
}
export interface QuietSection {
    dispose(): void;
}

export function installQuiet(core: QuietCore): QuietSection {
    // Тишина в начале перематывается от 2,5 с, в конце от 3 с; затухание 6 с, в конце до -36 дБ
    const INTRO_MIN = 2500;
    const TAIL_MIN = 3000;
    const FADE = 6000;
    let media: HTMLAudioElement | null = null;
    // Громкость сайта до затухания и последнее значение, поставленное здесь: чужая смена громкости отменяет затухание
    let base = 1;
    let ours = -1;
    let fading = false;
    let soundId = 0;
    let lastPosition = 0;
    let introDone = false;
    let tailDone = false;
    let fadeCancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const originalPlay = HTMLMediaElement.prototype.play;
    // Элемент сайта живёт вне документа, поэтому ловится при запуске
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement, ...args: []) {
        if (this instanceof HTMLAudioElement && this !== media) watch(this);
        return originalPlay.apply(this, args);
    };
    function restore(): void {
        if (!fading) return;
        fading = false;
        if (media) {
            ours = base;
            media.volume = base;
        }
    }
    const onVolume = (): void => {
        if (!media || Math.abs(media.volume - ours) < 0.002) return;
        // Громкость сменил человек или сайт: она новая основа, затухание на этом треке не продолжается
        base = media.volume;
        if (fading) fadeCancelled = true;
        fading = false;
    };
    const onLeave = (): void => restore();
    function watch(element: HTMLAudioElement): void {
        if (media) unwatch();
        media = element;
        media.addEventListener('volumechange', onVolume);
        for (const name of ['pause', 'emptied', 'loadstart']) media.addEventListener(name, onLeave);
    }
    function unwatch(): void {
        if (!media) return;
        restore();
        media.removeEventListener('volumechange', onVolume);
        for (const name of ['pause', 'emptied', 'loadstart']) media.removeEventListener(name, onLeave);
        media = null;
    }
    const positionOf = (sound: SiteSound): number => (typeof sound.currentTime === 'function' ? sound.currentTime() || 0 : 0);
    const durationOf = (sound: SiteSound): number => (typeof sound.getMediaDuration === 'function' ? sound.getMediaDuration() || 0 : 0);
    // Один шаг: смена трека, перемотка тишины, громкость затухания. Возвращает, через сколько следующий
    function step(): number {
        const player = core.player();
        const sound = player?.getCurrentSound();
        if (!player || !sound) {
            restore();
            return 500;
        }
        const position = positionOf(sound);
        // Новый трек или тот же с начала (повтор, перемотка в начало): разбор заново
        if (sound.id !== soundId || (position < 1500 && lastPosition > position + 5000)) {
            restore();
            soundId = sound.id;
            introDone = false;
            tailDone = false;
            fadeCancelled = false;
        }
        lastPosition = position;
        const options = core.options();
        const duration = durationOf(sound);
        const track = sound.attributes;
        if ((!options.edges && !options.fade) || !track || !player.isPlaying() || sound.isSnippetized?.()) {
            restore();
            return 250;
        }
        const raw = core.rawSamples(track);
        const bounds = raw ? quietBounds(raw, duration) : null;
        if (!bounds) {
            restore();
            return 250;
        }
        // Тишина в начале: только у трека, который только что начался, а не после перемотки человеком
        if (options.edges && !introDone) {
            introDone = true;
            if (position < 1500 && bounds.introEnd >= INTRO_MIN) {
                sound.seek(Math.max(0, bounds.introEnd - 300));
                return 250;
            }
        }
        const tail = options.edges && duration - bounds.loudEnd >= TAIL_MIN;
        const end = tail ? bounds.loudEnd + 500 : duration;
        if (tail && !tailDone && position >= end && position < duration - 1000) {
            tailDone = true;
            restore();
            sound.seek(duration - 250);
            return 250;
        }
        const left = end - position;
        if (!options.fade || !bounds.fadeOut || fadeCancelled || left > FADE || left < 0 || !media) {
            restore();
            return left > FADE ? Math.min(1000, left - FADE) : 250;
        }
        if (!fading) {
            fading = true;
            base = media.volume;
        }
        const gain = Math.pow(10, (-36 * (1 - left / FADE)) / 20);
        ours = Math.max(0, Math.min(1, base * gain));
        media.volume = ours;
        return 100;
    }
    function loop(): void {
        timer = undefined;
        if (core.disposed()) return;
        let delay = 500;
        try {
            delay = step();
        } catch (error) {
            restore();
            console.warn('Тихие края: шаг не удался', error);
        }
        timer = setTimeout(loop, delay);
    }
    // Первый шаг после того, как волна объявит всё своё: форма волны и плеер появляются позже
    timer = setTimeout(loop, 500);
    return {
        dispose: () => {
            if (timer !== undefined) clearTimeout(timer);
            timer = undefined;
            unwatch();
            HTMLMediaElement.prototype.play = originalPlay;
        },
    };
}
