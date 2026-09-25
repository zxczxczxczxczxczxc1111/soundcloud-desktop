const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { performance } = require('node:perf_hooks');

module.exports = async function librarySmoke() {
    const { LibraryService } = require('../tsc/services/libraryService');
    const dir = mkdtempSync(join(tmpdir(), 'sc-library-smoke-'));
    const now = Date.now();
    const date = new Date(now);
    const records = Array.from({ length: 50000 }, (_, i) => JSON.stringify({
        at: now - i * 1000, id: 1 + i % 4000, artist: 1 + i % 300, dur: 200000, pos: 190000, heard: 185000,
        end: 'done', source: 'wave:similar', why: 'similar', liked: false, likedNow: false,
        disliked: false, hiddenArtist: false, genre: 'electronic', tags: 'ambient', v: 2,
        title: 'Synthetic ' + i % 4000, artistName: 'Artist ' + i % 300, path: '/artist/track-' + i % 4000,
    }));
    writeFileSync(join(dir, `signals-77-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}.jsonl`), records.join('\n') + '\n');
    const library = new LibraryService(dir, () => {});
    let beats = 0;
    const heartbeat = setInterval(() => beats++, 10);
    const start = performance.now();
    try {
        assert.equal(await library.request('sync', 77), 50000);
        const syncedMs = performance.now() - start;
        assert.ok(beats > 2, 'main event loop must run while history is indexed');
        assert.equal((await library.request('overview', 77, null, now + 1)).total, 50000);
        assert.ok((await library.request('view', 77)).counted > 0);
        const mix = await library.request('saveMix', 77, 'Smoke mix', [{ id: 42, title: 'Music' }]);
        assert.equal((await library.request('listMixes', 77))[0].id, mix.id);
        assert.deepEqual(await library.request('listMixes', 78), []);
        // Хранилище рекомендаций в SQLite поставляемого Electron: разбор версий, связь каталога, обход с номером прогона
        const uploads = Array.from({ length: 2000 }, (_, i) => ({
            id: 100000 + i, kind: 'track', title: 'Artist ' + (i % 50) + ' - Song ' + i + (i % 3 ? '' : ' (Slowed + Reverb)'), user_id: 1 + i % 50,
            user: { id: 1 + i % 50, username: 'user' + (i % 50) }, duration: 180000 + i, created_at: '2026-09-25T08:38:54Z',
        }));
        const recordStart = performance.now();
        assert.equal(await library.request('recordUploads', 77, uploads), 2000);
        const recordMs = performance.now() - recordStart;
        assert.deepEqual((await library.request('uploads', 77, ['sc:track:100000']))[0].version, ['reverb', 'slowed']);
        const run = await library.request('syncStart', 77, 'likes', false);
        assert.equal(await library.request('syncPage', 77, 'likes', run.run, uploads.slice(0, 200).map((item) => ({ key: 'sc:track:' + item.id })), null), true);
        assert.equal((await library.request('syncFinish', 77, 'likes', run.run, 'complete', '')).status, 'complete');
        assert.equal((await library.request('libraryMembers', 77, 'likes')).length, 200);
        assert.equal(await library.request('syncPage', 77, 'likes', run.run, [], null), false);
        assert.deepEqual(await library.request('libraryMembers', 78, 'likes'), []);
        console.log(`PASS: library worker, 50000 plays in ${Math.round(syncedMs)} ms, main heartbeat ${beats}, account isolation, recommend store 2000 uploads in ${Math.round(recordMs)} ms`);
    } finally {
        clearInterval(heartbeat);
        const closing = library.close();
        assert.equal(library.close(), closing, 'repeated close must await the same worker exit');
        await closing;
        await assert.rejects(library.request('listMixes', 77), /закрыта/);
        rmSync(dir, { recursive: true, force: true });
    }
};
