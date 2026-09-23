const { spawn } = require('node:child_process');
const path = require('node:path');
const executable = require('electron');
const entry = path.resolve(process.argv[2] || 'scripts/electron-smoke.cjs');
const child = spawn(executable, [entry], { stdio: 'inherit', windowsHide: true });
const timeout = setTimeout(() => { console.error('Превышено время проверки Electron'); child.kill(); }, 120000);
child.on('error', (error) => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
child.on('exit', (code) => { clearTimeout(timeout); process.exitCode = code === 0 ? 0 : 1; });
