'use strict';
// Страница истории прослушиваний: обзор периода и журнал дня. Данные отдаёт main из индекса журнала сигналов
(function () {
    const api = window.historyAPI;
    const view = document.getElementById('view');
    const tip = document.getElementById('tip');
    const ARTISTS_SHORT = 8;

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
            counted: ['трек засчитан', 'трека засчитано', 'треков засчитано'],
            artists: ['артист', 'артиста', 'артистов'],
            fresh: ['новый артист', 'новых артиста', 'новых артистов'],
            artistsTitle: (p) => 'Артисты ' + TEXTS.ru.periodText(p),
            more: 'Ещё',
            less: 'Свернуть',
            tracks: 'Треки',
            genres: 'Жанры',
            when: 'Когда ты слушаешь',
            emptyTop: 'Пока пусто: засчитывается трек, прозвучавший 30 секунд',
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
            trackCount: ['трек', 'трека', 'треков'],
            fromWave: 'Из волны',
            away: 'Играло, пока тебя не было у компьютера',
            like: 'Лайк',
            skipped: (t) => 'пропущен на ' + t,
            done: (t) => 'дослушан, ' + t,
            of: (a, b) => a + ' из ' + b,
            loading: 'Название загружается',
            unavailable: 'Трек недоступен',
            bin: (h) => (h < 24 ? 'столбец это ' + h + ' ' + plural(h, ['час', 'часа', 'часов']) : h === 24 ? 'столбец это день' : 'столбец это ' + h / 24 + ' ' + plural(h / 24, ['день', 'дня', 'дней'])),
            waveLabel: (p, h) => 'Музыка ' + TEXTS.ru.periodText(p) + ', ' + TEXTS.ru.bin(h),
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
            early: 'Ранние пропуски в волне',
            earlyTotal: (share) => share + '% за 30 дней',
            earlyNone: 'волна ещё не играла',
            earlyNote: 'Доля треков волны, пропущенных за первые 30 секунд. Чем ниже, тем точнее волна',
            earlyDay: (day, share, early, total) => day + ': ' + share + '%, ' + early + ' из ' + total,
            earlyIdle: (day) => day + ': волна не играла',
            earlyLabel: 'Доля ранних пропусков в волне по дням за 30 дней',
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
            music: (p) => 'of music ' + TEXTS.en.periodText(p),
            h: 'h',
            min: 'min',
            sec: 's',
            counted: ['track counted', 'tracks counted'],
            artists: ['artist', 'artists'],
            fresh: ['new artist', 'new artists'],
            artistsTitle: (p) => 'Artists ' + TEXTS.en.periodText(p),
            more: 'More',
            less: 'Show less',
            tracks: 'Tracks',
            genres: 'Genres',
            when: 'When you listen',
            emptyTop: 'Nothing yet: a track counts after 30 seconds of playback',
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
            trackCount: ['track', 'tracks'],
            fromWave: 'From the wave',
            away: 'Played while you were away',
            like: 'Liked',
            skipped: (t) => 'skipped at ' + t,
            done: (t) => 'finished, ' + t,
            of: (a, b) => a + ' of ' + b,
            loading: 'Loading title',
            unavailable: 'Track unavailable',
            bin: (h) => (h < 24 ? 'each bar is ' + h + ' ' + (h === 1 ? 'hour' : 'hours') : h === 24 ? 'each bar is a day' : 'each bar is ' + h / 24 + ' days'),
            waveLabel: (p, h) => 'Music ' + TEXTS.en.periodText(p) + ', ' + TEXTS.en.bin(h),
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
            early: 'Early skips in the wave',
            earlyTotal: (share) => share + '% in 30 days',
            earlyNone: 'the wave hasn’t played yet',
            earlyNote: 'Share of wave tracks skipped in the first 30 seconds. Lower means a more accurate wave',
            earlyDay: (day, share, early, total) => day + ': ' + share + '%, ' + early + ' of ' + total,
            earlyIdle: (day) => day + ': the wave didn’t play',
            earlyLabel: 'Share of early skips in the wave by day, last 30 days',
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
        playing: '',
        // Вкус глазами волны: не зависит от периода, считается по всей истории с забыванием
        taste: null,
    };
    let T = TEXTS.ru;
    let fmtLong, fmtShort, fmtWd;

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
        document.title = T.title;
    }
    function setTheme(dark) {
        document.documentElement.classList.toggle('theme-light', dark === false);
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
    };

    // Куски страницы
    const periodSeg = () =>
        '<div class="seg" role="group" aria-label="' + esc(T.periodGroup) + '">' +
        [7, 30, 365, 'all'].map((value) => '<button data-period="' + value + '" aria-pressed="' + (state.period === value) + '">' + esc(T.periods[value]) + '</button>').join('') +
        '</div>';
    const head = (extra) =>
        '<div class="ph"><button class="back" data-act="close" aria-label="' + esc(T.closeLabel) + '" data-tip="' + esc(T.close) + '">' + ICON.back + '</button><h1>' + esc(T.title) + '</h1>' + extra +
        '<label class="search"><input type="search" id="q" placeholder="' + esc(T.search) + '" value="' + esc(state.query) + '" aria-label="' + esc(T.searchLabel) + '" spellcheck="false" autocomplete="off">' + ICON.search + '</label></div>';
    const art = (url, cls) => (url ? '<img class="' + cls + '" src="' + esc(url) + '" alt="" loading="lazy">' : '<span class="' + cls + '" aria-hidden="true"></span>');
    const keyOf = (r) => r.at + ':' + r.id;

    function row(r, withDate) {
        const frac = r.dur ? Math.min(1, r.heard / r.dur) : 1;
        const icons =
            (r.source.startsWith('wave') ? '<span data-tip="' + esc(T.fromWave) + '" aria-label="' + esc(T.fromWave) + '">' + ICON.wave + '</span>' : '') +
            (r.away ? '<span data-tip="' + esc(T.away) + '" aria-label="' + esc(T.away) + '">' + ICON.away + '</span>' : '') +
            (r.liked ? '<span class="like" data-tip="' + esc(T.like) + '" aria-label="' + esc(T.like) + '">' + ICON.like + '</span>' : '');
        const heard = !r.dur ? clock(r.heard) : r.end === 'skip' ? T.skipped(clock(r.heard)) : r.end === 'done' ? T.done(clock(r.dur)) : T.of(clock(r.heard), clock(r.dur));
        const title = r.title ? '<b>' + esc(r.title) + '</b>' : '<b class="none">' + esc(r.resolved === 2 ? T.unavailable : T.loading) + '</b>';
        const when = withDate ? cap(fmtShort.format(r.at)) + ', ' + timeOf(r.at) : timeOf(r.at);
        const play = r.path ? ' play" role="button" tabindex="0" data-path="' + esc(r.path) + '" data-key="' + esc(keyOf(r)) : '';
        return (
            '<div class="row' + (r.end === 'skip' ? ' skip' : '') + (state.playing === keyOf(r) ? ' playing' : '') + play + '">' +
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
        const max = Math.max(1, ...bins);
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
        return (
            '<div class="pwave"><svg viewBox="0 0 ' + bins.length * 3 + ' 124" preserveAspectRatio="none" data-wave="period" role="img" aria-label="' + esc(T.waveLabel(state.period, wave.binHours)) + '">' + rects + '</svg>' +
            '<div class="pwave-x"><span>' + esc(fmtShort.format(wave.from)) + '</span><span>' + esc(T.bin(wave.binHours)) + '</span><span>' + esc(T.todayLower) + '</span></div></div>'
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
    function earlyChart(days) {
        const cols = 'grid-template-columns:repeat(' + days.length + ',minmax(0,1fr))';
        const lines = [0, 25, 50, 75, 100].map((v) => '<div style="bottom:' + v + '%"><span class="num">' + v + '%</span></div>').join('');
        const last = days.length - 1;
        const bars = days.map((d) => {
            const share = d.total ? Math.round((d.early / d.total) * 100) : 0;
            const day = cap(fmtWd.format(d.start));
            const tipText = d.total ? T.earlyDay(day, share, d.early, d.total) : T.earlyIdle(day);
            // День с волной без ранних пропусков виден чертой у оси, пустой день пуст
            const height = d.total ? Math.max(2, share) : 0;
            return '<div class="cc-slot" tabindex="0" data-tip="' + esc(tipText) + '" aria-label="' + esc(tipText) + '"><i style="height:' + height + '%"></i></div>';
        }).join('');
        const labels = days.map((d, i) => '<span>' + ((last - i) % 7 === 0 ? esc(i === last ? T.todayLower : fmtShort.format(d.start)) : '') + '</span>').join('');
        return (
            '<div class="cc" role="group" aria-label="' + esc(T.earlyLabel) + '"><div class="cc-plot"><div class="cc-grid">' + lines + '</div><div class="cc-bars" style="' + cols + '">' + bars + '</div></div>' +
            '<div class="cc-x" style="' + cols + '">' + labels + '</div></div>'
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
        const total = t.early.reduce((sum, d) => sum + d.total, 0);
        const early = t.early.reduce((sum, d) => sum + d.early, 0);
        return (
            '<div class="grid2 sec"><div><div class="sec-h"><h2>' + esc(T.tasteArtists) + '</h2></div>' + tasteList('artist', t.artists) + '</div>' +
            '<div><div class="sec-h"><h2>' + esc(T.tasteTags) + '</h2></div>' + tasteList('tag', t.tags) + '</div></div>' +
            restoreLine +
            '<div class="sec"><div class="sec-h"><h2>' + esc(T.early) + '</h2><span class="sub num">' + esc(total ? T.earlyTotal(Math.round((early / total) * 100)) : T.earlyNone) + '</span></div>' +
            '<p class="sub note">' + esc(T.earlyNote) + '</p>' + earlyChart(t.early) + '</div>'
        );
    }

    function journal() {
        const data = state.day;
        const rows = data ? data.rows : [];
        const total = rows.reduce((sum, r) => sum + r.heard, 0);
        const before = data && data.before !== null ? dayStart(data.before) : '';
        const after = data && data.after !== null ? dayStart(data.after) : '';
        return (
            '<div class="sec" id="journal"><div class="jn"><h2>' + esc(dayTitle(state.selected)) + '</h2><span class="sub num">' +
            esc(rows.length ? span(total) + ', ' + rows.length + ' ' + plural(rows.length, T.trackCount) : T.silence) + '</span>' +
            '<button class="icon-btn" data-day="' + before + '"' + (before === '' ? ' disabled' : '') + ' aria-label="' + esc(T.prevDay) + '" data-tip="' + esc(T.prevDay) + '">' + ICON.prev + '</button>' +
            '<button class="icon-btn" data-day="' + after + '"' + (after === '' ? ' disabled' : '') + ' aria-label="' + esc(T.nextDay) + '" data-tip="' + esc(T.nextDay) + '">' + ICON.next + '</button></div>' +
            '<div class="jn-list">' + (rows.length ? rows.map((r) => row(r, false)).join('') : '<p class="empty">' + esc(T.dayEmpty) + '</p>') + '</div></div>'
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
            [s.fresh, plural(s.fresh, T.fresh)],
        ];
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
            journal()
        );
    }

    function renderResults() {
        const list = state.results || [];
        if (!list.length) return '<p class="empty">' + esc(T.searchEmpty) + '</p>';
        const count = list.length + ' ' + plural(list.length, T.plays);
        return (
            '<div class="sec"><div class="sec-h"><h2>' + esc(T.results) + '</h2><span class="sub num">' + esc(list.length >= 200 ? T.latest(200) : count) + '</span></div>' +
            '<div class="search-rows">' + list.map((r) => row(r, true)).join('') + '</div></div>'
        );
    }

    function render(keepScroll) {
        const scroll = view.scrollTop;
        const active = document.activeElement;
        const focusSearch = active && active.id === 'q';
        const caret = focusSearch ? active.selectionStart : 0;
        let body;
        if (!state.signedIn) body = '<p class="empty wide">' + esc(T.signedOut) + '</p>';
        else if (state.failed) body = '<div class="empty wide"><p>' + esc(T.failed) + '</p><button class="link" data-act="retry" style="margin-top:12px">' + esc(T.retry) + '</button></div>';
        else if (!state.loaded) body = '';
        else if (state.query) body = renderResults();
        else body = renderOverview();
        view.innerHTML = '<div class="wrap">' + head(state.signedIn && !state.query ? periodSeg() : '') + body + '</div>';
        if (keepScroll) view.scrollTop = scroll;
        if (focusSearch) {
            const q = document.getElementById('q');
            q.focus();
            q.setSelectionRange(caret, caret);
        }
    }

    // Загрузка
    async function loadOverview() {
        const end = addDays(today(), 1);
        const from = state.period === 'all' ? null : addDays(today(), -(state.period - 1));
        state.overview = await api.invoke('history:overview', from, end);
        if (!state.overview) throw new Error('Пустой ответ обзора');
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
            await Promise.all([loadOverview(), first ? loadTaste() : Promise.resolve()]);
            await loadDay(state.selected || today());
            // Первое открытие без музыки сегодня: журнал последнего дня, когда она была
            if (first && !state.day.rows.length && state.day.before !== null) await loadDay(dayStart(state.day.before));
            if (state.query) await loadResults();
            state.failed = false;
        } catch (error) {
            console.error('История не загружена:', error);
            state.failed = true;
        }
        state.loaded = true;
    }

    async function play(path, key) {
        try {
            if (await api.invoke('history:play', path)) {
                state.playing = key || '';
                render(true);
            }
        } catch (error) {
            console.error('Трек не включён:', error);
        }
    }

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
        if (data.act === 'retry') {
            await reload(true);
            return render(false);
        }
        if (data.act === 'artists') {
            state.allArtists = !state.allArtists;
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
        if (data.path) return play(data.path, data.key);
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
            document.getElementById('journal')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.repeat) return;
        if (event.key === 'Escape') {
            event.preventDefault();
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
            play(event.target.dataset.path, event.target.dataset.key);
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

    // Названия старых треков добрались, язык или тема сменились
    api.on('history:changed', async () => {
        if (!state.loaded || state.failed) return;
        await reload(false);
        render(true);
    });
    api.on('history:language', (lang) => {
        setLanguage(lang);
        render(true);
    });
    api.on('theme-changed', (dark) => setTheme(dark));

    async function start() {
        setLanguage(document.documentElement.lang);
        try {
            const init = await api.invoke('history:init');
            setLanguage(init.language);
            setTheme(init.dark);
            state.signedIn = init.signedIn === true;
            if (state.signedIn) await reload(true);
            else state.loaded = true;
        } catch (error) {
            console.error('История не открыта:', error);
            state.failed = true;
            state.loaded = true;
        }
        render(false);
        api.send('history:ready');
    }
    start();
})();
