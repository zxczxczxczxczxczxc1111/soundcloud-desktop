const { execFileSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const build = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
mkdirSync('tsc', { recursive: true });
writeFileSync('tsc/build-info.json', JSON.stringify({ build, dirty }) + '\n');
