const { app, BrowserWindow, ipcMain } = require('electron');
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
    const store = { get: (_key, fallback) => fallback };
    const manager = new SettingsManager(win, store);
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
    };
    for (const [channel, data] of Object.entries(responses)) ipcMain.handle(channel, () => data);
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
        assert.equal(win.listenerCount('closed'), closedListeners);
    }
    manager.dispose();
    win.destroy();
    console.log('PASS: CSS injection blocked; legitimate CSS rendered; 30 settings open/close cycles passed.');
    app.quit();
});
