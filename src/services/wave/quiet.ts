// Тихие края и плавный переход между треками. По форме волны тишина в начале трека перематывается, тишина в конце
// перематывается к самому концу (дальше сайт сам решает: следующий трек, повтор или автоплей). Плавный переход: за
// несколько секунд до конца звука хвост трека подхватывает свой звуковой элемент и гаснет, а сайт уже играет следующий
// трек, и тот набирает громкость. Действует на всё, что играет в клиенте, не только на волну.
// Раздел страницы волны: installQuiet уходит на страницу текстом вместе с волной (pageHelpers в wave.ts) и зовёт
// quietBounds и openStream по голому имени.
// Устройство сайта (проверено 02.10.2026 и 10.10.2026 в dev-клиенте): один звуковой элемент вне документа на все треки,
// на новом треке сайт сам ставит ему свою громкость. Элемент идёт через Web Audio плеера maestro: источник, регуляторы
// pausePlay, seek, glitchCoverup и выход контекста. Позиция трека у плеера сайта не равна currentTime элемента (у MSE
// своя шкала), поэтому свой элемент сверяется с sound.currentTime(). Свой элемент подключается в тот же контекст: задержка
// вывода у обоих одна, и равные позиции дают совпадение звука до миллисекунд (сверено взаимной корреляцией сигналов).
// Поток трека это HLS AAC, ссылку отдаёт API сайта, Chromium 148 играет его сам
import type { SitePlayer, SiteSound } from '../wave';
import type { WaveTrack } from '../waveTypes';

/** Где кончается тишина в начале и начинается в конце, мс */
export interface QuietBounds { introEnd: number; loudEnd: number }
/** edges: тишина в начале и конце проматывается; crossfade: длина плавного перехода, с, 0 выключает */
export interface QuietOptions { edges: boolean; crossfade: number }

/** Настройки с main: длина перехода целая от 1 до 12 с, всё прочее значит выключено */
export function quietOptionsOf(value: unknown): QuietOptions {
    const next = value && typeof value === 'object' ? (value as Partial<Record<keyof QuietOptions, unknown>>) : {};
    const seconds = typeof next.crossfade === 'number' && Number.isFinite(next.crossfade) ? Math.round(next.crossfade) : 0;
    return { edges: next.edges !== false, crossfade: seconds >= 1 ? Math.min(12, seconds) : 0 };
}

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
    return { introEnd: first * step, loudEnd: (last + 1) * step };
}

interface StreamTrack extends WaveTrack {
    track_authorization?: string;
    media?: { transcodings?: Array<{ url?: string; snipped?: boolean; format?: { protocol?: string; mime_type?: string } } | null> } | null;
}
/** Открытый поток HLS AAC трека для своего элемента: ссылка API вместе с track_authorization. Отрывки и зашифрованные
 *  потоки (у них другой protocol) не берутся: свой элемент их не сыграет */
