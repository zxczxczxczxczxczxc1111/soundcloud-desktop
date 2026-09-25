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
        // Вкус по 50000 прослушиваниям и лайкам из хранилища: участники из названий лайков доходят до профиля
        await library.request('invalidate', 77, []);
        const tasteStart = performance.now();
        const profile = await library.request('profile', 77);
        const tasteMs = performance.now() - tasteStart;
        assert.ok(profile.tracks.length > 0 && profile.artists.length > 0);
        assert.ok(profile.credits.some(([key]) => key === 'artist0'), 'liked uploads must feed credits');
        // Радар: 20000 свежих загрузок аккаунтов из вкуса, план обхода, выпуск один раз за период
        const fresh = new Date(now - 2 * 86400000).toISOString();
        const releases = Array.from({ length: 20000 }, (_, i) => ({
            id: 200000 + i, kind: 'track', title: 'Release ' + i, user_id: 1 + i % 300, user: { id: 1 + i % 300, username: 'Artist ' + i % 300 },
            duration: 150000 + i * 7, created_at: fresh, genre: 'electronic',
        }));
        for (let i = 0; i < releases.length; i += 5000) await library.request('recordUploads', 77, releases.slice(i, i + 5000));
        const plan = await library.request('radarPlan', 77);
        assert.ok(plan.some((source) => source.kind === 'user') && plan.some((source) => source.kind === 'search' && /^Artist \d+$/.test(source.q)), 'taste curators and credits must be radar sources');
        for (const source of plan) assert.equal(await library.request('catalogChecked', 77, source.key, '', 'ok', '', 1), true);
        const cutoff = now - 3600000;
        assert.deepEqual(await library.request('radarStatus', 77, '2026-09-25', cutoff), { published: false, started: 0 });
        assert.ok((await library.request('radarTask', 77, '2026-09-25', cutoff, 'Europe/Moscow')).started > 0);
        const radarStart = performance.now();
        const built = await library.request('radarBuild', 77, '2026-09-25', cutoff, false, false);
        const radarMs = performance.now() - radarStart;
        assert.equal(built.published, true);
        assert.equal(built.edition.status, 'complete');
        assert.equal(built.edition.items.length, 50);
        assert.equal((await library.request('radarBuild', 77, '2026-09-25', cutoff, true, false)).published, false);
        assert.equal((await library.request('radarEditions', 77)).length, 1);
        assert.equal((await library.request('radarEdition', 77, '2026-09-25')).items.length, 50);
        console.log(`PASS: library worker, 50000 plays in ${Math.round(syncedMs)} ms, main heartbeat ${beats}, account isolation, recommend store 2000 uploads in ${Math.round(recordMs)} ms, taste in ${Math.round(tasteMs)} ms, radar of 20000 uploads from ${plan.length} sources in ${Math.round(radarMs)} ms`);
    } finally {
        clearInterval(heartbeat);
        const closing = library.close();
        assert.equal(library.close(), closing, 'repeated close must await the same worker exit');
        await closing;
        await assert.rejects(library.request('listMixes', 77), /закрыта/);
        rmSync(dir, { recursive: true, force: true });
    }
};
