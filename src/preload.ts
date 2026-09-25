import { contextBridge, ipcRenderer } from 'electron';
import type { SiteDictionary, TrackInfo, TrackUpdateReason } from './types';

// Правила скрытия приходят до скриптов сайта. Неразмеченная полка ждёт заголовка, вместо кадра с запрещённым блоком.
export function installEarlyBlocks(css: string): void {
    const page = window as Window & { __scEarlyBlocks?: { update(css: string): void } };
    if (page.__scEarlyBlocks) { page.__scEarlyBlocks.update(css); return; }
    const style = document.createElement('style'); style.id = 'sc-early-blocks';
    const setStyle = (value: string): void => {
        style.textContent = value + '\nhtml[data-sc-home] li.mixedModularHome__item:not([data-sc-shelf]){visibility:hidden!important}';
    };
    setStyle(css);
    const patterns: Array<[string, RegExp]> = [
        ['more', /^(More of what you like|Больше того, что тебе нравится)$/i], ['recent', /^(Recently played|Недавно играло)$/i],
        ['mixed', /^(Mixed for|Миксы для)( |$)/i], ['stations', /^(Discover with Stations|Станции)$/i],
        ['trending', /^(Trending by genre|В тренде по жанрам)$/i], ['made', /^(Made for|Для)( |$)/i],
        ['curated', /^(Curated by SoundCloud|Подборки SoundCloud)$/i], ['albums', /^(Albums for|Альбомы для)( |$)/i],
        ['liked', /^(Liked by|Лайкнули)$/i], ['buzzing', /^(Artists to watch out for|Артисты, за которыми стоит следить)$/i],
    ];
    const update = (): void => {
        const root = document.documentElement; if (!root) return;
        if (!style.isConnected) root.prepend(style);
        const home = location.pathname === '/' || location.pathname === '/discover';
        root.toggleAttribute('data-sc-home', home);
        if (!home) return;
        for (const item of document.querySelectorAll('li.mixedModularHome__item:not([data-sc-shelf])')) {
            const title = item.querySelector('.mixedSelectionModule__titleText')?.textContent?.replace(/\s+/g, ' ').trim();
            if (title) item.setAttribute('data-sc-shelf', patterns.find(([, pattern]) => pattern.test(title))?.[0] ?? 'other');
        }
    };
    const observer = new MutationObserver(update);
    observer.observe(document, { childList: true, subtree: true, characterData: true });
    const push = history.pushState; const replace = history.replaceState;
    history.pushState = function (...args) { push.apply(this, args); update(); };
    history.replaceState = function (...args) { replace.apply(this, args); update(); };
    window.addEventListener('popstate', update);
    page.__scEarlyBlocks = { update: (value) => { setStyle(value); update(); } };
    window.addEventListener('pagehide', () => { observer.disconnect(); window.removeEventListener('popstate', update); history.pushState = push; history.replaceState = replace; }, { once: true });
    update();
}

try {
    const css: unknown = ipcRenderer.sendSync('soundcloud:early-blocks');
    if (typeof css === 'string') contextBridge.executeInMainWorld({ func: installEarlyBlocks, args: [css] });
} catch (error) { console.warn('Ранние правила скрытия не установлены', error); }
ipcRenderer.on('soundcloud:early-blocks', (_event, css: unknown) => {
    if (typeof css === 'string') contextBridge.executeInMainWorld({ func: installEarlyBlocks, args: [css] });
});

/**
 * Русский перевод сайта. Сайт переводит интерфейс через свой модуль Lingua: ключ это английская фраза.
 * Функция ставит перехват загрузки модулей webpack, находит Lingua и подкладывает словарь сразу после
 * его создания, до первой отрисовки. Выполняется в главном мире страницы и сериализуется целиком,
 * поэтому самодостаточна: всё нужное приходит аргументом.
 */