export function openStream(track: WaveTrack): string | null {
    const { media, track_authorization: auth } = track as StreamTrack;
    if (typeof auth !== 'string' || !auth) return null;
    const list = Array.isArray(media?.transcodings) ? media.transcodings : [];
    for (const item of list) {
        const url = item?.url;
        if (item?.format?.protocol !== 'hls' || !/mp4a/.test(item.format.mime_type ?? '') || item.snipped === true) continue;
        if (typeof url !== 'string' || !/^https:\/\/api-v2\.soundcloud\.com\/media\//.test(url)) continue;
        return url + (url.includes('?') ? '&' : '?') + 'track_authorization=' + encodeURIComponent(auth);
    }
    return null;
}

export interface QuietCore {
    player(): SitePlayer | null;
    /** Сырые отсчёты формы волны трека; null, пока грузятся или их нет. Вызов сам запускает загрузку */
    rawSamples(track: WaveTrack): number[] | null;
    /** Ссылка на плейлист потока по ссылке API трека. Запрос идёт через API сайта: ключ и вход подставляет он */
    resolveStream(url: string): Promise<string | null>;
    /** Треки сейчас сменяет разведка: переход не нужен */
    held(): boolean;
    options(): QuietOptions;
    disposed(): boolean;
}
export interface QuietSection {
    /** Трек сменился плавным переходом за секунды до конца: для журнала он дослушан */
    crossfaded(id: number): boolean;
    dispose(): void;
}

export function installQuiet(core: QuietCore): QuietSection {
    // Тишина в начале перематывается от 2,5 с, в конце от 3 с
    const INTRO_MIN = 2500;
    const TAIL_MIN = 3000;
    // Хвост готовится за 10 с до перехода и передаётся своему элементу плавно за 30 мс. Сайт отвечает новым треком за
    // 0,2 с (замер 10.10), ждём его до 8 с
    const PREPARE = 10000;
    const SWAP = 0.03;
    const WAIT_NEXT = 8000;
    // Свой элемент начинает играть на 60 мс позже вызова play (замер 10.10). Разница с треком сайта сошлась, когда медиана
    // последних замеров не больше 8 мс: при передаче за 30 мс такой сдвиг не слышен
    const START_LAG = 0.06;
    const SYNCED = 0.008;

    interface SiteAudio { context: AudioContext; gain: GainNode; element: HTMLMediaElement | null }
    interface Deck { context: AudioContext; element: HTMLAudioElement; gain: GainNode; busy: boolean }
    // load: поток грузится; sync: свой элемент играет без звука и подгоняется; ready: сошёлся; out: хвост после передачи
    // readings: последние расхождения с треком сайта, с; stable: шагов подряд в допуске; calm: шагов подряд со скоростью 1
    interface Tail { deck: Deck; site: SiteAudio; end: number; phase: 'load' | 'sync' | 'ready' | 'out'; readings: number[]; stable: number; calm: number; until: number }
    interface Incoming { from: number; to: number; at: number; started: number; length: number; tail: Tail }

    const own = new WeakSet<HTMLMediaElement>();
    const decks: Deck[] = [];
    const volume = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
    let media: HTMLAudioElement | null = null;
    // Громкость, которую ставят сайт и человек, и свой множитель к ней: звучит их произведение
    let base = 1;
    let level = 1;
    let tail: Tail | null = null;
    let fading: Tail[] = [];
    let swapping: { item: Tail; at: number; length: number } | null = null;
    let incoming: Incoming | null = null;
    const crossfadedIds: number[] = [];
    let soundId = 0;
    let lastPosition = 0;
    let introDone = false;
    let tailDone = false;
    let tried = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const originalPlay = HTMLMediaElement.prototype.play;
    // Элемент сайта живёт вне документа, поэтому ловится при запуске. Свои элементы хвоста не в счёт
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement, ...args: []) {
        if (this instanceof HTMLAudioElement && this !== media && !own.has(this)) watch(this);
        return originalPlay.apply(this, args);
    };
    function apply(): void {
        if (media && volume?.set) volume.set.call(media, Math.max(0, Math.min(1, base * level)));
    }
    function setLevel(value: number): void {
        if (Math.abs(value - level) < 0.0005) return;
        level = value;
        apply();
    }
    // Сайт и ползунок пишут громкость как обычно и читают её же, а звучит она с множителем
    function watch(element: HTMLAudioElement): void {
        if (media) unwatch();
        if (!volume?.get || !volume.set) return;
        media = element;
        base = volume.get.call(element) as number;
        Object.defineProperty(element, 'volume', {
            configurable: true,
            enumerable: true,
            get: () => base,
            set: (value: number) => {
                base = Math.max(0, Math.min(1, Number(value) || 0));
                apply();
            },
        });
        apply();
    }
    function unwatch(): void {
        if (!media) return;
        Reflect.deleteProperty(media, 'volume');
        if (volume?.set) volume.set.call(media, base);
        media = null;
    }
    const positionOf = (sound: SiteSound): number => (typeof sound.currentTime === 'function' ? sound.currentTime() || 0 : 0);
    const durationOf = (sound: SiteSound): number => (typeof sound.getMediaDuration === 'function' ? sound.getMediaDuration() || 0 : 0);
    const repeatOne = (): boolean => document.querySelector('.repeatControl')?.classList.contains('m-one') === true;
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    // Цепочка Web Audio трека лежит у плеера maestro в _webAudioOrchestration, сейчас это sound.player.player._player._player.
    // Имена внутренние, поэтому ищется обходом от sound.player, не глубже пяти уровней и не больше 200 объектов
    function siteAudioOf(sound: SiteSound): SiteAudio | null {
        const queue: Array<{ value: unknown; depth: number }> = [{ value: (sound as unknown as { player?: unknown }).player, depth: 0 }];
        const seen = new Set<object>();
        while (queue.length && seen.size < 200) {
            const next = queue.shift();
            if (!next) break;
            const { value, depth } = next;
            if (!value || typeof value !== 'object' || seen.has(value) || value instanceof Node || value === window) continue;
            seen.add(value);
            const record = value as Record<string, unknown>;
            const found = asSiteAudio(record._webAudioOrchestration);
            if (found) return found;
            if (depth >= 5) continue;
            for (const key of Object.keys(record)) {
                let child: unknown;
                try {
                    child = record[key];
                } catch {
                    continue;
                }
                if (child && typeof child === 'object' && !Array.isArray(child)) queue.push({ value: child, depth: depth + 1 });
            }
        }
        return null;
    }
    function asSiteAudio(value: unknown): SiteAudio | null {
        const orchestration = value as { context?: unknown; gainNodes?: { glitchCoverup?: unknown } | null; mediaElementSource?: { mediaElement?: unknown } | null } | null | undefined;
        const context = orchestration?.context as AudioContext | undefined;
        const gain = orchestration?.gainNodes?.glitchCoverup as GainNode | undefined;
        if (!context || typeof context.createMediaElementSource !== 'function' || typeof context.createGain !== 'function') return null;
        if (!gain || typeof gain.gain?.linearRampToValueAtTime !== 'function') return null;
        const element = orchestration?.mediaElementSource?.mediaElement;
        return { context, gain, element: element instanceof HTMLMediaElement ? element : null };
    }

    // Свои элементы хвоста: источник Web Audio у элемента создаётся один раз, поэтому их держим. Два на контекст: хвост
    // прошлого перехода может ещё звучать, когда готовится следующий
    function deckFor(context: AudioContext): Deck | null {
        const free = decks.find((deck) => deck.context === context && !deck.busy);
        if (free) {
            free.busy = true;
            return free;
        }
        if (decks.filter((deck) => deck.context === context).length >= 2) return null;
        const element = document.createElement('audio');
        // Без CORS Web Audio получает от чужого потока тишину
        element.crossOrigin = 'anonymous';
        element.preload = 'auto';
        // Подгонка идёт без звука: скорость меняется как у пластинки, ровно. С сохранением высоты тона Chromium режет звук
        // кусками, и сдвиг по звуку скачет на 10-25 мс (замер 10.10)
        element.preservesPitch = false;
        own.add(element);
        const source = context.createMediaElementSource(element);
        const gain = context.createGain();
        gain.gain.value = 0;
        source.connect(gain);
        gain.connect(context.destination);
        const deck: Deck = { context, element, gain, busy: true };
        decks.push(deck);
        return deck;
    }
    function restoreSite(site: SiteAudio): void {
        // Регулятор сайта уходящего трека: если сайт трек не сменил, без этого он остался бы без звука
        const param = site.gain.gain;
        param.cancelScheduledValues(0);
        param.value = 1;
    }
    function release(item: Tail): void {
        const { deck } = item;
        deck.gain.gain.cancelScheduledValues(0);
        deck.gain.gain.value = 0;
        deck.element.pause();
        deck.element.removeAttribute('src');
        deck.element.load();
        deck.element.playbackRate = 1;
        deck.busy = false;
        if (item.phase === 'out') restoreSite(item.site);
    }
    function dropTail(): void {
        if (!tail) return;
        release(tail);
        tail = null;
    }
    function finishIncoming(): void {
        if (!incoming) return;
        const { tail: item } = incoming;
        release(item);
        fading = fading.filter((entry) => entry !== item);
        incoming = null;
        setLevel(1);
    }
    function remember(id: number): void {
        crossfadedIds.push(id);
        if (crossfadedIds.length > 20) crossfadedIds.shift();
    }

    function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
        return Promise.race([promise, sleep(ms).then((): T => { throw new Error('Тайм-аут: ' + what); })]);
    }
    async function until(check: () => boolean, ms: number, what: string): Promise<void> {
        const deadline = performance.now() + ms;
        while (!check()) {
            if (performance.now() > deadline) throw new Error('Тайм-аут: ' + what);
            await sleep(10);
        }
    }
    // Хвост играющего трека: поток грузится в свой элемент, встаёт на позицию чуть впереди и запускается без звука, когда
    // трек у сайта до неё дойдёт. Дальше его подгоняет скоростью syncTail
    async function prepare(sound: SiteSound, end: number): Promise<void> {
        const track = sound.attributes;
        const site = siteAudioOf(sound);
        const api = track ? openStream(track) : null;
        if (!site || !api || site.context.state !== 'running') return;
        if (!media && site.element instanceof HTMLAudioElement) watch(site.element);
        let deck: Deck | null;
        try {
            deck = deckFor(site.context);
        } catch (error) {
            console.warn('Плавный переход: свой элемент не подключился к звуку сайта', error);
            return;
        }
        if (!deck) return;
        const current: Tail = { deck, site, end, phase: 'load', readings: [], stable: 0, calm: 0, until: 0 };
        tail = current;
        const stale = (): boolean => tail !== current || core.disposed();
        try {
            const url = await withTimeout(core.resolveStream(api), 8000, 'ссылка на поток');
            if (stale()) return;
            if (!url) throw new Error('API не дал ссылку на поток');
            const element = deck.element;
            element.src = url;
            await until(() => element.readyState >= 1 || element.error !== null, 8000, 'данные потока');
            if (stale()) return;
            if (element.error) throw new Error('поток не играет: ' + element.error.message);
            // Поток не тот, что играет сайт (например, отрывок вместо целого трека)
            if (Math.abs(element.duration * 1000 - durationOf(sound)) > 1500) throw new Error('длина потока ' + element.duration + ' с');
            const target = positionOf(sound) / 1000 + 0.6;
            element.currentTime = target;
            await until(() => element.readyState >= 3 && !element.seeking, 5000, 'перемотка потока');
            if (stale()) return;
            const left = (target - START_LAG - positionOf(sound) / 1000) * 1000;
            if (left > 20) await sleep(left - 15);
            await until(() => positionOf(sound) / 1000 >= target - START_LAG, 2000, 'позиция сайта');
            if (stale()) return;
            deck.gain.gain.cancelScheduledValues(0);
            deck.gain.gain.value = 0;
            element.playbackRate = 1;
            await element.play();
            if (stale()) return;
            current.phase = 'sync';
        } catch (error) {
            if (stale()) return;
            dropTail();
            console.warn('Плавный переход: хвост не готов, трек просто затихнет', error);
        }
    }
    // Подгонка скоростью по медиане девяти замеров: позиции читаются с шумом до 10-20 мс, резкий регулятор на нём
    // раскачивается (замер 10.10: при усилении 4 сдвиг по звуку гулял до 15 мс)
    function syncTail(item: Tail, position: number): void {
        const element = item.deck.element;
        if (volume?.set) volume.set.call(element, base);
        element.muted = media?.muted === true;
        if (item.phase !== 'sync' && item.phase !== 'ready') return;
        const gap = element.currentTime - position / 1000;
        item.readings.push(gap);
        if (item.readings.length > 9) item.readings.shift();
        const middle = item.readings.slice().sort((a, b) => a - b)[Math.floor(item.readings.length / 2)];
        // Перемотка человеком или поток встал: хвост этого места больше не годится
        if (Math.abs(middle) > 1 || element.paused || element.ended) {
            dropTail();
            tried = false;
            return;
        }
        // Внутри допуска скорость ровно 1: передача берёт хвост, который уже не догоняет
        const rate = Math.abs(middle) < SYNCED ? 1 : 1 - Math.max(-0.04, Math.min(0.04, middle * 2));
        element.playbackRate = rate;
        item.calm = rate === 1 ? item.calm + 1 : 0;
        // Один из потоков изредка разом сдвигается на кадр AAC, 23 мс (замер 10.10): медиана замечает это не сразу, поэтому
        // готовность снимается и по среднему трёх последних замеров. Готов хвост, который треть секунды идёт со скоростью 1
        const recent = item.readings.slice(-3).reduce((sum, value) => sum + value, 0) / Math.min(3, item.readings.length);
        const settled = item.readings.length >= 5 && Math.abs(middle) <= SYNCED && Math.abs(recent) <= SYNCED * 2 && item.calm >= 10;
        item.stable = settled ? item.stable + 1 : 0;
        if (item.stable >= 6) item.phase = 'ready';
        else if (!settled) item.phase = 'sync';
    }
    // Передача хвоста: регулятор сайта уходит в ноль, свой поднимается, оба на звуковом потоке за 30 мс. Следующий трек
    // включается на следующем шаге, когда передача закончится
    function handoff(item: Tail, length: number): void {
        const { context, gain, element } = item.deck;
        const site = item.site.gain.gain;
        const at = context.currentTime + 0.01;
        element.playbackRate = 1;
        site.cancelScheduledValues(at);
        site.setValueAtTime(site.value, at);
        site.linearRampToValueAtTime(0, at + SWAP);
        gain.gain.cancelScheduledValues(0);
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(1, at + SWAP);
        item.phase = 'out';
        tail = null;
        fading.push(item);
        swapping = { item, at: performance.now(), length };
    }
    // Хвост гаснет по косинусу, пока следующий трек вступает по синусу: сумма мощностей ровная
    function fadeOut(item: Tail, length: number): void {
        const { context, gain, element } = item.deck;
        const seconds = Math.max(0.3, Math.min(length / 1000, item.end / 1000 - element.currentTime));
        const curve = new Float32Array(32).map((_, i) => Math.cos((i / 31) * (Math.PI / 2)));
        const now = context.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(1, now);
        try {
            gain.gain.setValueCurveAtTime(curve, now + 0.005, seconds);
        } catch (error) {
            gain.gain.linearRampToValueAtTime(0, now + seconds);
            console.warn('Плавный переход: кривая затухания не встала, хвост гаснет прямой', error);
        }
        item.until = performance.now() + seconds * 1000 + 200;
        restoreSite(item.site);
    }
    // Вступление следующего трека после передачи. Сайт ещё на старом треке, человек переключил дальше или поставил
    // паузу: переход заканчивается, громкость обычная
    function follow(player: SitePlayer, sound: SiteSound, position: number): void {
        const current = incoming;
        if (!current) return;
        const now = performance.now();
        if (sound.id === current.from) {
            if (now - current.at > WAIT_NEXT) finishIncoming();
            return;
        }
        if (!current.to) current.to = sound.id;
        if (sound.id !== current.to) {
            finishIncoming();
            return;
        }
        if (!current.started) {
            if (!player.isPlaying() || position <= 0) {
                if (now - current.at > WAIT_NEXT) finishIncoming();
                return;
            }
            current.started = now;
            fadeOut(current.tail, current.length);
        } else if (!player.isPlaying()) {
            finishIncoming();
            return;
        }
        const k = Math.min(1, (now - current.started) / current.length);
        setLevel(Math.sin(k * (Math.PI / 2)));
        if (k >= 1) incoming = null;
    }

    // Один шаг: смена трека, перемотка тишины, подготовка и передача хвоста. Возвращает, через сколько следующий
    function step(): number {
        const now = performance.now();
        fading = fading.filter((item) => {
            if (item.until && now > item.until) {
                release(item);
                return false;
            }
            syncTail(item, 0);
            return true;
        });
        const player = core.player();
        const sound = player?.getCurrentSound();
        if (!player || !sound) {
            dropTail();
            if (!incoming && !swapping) setLevel(1);
            return 500;
        }
        if (swapping) {
            if (now - swapping.at < 35) return 10;
            const { item, length } = swapping;
            swapping = null;
            // Человек успел переключить сам: второй раз дальше не идём, звук сайту возвращается
            if (sound.id !== soundId) {
                release(item);
                fading = fading.filter((entry) => entry !== item);
                return 40;
            }
            setLevel(0);
            remember(soundId);
            incoming = { from: soundId, to: 0, at: now, started: 0, length, tail: item };
            try {
                player.playNext?.();
            } catch (error) {
                console.warn('Плавный переход: сайт не переключил трек', error);
                finishIncoming();
            }
            return 40;
        }
        const position = positionOf(sound);
        follow(player, sound, position);
        // Новый трек или тот же с начала (повтор, перемотка в начало): разбор заново
        if (sound.id !== soundId || (position < 1500 && lastPosition > position + 5000)) {
            soundId = sound.id;
            introDone = false;
            tailDone = false;
            tried = false;
            dropTail();
            if (!incoming) setLevel(1);
        }
        lastPosition = position;
        const options = core.options();
        const duration = durationOf(sound);
        const track = sound.attributes;
        if (!track || !player.isPlaying() || sound.isSnippetized?.()) {
            dropTail();
            tried = false;
            return incoming ? 40 : 250;
        }
        const raw = options.edges ? core.rawSamples(track) : null;
        const bounds = raw ? quietBounds(raw, duration) : null;
        // Тишина в начале: только у трека, который только что начался, а не после перемотки человеком
        if (bounds && !introDone) {
            introDone = true;
            if (position < 1500 && bounds.introEnd >= INTRO_MIN) {
                sound.seek(Math.max(0, bounds.introEnd - 300));
                return 250;
            }
        }
        const silentTail = bounds !== null && duration - bounds.loudEnd >= TAIL_MIN;
        const end = bounds && silentTail ? bounds.loudEnd + 500 : duration;
        const length = options.crossfade * 1000;
        const from = end - length;
        const crossfade = length > 0 && duration >= 30000 && from >= 10000 && typeof player.playNext === 'function' && player.hasNextSound?.() === true && !repeatOne() && !core.held();
        if (crossfade && !incoming) {
            if (!tail && !tried && position >= from - PREPARE && position < from - 1500) {
                tried = true;
                void prepare(sound, end);
            }
            if (tail) syncTail(tail, position);
            if (position >= from && position < end) {
                if (tail?.phase === 'ready') {
                    handoff(tail, length);
                    return 10;
                }
                // Подгонка сбилась прямо перед переходом: до полутора секунд ждём, громкость пока полная
                if (tail?.phase === 'sync' && level === 1 && position < from + 1500) return 30;
                // Хвост не готов к началу перехода: трек просто затихает к концу звука, поздней передачи не будет
                tried = true;
                dropTail();
                setLevel(Math.cos(Math.min(1, (position - from) / length) * (Math.PI / 2)));
                return 40;
            }
            if (position < from) setLevel(1);
        } else {
            dropTail();
            if (!incoming) setLevel(1);
        }
        if (silentTail && !tailDone && position >= end && position < duration - 1000) {
            tailDone = true;
            sound.seek(duration - 250);
            return 250;
        }
        if (incoming || tail) return 30;
        // Хвост после перехода ещё звучит: громкость за ползунком и снятие в срок
        if (fading.length) return 100;
        if (crossfade && position < from - PREPARE) return Math.max(250, Math.min(1000, from - PREPARE - position));
        return silentTail && end - position > 1000 ? Math.min(1000, end - position - 500) : 250;
    }
    // Всё своё снимается, звук сайту возвращается целиком
    function reset(): void {
        swapping = null;
        finishIncoming();
        dropTail();
        for (const item of fading) release(item);
        fading = [];
        setLevel(1);
    }
    function loop(): void {
        timer = undefined;
        if (core.disposed()) return;
        let delay = 500;
        try {
            delay = step();
        } catch (error) {
            reset();
            console.warn('Тихие края: шаг не удался', error);
        }
        timer = setTimeout(loop, delay);
    }
    // Первый шаг после того, как волна объявит всё своё: форма волны и плеер появляются позже
    timer = setTimeout(loop, 500);
    return {
        crossfaded: (id) => crossfadedIds.includes(id),
        dispose: () => {
            if (timer !== undefined) clearTimeout(timer);
            timer = undefined;
            reset();
            for (const deck of decks) deck.gain.disconnect();
            decks.length = 0;
            unwatch();
            HTMLMediaElement.prototype.play = originalPlay;
        },
    };
}
