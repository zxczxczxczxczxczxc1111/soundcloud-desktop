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
        console.log(`PASS: library worker, 50000 plays in ${Math.round(syncedMs)} ms, main heartbeat ${beats}, account isolation`);
    } finally {
        clearInterval(heartbeat);
        const closing = library.close();
        assert.equal(library.close(), closing, 'repeated close must await the same worker exit');
        await closing;
        await assert.rejects(library.request('listMixes', 77), /закрыта/);
        rmSync(dir, { recursive: true, force: true });
    }
};
