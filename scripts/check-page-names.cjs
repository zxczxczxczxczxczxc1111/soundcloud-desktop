// Скрипты страницы уходят на сайт текстом функций: имя, не объявленное внутри текста (импорт модуля, константа снаружи
// функции), на странице превращается в ReferenceError в той ветке, где встретится. Проверяется ровно собранный tsc текст:
// компилятор читает его как JS с библиотекой браузера и перечисляет необъявленные имена. Новый скрипт страницы добавлять в список
const path = require('node:path');
const ts = require('typescript');

const services = path.resolve(__dirname, '..', 'tsc', 'services');
const load = (name) => require(path.join(services, name));
const scripts = [
    ['audioMonitor', () => load('audioMonitorService').audioMonitorScript],
    ['fullShuffle', () => load('fullShuffle').fullShuffleScript(true)],
    ['homeBlocks', () => load('homeBlocks').homePageScript()],
    ['mediaControls', () => load('mediaControls').mediaControlsScript],
    ['pageFeatures', () => load('pageFeatures').pageFeaturesScript(true)],
    ['pageMotion', () => load('pageMotion').pageMotionScript(false)],
    ['playbackController', () => '(' + load('playbackController').executePageCommand.toString() + ')({"type":"toggle"});'],
    ['playerArea', () => load('playerArea').playerAreaScript()],
    ['wave', () => load('wave').waveScript()],
];
// Проверка самой проверки: имя из модуля и константа снаружи, как их отдал бы tsc
const CONTROL = '(function install(){ const x = identity_1.copyKey(1); return helper(x) + missingConst; })();';
const CONTROL_NAMES = ['identity_1', 'helper', 'missingConst'];
// Не найдено имя, похожее имя, require/module/process из Node на странице
const CODES = new Set([2304, 2552, 2580, 2591, 2662, 2663]);
const options = {
    allowJs: true, checkJs: true, noEmit: true, target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: [],
};

function undeclared(name, text) {
    const fileName = '/page/' + name + '.js';
    const host = ts.createCompilerHost(options);
    const getSourceFile = host.getSourceFile.bind(host);
    const fileExists = host.fileExists.bind(host);
    host.getSourceFile = (file, version) => file === fileName ? ts.createSourceFile(file, text, version, true, ts.ScriptKind.JS) : getSourceFile(file, version);
    host.fileExists = (file) => file === fileName || fileExists(file);
    const program = ts.createProgram([fileName], options, host);
    const source = program.getSourceFile(fileName);
    const found = new Map();
    for (const diagnostic of program.getSemanticDiagnostics(source)) {
        if (!CODES.has(diagnostic.code) || diagnostic.start === undefined) continue;
        const word = text.slice(diagnostic.start, diagnostic.start + diagnostic.length);
        if (!found.has(word)) {
            const { line } = source.getLineAndCharacterOfPosition(diagnostic.start);
            found.set(word, text.split('\n')[line].trim().slice(0, 140));
        }
    }
    return found;
}

let failed = false;
const control = undeclared('control', CONTROL);
const missed = CONTROL_NAMES.filter((word) => !control.has(word));
if (missed.length) {
    console.error('Проверка имён не поймала заведомо сломанный кусок: ' + missed.join(', '));
    failed = true;
}
for (const [name, build] of scripts) {
    let text;
    try {
        text = build();
    } catch (error) {
        console.error(name + ': скрипт не собран: ' + (error instanceof Error ? error.message : String(error)));
        failed = true;
        continue;
    }
    if (typeof text !== 'string' || !text) {
        console.error(name + ': скрипт пустой');
        failed = true;
        continue;
    }
    const found = undeclared(name, text);
    for (const [word, place] of found) console.error(name + ': необъявленное имя ' + word + ': ' + place);
    if (found.size) failed = true;
}
if (failed) process.exitCode = 1;
else console.log('Скрипты страницы проверены: ' + scripts.length + ', необъявленных имён нет');