export function installSiteTranslation(dictionary: SiteDictionary): void {
    type Method = (this: LinguaInstance, ...args: unknown[]) => unknown;
    interface LinguaLib {
        phrases: Record<string, unknown>;
        extend(phrases: Record<string, unknown>): void;
        t(phrase: string, params?: object): string;
    }
    interface LinguaInstance { i18n?: LinguaLib }
    interface LinguaPrototype { initialize: Method; t: Method; tp: Method; getIntlLocale?: Method; __scRu?: boolean }
    type Factory = ((this: unknown, module: { exports: unknown }, ...rest: unknown[]) => unknown) & { __scRu?: boolean };
    type Push = (this: unknown, ...items: unknown[]) => unknown;

    const page = window as unknown as Record<string, unknown>;
    // Сайт уже запустился или перевод уже стоит: подменять поздно, остаётся английский
    if (page.webpackJsonp !== undefined || page.__scSiteTranslation !== undefined) return;
    const missing = new Set<string>();
    Object.defineProperty(page, '__scSiteTranslation', { value: Object.freeze({ language: 'ru', missing }) });

    const own = (table: object, key: string) => Object.prototype.hasOwnProperty.call(table, key);
    const contextOf = (options: unknown) => {
        const context = options && typeof options === 'object' ? (options as { context?: unknown }).context : undefined;
        return typeof context === 'string' && context ? context + '::' : '';
    };
    // Формы: 1 трек, 2 трека, 5 треков; дробное число читается как «2,5 трека»
    const pluralIndex = (count: number) => {
        if (!Number.isInteger(count)) return 1;
        const tail = Math.abs(count) % 100;
        const last = tail % 10;
        if (tail > 10 && tail < 20) return 2;
        if (last === 1) return 0;
        return last > 1 && last < 5 ? 1 : 2;
    };
    const ruNumber = new Intl.NumberFormat('ru-RU');
    const noteMissing = (lib: LinguaLib | undefined, key: string) => {
        if (lib && missing.size < 2000 && !own(lib.phrases, key)) missing.add(key);
    };

    const patchLingua = (exports: unknown) => {
        const proto = (exports as { LinguaClass?: { prototype?: LinguaPrototype } } | null)?.LinguaClass?.prototype;
        if (!proto || proto.__scRu || typeof proto.initialize !== 'function' || typeof proto.t !== 'function' || typeof proto.tp !== 'function') return;
        proto.__scRu = true;
        const { initialize, t, tp } = proto;
        proto.initialize = function (...args) {
            const result = initialize.apply(this, args);
            try {
                this.i18n?.extend(dictionary.phrases);
            } catch (error) {
                console.warn('[перевод] словарь не подложен', error);
            }
            return result;
        };
        proto.t = function (...args) {
            if (typeof args[0] === 'string') noteMissing(this.i18n, contextOf(args[2]) + args[0]);
            return t.apply(this, args);
        };
        proto.tp = function (...args) {
            const [singular, , count, params, options] = args;
            const lib = this.i18n;
            const key = typeof singular === 'string' ? contextOf(options) + singular : '';
            const forms = key && own(dictionary.plurals, key) ? dictionary.plurals[key] : undefined;
            if (lib && forms && forms.length === 3) {
                // Счётчик иногда приходит уже сокращённым («1.2K»): такое число читается как «много»
                const value = typeof count === 'number' ? count : Number(count);
                const exact = Number.isFinite(value);
                const shown = exact ? ruNumber.format(value) : String(count ?? '');
                return lib.t(forms[exact ? pluralIndex(value) : 2], Object.assign({}, params, { '%d': shown }));
            }
            if (key && missing.size < 2000) missing.add(key);
            return tp.apply(this, args);
        };
        // Даты и числа через Intl по-русски; язык запросов к API (getLocale) остаётся английским
        if (typeof proto.getIntlLocale === 'function') proto.getIntlLocale = () => 'ru';
    };

    // Локаль дат и чисел сайта: «9 years ago», месяцы, разделители. Помощники Lingua читают её при каждом вызове
    const patchLocale = (exports: unknown) => {
        const data = (exports as { default?: Record<string, unknown> } | null)?.default;
        if (!data || typeof data !== 'object' || data.__scRu) return;
        const relative = data.relativeTime as Record<string, unknown> | undefined;
        const dates = data.dates as Record<string, unknown> | undefined;
        if (!relative || !dates) return;
        data.__scRu = true;
        const forms = (list: string[]) => (count: unknown) => {
            const value = Number(count);
            return list[Number.isFinite(value) ? pluralIndex(value) : 2].replace('%d', String(count));
        };
        Object.assign(relative, {
            justNow: 'только что',
            rightNow: 'прямо сейчас',
            future: 'через %s',
            past: '%s назад',
            sec: forms(['%d секунду', '%d секунды', '%d секунд']),
            min: forms(['%d минуту', '%d минуты', '%d минут']),
            hour: forms(['%d час', '%d часа', '%d часов']),
            day: forms(['%d день', '%d дня', '%d дней']),
            month: forms(['%d месяц', '%d месяца', '%d месяцев']),
            year: forms(['%d год', '%d года', '%d лет']),
            secAbbreviated: forms(['%d с', '%d с', '%d с']),
            minAbbreviated: forms(['%d мин', '%d мин', '%d мин']),
            hourAbbreviated: forms(['%d ч', '%d ч', '%d ч']),
            dayAbbreviated: forms(['%d день', '%d дня', '%d дней']),
            monthAbbreviated: forms(['%d мес.', '%d мес.', '%d мес.']),
            yearAbbreviated: forms(['%d г.', '%d г.', '%d л.']),
        });
        // Месяцы в родительном падеже: в датах сайта они почти всегда после числа
        Object.assign(dates, {
            months: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
            monthsShort: ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'],
            weekdays: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
            shortWeekdays: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
            minWeekdays: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
        });
        const formats = data.dateFormats as Record<string, unknown> | undefined;
        if (formats) Object.assign(formats, { readableAbbreviated: 'DD MMM YYYY', readableAbbreviatedWithoutYear: 'DD MMM' });
        const picker = data.datePicker as Record<string, unknown> | undefined;
        if (picker) Object.assign(picker, { closeText: 'Готово', prevText: 'Назад', nextText: 'Далее', currentText: 'Сегодня', weekHeader: 'Нед' });
        data.delimiters = { thousands: ' ', decimal: ',' };
    };

    const hookPackage = (pkg: unknown) => {
        try {
            const modules = Array.isArray(pkg) ? pkg[1] : undefined;
            if (!modules || typeof modules !== 'object') return;
            const table = modules as Record<string, unknown>;
            for (const id of Object.keys(table)) {
                const factory = table[id];
                if (typeof factory !== 'function' || (factory as Factory).__scRu) continue;
                const source = Function.prototype.toString.call(factory);
                if (source.length > 20000) continue;
                const isLingua = source.includes('LinguaClass') && source.includes('.prototype.initialize');
                const isLocale = source.includes('relativeTime:{justNow:"Just now"');
                if (!isLingua && !isLocale) continue;
                const wrapped: Factory = function (this: unknown, module, ...rest) {
                    const result = (factory as Factory).call(this, module, ...rest);
                    try {
                        if (isLingua) patchLingua(module.exports);
                        else patchLocale(module.exports);
                    } catch (error) {
                        console.warn('[перевод] модуль ' + id + ' не пропатчен', error);
                    }
                    return result;
                };
                wrapped.__scRu = true;
                table[id] = wrapped;
            }
        } catch (error) {
            console.warn('[перевод] пакет модулей пропущен', error);
        }
    };

    // Рантаймов webpack у сайта два, оба читают push и тут же ставят свой. Обёртка запоминает
    // обработчик на момент чтения: второй рантайм вызывает первый, а не сам себя.
    const queue: unknown[] = [];
    const arrayPush = Array.prototype.push as Push;
    const wrap = (next: Push): Push => function (this: unknown, ...items: unknown[]) {
        items.forEach(hookPackage);
        return next.apply(this, items);
    };
    let current = wrap(arrayPush);
    Object.defineProperty(queue, 'push', {
        configurable: true,
        enumerable: false,
        get: () => current,
        set: (next: unknown) => {
            if (typeof next === 'function') current = wrap(next as Push);
        },
    });
    page.webpackJsonp = queue;
}

