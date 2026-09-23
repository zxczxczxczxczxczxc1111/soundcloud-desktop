const { execFileSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const build = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
mkdirSync('tsc', { recursive: true });
// SC_BUILD_CHANNEL=test помечает тестовую сборку: другое название и иконка, чтобы не спутать с установленной
const channel = process.env.SC_BUILD_CHANNEL === 'test' ? 'test' : 'release';
writeFileSync('tsc/build-info.json', JSON.stringify({ build, dirty, channel }) + '\n');
