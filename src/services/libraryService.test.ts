import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { LibraryService } from './libraryService';

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) {
        if (!root.startsWith(join(tmpdir(), 'sc-library-'))) throw new Error('Неожиданная папка теста');
        rmSync(root, { recursive: true, force: true });
    }
});
// Тестовый поток: первый запуск молчит, как зависший на долгом запросе; следующий отвечает на всё
function hangingOnce(): { directory: string; script: string } {
    const directory = mkdtempSync(join(tmpdir(), 'sc-library-'));
    roots.push(directory);
    const script = join(directory, 'worker.cjs');
    writeFileSync(script, [
        "const { parentPort, workerData } = require('node:worker_threads');",
        "const fs = require('node:fs'); const path = require('node:path');",
        "const marker = path.join(workerData.directory, 'started');",
        'const answers = fs.existsSync(marker);',
        "fs.writeFileSync(marker, '1');",
        'parentPort.on(\'message\', (message) => {',
        "    if (message.method === 'close') { parentPort.close(); return; }",
        "    if (answers && message.id) parentPort.postMessage({ id: message.id, value: 'ok' });",
        '});',
    ].join('\n'));
    return { directory, script };
}

it('после двух тайм-аутов подряд зависший поток заменяется, следующий запрос идёт в новый', async () => {
    const { directory, script } = hangingOnce();
    const library = new LibraryService(directory, () => undefined, script, 200);
    try {
        await expect(library.request('syncState', 77)).rejects.toThrow('вовремя');
        await expect(library.request('syncState', 77)).rejects.toThrow('вовремя');
        // Раньше поток оставался прежним, и все следующие запросы ждали за зависшим
        await expect(library.request('syncState', 77)).resolves.toBe('ok');
    } finally {
        await library.close();
    }
});

it('посреди копии поток не перезапускается: у неё свой предел и откат', async () => {
    const { directory, script } = hangingOnce();
    const library = new LibraryService(directory, () => undefined, script, 200);
    const copy = library.request('backupSave', join(directory, 'x.scbackup'), {}, { version: '0', build: '' }, 0).catch((error: unknown) => error);
    try {
        await expect(library.request('syncState', 77)).rejects.toThrow('вовремя');
        await expect(library.request('syncState', 77)).rejects.toThrow('вовремя');
        await expect(library.request('syncState', 77)).rejects.toThrow('вовремя');
    } finally {
        await library.close();
    }
    expect(await copy).toBeInstanceOf(Error);
});
