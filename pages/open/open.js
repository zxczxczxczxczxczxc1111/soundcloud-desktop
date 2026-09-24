'use strict';
// Переходник кнопки «Слушать в SoundCloud» из карточки Discord: пробует открыть трек в клиенте по ссылке soundcloud-desktop://,
// без клиента уводит на soundcloud.com. Понять наверняка, открылся ли клиент, браузер не даёт, поэтому:
// фокус ушёл со страницы (открылся клиент или диалог браузера «Открыть приложение?») значит остаёмся, иначе через 2 с на сайт
(() => {
    const t = new URLSearchParams(location.search).get('t') || '';
    // Только путь публичного трека: иначе страница стала бы открытым редиректом под этим адресом
    const valid = /^[a-z0-9_-]{1,100}\/[a-z0-9_-]{1,255}$/i.test(t);
    const web = valid ? 'https://soundcloud.com/' + t.toLowerCase() : 'https://soundcloud.com/';
    const ru = /^(ru|uk|be|kk)\b/i.test(navigator.language || '');
    const text = ru
        ? { title: 'Открываю трек в клиенте', hint: 'Если клиента нет, через пару секунд откроется сайт', app: 'Открыть в клиенте', web: 'Слушать на soundcloud.com' }
        : { title: 'Opening the track in the app', hint: 'No app? The website opens in a couple of seconds', app: 'Open in the app', web: 'Listen on soundcloud.com' };
    document.documentElement.lang = ru ? 'ru' : 'en';
    for (const id of ['title', 'hint', 'app', 'web']) {
        const node = document.getElementById(id);
        if (node) node.textContent = text[id];
    }
    const webLink = document.getElementById('web');
    const appLink = document.getElementById('app');
    if (webLink) webLink.href = web;
    if (!valid) {
        location.replace(web);
        return;
    }
    const app = 'soundcloud-desktop://track/' + t.toLowerCase();
    if (appLink) appLink.href = app;

    let left = false;
    const leave = () => { left = true; };
    window.addEventListener('blur', leave);
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') leave(); });
    // Firefox уводит всю страницу на ошибку «адрес не понят», если перейти на неизвестную схему, поэтому через скрытую рамку
    if (/firefox/i.test(navigator.userAgent)) {
        const frame = document.createElement('iframe');
        frame.hidden = true;
        frame.src = app;
        document.body.append(frame);
    } else {
        location.href = app;
    }
    setTimeout(() => {
        if (!left && document.hasFocus()) location.replace(web);
    }, 2000);
})();
