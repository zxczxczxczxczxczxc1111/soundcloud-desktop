'use strict';
// Страница истории прослушиваний: обзор периода и журнал дня. Данные отдаёт main из индекса журнала сигналов
(function () {
    const api = window.historyAPI;
    const view = document.getElementById('view');
    const tip = document.getElementById('tip');
    const ARTISTS_SHORT = 8;
    // Прослушивание засчитывается с 30 секунд звука, как в индексе истории (COUNTED_MS)
    const COUNTED_MS = 30000;

    const TEXTS = {
        ru: {
            title: 'История',
            close: 'Закрыть, Esc',
            closeLabel: 'Закрыть историю',
            search: 'Поиск по истории',
            searchLabel: 'Поиск по названию и артисту',
            periodGroup: 'Период',
            periods: { 7: '7 дней', 30: '30 дней', 365: 'Год', all: 'Всё время' },
            periodText: (p) => (p === 'all' ? 'за всё время' : p === 365 ? 'за год' : 'за ' + p + ' ' + plural(p, ['день', 'дня', 'дней'])),
            music: (p) => 'музыки ' + TEXTS.ru.periodText(p),
            h: 'ч',
            min: 'мин',
            sec: 'с',
            counted: ['прослушивание', 'прослушивания', 'прослушиваний'],
            artists: ['артист', 'артиста', 'артистов'],
            fresh: ['новый артист', 'новых артиста', 'новых артистов'],
            artistsTitle: (p) => 'Артисты ' + TEXTS.ru.periodText(p),
            more: 'Ещё',
            less: 'Свернуть',
            tracks: 'Треки',
            genres: 'Жанры',
            when: 'Когда ты слушаешь',
            emptyTop: 'Здесь появится музыка, которую ты слушаешь',
            nothing: 'Пока пусто',
            times: ['раз', 'раза', 'раз'],
            heatLabel: 'Минуты музыки по часам и дням недели',
            week: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
            lessHeat: 'Меньше',
            moreHeat: 'больше',
            silence: 'тишина',
            today: 'Сегодня',
            yesterday: 'Вчера',
            todayLower: 'сегодня',
            prevDay: 'Предыдущий день с музыкой',
            nextDay: 'Следующий день с музыкой',
            dayEmpty: 'В этот день музыки не было',
            fromWave: 'Из волны',
            fromRadar: 'Из радара релизов',
            fromLibrary: 'Из «Моей музыки»',
            fromMix: 'Из подборки',
            fromArtist: 'Из всех треков артиста',
            away: 'Играло, пока тебя не было у компьютера',
            like: 'Лайк',
            skipped: (t) => 'пропущен на ' + t,
            done: (t) => 'дослушан, ' + t,
            of: (a, b) => a + ' из ' + b,
            loading: 'Название загружается',
            unavailable: 'Трек недоступен',
            waveLabel: (p) => 'Длительность прослушивания ' + TEXTS.ru.periodText(p),
            from: (d) => 'С ' + d,
            results: 'Результаты поиска',
            plays: ['прослушивание', 'прослушивания', 'прослушиваний'],
            latest: (n) => 'последние ' + n,
            searchEmpty: 'Ничего не нашлось',
            signedOut: 'Войди в аккаунт SoundCloud, и здесь появится история прослушиваний',
            emptyAll: 'Здесь будут треки, которые ты слушаешь в клиенте',
            failed: 'Историю не удалось загрузить',
            retry: 'Повторить',
            artistTip: (plays, time) => plays + ', ' + time + '. Открыть страницу артиста',
            tasteArtists: 'Артисты, которых волна ставит чаще',
            tasteTags: 'Теги, на которые опирается волна',
            tasteEmpty: 'Волне пока не на что опереться',
            drop: 'Убрать из вкуса',
            removed: 'Убрано из вкуса:',
            restore: 'Вернуть во вкус волны',
            recap: 'Сводка недели',
            recapTip: 'Неделя музыки одной картинкой',
            recapWeeks: { last: 'Прошлая неделя', this: 'Эта неделя' },
            recapWeekGroup: 'Какая неделя',
            recapWeek: (n, range) => 'Неделя ' + n + ', ' + range,
            // 21-27 сентября 2026, 28 сентября - 4 октября 2026, 28 декабря 2026 - 3 января 2027
            recapRange: (a, b) => {
                const [x, y] = [new Date(a), new Date(b)];
                if (x.getFullYear() !== y.getFullYear()) return fmtDayMonth.format(a) + ' ' + x.getFullYear() + ' - ' + fmtDayMonth.format(b) + ' ' + y.getFullYear();
                return (x.getMonth() === y.getMonth() ? x.getDate() + '-' : fmtDayMonth.format(a) + ' - ') + fmtDayMonth.format(b) + ' ' + y.getFullYear();
            },
            recapMusic: 'музыки',
            recapTracks: 'Треки недели',
            recapArtists: 'Артисты недели',
            recapGenres: 'Любимые жанры',
            dayParts: ['Утро', 'День', 'Вечер', 'Ночь'],
            recapPeak: (day, hour) => 'Пик: ' + day + ', ' + hour,
            recapLoading: 'Собираю сводку',
            recapEmpty: { last: 'На прошлой неделе музыки не было', this: 'На этой неделе музыки пока не было' },
            recapFailed: 'Сводка не собралась',
            recapColors: 'Цвет карточки',
            recapPresets: ['Полночь', 'Фиолет', 'Бордо', 'Океан', 'Закат', 'Мята', 'Персик', 'Иней'],
            recapLabel: (time, plays) => 'Сводка недели: ' + time + ' музыки, ' + plays,
            copy: 'Скопировать',
            copied: 'Скопировано',
            copyFailed: 'Не удалось скопировать',
            save: 'Сохранить',
            saved: 'Сохранено',
            saveFailed: 'Не удалось сохранить',
            recapClose: 'Закрыть',
            waveTitle: 'Как попадает волна',
            waveCount: (n, p) => n + ' ' + plural(n, ['трек', 'трека', 'треков']) + ' волны ' + TEXTS.ru.periodText(p),
            waveLoading: 'Считаю',
            waveFailed: 'Замер не загрузился',
            waveNone: 'Волна в этот период не играла',
            waveEarly: 'пропущено до 0:30',
            waveDone: 'дослушано',
            waveShareTip: (part, whole) => part + ' из ' + whole,
            waveOwn: (share) => 'своя музыка ' + share + '%',
            wavePrev: (share, p) => (p === 365 ? 'прошлый год ' : 'прошлые ' + p + ' ' + plural(p, ['день', 'дня', 'дней']) + ' ') + share + '%',
            likes: ['лайк', 'лайка', 'лайков'],
            waveMore: (n) => '«Больше такого» ' + n,
            refusals: ['отказ', 'отказа', 'отказов'],
            waveAgainstTip: '«Не нравится», «Не сейчас» или скрытый аккаунт',
            waveRepeats: (n) => n + ' ' + plural(n, ['повтор', 'повтора', 'повторов']) + ' недавнего',
            waveRepeatsTip: 'Трек волны уже звучал за 3 дня до этого',
            waveNewTip: 'Впервые прослушаны дольше 30 секунд, и именно в волне',
            waveDays: 'Пропуски до 0:30 по дням',
            waveDaysLabel: 'Доля ранних пропусков в волне по дням',
            waveDay: (day, share, early, total) => day + ': ' + share + '%, ' + early + ' из ' + total,
            waveDayIdle: (day) => day + ': волна не играла',
            waveWeeks: 'Пропуски до 0:30 по неделям',
            waveWeeksLabel: 'Доля ранних пропусков в волне по неделям',
            waveWeek: (d, share, early, total) => 'С ' + d + ': ' + share + '%, ' + early + ' из ' + total,
            waveWeekIdle: (d) => 'С ' + d + ': волна не играла',
            waveCols: { tracks: 'Треков', early: 'До 0:30', done: 'Дослушано', likes: 'Лайки' },
            waveSource: 'Подборка',
            waveReason: 'Причина',
            waveOrigin: 'Откуда взят',
            waveSlot: 'Место в выдаче',
            slots: { first: 'Первые три', later: 'С четвёртого' },
            wavePreset: 'Настроение',
            presets: { happy: 'Весёлое', sad: 'Грустное', aggressive: 'Агрессивное', calm: 'Спокойное', energetic: 'Энергичное' },
            sources: {
                similar: 'Моя волна: похожее', fresh: 'Моя волна: новое', track: 'Волна по треку', artist: 'Волна по артисту', playlist: 'Волна по плейлисту', daily: 'Разведка',
                forgotten: 'Давно не слушал', group: 'Твой вкус', tracks: 'Волна по набору', radar: 'Радар релизов', library: 'В «Моей музыке»',
                artistAll: 'Все треки артиста', liked: 'Лайкнули твои артисты',
            },
            reasons: {
                similar: 'Похоже на трек', fresh: 'Новое, похоже на трек', newArtist: 'Новый артист', genreFresh: 'Свежее в жанре', genrePopular: 'Популярное в жанре',
                genreSimilar: 'Жанр и похожее', artistTrack: 'Треки артиста', mood: 'В духе трека', tasteArtist: 'Любимый артист', tasteTag: 'Любимый тег',
                daily: 'Разведка', forgotten: 'Давно не звучал', group: 'Твой вкус', version: 'Другая версия', radar: 'Радар релизов', restored: 'Сохранённая очередь',
                moodTag: 'Метка настроения', seedTrack: 'Начало волны', relatedArtist: 'Похожий артист', scMix: 'Подборка SoundCloud',
                neighbors: 'Слушатели с похожим вкусом', likedBy: 'Лайк артиста', library: 'Моя музыка', station: 'Станция трека',
                '': 'Не записана',
            },
        },
        en: {
            title: 'History',
            close: 'Close, Esc',
            closeLabel: 'Close history',
            search: 'Search history',
            searchLabel: 'Search by title and artist',
            periodGroup: 'Period',
            periods: { 7: '7 days', 30: '30 days', 365: 'Year', all: 'All time' },
            periodText: (p) => (p === 'all' ? 'of all time' : p === 365 ? 'in the last year' : 'in the last ' + p + ' days'),
            music: (p) => 'of music ' + (p === 'all' ? 'in total' : TEXTS.en.periodText(p)),
            h: 'h',
            min: 'min',
            sec: 's',
            counted: ['play', 'plays'],
            artists: ['artist', 'artists'],
            fresh: ['new artist', 'new artists'],
            artistsTitle: (p) => 'Artists ' + TEXTS.en.periodText(p),
            more: 'More',
            less: 'Show less',
            tracks: 'Tracks',
            genres: 'Genres',
            when: 'When you listen',
            emptyTop: 'Music you listen to will appear here',
            nothing: 'Nothing yet',
            times: ['play', 'plays'],
            heatLabel: 'Minutes of music by hour and weekday',
            week: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            lessHeat: 'Less',
            moreHeat: 'more',
            silence: 'silence',
            today: 'Today',
            yesterday: 'Yesterday',
            todayLower: 'today',
            prevDay: 'Previous day with music',
            nextDay: 'Next day with music',
            dayEmpty: 'No music on this day',
            fromWave: 'From the wave',
            fromRadar: 'From Release Radar',
            fromLibrary: 'From My music',
            fromMix: 'From a mix',
            fromArtist: 'From all tracks by an artist',
            away: 'Played while you were away',
            like: 'Liked',
            skipped: (t) => 'skipped at ' + t,
            done: (t) => 'finished, ' + t,
            of: (a, b) => a + ' of ' + b,
            loading: 'Loading title',
            unavailable: 'Track unavailable',
            waveLabel: (p) => (p === 'all' ? 'Total listening time' : 'Listening time ' + TEXTS.en.periodText(p)),
            from: (d) => 'From ' + d,
            results: 'Search results',
            plays: ['play', 'plays'],
            latest: (n) => 'latest ' + n,
            searchEmpty: 'Nothing found',
            signedOut: 'Sign in to SoundCloud to see your listening history here',
            emptyAll: 'Tracks you play in the app will show up here',
            failed: 'Could not load history',
            retry: 'Retry',
            artistTip: (plays, time) => plays + ', ' + time + '. Open artist page',
            tasteArtists: 'Artists the wave plays more often',
            tasteTags: 'Tags the wave leans on',
            tasteEmpty: 'Nothing for the wave to go on yet',
            drop: 'Remove from taste',
            removed: 'Removed from taste:',
            restore: 'Put back into the wave’s taste',
            recap: 'Weekly recap',
            recapTip: 'Your week in music as one image',
            recapWeeks: { last: 'Last week', this: 'This week' },
            recapWeekGroup: 'Which week',
            recapWeek: (n, range) => 'Week ' + n + ', ' + range,
            // September 21-27, 2026, September 28 - October 4, 2026, December 28, 2026 - January 3, 2027
            recapRange: (a, b) => {
                const [x, y] = [new Date(a), new Date(b)];
                if (x.getFullYear() !== y.getFullYear()) return fmtDayMonth.format(a) + ', ' + x.getFullYear() + ' - ' + fmtDayMonth.format(b) + ', ' + y.getFullYear();
                return fmtDayMonth.format(a) + (x.getMonth() === y.getMonth() ? '-' + y.getDate() : ' - ' + fmtDayMonth.format(b)) + ', ' + y.getFullYear();
            },
            recapMusic: 'of music',
            recapTracks: 'Tracks of the week',
            recapArtists: 'Artists of the week',
            recapGenres: 'Favourite genres',
            dayParts: ['Morning', 'Afternoon', 'Evening', 'Night'],
            recapPeak: (day, hour) => 'Peak: ' + day + ', ' + hour,
            recapLoading: 'Putting the recap together',
            recapEmpty: { last: 'No music last week', this: 'No music this week yet' },
            recapFailed: 'Could not build the recap',
            recapColors: 'Card colour',
            recapPresets: ['Midnight', 'Violet', 'Burgundy', 'Ocean', 'Sunset', 'Mint', 'Peach', 'Frost'],
            recapLabel: (time, plays) => 'Weekly recap: ' + time + ' of music, ' + plays,
            copy: 'Copy',
            copied: 'Copied',
            copyFailed: 'Could not copy',
            save: 'Save',
            saved: 'Saved',
            saveFailed: 'Could not save',
            recapClose: 'Close',
            waveTitle: 'How well the wave fits',
            waveCount: (n, p) => n + ' wave ' + plural(n, ['track', 'tracks']) + ' ' + (p === 'all' ? 'in total' : TEXTS.en.periodText(p)),
            waveLoading: 'Counting',
            waveFailed: 'Could not load the stats',
            waveNone: 'The wave didn’t play in this period',
            waveEarly: 'skipped before 0:30',
            waveDone: 'played to the end',
            waveShareTip: (part, whole) => part + ' of ' + whole,
            waveOwn: (share) => 'your music ' + share + '%',
            wavePrev: (share, p) => (p === 365 ? 'previous year ' : 'previous ' + p + ' days ') + share + '%',
            likes: ['like', 'likes'],
            waveMore: (n) => 'More like this ' + n,
            refusals: ['refusal', 'refusals'],
            waveAgainstTip: 'Don’t like, Not now or a hidden account',
            waveRepeats: (n) => n + ' recent ' + plural(n, ['repeat', 'repeats']),
            waveRepeatsTip: 'The wave track had already played in the 3 days before',
            waveNewTip: 'First played for over 30 seconds, and in the wave',
            waveDays: 'Skips before 0:30 by day',
            waveDaysLabel: 'Share of early skips in the wave by day',
            waveDay: (day, share, early, total) => day + ': ' + share + '%, ' + early + ' of ' + total,
            waveDayIdle: (day) => day + ': the wave didn’t play',
            waveWeeks: 'Skips before 0:30 by week',
            waveWeeksLabel: 'Share of early skips in the wave by week',
            waveWeek: (d, share, early, total) => 'From ' + d + ': ' + share + '%, ' + early + ' of ' + total,
            waveWeekIdle: (d) => 'From ' + d + ': the wave didn’t play',
            waveCols: { tracks: 'Tracks', early: 'Before 0:30', done: 'To the end', likes: 'Likes' },
            waveSource: 'Mix',
            waveReason: 'Reason',
            waveOrigin: 'Found via',
            waveSlot: 'Place in the batch',
            slots: { first: 'First three', later: 'Fourth on' },
            wavePreset: 'Mood',
            presets: { happy: 'Happy', sad: 'Sad', aggressive: 'Aggressive', calm: 'Calm', energetic: 'Energetic' },
            sources: {
                similar: 'My Wave: Similar', fresh: 'My Wave: New', track: 'Wave from track', artist: 'Wave from artist', playlist: 'Wave from playlist', daily: 'Scout',
                forgotten: 'Not played in a while', group: 'Your taste', tracks: 'Wave from picks', radar: 'Release Radar', library: 'In My music',
                artistAll: 'All tracks by artist', liked: 'Liked by your artists',
            },
            reasons: {
                similar: 'Similar to a track', fresh: 'New, similar to a track', newArtist: 'New artist', genreFresh: 'Fresh in genre', genrePopular: 'Popular in genre',
                genreSimilar: 'Genre and similar', artistTrack: 'Artist’s tracks', mood: 'In the spirit of a track', tasteArtist: 'Favourite artist', tasteTag: 'Favourite tag',
                daily: 'Scout', forgotten: 'Not played in a while', group: 'Your taste', version: 'Another version', radar: 'Release Radar', restored: 'Saved queue',
                moodTag: 'Mood tag', seedTrack: 'Wave start', relatedArtist: 'Similar artist', scMix: 'SoundCloud mix',
                neighbors: 'Listeners with your taste', likedBy: 'Liked by an artist', library: 'My music', station: 'Track station',
                '': 'Not recorded',
            },
        },
    };

    const state = {
        lang: 'ru',
        signedIn: true,
        failed: false,
        loaded: false,
        period: 30,
        query: '',
        overview: null,
        selected: 0,
        day: null,
        results: null,
        allArtists: false,
        // Трек, который сейчас в плеере сайта: отмечается самая свежая его строка
        nowId: 0,
        // Вкус глазами волны: не зависит от периода, считается по всей истории с забыванием
        taste: null,
        // Замер волны за период: грузится, только пока блок раскрыт
        waveOpen: false,
        wave: null,
        waveFailed: false,
    };
    const WEEK = 7 * 86400000;
    let T = TEXTS.ru;
    let fmtLong, fmtShort, fmtWd, fmtDayMonth, fmtWeekday;

    // Форматирование
    function plural(n, forms) {
        if (forms.length === 2) return forms[n === 1 ? 0 : 1];
        return forms[n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2];
    }
    const pad = (n) => String(n).padStart(2, '0');
    const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const clock = (ms) => {
        const s = Math.round(ms / 1000);
        return Math.floor(s / 60) + ':' + pad(s % 60);
    };
    const span = (ms) => {
        const m = Math.round(ms / 60000);
        if (m < 1) return Math.round(ms / 1000) + ' ' + T.sec;
        const h = Math.floor(m / 60);
        return h ? h + ' ' + T.h + (m % 60 ? ' ' + (m % 60) + ' ' + T.min : '') : m + ' ' + T.min;
    };
    const minutesLabel = (m) => (m >= 60 ? (m % 60 ? Math.floor(m / 60) + ' ' + T.h + ' ' + (m % 60) + ' ' + T.min : m / 60 + ' ' + T.h) : m + ' ' + T.min);
    const timeOf = (at) => {
        const d = new Date(at);
        return pad(d.getHours()) + ':' + pad(d.getMinutes());
    };
    const dayStart = (at) => {
        const d = new Date(at);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    };
    const addDays = (start, n) => {
        const d = new Date(start);
        d.setDate(d.getDate() + n);
        return d.getTime();
    };
    const today = () => dayStart(Date.now());
    const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
    const dayTitle = (start) => (start === today() ? T.today : start === addDays(today(), -1) ? T.yesterday : cap(fmtLong.format(start)));
    // Обложки журнала: -large это 100 на 100, для крупных кругов берётся 300 на 300
    const bigArt = (url) => url.replace(/-large\.(jpg|png)$/, '-t300x300.$1');
    const artistPath = (path) => (path ? '/' + path.split('/')[1] : '');

    function setLanguage(lang) {
        state.lang = lang === 'en' ? 'en' : 'ru';
        T = TEXTS[state.lang];
        document.documentElement.lang = state.lang;
        fmtLong = new Intl.DateTimeFormat(state.lang, { weekday: 'long', day: 'numeric', month: 'long' });
        fmtShort = new Intl.DateTimeFormat(state.lang, { day: 'numeric', month: 'short' });
        fmtWd = new Intl.DateTimeFormat(state.lang, { weekday: 'short', day: 'numeric', month: 'long' });
        fmtDayMonth = new Intl.DateTimeFormat(state.lang, { day: 'numeric', month: 'long' });
        fmtWeekday = new Intl.DateTimeFormat(state.lang, { weekday: 'long' });
        document.title = T.title;
    }
    const ICON = {
        wave: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M1 7c1.5-3.5 3-3.5 4 0s2.5 3.5 4 0 2.5-3.5 4 0"/></svg>',
        like: '<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M7 12.3 5.9 11.3C2.8 8.5 1 6.8 1 4.7 1 3 2.3 1.7 4 1.7c.9 0 1.9.4 2.5 1.1h1c.6-.7 1.6-1.1 2.5-1.1 1.7 0 3 1.3 3 3 0 2.1-1.8 3.8-4.9 6.6z"/></svg>',
        away: '<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M8.6 1.3a5.8 5.8 0 1 0 4.1 8.8A5 5 0 0 1 8.6 1.3z"/></svg>',
        back: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8H3M7 4 3 8l4 4"/></svg>',
        search: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="6" r="4.5"/><path d="m9.5 9.5 3.5 3.5" stroke-linecap="round"/></svg>',
        prev: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5 4.5 7 9 11.5"/></svg>',
        next: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2.5 9.5 7 5 11.5"/></svg>',
        undo: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2 1.5 4.5 4 7"/><path d="M1.5 4.5H7a3.25 3.25 0 0 1 0 6.5H5"/></svg>',
        recap: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2.5" width="11" height="9" rx="1.5"/><circle cx="5" cy="6.5" r="1.6"/><path d="M8 5.5h3M8 8h2.5" stroke-linecap="round"/></svg>',
        fold: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2.5 9.5 7 5 11.5"/></svg>',
    };

    // Куски страницы
    const periodSeg = () =>
        '<div class="seg" role="group" aria-label="' + esc(T.periodGroup) + '">' +
        [7, 30, 365, 'all'].map((value) => '<button data-period="' + value + '" aria-pressed="' + (state.period === value) + '">' + esc(T.periods[value]) + '</button>').join('') +
        '</div>';
    const head = (extra) =>
        '<div class="ph"><button class="back" data-act="close" aria-label="' + esc(T.closeLabel) + '" data-tip="' + esc(T.close) + '">' + ICON.back + '</button><h1>' + esc(T.title) + '</h1>' + extra +
        '<label class="search"><input type="search" id="q" placeholder="' + esc(T.search) + '" value="' + esc(state.query) + '" aria-label="' + esc(T.searchLabel) + '" spellcheck="false" autocomplete="off">' + ICON.search + '</label></div>';
    const recapButton = () => '<button class="link rc-open" data-act="recap" data-tip="' + esc(T.recapTip) + '">' + ICON.recap + esc(T.recap) + '</button>';
    const art = (url, cls) => (url ? '<img class="' + cls + '" src="' + esc(url) + '" alt="" loading="lazy">' : '<span class="' + cls + '" aria-hidden="true"></span>');
    const keyOf = (r) => r.at + ':' + r.id;
    // Откуда играло: радар, «Моя музыка» и подборки называются своими именами, остальное волна
    function sourceLabel(source) {
        const kind = source.slice(5);
        if (kind === 'radar') return T.fromRadar;
        if (kind === 'library') return T.fromLibrary;
        if (kind === 'artistAll') return T.fromArtist;
        return ['daily', 'forgotten', 'liked', 'group', 'tracks'].includes(kind) ? T.fromMix : T.fromWave;
    }
    // Играющий трек отмечается одной строкой: самой свежей в списке (строки идут от новых к старым)
    const playingKey = (rows) => {
        const found = state.nowId ? rows.find((r) => r.id === state.nowId) : null;
        return found ? keyOf(found) : '';
    };

    function row(r, withDate, playing) {
        // Смену трека сайтом (endedBy auto) человек не делал, это не пропуск. Серым идёт только пропуск раньше 30 секунд,
        // подпись пропуска показывает место остановки; у записей без него остаётся, сколько играло
        const skipped = r.end === 'skip' && r.endedBy !== 'auto';
        const stop = skipped && r.pos !== null && r.pos !== undefined ? r.pos : r.heard;
        const early = skipped && r.heard < COUNTED_MS;
        const frac = r.dur ? Math.min(1, (skipped ? stop : r.heard) / r.dur) : 1;
        const label = r.source.startsWith('wave') ? sourceLabel(r.source) : '';
        const icons =
            (label ? '<span data-tip="' + esc(label) + '" aria-label="' + esc(label) + '">' + ICON.wave + '</span>' : '') +
            (r.away ? '<span data-tip="' + esc(T.away) + '" aria-label="' + esc(T.away) + '">' + ICON.away + '</span>' : '') +
            (r.liked ? '<span class="like" data-tip="' + esc(T.like) + '" aria-label="' + esc(T.like) + '">' + ICON.like + '</span>' : '');
        const heard = !r.dur ? clock(r.heard) : skipped ? T.skipped(clock(stop)) : r.end === 'done' ? T.done(clock(r.dur)) : T.of(clock(r.heard), clock(r.dur));
        const title = r.title ? '<b>' + esc(r.title) + '</b>' : '<b class="none">' + esc(r.resolved === 2 ? T.unavailable : T.loading) + '</b>';
        const when = withDate ? cap(fmtShort.format(r.at)) + ', ' + timeOf(r.at) : timeOf(r.at);
        const play = r.path ? ' play" role="button" tabindex="0" data-path="' + esc(r.path) + '" data-id="' + r.id : '';
        return (
            '<div class="row' + (early ? ' skip' : '') + (playing ? ' playing' : '') + play + '">' +
            '<span class="tm num">' + esc(when) + '</span>' + art(r.artwork, 'art') +
            '<span class="ti">' + title + '<span>' + esc(r.artistName) + '</span></span>' +
            '<span class="hd"><span class="bar"><i style="width:' + (frac * 100).toFixed(1) + '%"></i></span><span class="hn num">' + esc(heard) + '</span></span>' +
            '<span class="ic">' + icons + '</span></div>'
        );
    }

    function topList(kind, entries, limit) {
        if (!entries.length) return '<p class="sub">' + esc(kind === 'genre' ? T.nothing : T.emptyTop) + '</p>';
        const max = entries[0].plays || 1;
        return (
            '<ol class="tl">' +
            entries.slice(0, limit).map((e, i) => {
                const name = kind === 'genre' ? cap(e.name) : e.name || T.loading;
                const cover = kind === 'genre' ? '' : art(e.artwork, 'art');
                const tipText = e.plays + ' ' + plural(e.plays, T.times) + ', ' + span(e.ms);
                const play = kind === 'track' && e.path ? ' play" role="button" tabindex="0" data-path="' + esc(e.path) : '';
                return (
                    '<li class="' + (cover ? '' : 'noart') + play + '" data-tip="' + esc(tipText) + '"><span class="rk num">' + (i + 1) + '</span>' + cover +
                    '<span class="nm"><span class="nm-top"><b>' + esc(name) + '</b><span class="num">' + e.plays + '</span></span>' +
                    (kind === 'track' ? '<span class="nm-by">' + esc(e.artistName) + '</span>' : '') +
                    '<span class="bar"><i style="width:' + ((e.plays / max) * 100).toFixed(1) + '%"></i></span></span></li>'
                );
            }).join('') +
            '</ol>'
        );
    }

    function heatmap(heat) {
        const max = Math.max(1, ...heat);
        let html = '<div class="hm" role="img" aria-label="' + esc(T.heatLabel) + '"><span></span>' + [0, 6, 12, 18].map((h) => '<span class="hh num">' + h + ':00</span>').join('');
        for (let day = 0; day < 7; day++) {
            html += '<span>' + esc(T.week[day]) + '</span>';
            for (let hour = 0; hour < 24; hour++) {
                const minutes = heat[day * 24 + hour] || 0;
                const level = minutes ? 1 + Math.min(4, Math.floor((minutes / max) * 5)) : 0;
                html += '<i class="l' + level + '" data-tip="' + esc(T.week[day] + ', ' + hour + ':00-' + (hour + 1) + ':00: ' + (minutes ? minutesLabel(minutes) : T.silence)) + '"></i>';
            }
        }
        return (
            html + '</div><div class="lg"><span>' + esc(T.lessHeat) + '</span>' + [1, 2, 3, 4, 5].map((n) => '<i style="background:var(--h' + n + ')"></i>').join('') + '<span>' + esc(T.moreHeat) + '</span></div>'
        );
    }

    // Волна периода: высота столбца это минуты звука, выбранный день оранжевый, под осью отражение
    function periodWave(wave) {
        const bins = wave.bins;
        const peak = Math.max(1, ...bins);
        const step = peak > 60 ? 60 : 10;
        const max = Math.ceil(peak / step) * step;
        const binMs = wave.binHours * 3600000;
        const rects = bins.map((minutes, i) => {
            const at = wave.from + i * binMs;
            const on = wave.binHours < 24 ? dayStart(at) === state.selected : state.selected >= at && state.selected < at + binMs;
            const h = minutes ? Math.max(2, (minutes / max) * 88) : 1;
            const cls = on ? 'on' : minutes ? '' : 'idle';
            return (
                '<rect class="' + cls + '" x="' + i * 3 + '" y="' + (90 - h).toFixed(1) + '" width="2" height="' + h.toFixed(1) + '"/>' +
                (minutes ? '<rect class="' + cls + ' echo" x="' + i * 3 + '" y="93" width="2" height="' + (h * 0.3).toFixed(1) + '"/>' : '')
            );
        }).join('');
        const dates = [...new Set([0, .25, .5, .75, 1].map((fraction) => dayStart(wave.from + Math.floor((bins.length - 1) * fraction) * binMs)))];
        const grid = [2, 46, 90].map((y) => '<line x1="0" x2="' + bins.length * 3 + '" y1="' + y + '" y2="' + y + '" class="pwave-grid"/>').join('');
        return (
            '<div class="pwave"><div class="pwave-axis" aria-hidden="true"><span>' + esc(minutesLabel(max)) + '</span><span>' + esc(minutesLabel(max / 2)) + '</span><span>0</span></div>' +
            '<svg viewBox="0 0 ' + bins.length * 3 + ' 124" preserveAspectRatio="none" data-wave="period" role="img" aria-label="' + esc(T.waveLabel(state.period)) + '">' + grid + rects + '</svg>' +
            '<div class="pwave-x">' + dates.map((at) => '<button data-day="' + at + '" aria-label="' + esc(fmtLong.format(at)) + '" aria-pressed="' + (at === state.selected) + '">' + esc(fmtShort.format(at)) + '</button>').join('') + '</div></div>'
        );
    }

    function artistsBlock(list) {
        if (!list.length) return '<p class="sub">' + esc(T.emptyTop) + '</p>';
        const shown = state.allArtists ? list : list.slice(0, ARTISTS_SHORT);
        return (
            '<div class="artists">' +
            shown.map((a) => {
                const path = artistPath(a.path);
                const cover = a.artwork ? '<img src="' + esc(bigArt(a.artwork)) + '" alt="" loading="lazy">' : '';
                const body = '<span class="av">' + cover + '</span><b>' + esc(a.name || T.loading) + '</b><span class="num">' + esc(span(a.ms)) + '</span>';
                const tipText = T.artistTip(a.plays + ' ' + plural(a.plays, T.times), span(a.ms));
                return path ? '<button data-artist="' + esc(path) + '" data-tip="' + esc(tipText) + '">' + body + '</button>' : '<div>' + body + '</div>';
            }).join('') +
            '</div>'
        );
    }

    // Вкус глазами волны: полоска это вес в модели относительно самого любимого
    function tasteList(kind, entries) {
        if (!entries.length) return '<p class="sub">' + esc(kind === 'artist' ? T.tasteEmpty : T.nothing) + '</p>';
        const shown = entries.slice(0, 6);
        const max = shown[0].weight || 1;
        return (
            '<ol class="tl">' +
            shown.map((e, i) => {
                const cover = kind === 'artist' ? art(e.artwork ? bigArt(e.artwork) : '', 'art round') : '';
                const name = kind === 'artist' ? e.name : cap(e.label);
                const key = kind === 'artist' ? e.id : e.key;
                return (
                    '<li class="taste' + (cover ? '' : ' noart') + '"><span class="rk num">' + (i + 1) + '</span>' + cover +
                    '<span class="nm"><span class="nm-top"><b>' + esc(name) + '</b></span><span class="bar"><i style="width:' + ((e.weight / max) * 100).toFixed(1) + '%"></i></span></span>' +
                    '<button class="drop" data-drop="' + kind + '" data-key="' + esc(key) + '">' + esc(T.drop) + '</button></li>'
                );
            }).join('') +
            '</ol>'
        );
    }
    function tasteBlock() {
        const t = state.taste;
        if (!t) return '';
        const removed = [
            ...t.removed.artists.map((a) => ['artist', a.id, a.name]),
            ...t.removed.tags.map((g) => ['tag', g.key, cap(g.label)]),
        ];
        const restoreLine = removed.length
            ? '<div class="removed"><span class="sub">' + esc(T.removed) + '</span>' +
              removed.map(([kind, key, name]) => '<button class="chip" data-restore="' + kind + '" data-key="' + esc(key) + '" data-tip="' + esc(T.restore) + '">' + esc(name) + ICON.undo + '</button>').join('') +
              '</div>'
            : '';
        return (
            '<div class="grid2 sec"><div><div class="sec-h"><h2>' + esc(T.tasteArtists) + '</h2></div>' + tasteList('artist', t.artists) + '</div>' +
            '<div><div class="sec-h"><h2>' + esc(T.tasteTags) + '</h2></div>' + tasteList('tag', t.tags) + '</div></div>' +
            restoreLine
        );
    }

    // Как попадает волна: доли считаются от треков волны, которые человек оценил сам (дослушал или переключил)
    const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
    function waveFigures(q) {
        const w = q.wave;
        const compare = (key) => {
            const parts = [];
            if (q.own.plays) parts.push(T.waveOwn(pct(q.own[key], q.own.plays)));
            if (q.previous && q.previous.plays) parts.push(T.wavePrev(pct(q.previous[key], q.previous.plays), state.period));
            return parts.join(', ');
        };
        const figs = [
            { value: pct(w.early, w.plays) + '%', label: T.waveEarly, note: compare('early'), tip: T.waveShareTip(w.early, w.plays) },
            { value: pct(w.done, w.plays) + '%', label: T.waveDone, note: compare('done'), tip: T.waveShareTip(w.done, w.plays) },
            { value: w.likes, label: plural(w.likes, T.likes), note: w.more ? T.waveMore(w.more) : '' },
            { value: w.against, label: plural(w.against, T.refusals), tip: T.waveAgainstTip },
            { value: q.newArtists, label: plural(q.newArtists, T.fresh), tip: T.waveNewTip, note: q.repeats ? T.waveRepeats(q.repeats) : '', noteTip: T.waveRepeatsTip },
        ];
        return (
            '<div class="figs wq-figs">' +
            figs.map((f) =>
                '<div class="fig"' + (f.tip ? ' tabindex="0" data-tip="' + esc(f.tip) + '"' : '') + '><b class="num">' + esc(f.value) + '</b><span>' + esc(f.label) + '</span>' +
                (f.note ? '<em' + (f.noteTip ? ' data-tip="' + esc(f.noteTip) + '"' : '') + '>' + esc(f.note) + '</em>' : '') + '</div>',
            ).join('') +
            '</div>'
        );
    }
    // Сутки периода до месяца; день без волны пустое место, день без ранних пропусков черта у оси
    function waveDays(q) {
        const days = q.days;
        if (days.filter((d) => d.plays).length < 2) return '';
        const cols = 'grid-template-columns:repeat(' + days.length + ',minmax(0,1fr))';
        const lines = [0, 25, 50, 75, 100].map((v) => '<div style="bottom:' + v + '%"><span class="num">' + v + '%</span></div>').join('');
        const last = days.length - 1;
        const every = days.length > 7 ? 7 : 1;
        const bars = days.map((d) => {
            const share = pct(d.early, d.plays);
            const day = cap(fmtWd.format(d.from));
            const tipText = d.plays ? T.waveDay(day, share, d.early, d.plays) : T.waveDayIdle(day);
            const height = d.plays ? Math.max(2, share) : 0;
            return '<div class="cc-slot' + (d.plays && d.plays < 5 ? ' low' : '') + '" tabindex="0" data-tip="' + esc(tipText) + '" aria-label="' + esc(tipText) + '"><i style="height:' + height + '%"></i></div>';
        }).join('');
        const labels = days.map((d, i) => '<span>' + ((last - i) % every === 0 ? esc(d.from === today() ? T.todayLower : fmtShort.format(d.from)) : '') + '</span>').join('');
        return (
            '<div class="wq-part"><h3>' + esc(T.waveDays) + '</h3>' +
            '<div class="cc" role="group" aria-label="' + esc(T.waveDaysLabel) + '"><div class="cc-plot"><div class="cc-grid">' + lines + '</div><div class="cc-bars" style="' + cols + '">' + bars + '</div></div>' +
            '<div class="cc-x" style="' + cols + '">' + labels + '</div></div></div>'
        );
    }
    // Недели идут от конца периода; пустая неделя остаётся пустым местом, чтобы шаг оси не врал
    function waveWeeks(q) {
        const count = Math.min(12, Math.ceil((q.to - q.from) / WEEK));
        if (count < 3) return '';
        const byFrom = new Map(q.weeks.map((w) => [w.from, w]));
        const weeks = [];
        for (let i = count - 1; i >= 0; i--) {
            const from = q.to - (i + 1) * WEEK;
            weeks.push(byFrom.get(from) || { from, plays: 0, early: 0 });
        }
        if (weeks.filter((w) => w.plays).length < 2) return '';
        const cols = 'grid-template-columns:repeat(' + weeks.length + ',minmax(0,1fr))';
        const lines = [0, 25, 50, 75, 100].map((v) => '<div style="bottom:' + v + '%"><span class="num">' + v + '%</span></div>').join('');
        const last = weeks.length - 1;
        const every = weeks.length > 6 ? 2 : 1;
        const label = (w) => fmtShort.format(Math.max(w.from, q.from));
        const bars = weeks.map((w) => {
            const share = pct(w.early, w.plays);
            const tipText = w.plays ? T.waveWeek(label(w), share, w.early, w.plays) : T.waveWeekIdle(label(w));
            const height = w.plays ? Math.max(2, share) : 0;
            return '<div class="cc-slot' + (w.plays && w.plays < 5 ? ' low' : '') + '" tabindex="0" data-tip="' + esc(tipText) + '" aria-label="' + esc(tipText) + '"><i style="height:' + height + '%"></i></div>';
        }).join('');
        const labels = weeks.map((w, i) => '<span>' + ((last - i) % every === 0 ? esc(label(w)) : '') + '</span>').join('');
        return (
            '<div class="wq-part"><h3>' + esc(T.waveWeeks) + '</h3>' +
            '<div class="cc" role="group" aria-label="' + esc(T.waveWeeksLabel) + '"><div class="cc-plot"><div class="cc-grid">' + lines + '</div><div class="cc-bars" style="' + cols + '">' + bars + '</div></div>' +
            '<div class="cc-x" style="' + cols + '">' + labels + '</div></div></div>'
        );
    }
    // Разрез таблицей: полоса это доля ранних пропусков; строки меньше чем из 5 треков приглушены
    function waveTable(head, slices, name) {
        const rows = slices.filter((s) => s.plays);
        if (!rows.length) return '';
        const c = T.waveCols;
        return (
            '<table class="wt"><thead><tr><th scope="col">' + esc(head) + '</th><th scope="col">' + esc(c.tracks) + '</th><th scope="col">' + esc(c.early) + '</th>' +
            '<th scope="col">' + esc(c.done) + '</th><th scope="col">' + esc(c.likes) + '</th></tr></thead><tbody>' +
            rows.map((s) => {
                const early = pct(s.early, s.plays);
                return (
                    '<tr' + (s.plays < 5 ? ' class="low"' : '') + '><th scope="row">' + esc(name(s.key)) + '</th><td class="num">' + s.plays + '</td>' +
                    '<td><span class="wt-share"><span class="bar"><i style="width:' + early + '%"></i></span><span class="num">' + early + '%</span></span></td>' +
                    '<td class="num">' + pct(s.done, s.plays) + '%</td><td class="num">' + s.likes + '</td></tr>'
                );
            }).join('') +
            '</tbody></table>'
        );
    }
    function waveBlock() {
        const q = state.wave;
        const open = state.waveOpen;
        const count = open && q && q.wave.plays ? '<span class="sub num">' + esc(T.waveCount(q.wave.plays, state.period)) + '</span>' : '';
        const head =
            '<div class="sec-h"><h2><button class="fold" data-act="wave" aria-expanded="' + open + '" aria-controls="wave-quality">' + esc(T.waveTitle) + ICON.fold + '</button></h2>' + count + '</div>';
        if (!open) return '<div class="sec wq">' + head + '</div>';
        let body;
        if (state.waveFailed) body = '<p class="sub">' + esc(T.waveFailed) + '</p><button class="link" data-act="wave-retry">' + esc(T.retry) + '</button>';
        else if (!q) body = '<p class="sub">' + esc(T.waveLoading) + '</p>';
        else if (!q.wave.plays) body = '<p class="sub">' + esc(T.waveNone) + '</p>';
        else {
            // Места сравнивают первые три трека выдачи с остальными: одна строка без пары ничего не говорит
            const slots = q.slots.first.plays && q.slots.later.plays ? [{ key: 'first', ...q.slots.first }, { key: 'later', ...q.slots.later }] : [];
            // Период до месяца по дням, длиннее по неделям
            body =
                waveFigures(q) + (q.days.length ? waveDays(q) : waveWeeks(q)) +
                '<div class="grid2 wq-part"><div>' + waveTable(T.waveSource, q.sources, (key) => T.sources[key] || key) +
                waveTable(T.waveSlot, slots, (key) => T.slots[key]) +
                (q.presets ? waveTable(T.wavePreset, q.presets, (key) => T.presets[key] || key) : '') + '</div>' +
                '<div>' + waveTable(T.waveReason, q.reasons, (key) => T.reasons[key] || key) +
                // Откуда взят трек до подмены причиной по вкусу: «Любимый артист» и «Любимый тег» ставятся лучшим по оценке
                (q.origins && q.origins.some((s) => s.key && s.plays) ? waveTable(T.waveOrigin, q.origins, (key) => T.reasons[key] || key) : '') + '</div></div>';
        }
        return '<div class="sec wq">' + head + '<div id="wave-quality">' + body + '</div></div>';
    }

    function journal() {
        const data = state.day;
        const rows = data ? data.rows : [];
        const total = rows.reduce((sum, r) => sum + r.heard, 0);
        // Прослушивания считаются как в обзоре периода: с 30 секунд звука
        const counted = rows.filter((r) => r.heard >= COUNTED_MS).length;
        const playing = playingKey(rows);
        const before = data && data.before !== null ? dayStart(data.before) : '';
        const after = data && data.after !== null ? dayStart(data.after) : '';
        return (
            '<div class="sec" id="journal"><div class="jn"><h2>' + esc(dayTitle(state.selected)) + '</h2><span class="sub num">' +
            esc(rows.length ? span(total) + ', ' + counted + ' ' + plural(counted, T.counted) : T.silence) + '</span>' +
            '<button class="icon-btn" data-day="' + before + '"' + (before === '' ? ' disabled' : '') + ' aria-label="' + esc(T.prevDay) + '" data-tip="' + esc(T.prevDay) + '">' + ICON.prev + '</button>' +
            '<button class="icon-btn" data-day="' + after + '"' + (after === '' ? ' disabled' : '') + ' aria-label="' + esc(T.nextDay) + '" data-tip="' + esc(T.nextDay) + '">' + ICON.next + '</button></div>' +
            '<div class="jn-list">' + (rows.length ? rows.map((r) => row(r, false, keyOf(r) === playing)).join('') : '<p class="empty">' + esc(T.dayEmpty) + '</p>') + '</div></div>'
        );
    }

    function renderOverview() {
        const s = state.overview;
        if (!s.total) return '<p class="empty wide">' + esc(T.emptyAll) + '</p>';
        const minutes = Math.round(s.heard / 60000);
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        const figs = [
            [s.counted, plural(s.counted, T.counted)],
            [s.artistCount, plural(s.artistCount, T.artists)],
        ];
        // Период начался не позже первой записи истории (всё время или месяц, когда история моложе месяца):
        // каждый артист тут появился впервые, «новых» столько же, сколько всех, и число ничего не говорит
        if (s.firstAt !== null && s.from > s.firstAt) figs.push([s.fresh, plural(s.fresh, T.fresh)]);
        const moreButton = s.artists.length > ARTISTS_SHORT ? '<button class="link" data-act="artists">' + esc(state.allArtists ? T.less : T.more) + '</button>' : '';
        return (
            '<div class="hero"><div><div class="big num">' + (h ? h + '<small>' + esc(T.h) + '</small>' : '') + m + '<small>' + esc(T.min) + '</small></div><div class="big-cap">' + esc(T.music(state.period)) + '</div></div>' +
            '<div class="figs">' + figs.map(([v, l]) => '<div class="fig"><b class="num">' + v + '</b><span>' + esc(l) + '</span></div>').join('') + '</div></div>' +
            periodWave(s.wave) +
            '<div class="sec"><div class="sec-h"><h2>' + esc(T.artistsTitle(state.period)) + '</h2>' + moreButton + '</div>' + artistsBlock(s.artists) + '</div>' +
            '<div class="grid2 sec"><div><div class="sec-h"><h2>' + esc(T.tracks) + '</h2></div>' + topList('track', s.tracks, 8) + '</div>' +
            '<div><div class="sec-h"><h2>' + esc(T.genres) + '</h2></div>' + topList('genre', s.genres, 5) +
            '<div class="sec-h" style="margin-top:28px"><h2>' + esc(T.when) + '</h2></div>' + heatmap(s.heat) + '</div></div>' +
            tasteBlock() +
            waveBlock() +
            journal()
        );
    }

    function renderResults() {
        const list = state.results || [];
        if (!list.length) return '<p class="empty">' + esc(T.searchEmpty) + '</p>';
        const count = list.length + ' ' + plural(list.length, T.plays);
        const playing = playingKey(list);
        return (
            '<div class="sec"><div class="sec-h"><h2>' + esc(T.results) + '</h2><span class="sub num">' + esc(list.length >= 200 ? T.latest(200) : count) + '</span></div>' +
            '<div class="search-rows">' + list.map((r) => row(r, true, keyOf(r) === playing)).join('') + '</div></div>'
        );
    }

    function render(keepScroll) {
        const scroll = view.scrollTop;
        const active = document.activeElement;
        const focusKey = active?.tagName === 'BUTTON' ? ['period', 'day', 'act', 'artist'].find((key) => active.dataset[key]) : null;
        const focusValue = focusKey ? active.dataset[focusKey] : null;
        const focusSearch = active && active.id === 'q';
        const caret = focusSearch ? active.selectionStart : 0;
        let body;
        if (!state.signedIn) body = '<p class="empty wide">' + esc(T.signedOut) + '</p>';
        else if (state.failed) body = '<div class="empty wide"><p>' + esc(T.failed) + '</p><button class="link" data-act="retry" style="margin-top:12px">' + esc(T.retry) + '</button></div>';
        else if (!state.loaded) body = '';
        else if (state.query) body = renderResults();
        else body = renderOverview();
        const tools = state.signedIn && !state.query ? periodSeg() + (state.loaded && !state.failed ? recapButton() : '') : '';
        view.innerHTML = '<div class="wrap">' + head(tools) + body + '</div>';
        if (keepScroll) view.scrollTop = scroll;
        if (focusSearch) {
            const q = document.getElementById('q');
            q.focus();
            q.setSelectionRange(caret, caret);
        } else if (focusKey) {
            [...view.querySelectorAll('button')].find((button) => button.dataset[focusKey] === focusValue)?.focus({ preventScroll: true });
        }
    }

    // Загрузка
    const periodFrom = () => (state.period === 'all' ? null : addDays(today(), -(state.period - 1)));
    async function loadOverview() {
        state.overview = await api.invoke('history:overview', periodFrom(), addDays(today(), 1));
        if (!state.overview) throw new Error('Пустой ответ обзора');
    }
    // Замер волны не загрузился: остальная страница живёт без него
    async function loadWave() {
        try {
            const data = await api.invoke('history:wave', periodFrom(), addDays(today(), 1));
            if (!data) throw new Error('Пустой ответ замера волны');
            state.wave = data;
            state.waveFailed = false;
        } catch (error) {
            console.error('Замер волны не загружен:', error);
            state.wave = null;
            state.waveFailed = true;
        }
    }
    async function loadDay(start) {
        const data = await api.invoke('history:day', start, addDays(start, 1));
        if (!data) throw new Error('Пустой ответ журнала дня');
        state.selected = start;
        state.day = data;
    }
    // Вкус не загрузился: страница живёт без него
    async function loadTaste() {
        try {
            state.taste = await api.invoke('history:taste');
        } catch (error) {
            console.error('Вкус волны не загружен:', error);
            state.taste = null;
        }
    }
    let searchToken = 0;
    async function loadResults() {
        const token = ++searchToken;
        const rows = await api.invoke('history:search', state.query);
        if (token === searchToken) state.results = Array.isArray(rows) ? rows : [];
    }
    async function reload(first) {
        try {
            // Свёрнутый замер не грузится; прежний период при раскрытии не мелькает
            if (!state.waveOpen) state.wave = null;
            await Promise.all([loadOverview(), first ? loadTaste() : Promise.resolve(), state.waveOpen ? loadWave() : Promise.resolve()]);
            // Выбранный день вне нового периода: журнал идёт на сегодня, как при первом открытии
            const inside = !!state.selected && state.selected >= state.overview.from;
            await loadDay(inside ? state.selected : today());
            // Сегодня без музыки: журнал последнего дня, когда она была, но не раньше начала периода
            if ((first || !inside) && !state.day.rows.length && state.day.before !== null && state.day.before >= state.overview.from) await loadDay(dayStart(state.day.before));
            if (state.query) await loadResults();
            state.failed = false;
        } catch (error) {
            console.error('История не загружена:', error);
            state.failed = true;
        }
        state.loaded = true;
    }

    let playRequest = 0;
    async function play(path, id) {
        const request = ++playRequest;
        try {
            const result = await api.invoke('history:play', path);
            if (request !== playRequest) return;
            if (result === 'played') {
                // main пришлёт смену трека сам; отметка ставится сразу, чтобы не ждать его
                state.nowId = Number(id) || 0;
                render(true);
            } else if (result !== 'superseded') {
                showPlayError();
            }
        } catch (error) {
            console.error('Трек не включён:', error);
            if (request === playRequest) showPlayError();
        }
    }
    function showPlayError() {
        let message = document.getElementById('play-error');
        if (!message) {
            message = document.createElement('p');
            message.id = 'play-error';
            message.className = 'empty';
            message.setAttribute('role', 'alert');
            view.prepend(message);
        }
        message.textContent = state.lang === 'en' ? 'Could not play this track. Check your connection and try again.' : 'Не удалось включить трек. Проверь соединение и попробуй ещё раз.';
    }

    // Сводка недели: неделя музыки одной картинкой, как шапка профиля на SoundCloud. Рисуется на холсте и уходит в main как PNG.
    // Обложки и аватарки sndcdn отдаёт с разрешением для чужих страниц, поэтому холст с ними остаётся выгружаемым
    const RECAP = { width: 1200, height: 760, hero: 330, scale: 2, font: "Onest, 'Segoe UI', system-ui, sans-serif" };
    const RECAP_PANELS = {
        dark: { panel: '#121212', ink: '#ffffff', muted: '#9a9a9a', line: 'rgba(255, 255, 255, 0.08)', film: 'rgba(255, 255, 255, 0.09)', empty: '#2a2a2a' },
        light: { panel: '#f5f5f3', ink: '#141414', muted: '#666666', line: 'rgba(0, 0, 0, 0.08)', film: 'rgba(0, 0, 0, 0.06)', empty: '#e2e2de' },
    };
    // Восемь цветов от тёмных к светлым; у трёх светлых и нижняя часть светлая
    const RECAP_PRESETS = [
        { a: '#23253f', b: '#0c0c14', panel: 'dark' },
        { a: '#4a2a96', b: '#140f2a', panel: 'dark' },
        { a: '#7a1f35', b: '#1c0a10', panel: 'dark' },
        { a: '#0f6170', b: '#0a1c26', panel: 'dark' },
        { a: '#ff5500', b: '#8a1d52', panel: 'dark' },
        { a: '#8fdcc3', b: '#2e8c86', panel: 'light' },
        { a: '#ffd2b0', b: '#ff7d5c', panel: 'light' },
        { a: '#f1f4f9', b: '#bccbe3', panel: 'light' },
    ];
    const DAY_PARTS = [[6, 12], [12, 18], [18, 24], [0, 6]];
    const PRESET_KEY = 'scDesktopRecapPreset';
    function readPreset() {
        try {
            const value = Number(window.localStorage.getItem(PRESET_KEY));
            return window.localStorage.getItem(PRESET_KEY) !== null && Number.isInteger(value) && value >= 0 && value < RECAP_PRESETS.length ? value : 1;
        } catch (error) {
            console.warn('Сводка недели: цвет карточки не прочитан', error);
            return 1;
        }
    }
    function savePreset(value) {
        try {
            window.localStorage.setItem(PRESET_KEY, String(value));
        } catch (error) {
            console.warn('Сводка недели: цвет карточки не сохранён', error);
        }
    }
    const recap = { open: false, week: 'last', data: null, people: undefined, failed: false, busy: false, canvas: null, model: null, request: 0, draw: 0, status: '', statusTimer: 0, preset: readPreset() };
    const modal = document.createElement('div');
    modal.className = 'rc';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'rc-title');
    document.body.append(modal);

    // Неделя с понедельника: прошлая целиком или эта до сегодняшнего дня
    const mondayOf = (at) => addDays(dayStart(at), -((new Date(at).getDay() + 6) % 7));
    function recapRange(week) {
        const monday = mondayOf(Date.now());
        return week === 'this' ? { from: monday, to: addDays(today(), 1), last: today() } : { from: addDays(monday, -7), to: monday, last: addDays(monday, -1) };
    }
    // Номер недели по ISO: первая неделя та, где есть 4 января, год берётся по четвергу недели
    function isoWeek(monday) {
        const year = new Date(addDays(monday, 3)).getFullYear();
        return { year, week: 1 + Math.round((monday - mondayOf(new Date(year, 0, 4).getTime())) / WEEK) };
    }

    const pictures = new Map();
    function picture(url) {
        if (!url) return Promise.resolve(null);
        if (!pictures.has(url)) {
            pictures.set(
                url,
                new Promise((resolve) => {
                    const img = new window.Image();
                    const timer = window.setTimeout(() => resolve(null), 10000);
                    img.crossOrigin = 'anonymous';
                    img.onload = () => {
                        window.clearTimeout(timer);
                        resolve(img);
                    };
                    img.onerror = () => {
                        window.clearTimeout(timer);
                        console.warn('Сводка недели: картинка не загрузилась', url);
                        resolve(null);
                    };
                    img.src = url;
                }),
            );
        }
        return pictures.get(url);
    }
    // Картинки журнала маленькие (-large это 100 на 100): для карточки берётся крупный размер того же файла
    const sized = (url, size) => (url ? url.replace(/-(large|t\d+x\d+)\.(jpg|png)$/, '-' + size + '.$2') : '');
    let fontsReady = null;
    const recapFonts = () =>
        fontsReady ||
        (fontsReady = Promise.all([400, 600, 700, 800].map((weight) => document.fonts.load(weight + ' 20px Onest', 'Аa'))).catch((error) =>
            console.warn('Сводка недели: шрифт не загрузился, рисую системным', error),
        ));

    // Всё, что нарисовано, кроме цвета: смена цвета перерисовывает без новых запросов
    async function recapModel(s, people, week) {
        const { last } = recapRange(week);
        const tracks = s.tracks.slice(0, 5);
        const artists = s.artists.slice(0, 5);
        const me = people && people.me;
        const avatars = (people && people.avatars) || {};
        const [avatar, covers, faces] = await Promise.all([
            picture(me ? sized(me.avatar, 't500x500') : ''),
            Promise.all(tracks.map((t) => picture(sized(t.artwork, 't300x300')))),
            Promise.all(artists.map((a) => picture(sized(avatars[artistPath(a.path)] || a.artwork, 't300x300')))),
        ]);
        // Части суток по минутам звука; тепловая карта индекса идёт с понедельника, как и неделя сводки
        const parts = DAY_PARTS.map(([from, to]) => {
            let minutes = 0;
            for (let day = 0; day < 7; day++) for (let hour = from; hour < to; hour++) minutes += s.heat[day * 24 + hour] || 0;
            return minutes;
        });
        const total = parts.reduce((sum, minutes) => sum + minutes, 0);
        const busiest = Math.max(...parts);
        const top = Math.max(...s.heat);
        const peakAt = top > 0 ? s.heat.indexOf(top) : -1;
        const { year, week: number } = isoWeek(s.from);
        return {
            year,
            number,
            range: T.recapWeek(number, T.recapRange(s.from, last)),
            name: me ? me.username : '',
            link: me && me.permalink ? 'soundcloud.com/' + me.permalink : '',
            avatar,
            heard: s.heard,
            stats: [
                [s.counted, plural(s.counted, T.counted)],
                [s.artistCount, plural(s.artistCount, T.artists)],
                // История моложе недели: новые все, число ничего не говорит
                ...(s.firstAt !== null && s.from > s.firstAt ? [[s.fresh, plural(s.fresh, T.fresh)]] : []),
            ],
            tracks: tracks.map((t, i) => ({ title: t.name || T.loading, artist: t.artistName, plays: t.plays, cover: covers[i] })),
            artists: artists.map((a, i) => ({ name: a.name || T.loading, time: span(a.ms), face: faces[i] })),
            genres: s.genres.slice(0, 4).map((g) => ({ name: cap(g.name), share: pct(g.plays, s.counted) + '%' })),
            parts: parts.map((minutes, i) => ({
                name: T.dayParts[i],
                hours: DAY_PARTS[i][0] + '-' + DAY_PARTS[i][1],
                share: pct(minutes, total) + '%',
                top: minutes > 0 && minutes === busiest,
            })),
            peak: peakAt < 0 ? '' : T.recapPeak(fmtWeekday.format(addDays(s.from, Math.floor(peakAt / 24))), pad(peakAt % 24) + ':00'),
        };
    }

    function paintRecap(ctx, m, preset) {
        const W = RECAP.width;
        const HERO = RECAP.hero;
        const p = RECAP_PANELS[preset.panel];
        const font = (size, weight) => (ctx.font = weight + ' ' + size + 'px ' + RECAP.font);
        const fit = (value, room) => {
            if (ctx.measureText(value).width <= room) return value;
            let cut = value;
            while (cut && ctx.measureText(cut + '…').width > room) cut = cut.slice(0, -1);
            return cut.trimEnd() + '…';
        };
        const text = (value, x, y, color, align) => {
            ctx.fillStyle = color;
            ctx.textAlign = align || 'left';
            ctx.fillText(value, x, y);
        };
        // Квадрат из середины картинки без искажения
        const cover = (img, x, y, size) => {
            const side = Math.min(img.naturalWidth, img.naturalHeight);
            ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, x, y, size, size);
        };
        const round = (img, cx, cy, r, fill) => {
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.clip();
            if (img) cover(img, cx - r, cy - r, r * 2);
            else {
                ctx.fillStyle = fill;
                ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
            }
            ctx.restore();
        };
        // Плашка как у названия трека на SoundCloud: чёрный фон по ширине текста, части на общей базовой линии
        const plate = (x, y, h, padX, runs, align) => {
            const widths = runs.map((run) => {
                font(run.size, run.weight);
                return ctx.measureText(run.text).width;
            });
            const width = padX * 2 + widths.reduce((sum, w, i) => sum + w + (i ? 8 : 0), 0);
            const left = align === 'right' ? x - width : x;
            ctx.fillStyle = '#000000';
            ctx.fillRect(left, y, width, h);
            const base = y + h / 2 + Math.max(...runs.map((run) => run.size)) * 0.36;
            let cursor = left + padX;
            ctx.textBaseline = 'alphabetic';
            runs.forEach((run, i) => {
                font(run.size, run.weight);
                text(run.text, cursor, base, run.color);
                cursor += widths[i] + 8;
            });
        };

        ctx.fillStyle = p.panel;
        ctx.fillRect(0, 0, W, RECAP.height);
        // Шапка: градиент на 135 градусов, как linear-gradient(135deg) у макета
        const shift = (W + HERO) / 4;
        const gradient = ctx.createLinearGradient(W / 2 - shift, HERO / 2 - shift, W / 2 + shift, HERO / 2 + shift);
        gradient.addColorStop(0, preset.a);
        gradient.addColorStop(1, preset.b);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, W, HERO);

        round(m.avatar, 155, 165, 115, '#c9b8ff');
        if (!m.avatar) {
            font(96, 700);
            ctx.textBaseline = 'middle';
            text((m.name || 'S').charAt(0).toUpperCase(), 155, 170, '#2a1b5c', 'center');
        }
        font(40, 700);
        plate(300, 56, 48, 12, [{ text: fit(m.name || T.recap, 520), size: 40, weight: 700, color: '#ffffff' }]);
        if (m.link) plate(300, 112, 24, 10, [{ text: m.link, size: 15, weight: 400, color: '#cccccc' }]);
        plate(300, 166, 72, 14, [
            { text: span(m.heard), size: 54, weight: 800, color: '#ffffff' },
            { text: T.recapMusic, size: 17, weight: 400, color: '#cccccc' },
        ]);
        plate(300, 246, 24, 10, [{ text: m.range, size: 15, weight: 400, color: '#cccccc' }]);
        m.stats.forEach(([value, label], i) =>
            plate(1160, 56 + i * 46, 38, 12, [
                { text: String(value), size: 24, weight: 700, color: '#ffffff' },
                { text: label, size: 15, weight: 400, color: '#cccccc' },
            ], 'right'),
        );

        // Низ: треки и артисты недели слева, жанры и время суток справа
        ctx.textBaseline = 'middle';
        font(13, 600);
        text(T.recapTracks, 40, 365, p.muted);
        m.tracks.forEach((t, i) => {
            const x = 40 + i * 148;
            if (t.cover) cover(t.cover, x, 384, 128);
            else {
                ctx.fillStyle = p.empty;
                ctx.fillRect(x, 384, 128, 128);
            }
            font(15, 600);
            text(fit(t.title, 128), x, 529, p.ink);
            font(13, 400);
            text(fit(t.artist, 128), x, 546.5, p.muted);
            ctx.fillStyle = p.muted;
            ctx.beginPath();
            ctx.moveTo(x, 559);
            ctx.lineTo(x + 8, 563.5);
            ctx.lineTo(x, 568);
            ctx.closePath();
            ctx.fill();
            font(12, 400);
            text(String(t.plays), x + 13, 563.5, p.muted);
        });
        font(13, 600);
        text(T.recapArtists, 40, 603, p.muted);
        m.artists.forEach((a, i) => {
            const x = 40 + i * 148;
            round(a.face, x + 32, 654, 32, p.empty);
            ctx.textBaseline = 'middle';
            font(15, 600);
            text(fit(a.name, 128), x, 703, p.ink);
            font(13, 400);
            text(a.time, x, 720.5, p.muted);
        });

        font(13, 600);
        text(T.recapGenres, 820, 365, p.muted);
        if (!m.genres.length) {
            font(15, 400);
            text(T.nothing, 820, 397, p.muted);
        }
        m.genres.forEach((g, i) => {
            const cy = 397 + i * 30;
            font(15, 400);
            text(g.share, 1160, cy, p.muted, 'right');
            font(15, 600);
            text(fit(g.name, 280), 820, cy, p.ink);
            ctx.fillStyle = p.line;
            ctx.fillRect(820, 411 + i * 30, 340, 1);
        });
        font(13, 600);
        text(T.when, 820, 533, p.muted);
        m.parts.forEach((d, i) => {
            const top = 550 + i * 32;
            if (d.top) {
                ctx.fillStyle = p.film;
                ctx.beginPath();
                ctx.roundRect(810, top, 360, 30, 4);
                ctx.fill();
            }
            const weight = d.top ? 700 : 400;
            font(15, weight);
            text(d.name, 820, top + 15, p.ink);
            text(d.share, 1160, top + 15, p.ink, 'right');
            font(13, 400);
            text(d.hours, 1048, top + 15, p.muted);
        });
        if (m.peak) {
            font(13, 400);
            text(m.peak, 820, 695, p.muted);
        }
    }

    function drawRecap(m, preset) {
        const canvas = document.createElement('canvas');
        canvas.width = RECAP.width * RECAP.scale;
        canvas.height = RECAP.height * RECAP.scale;
        const ctx = canvas.getContext('2d');
        ctx.scale(RECAP.scale, RECAP.scale);
        paintRecap(ctx, m, preset);
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', T.recapLabel(span(m.heard), m.stats[0][0] + ' ' + m.stats[0][1]));
        return canvas;
    }

    // Окно сводки: шапка строится при открытии и смене языка, дальше меняются только отметки и картинка
    function buildRecapModal() {
        const button = (act, label, solid) => '<button class="rc-btn' + (solid ? ' solid' : '') + '" data-rc="' + act + '">' + esc(label) + '</button>';
        modal.innerHTML =
            '<div class="rc-bar"><h2 id="rc-title">' + esc(T.recap) + '</h2>' +
            '<div class="seg" role="group" aria-label="' + esc(T.recapWeekGroup) + '">' +
            ['last', 'this'].map((week) => '<button data-rc="week" data-week="' + week + '">' + esc(T.recapWeeks[week]) + '</button>').join('') +
            '</div><div class="rc-colors" role="group" aria-label="' + esc(T.recapColors) + '">' +
            RECAP_PRESETS.map((preset, i) =>
                '<button class="rc-swatch" data-rc="preset" data-index="' + i + '" aria-label="' + esc(T.recapPresets[i]) + '" data-tip="' + esc(T.recapPresets[i]) +
                '" style="background:linear-gradient(135deg,' + preset.a + ',' + preset.b + ')"></button>',
            ).join('') +
            '</div><span class="sub" id="rc-status" role="status"></span>' +
            button('copy', T.copy, true) + button('save', T.save, false) + button('close', T.recapClose, false) + '</div>' +
            '<div class="rc-body"></div>';
        updateRecapBar();
    }
    function updateRecapBar() {
        modal.querySelectorAll('[data-rc="week"]').forEach((node) => node.setAttribute('aria-pressed', String(node.dataset.week === recap.week)));
        modal.querySelectorAll('[data-rc="preset"]').forEach((node) => node.setAttribute('aria-pressed', String(Number(node.dataset.index) === recap.preset)));
        modal.querySelectorAll('[data-rc="copy"], [data-rc="save"]').forEach((node) => (node.disabled = !recap.canvas || recap.busy));
        const status = document.getElementById('rc-status');
        if (status) status.textContent = recap.status;
    }
    async function refreshRecapBody() {
        const body = modal.querySelector('.rc-body');
        if (!body) return;
        const s = recap.data;
        const draw = ++recap.draw;
        let note = '';
        if (recap.failed) note = T.recapFailed;
        else if (!s || (s.heard > 0 && recap.people === undefined)) note = T.recapLoading;
        else if (!s.heard) note = T.recapEmpty[recap.week];
        if (note) {
            recap.canvas = null;
            recap.model = null;
            body.innerHTML = '<p class="empty">' + esc(note) + '</p>';
            updateRecapBar();
            return;
        }
        try {
            const [model] = await Promise.all([recapModel(s, recap.people, recap.week), recapFonts()]);
            if (draw !== recap.draw || !recap.open) return;
            const canvas = drawRecap(model, RECAP_PRESETS[recap.preset]);
            const first = !recap.canvas;
            recap.canvas = canvas;
            recap.model = model;
            body.replaceChildren(canvas);
            updateRecapBar();
            // Картинка появилась впервые: фокус с «Закрыть» переходит на главное действие
            if (first && document.activeElement && document.activeElement.dataset.rc === 'close') modal.querySelector('[data-rc="copy"]').focus({ preventScroll: true });
        } catch (error) {
            console.error('Сводка недели не нарисована:', error);
            if (draw !== recap.draw || !recap.open) return;
            recap.canvas = null;
            body.innerHTML = '<p class="empty">' + esc(T.recapFailed) + '</p>';
        }
        updateRecapBar();
    }
    async function loadRecap() {
        const request = ++recap.request;
        const week = recap.week;
        const current = () => request === recap.request && recap.open;
        Object.assign(recap, { data: null, people: undefined, failed: false });
        refreshRecapBody();
        try {
            const { from, to } = recapRange(week);
            const data = await api.invoke('history:overview', from, to);
            if (!data) throw new Error('Пустой ответ обзора недели');
            if (!current()) return;
            recap.data = data;
            if (!data.heard) return refreshRecapBody();
            refreshRecapBody();
            let people = null;
            try {
                people = await api.invoke('history:people', [...new Set(data.artists.slice(0, 5).map((a) => artistPath(a.path)).filter(Boolean))]);
            } catch (error) {
                console.error('Ник и аватарки для сводки не получены:', error);
            }
            if (!current()) return;
            recap.people = people;
            await refreshRecapBody();
            // Прошлая неделя показана: точка у кнопки истории гаснет
            if (current() && week === 'last' && recap.model) api.send('history:recap-seen', recap.model.year, recap.model.number);
        } catch (error) {
            console.error('Сводка недели не собрана:', error);
            if (!current()) return;
            recap.failed = true;
            refreshRecapBody();
        }
    }
    function setRecapStatus(text) {
        recap.status = text;
        updateRecapBar();
        window.clearTimeout(recap.statusTimer);
        if (text) recap.statusTimer = window.setTimeout(() => setRecapStatus(''), 4000);
    }
    function openRecap() {
        Object.assign(recap, { open: true, week: 'last', canvas: null, model: null, busy: false, status: '' });
        modal.hidden = false;
        view.inert = true;
        tip.hidden = true;
        buildRecapModal();
        modal.querySelector('[data-rc="close"]').focus({ preventScroll: true });
        loadRecap();
    }
    function closeRecap() {
        recap.open = false;
        recap.request++;
        recap.draw++;
        window.clearTimeout(recap.statusTimer);
        modal.hidden = true;
        modal.innerHTML = '';
        recap.canvas = null;
        view.inert = false;
        view.querySelector('[data-act="recap"]')?.focus({ preventScroll: true });
    }
    async function recapAction(kind) {
        if (!recap.canvas || recap.busy) return;
        let image;
        try {
            image = recap.canvas.toDataURL('image/png');
        } catch (error) {
            console.error('Сводка недели не выгрузилась из холста:', error);
            return setRecapStatus(kind === 'copy' ? T.copyFailed : T.saveFailed);
        }
        const request = recap.request;
        const model = recap.model;
        recap.busy = true;
        updateRecapBar();
        let status;
        try {
            if (kind === 'copy') status = (await api.invoke('history:recap-copy', image)) === true ? T.copied : T.copyFailed;
            else {
                const result = await api.invoke('history:recap-save', image, model ? model.year : null, model ? model.number : null);
                status = result === 'saved' ? T.saved : result === 'canceled' ? '' : T.saveFailed;
            }
        } catch (error) {
            console.error('Сводка недели не передана:', error);
            status = kind === 'copy' ? T.copyFailed : T.saveFailed;
        }
        recap.busy = false;
        if (request !== recap.request || !recap.open) return;
        setRecapStatus(status);
    }
    modal.addEventListener('click', (event) => {
        const target = event.target.closest('button[data-rc]');
        if (!target || target.disabled) return;
        const act = target.dataset.rc;
        if (act === 'close') return closeRecap();
        if (act === 'week') {
            if (target.dataset.week === recap.week) return;
            recap.week = target.dataset.week === 'this' ? 'this' : 'last';
            recap.canvas = null;
            updateRecapBar();
            return loadRecap();
        }
        if (act === 'preset') {
            recap.preset = Number(target.dataset.index);
            savePreset(recap.preset);
            updateRecapBar();
            return refreshRecapBody();
        }
        recapAction(act);
    });

    // События
    let searchTimer;
    view.addEventListener('input', (event) => {
        if (event.target.id !== 'q') return;
        state.query = event.target.value.trim();
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(async () => {
            if (state.query) {
                try {
                    await loadResults();
                } catch (error) {
                    console.error('Поиск не удался:', error);
                    state.results = [];
                }
            }
            render(false);
        }, 200);
    });
    view.addEventListener('click', async (event) => {
        const target = event.target.closest('button, .play, svg[data-wave]');
        if (!target) return;
        const data = target.dataset;
        if (data.act === 'close') return api.send('history:close');
        if (data.act === 'recap') return openRecap();
        if (data.act === 'retry') {
            await reload(true);
            return render(false);
        }
        if (data.act === 'artists') {
            state.allArtists = !state.allArtists;
            return render(true);
        }
        if (data.act === 'wave' || data.act === 'wave-retry') {
            state.waveOpen = data.act === 'wave-retry' || !state.waveOpen;
            if (!state.waveOpen || (state.wave && !state.waveFailed)) return render(true);
            state.waveFailed = false;
            render(true);
            await loadWave();
            return render(true);
        }
        if (data.period) {
            state.period = data.period === 'all' ? 'all' : Number(data.period);
            state.allArtists = false;
            await reload(false);
            return render(true);
        }
        if (data.day) {
            try {
                await loadDay(Number(data.day));
            } catch (error) {
                console.error('День не загружен:', error);
            }
            return render(true);
        }
        if (data.drop || data.restore) {
            const kind = data.drop || data.restore;
            target.disabled = true;
            try {
                const next = await api.invoke('history:taste-remove', kind, kind === 'artist' ? Number(data.key) : data.key, !!data.drop);
                if (next) state.taste = next;
            } catch (error) {
                console.error('Вкус волны не изменён:', error);
            }
            return render(true);
        }
        if (data.artist) return api.send('history:artist', data.artist);
        if (data.path) return play(data.path, data.id);
        if (data.wave) {
            const wave = state.overview.wave;
            const box = target.getBoundingClientRect();
            const index = Math.min(wave.bins.length - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * wave.bins.length)));
            try {
                await loadDay(dayStart(wave.from + index * wave.binHours * 3600000));
            } catch (error) {
                console.error('День не загружен:', error);
                return;
            }
            render(true);
            const reduce = document.documentElement.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            document.getElementById('journal')?.scrollIntoView({ block: 'start', behavior: reduce ? 'instant' : 'smooth' });
        }
    });
    document.addEventListener('keydown', (event) => {
        // Окно чека держит Tab у своих кнопок
        if (recap.open && event.key === 'Tab') {
            const buttons = [...modal.querySelectorAll('button:not([disabled])')];
            const at = buttons.indexOf(document.activeElement);
            const next = event.shiftKey ? (at <= 0 ? buttons.length - 1 : at - 1) : (at + 1) % buttons.length;
            event.preventDefault();
            buttons[next]?.focus();
            return;
        }
        if (event.repeat) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            // Esc сначала закрывает чек недели, история остаётся
            if (recap.open) return closeRecap();
            const q = document.getElementById('q');
            // Первый Esc в поиске очищает запрос, второй закрывает историю
            if (q && document.activeElement === q && q.value) {
                q.value = '';
                state.query = '';
                render(true);
                return;
            }
            api.send('history:close');
            return;
        }
        if ((event.key === 'Enter' || event.key === ' ') && event.target.classList && event.target.classList.contains('play')) {
            event.preventDefault();
            play(event.target.dataset.path, event.target.dataset.id);
        }
    });

    // Подсказки: наведение и фокус показывают одно и то же
    function showTip(text, x, y) {
        tip.textContent = text;
        tip.hidden = false;
        const w = tip.offsetWidth;
        tip.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2)) + 'px';
        tip.style.top = Math.max(4, y - 40) + 'px';
    }
    document.addEventListener('mousemove', (event) => {
        const wave = event.target.closest && event.target.closest('svg[data-wave]');
        if (wave && state.overview) {
            const w = state.overview.wave;
            const box = wave.getBoundingClientRect();
            const index = Math.min(w.bins.length - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * w.bins.length)));
            const at = w.from + index * w.binHours * 3600000;
            const label = w.binHours < 24 ? cap(fmtWd.format(at)) + ', ' + timeOf(at) + '-' + timeOf(at + w.binHours * 3600000) : w.binHours === 24 ? cap(fmtWd.format(at)) : T.from(fmtShort.format(at));
            showTip(label + ': ' + (w.bins[index] ? minutesLabel(w.bins[index]) : T.silence), event.clientX, box.top);
            return;
        }
        const node = event.target.closest && event.target.closest('[data-tip]');
        if (!node) {
            tip.hidden = true;
            return;
        }
        const box = node.getBoundingClientRect();
        showTip(node.dataset.tip, box.left + box.width / 2, box.top);
    });
    document.addEventListener('focusin', (event) => {
        const node = event.target.closest && event.target.closest('[data-tip]');
        if (!node) {
            tip.hidden = true;
            return;
        }
        const box = node.getBoundingClientRect();
        showTip(node.dataset.tip, box.left + box.width / 2, box.top);
    });
    document.addEventListener('focusout', () => {
        tip.hidden = true;
    });
    view.addEventListener('scroll', () => {
        tip.hidden = true;
    });

    // Названия старых треков добрались, язык сменился
    api.on('history:changed', async () => {
        if (!state.loaded || state.failed) return;
        await reload(false);
        render(true);
    });
    api.on('history:language', (lang) => {
        setLanguage(lang);
        render(true);
        if (recap.open) {
            // Подпись о копировании была на прежнем языке, и в самой картинке все надписи
            recap.status = '';
            buildRecapModal();
            refreshRecapBody();
            modal.querySelector('[data-rc="close"]').focus({ preventScroll: true });
        }
    });
    // Плеер сайта сменил трек: отметка «играет» переезжает на него, пауза её не снимает
    api.on('history:now', (id) => {
        const next = typeof id === 'number' && id > 0 ? id : 0;
        if (next === state.nowId) return;
        state.nowId = next;
        if (state.loaded) render(true);
    });

    async function start() {
        let initRecap = false;
        setLanguage(document.documentElement.lang);
        try {
            const init = await api.invoke('history:init');
            setLanguage(init.language);
            document.documentElement.classList.toggle('reduce-motion', init.reduceMotion === true);
            state.signedIn = init.signedIn === true;
            state.nowId = typeof init.playing === 'number' && init.playing > 0 ? init.playing : 0;
            initRecap = init.recap === true;
            if (state.signedIn) await reload(true);
            else state.loaded = true;
        } catch (error) {
            console.error('История не открыта:', error);
            state.failed = true;
            state.loaded = true;
        }
        render(false);
        api.send('history:ready');
        // История открыта нажатием на кнопку с точкой: сразу сводка прошлой недели
        if (initRecap && state.signedIn && !state.failed) openRecap();
    }
    start();
})();
