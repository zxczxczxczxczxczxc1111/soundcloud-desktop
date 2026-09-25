import { parentPort, workerData } from 'node:worker_threads';
import { HistoryIndex } from './historyIndex';
import { WaveSignals } from './waveSignals';
import { TasteService, type TasteMark } from './tasteModel';
import { WaveExclusions } from './waveExclusions';
import { PlaybackStore } from './playbackStore';
import { RecommendStore } from './recommendStore';
import { RadarService } from './radar';
import { BackupService } from './backup';
import type { LibraryReply, LibraryRequest } from './libraryService';

const { directory } = workerData as { directory: string };
const index = new HistoryIndex(directory, new WaveSignals(directory));
const playback = new PlaybackStore(directory);
const recommend = new RecommendStore(directory);
const overrides = new Map<number, TasteMark[]>();
const taste = new TasteService(directory, index, (userId) => overrides.get(userId) ?? new WaveExclusions(directory).load(userId).more.map((entry) => ({
    id: entry.id, artist: entry.artistId ?? 0, genre: entry.genre ?? '', tags: entry.tags ?? '', at: entry.at,
})), (userId, played) => recommend.tasteLibrary(userId, played));
const radar = new RadarService(recommend, index, taste, (userId) => new WaveExclusions(directory).load(userId));
const backup = new BackupService(directory, { playback, recommend, index, taste });
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
        case 'recordUploads': return recommend.recordUploads(...request.args);
        case 'uploads': return recommend.uploads(...request.args);
        case 'recordingLinks': return recommend.recordingLinks(...request.args);
        case 'setRecordingLink': return recommend.setRecordingLink(...request.args);
        case 'syncStart': return recommend.syncStart(...request.args);
        case 'syncPage': return recommend.syncPage(...request.args);
        case 'syncFinish': return recommend.syncFinish(...request.args);
        case 'syncState': return recommend.syncState(...request.args);
        case 'libraryMembers': return recommend.libraryMembers(...request.args);
        case 'catalogChecked': return recommend.catalogChecked(...request.args);
        case 'radarPlan': return radar.plan(...request.args);
        case 'radarStatus': return recommend.radarStatus(...request.args);
        case 'radarTask': return recommend.radarTask(...request.args);
        case 'radarBuild': return radar.build(...request.args);
        case 'radarEditions': return recommend.editions(...request.args);
        case 'radarEdition': return recommend.edition(...request.args);
        case 'radarView': return radar.view(...request.args);
        case 'radarFound': return radar.found(...request.args);
        case 'backupSave': return backup.save(...request.args);
        case 'backupInspect': return backup.inspect(...request.args);
        case 'backupRestore': return backup.restore(...request.args);
        case 'backupRollback': return backup.rollback();
        case 'backupFinish': return backup.finish(...request.args);
    }
}
parentPort?.on('message', (request: LibraryRequest | { method: 'close' }) => {
    if (request.method === 'close') {
        index.close();
        recommend.close();
        parentPort?.close();
        return;
    }
    let reply: LibraryReply;
    try { reply = { id: request.id, value: run(request) }; }
    catch (error) { reply = { id: request.id, error: error instanceof Error ? error.message : String(error) }; }
    parentPort?.postMessage(reply);
});
parentPort?.on('close', () => {
    index.close();
    recommend.close();
});
