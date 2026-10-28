const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

function signPackage(directory) {
    const packageDir = path.resolve(directory);
    if (!fs.existsSync(packageDir)) throw new Error(`Нет каталога сборки: ${packageDir}`);
    if (process.env.SKIP_VMP_SIGNING === 'true') {
        console.warn('Тестовая сборка: VMP-подпись явно отключена.');
        return;
    }
    for (const command of ['sign-pkg', 'verify-pkg']) {
        const result = spawnSync(process.env.EVS_PYTHON || 'python',
            ['-m', 'castlabs_evs.vmp', '--no-ask', command, packageDir],
            // Подпись загружает exe на сервер EVS целиком (230 МБ на Electron 43), две минуты на это мало
            { stdio: 'inherit', windowsHide: true, timeout: 900000 });
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(`EVS ${command}: код ${result.status}`);
    }
}
module.exports = (context) => {
    if (context.electronPlatformName !== 'linux') signPackage(context.appOutDir);
};
if (require.main === module) {
    if (!process.argv[2]) throw new Error('Укажите каталог распакованной сборки');
    signPackage(process.argv[2]);
}
