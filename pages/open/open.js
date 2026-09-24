'use strict';
// Переходник кнопки «Слушать в SoundCloud» из карточки Discord: пробует открыть трек в клиенте по ссылке soundcloud-desktop://,
// без клиента уводит на soundcloud.com. Понять наверняка, открылся ли клиент, браузер не даёт, поэтому:
// фокус ушёл со страницы (открылся клиент или диалог браузера «Открыть приложение?») значит остаёмся, иначе через 5 с на сайт.
// Любое нажатие на странице отменяет уход: человек выбирает сам. «Открыть в клиенте» без ответа клиента ведёт на загрузку
(() => {
    const DELAY = 5;
    const RELEASES = 'https://github.com/zxczxczxczxczxczxc1111/soundcloud-desktop/releases/latest';
    const t = new URLSearchParams(location.search).get('t') || '';
    // Только путь публичного трека: иначе страница стала бы открытым редиректом под этим адресом
    const valid = /^[a-z0-9_-]{1,100}\/[a-z0-9_-]{1,255}$/i.test(t);
    const web = valid ? 'https://soundcloud.com/' + t.toLowerCase() : 'https://soundcloud.com/';
    const ru = /^(ru|uk|be|kk)\b/i.test(navigator.language || '');
    const text = ru
        ? {
              title: 'Открываю трек в клиенте',
              countdown: (n) => 'Если клиента нет, через ' + n + ' с откроется сайт',
              idle: 'Если клиент не открылся, слушай на сайте',
              failed: 'Клиента нет, открываю страницу загрузки',
              app: 'Открыть в клиенте',
              web: 'Слушать на soundcloud.com',
          }
        : {
              title: 'Opening the track in the app',
              countdown: (n) => 'No app? The website opens in ' + n + ' s',
              idle: "If the app didn't open, listen on the website",
              failed: 'No app found, opening the download page',
              app: 'Open in the app',
              web: 'Listen on soundcloud.com',
          };
    document.documentElement.lang = ru ? 'ru' : 'en';
    const title = document.getElementById('title');
    const hint = document.getElementById('hint');
    const appLink = document.getElementById('app');
    const webLink = document.getElementById('web');
    if (title) title.textContent = text.title;
    if (appLink) appLink.textContent = text.app;
    if (webLink) {
        webLink.textContent = text.web;
        webLink.href = web;
    }
    if (!valid) {
        location.replace(web);
        return;
    }
    const app = 'soundcloud-desktop://track/' + t.toLowerCase();
    if (appLink) appLink.href = app;
    const say = (value) => { if (hint) hint.textContent = value; };

    let left = false;
    let stopped = false;
    let remaining = DELAY;
    const leave = () => { left = true; };
    const stop = () => {
        if (stopped) return;
        stopped = true;
        say(text.idle);
    };
    window.addEventListener('blur', leave);
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') leave(); });
    document.addEventListener('pointerdown', stop);
    document.addEventListener('keydown', stop);

    // Firefox уводит всю страницу на ошибку «адрес не понят», если перейти на неизвестную схему, поэтому через скрытую рамку
    const launch = () => {
        if (/firefox/i.test(navigator.userAgent)) {
            const frame = document.createElement('iframe');
            frame.hidden = true;
            frame.src = app;
            document.body.append(frame);
        } else {
            location.href = app;
        }
    };
    if (appLink) {
        appLink.addEventListener('click', (event) => {
            event.preventDefault();
            stop();
            left = false;
            launch();
            // Клиент или диалог браузера забрали бы фокус; не забрали значит клиента нет
            setTimeout(() => {
                if (left || !document.hasFocus()) return;
                say(text.failed);
                location.href = RELEASES;
            }, 1500);
        });
    }

    say(text.countdown(remaining));
    launch();
    const timer = setInterval(() => {
        if (left || stopped) {
            clearInterval(timer);
            if (left && !stopped) say(text.idle);
            return;
        }
        remaining -= 1;
        if (remaining > 0) {
            say(text.countdown(remaining));
            return;
        }
        clearInterval(timer);
        if (document.hasFocus()) location.replace(web);
        else say(text.idle);
    }, 1000);
})();
