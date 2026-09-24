const { app, BrowserWindow, WebContentsView, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');

app.setPath('userData', path.join(app.getPath('temp'), 'soundcloud-desktop-smoke'));
process.on('uncaughtException', (error) => {
    console.error(error);
    app.exit(1);
});
process.on('unhandledRejection', (error) => {
    console.error(error);
    app.exit(1);
});

app.whenReady().then(async () => {
    // Локальные проверки не должны ждать сторонний сервер шрифтов.
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://assets.web.soundcloud.cloud/*'] }, (_details, callback) => callback({ cancel: true }));
    const { ViewStyles } = require('../tsc/services/viewStyles');
    const { SettingsManager } = require('../tsc/settings/settingsManager');
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await win.loadURL('data:text/html,<body>Theme test</body>');
    const styles = new ViewStyles();
    for (const css of [
        '/* ${globalThis.__themeProbe = true} */ body{color:rgb(1, 2, 3)}',
        'body{color:rgb(1, 2, 3)} /* `;globalThis.__themeProbe = true;// */',
    ]) {
        await styles.apply(win.webContents, css);
        const state = await win.webContents.executeJavaScript(
            '({marker:globalThis.__themeProbe === true,color:getComputedStyle(document.body).color})',
        );
        assert.deepEqual(state, { marker: false, color: 'rgb(1, 2, 3)' });
    }
    const { installRendererRecovery } = require('../tsc/services/rendererRecovery');
    let crashes = 0, repeated = 0;
    installRendererRecovery(win.webContents, { isQuitting: () => false, onCrash: () => crashes++, onRepeatedCrash: () => repeated++ });
    const reloaded = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Renderer recovery timeout')), 10000);
        win.webContents.once('did-finish-load', () => { clearTimeout(timeout); resolve(); });
    });
    win.webContents.forcefullyCrashRenderer();
    await reloaded;
    assert.equal(crashes, 1);
    assert.equal(repeated, 0);
    assert.equal(await win.webContents.executeJavaScript('document.body.textContent'), 'Theme test');
    console.log('PASS: CSS and renderer recovery');
    const store = { get: (_key, fallback) => fallback };
    let focusRestores = 0;
    const manager = new SettingsManager(win, store, () => { focusRestores++; win.webContents.focus(); });
    const empty = {
        title: '',
        author: '',
        artwork: '',
        duration: '',
        elapsed: '',
        isPlaying: false,
        isLiked: false,
        url: '',
    };
    const responses = {
        'get-translations': {},
        'get-custom-themes': [],
        'get-plugins': [],
        'get-current-custom-theme': 'none',
        'get-current-track': empty,
        'get-accounts': { accounts: [], currentAccountId: 'default' },
        'get-update-state': { mode: 'dev', version: '0.0.0', enabled: true, hint: '', status: '', releaseUrl: '' },
        'get-wave-exclusions': { tracks: [], artists: [] },
    };
    const { isTrustedLocalSender } = require('../tsc/trustedViews');
    for (const [channel, data] of Object.entries(responses)) ipcMain.handle(channel, (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Untrusted sender');
        return data;
    });
    const untrusted = new BrowserWindow({ show: false, webPreferences: {
        sandbox: true, contextIsolation: true, preload: path.resolve(__dirname, '../tsc/settings/settingsPreload.js'),
    } });
    await untrusted.loadURL('data:text/html,<body>Untrusted</body>');
    assert.equal(await untrusted.webContents.executeJavaScript("settingsAPI.invoke('get-current-track').then(() => false, () => true)"), true);
    untrusted.destroy();
    ipcMain.on('toggle-settings', () => manager.toggle());
    assert.equal(manager.getView(), null);
    const closedListeners = win.listenerCount('closed');
    for (let i = 0; i < 30; i++) {
        const ready = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Settings ready timeout')), 10000);
            ipcMain.once('settings-ready', () => {
                clearTimeout(timeout);
                resolve();
            });
        });
        manager.toggle();
        await ready;
        const view = manager.getView();
        assert.equal(await view.webContents.executeJavaScript('!!document.getElementById("close-settings")'), true);
        const closed = new Promise((resolve) => view.webContents.once('destroyed', resolve));
        manager.toggle();
        await closed;
        assert.equal(manager.getView(), null);
        assert.equal(focusRestores, i + 1);
        assert.equal(win.listenerCount('closed'), closedListeners);
    }
    console.log('PASS: settings lifecycle');
    manager.dispose();
    const { showHomepageConfirmDialog } = require('../tsc/settings/confirmPopup');
    for (const accept of [false, true]) {
        const texts = { title: 'Страница плагина', question: 'Открыть этот адрес в браузере?', cancel: 'Отмена', open: 'Открыть в браузере' };
        const confirmed = showHomepageConfirmDialog(win, 'https://example.com/?q=<script>alert(1)</script>', texts);
        const view = win.contentView.children.at(-1);
        await new Promise(resolve => view.webContents.once('did-finish-load', resolve));
        assert.equal(await view.webContents.executeJavaScript("document.querySelector('.url').textContent.includes('<script>')"), true);
        // Нажатие уничтожает view: ответ executeJavaScript может уже не вернуться.
        void view.webContents.executeJavaScript(`document.getElementById('${accept ? 'confirmBtn' : 'cancelBtn'}').click()`)
            .catch(error => { if (!view.webContents.isDestroyed()) throw error; });
        assert.equal(await confirmed, accept);
        assert.equal(win.listenerCount('closed'), closedListeners);
    }
    console.log('PASS: dialogs');
    const { UpdateScreen } = require('../tsc/update/updateScreen');
    const updateScreen = new UpdateScreen(win, 32);
    const updateView = win.contentView.children.at(-1);
    const screenState = { title: 'Обновление до версии 9.9.9', status: 'Загружаю: 42%', percent: 42, later: 'Позже', installing: false, dark: true };
    updateScreen.show(screenState);
    await new Promise(resolve => updateView.webContents.once('did-finish-load', resolve));
    const readScreen = () => updateView.webContents.executeJavaScript(
        "({ title: document.getElementById('title').textContent, status: document.getElementById('status').textContent, width: document.getElementById('fill').style.width, later: document.getElementById('later').hidden, now: document.querySelector('[role=progressbar]').getAttribute('aria-valuenow') })",
    );
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(await readScreen(), { title: 'Обновление до версии 9.9.9', status: 'Загружаю: 42%', width: '42%', later: false, now: '42' });
    assert.equal(updateScreen.owns(updateView.webContents), true);
    assert.equal(updateView.getBounds().y, 32);
    const laterPressed = new Promise(resolve => ipcMain.once('update-screen-later', event => resolve(isTrustedLocalSender(event))));
    await updateView.webContents.executeJavaScript("document.getElementById('later').click()");
    assert.equal(await laterPressed, true);
    updateScreen.show({ ...screenState, status: 'Устанавливаю и перезапускаю', percent: 100, installing: true });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal((await readScreen()).later, true);
    const screenClosed = new Promise(resolve => updateView.webContents.once('destroyed', resolve));
    updateScreen.close();
    await screenClosed;
    assert.equal(win.contentView.children.includes(updateView), false);
    console.log('PASS: update screen');
    const { NotificationManager } = require('../tsc/notifications/notificationManager');
    const notifications = new NotificationManager(win);
    notifications.show('<img src=x onerror="globalThis.injected=true">');
    const notification = win.contentView.children.at(-1);
    await new Promise(resolve => notification.webContents.once('did-finish-load', resolve));
    assert.equal(await notification.webContents.executeJavaScript('document.querySelectorAll("img").length'), 0);
    const notificationClosed = new Promise(resolve => notification.webContents.once('destroyed', resolve));
    void notification.webContents.executeJavaScript('notificationAPI.done()')
        .catch(error => { if (!notification.webContents.isDestroyed()) throw error; });
    await notificationClosed;
    notifications.dispose();
    console.log('PASS: notifications');
    const { pluginInjection, pluginCleanup } = require('../tsc/services/pluginScripts');
    await win.webContents.executeJavaScript(pluginInjection("quote'plugin", 'globalThis.pluginLoaded = true;'));
    assert.equal(await win.webContents.executeJavaScript('globalThis.pluginLoaded'), true);
    await win.webContents.executeJavaScript(pluginCleanup("quote'plugin"));
    const { PluginProcess } = require('../tsc/services/pluginProcess');
    const failures = [];
    const worker = new PluginProcess((error) => failures.push(error.message));
    const code = await worker.request({ kind: 'load', filename: 'test-plugin.js', source: 'let count = 0; module.exports = { contentScript: () => "/* test */", onTrackChange: () => ++count };' });
    assert.equal(code, '/* test */');
    assert.equal(await worker.request({ kind: 'track', track: {} }), 1);
    await worker.dispose();
    assert.equal(failures.length, 0);
    const stuck = new PluginProcess((error) => failures.push(error.message));
    await stuck.request({ kind: 'load', filename: 'stuck-plugin.js', source: 'module.exports = { onTrackChange: () => { while (true) {} } };' });
    await assert.rejects(stuck.request({ kind: 'track', track: {} }), /остановлен/);
    assert.equal(failures.length, 1);
    console.log('PASS: plugin processes');
    const http = require('node:http');
    const { ProxyService } = require('../tsc/services/proxyService');
    let authenticated = false;
    const proxy = http.createServer((request, response) => {
        if (request.headers['proxy-authorization'] !== 'Basic ' + Buffer.from('fixture:password').toString('base64')) {
            response.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="fixture"' });
            response.end();
            return;
        }
        authenticated = true;
        response.end('<body>proxy fixture</body>');
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const proxyWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, partition: 'proxy-test-' + Date.now() } });
    const values = new Map(Object.entries({ proxyEnabled: true, proxyHost: '127.0.0.1', proxyPort: String(proxy.address().port), proxyUsername: 'fixture' }));
    const proxyService = new ProxyService(proxyWindow.webContents, {
        get: (key, fallback) => values.has(key) ? values.get(key) : fallback,
        set: (key, value) => values.set(key, value), delete: key => values.delete(key),
    }, message => { throw new Error(message); });
    try {
        proxyService.setPassword('password');
        assert.notEqual(values.get('proxyPasswordEncrypted'), 'password');
        await proxyService.apply();
        await Promise.race([proxyWindow.loadURL('http://proxy-fixture.invalid/'), new Promise((_, reject) => setTimeout(() => reject(new Error('Proxy page timeout')), 20000).unref())]);
        assert.equal(authenticated, true);
        assert.equal(await proxyWindow.webContents.executeJavaScript('document.body.textContent'), 'proxy fixture');
        values.set('proxyEnabled', false);
        await proxyService.apply();
        assert.equal(await proxyWindow.webContents.session.resolveProxy('https://example.com'), 'DIRECT');
    } finally {
        proxyService.dispose();
        proxyWindow.destroy();
        await new Promise(resolve => proxy.close(resolve));
    }
    // Свёрнутое в трей окно возвращается с живой страницей: при restore() раньше show() она оставалась скрытой
    const { revealWindow } = require('../tsc/services/revealWindow');
    const trayWindow = new BrowserWindow({ width: 320, height: 240, webPreferences: { sandbox: true } });
    const trayPage = new WebContentsView({ webPreferences: { sandbox: true } });
    trayWindow.contentView.addChildView(trayPage);
    trayPage.setBounds({ x: 0, y: 0, width: 320, height: 240 });
    await trayPage.webContents.loadURL('data:text/html,<body>tray</body>');
    const visibility = async (expected) => {
        for (let attempt = 0; attempt < 30; attempt++) {
            const state = await trayPage.webContents.executeJavaScript('document.visibilityState');
            if (state === expected) return state;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return trayPage.webContents.executeJavaScript('document.visibilityState');
    };
    try {
        for (let run = 0; run < 2; run++) {
            trayWindow.minimize();
            trayWindow.hide();
            assert.equal(await visibility('hidden'), 'hidden');
            revealWindow(trayWindow);
            assert.equal(await visibility('visible'), 'visible');
        }
    } finally {
        trayWindow.destroy();
    }
    console.log('PASS: window restored from tray');
    win.destroy();
    console.log('PASS: CSS boundary, 30 settings cycles, quoted plugin ID, isolated plugin callbacks and hung worker termination, IPC rejection, dialogs, proxy authentication and disable.');
    app.quit();
});
