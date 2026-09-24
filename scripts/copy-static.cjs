// Кладёт рядом со скомпилированным кодом статические файлы шапки и панели настроек: tsc их не переносит
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
fs.cpSync(path.join(root, 'src', 'header'), path.join(root, 'tsc', 'header'), { recursive: true });

const updateSource = path.join(root, 'src', 'update');
const updateTarget = path.join(root, 'tsc', 'update');
fs.mkdirSync(updateTarget, { recursive: true });
for (const name of fs.readdirSync(updateSource)) {
    if (/\.(html|css|js)$/.test(name)) fs.copyFileSync(path.join(updateSource, name), path.join(updateTarget, name));
}

const settingsSource = path.join(root, 'src', 'settings');
const settingsTarget = path.join(root, 'tsc', 'settings');
fs.mkdirSync(settingsTarget, { recursive: true });
for (const name of fs.readdirSync(settingsSource)) {
    if (/\.(html|css|js)$/.test(name)) fs.copyFileSync(path.join(settingsSource, name), path.join(settingsTarget, name));
}