// Словарь приходит синхронно: перехват обязан встать до первого скрипта сайта
try {
    const dictionary: unknown = ipcRenderer.sendSync('soundcloud:site-translation');
    if (dictionary && typeof dictionary === 'object') {
        contextBridge.executeInMainWorld({ func: installSiteTranslation, args: [dictionary] });
    }
} catch (error) {
    console.warn('[перевод] не установлен', error);
}

contextBridge.exposeInMainWorld('soundcloudAPI', {
    library: {
        loadSession: (user: number) => ipcRenderer.invoke('soundcloud:library:loadSession', user),
        saveSession: (user: number, snapshot: unknown) => ipcRenderer.invoke('soundcloud:library:saveSession', user, snapshot),
        loadCatalog: (user: number) => ipcRenderer.invoke('soundcloud:library:loadCatalog', user),
        saveCatalog: (user: number, tracks: unknown) => ipcRenderer.invoke('soundcloud:library:saveCatalog', user, tracks),
        listMixes: (user: number) => ipcRenderer.invoke('soundcloud:library:listMixes', user),
        saveMix: (user: number, title: string, tracks: unknown) => ipcRenderer.invoke('soundcloud:library:saveMix', user, title, tracks),
        removeMix: (user: number, id: string) => ipcRenderer.invoke('soundcloud:library:removeMix', user, id),
    },
    // Хранилище рекомендаций: загрузки с разбором версий, связи записей, обход лайков и подписок; ввод проверяет worker
    recommend: {
        recordUploads: (user: number, tracks: unknown) => ipcRenderer.invoke('soundcloud:recommend:recordUploads', user, tracks),
        uploads: (user: number, keys: unknown) => ipcRenderer.invoke('soundcloud:recommend:uploads', user, keys),
        recordingLinks: (user: number) => ipcRenderer.invoke('soundcloud:recommend:recordingLinks', user),
        setRecordingLink: (user: number, a: string, b: string, same: boolean) => ipcRenderer.invoke('soundcloud:recommend:setRecordingLink', user, a, b, same),
        syncStart: (user: number, source: string, resume: boolean) => ipcRenderer.invoke('soundcloud:recommend:syncStart', user, source, resume),
        syncPage: (user: number, source: string, run: number, items: unknown, cursor: unknown) =>
            ipcRenderer.invoke('soundcloud:recommend:syncPage', user, source, run, items, cursor),
        syncFinish: (user: number, source: string, run: number, status: string, error: string) =>
            ipcRenderer.invoke('soundcloud:recommend:syncFinish', user, source, run, status, error),
        syncState: (user: number) => ipcRenderer.invoke('soundcloud:recommend:syncState', user),
        libraryMembers: (user: number, source: string) => ipcRenderer.invoke('soundcloud:recommend:libraryMembers', user, source),
        // Радар: план обхода источников и отметка проверки источника
        radarPlan: (user: number) => ipcRenderer.invoke('soundcloud:recommend:radarPlan', user),
        catalogChecked: (user: number, key: string, label: string, status: string, error: string, found: number) =>
            ipcRenderer.invoke('soundcloud:recommend:catalogChecked', user, key, label, status, error, found),
    },
    playback: (command: string) => {
        if (['play', 'pause', 'next', 'previous'].includes(command)) ipcRenderer.send('soundcloud:playback', command);
    },
    sendProfileUpdate: (username: string) => {
        ipcRenderer.send('soundcloud:profile-update', username);
    },
    sendTrackUpdate: (data: TrackInfo, reason: TrackUpdateReason) => {
        ipcRenderer.send('soundcloud:track-update', {
            data,
            reason,
        });
    },
    // Журнал прослушанного для «Моей волны», id проверяет main
    waveJournal: {
        load: (userId: number): Promise<unknown> => ipcRenderer.invoke('soundcloud:wave-journal:load', userId),
        add: (userId: number, ids: number[]) => {
            ipcRenderer.send('soundcloud:wave-journal:add', userId, ids);
        },
    },
    // Журнал сигналов: как слушался каждый трек, события проверяет main
    waveSignals: {
        add: (userId: number, signals: unknown[]) => {
            ipcRenderer.send('soundcloud:wave-signals:add', userId, signals);
        },
    },
    // Волна от трека осталась пустой: числа по источникам в журнал диагностики, проверяет main
    reportWaveEmpty: (counts: unknown) => {
        ipcRenderer.send('soundcloud:wave-empty', counts);
    },
    // Место плеера сайта снизу страницы: окно истории кончается выше него, числа проверяет main
    reportPlayerArea: (height: unknown, viewport: unknown) => {
        ipcRenderer.send('soundcloud:player-area', height, viewport);
    },
    // Кнопка с часами в блоке «Моей волны»: та же история, что по Ctrl+H
    openHistory: () => {
        ipcRenderer.send('soundcloud:open-history');
    },
    // Жанр, счётчики и волна текущего трека для карточки Discord
    sendTrackMeta: (meta: unknown) => {
        ipcRenderer.send('soundcloud:track-meta', meta);
    },
    // Отметки волны: «Не нравится», скрытые артисты, «Не сейчас», «Больше такого»; ввод проверяет main
    waveExclusions: {
        load: (userId: number): Promise<unknown> => ipcRenderer.invoke('soundcloud:wave-exclusions:load', userId),
        set: (userId: number, kind: string, entry: object, excluded: boolean): Promise<unknown> =>
            ipcRenderer.invoke('soundcloud:wave-exclusions:set', userId, kind, entry, excluded),
    },
    // Профиль вкуса для порядка волны: считает main по истории прослушиваний
    waveTaste: {
        load: (userId: number): Promise<unknown> => ipcRenderer.invoke('soundcloud:wave-taste', userId),
    },
    // Подборки дня: снимок до полуночи и треки, звучавшие за 30 дней; снимок проверяет main
    waveShelf: {
        load: (userId: number): Promise<unknown> => ipcRenderer.invoke('soundcloud:wave-shelf:load', userId),
        save: (userId: number, snapshot: object): Promise<unknown> => ipcRenderer.invoke('soundcloud:wave-shelf:save', userId, snapshot),
    },
});
