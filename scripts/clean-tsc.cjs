// Чистит каталог сборки перед упаковкой: tsc пишет поверх старого, и файлы, удалённые из src, иначе попадают в пакет
const fs = require('node:fs');
const path = require('node:path');

fs.rmSync(path.resolve(__dirname, '..', 'tsc'), { recursive: true, force: true });
