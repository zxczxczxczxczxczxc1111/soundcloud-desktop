import { parentPort, workerData } from 'node:worker_threads';
import { HistoryIndex } from './historyIndex';
import { WaveSignals } from './waveSignals';
import { TasteService, type TasteMark } from './tasteModel';
import { WaveExclusions } from './waveExclusions';
import { PlaybackStore } from './playbackStore';
import type { LibraryReply, LibraryRequest } from './libraryService';

const { directory } = workerData as { directory: string };
const index = new HistoryIndex(directory, new WaveSignals(directory));
const playback = new PlaybackStore(directory);
const overrides = new Map<number, TasteMark[]>();
const taste = new TasteService(directory, index, (userId) => overrides.get(userId) ?? new WaveExclusions(directory).load(userId).more.map((entry) => ({
    id: entry.id, artist: entry.artistId ?? 0, genre: entry.genre ?? '', tags: entry.tags ?? '', at: entry.at,
})));
function run(request: LibraryRequest): unknown {
    switch (request.method) {
        case 'sync': return index.sync(...request.args);
        case 'overview': return index.overview(...request.args);
        case 'day': return index.day(...request.args);
        case 'neighbors': return index.neighbors(...request.args);
        case 'search': return index.search(...request.args);
        case 'missing': return index.missing(...request.args);
        case 'resolve': return index.resolve(...request.args);
        case 'tastePlays': return index.tastePlays(...request.args);
        case 'profile': return taste.profile(...request.args);
        case 'view': return taste.view(...request.args);
        case 'setRemoved': return taste.setRemoved(...request.args);
        case 'invalidate': overrides.set(request.args[0], request.args[1]); taste.invalidate(request.args[0]); return;
        case 'loadSession': return playback.loadSession(...request.args);
        case 'saveSession': return playback.saveSession(...request.args);
        case 'loadCatalog': return playback.loadCatalog(...request.args);
        case 'saveCatalog': return playback.saveCatalog(...request.args);
        case 'listMixes': return playback.listMixes(...request.args);
        case 'saveMix': return playback.saveMix(...request.args);
        case 'removeMix': return playback.removeMix(...request.args);
    }
}
parentPort?.on('message', (request: LibraryRequest) => {
    let reply: LibraryReply;
    try { reply = { id: request.id, value: run(request) }; }
    catch (error) { reply = { id: request.id, error: error instanceof Error ? error.message : String(error) }; }
    parentPort?.postMessage(reply);
});
parentPort?.on('close', () => index.close());
