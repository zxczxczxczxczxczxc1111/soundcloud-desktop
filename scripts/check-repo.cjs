const { execFileSync } = require('node:child_process');
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const forbidden = files.filter(file => /(^|\/)(docs|pamyat|analysis|artifacts|node_modules|build|tsc|\.codex|\.claude)(\/|$)/i.test(file) ||
    /(^|\/)(AGENTS|PLAN|STATE|BACKLOG|RAZBOR)\.md$/i.test(file) || /(^|\/)\.env($|\.)/i.test(file) ||
    (/\.(md|txt)$/i.test(file) && !/^(README\.md|LICENSE(?:\.txt)?)$/i.test(file)) || /\.(pem|pfx|p12|key|log)$/i.test(file));
if (forbidden.length) { console.error('Лишние файлы в репозитории:\n' + forbidden.join('\n')); process.exitCode = 1; }
else console.log('Состав репозитория проверен');
