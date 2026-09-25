import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import type { HistoryIndex } from './historyIndex';
import type { TasteService, TasteMark } from './tasteModel';
import type { PlaybackStore } from './playbackStore';
import type { RecommendStore } from './recommendStore';
import type { RadarService } from './radar';

type Operation<F extends (...args: never[]) => unknown> = { args: Parameters<F>; result: ReturnType<F> };
export interface LibraryOperations {
    sync: Operation<HistoryIndex['sync']>;
    overview: Operation<HistoryIndex['overview']>;
    day: Operation<HistoryIndex['day']>;
    neighbors: Operation<HistoryIndex['neighbors']>;
    search: Operation<HistoryIndex['search']>;
    missing: Operation<HistoryIndex['missing']>;
    resolve: Operation<HistoryIndex['resolve']>;
    tastePlays: Operation<HistoryIndex['tastePlays']>;
    profile: Operation<TasteService['profile']>;
    view: Operation<TasteService['view']>;
    setRemoved: Operation<TasteService['setRemoved']>;
    invalidate: { args: [userId: number, marks: TasteMark[]]; result: void };
    loadSession: Operation<PlaybackStore['loadSession']>;
    saveSession: Operation<PlaybackStore['saveSession']>;
    loadCatalog: Operation<PlaybackStore['loadCatalog']>;
    saveCatalog: Operation<PlaybackStore['saveCatalog']>;
    listMixes: Operation<PlaybackStore['listMixes']>;
    saveMix: Operation<PlaybackStore['saveMix']>;
    removeMix: Operation<PlaybackStore['removeMix']>;
    recordUploads: Operation<RecommendStore['recordUploads']>;
    uploads: Operation<RecommendStore['uploads']>;
    recordingLinks: Operation<RecommendStore['recordingLinks']>;
    setRecordingLink: Operation<RecommendStore['setRecordingLink']>;
    syncStart: Operation<RecommendStore['syncStart']>;
    syncPage: Operation<RecommendStore['syncPage']>;
    syncFinish: Operation<RecommendStore['syncFinish']>;
    syncState: Operation<RecommendStore['syncState']>;
    libraryMembers: Operation<RecommendStore['libraryMembers']>;
    catalogChecked: Operation<RecommendStore['catalogChecked']>;
    radarPlan: Operation<RadarService['plan']>;
    radarStatus: Operation<RecommendStore['radarStatus']>;
    radarTask: Operation<RecommendStore['radarTask']>;
    radarBuild: Operation<RadarService['build']>;
    radarEditions: Operation<RecommendStore['editions']>;
    radarEdition: Operation<RecommendStore['edition']>;
    radarView: Operation<RadarService['view']>;
    radarFound: Operation<RadarService['found']>;
}
export type LibraryRequest = { [K in keyof LibraryOperations]: { id: number; method: K; args: LibraryOperations[K]['args'] } }[keyof LibraryOperations];
export interface LibraryReply { id: number; value?: unknown; error?: string }

// Единственный владелец SQLite живёт в worker. Главный поток только передаёт команды и получает готовые данные.
export class LibraryService {
    private worker: Worker | null = null;
    private sequence = 0;
    private closed = false;
    private closing: Promise<void> | null = null;
    private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
    private marks = new Map<number, TasteMark[]>();
    constructor(private directory: string, private flush: () => void, private workerPath = join(__dirname, 'libraryWorker.js')) {}

    private start(): Worker {
        if (this.closed) throw new Error('Библиотека закрыта');
        if (this.worker) return this.worker;
        const worker = new Worker(this.workerPath, { workerData: { directory: this.directory } });
        this.worker = worker;
        worker.on('message', (reply: LibraryReply) => {
            const pending = this.pending.get(reply.id);
            if (!pending) return;
            this.pending.delete(reply.id);
            clearTimeout(pending.timer);
            if (reply.error) pending.reject(new Error(reply.error));
            else pending.resolve(reply.value);
        });
        const fail = (error: Error): void => {
            if (this.worker !== worker) return;
            this.worker = null;
            for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
            this.pending.clear();
            void worker.terminate().catch((cause: unknown) => console.warn('Worker библиотеки не остановлен', cause));
        };
        worker.on('error', fail);
        worker.on('exit', (code) => fail(new Error('Worker библиотеки остановлен: ' + code)));
        for (const [userId, marks] of this.marks) worker.postMessage({ id: 0, method: 'invalidate', args: [userId, marks] });
        return worker;
    }
    public request<K extends keyof LibraryOperations>(method: K, ...args: LibraryOperations[K]['args']): Promise<LibraryOperations[K]['result']> {
        try {
            if (method === 'sync' || method === 'profile' || method === 'view' || method === 'radarBuild' || method === 'radarView' || method === 'radarFound') this.flush();
            const worker = this.start();
            const id = ++this.sequence;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    this.pending.delete(id);
                    reject(new Error('Библиотека не ответила вовремя'));
                }, 60000);
                this.pending.set(id, { resolve: (value) => resolve(value as LibraryOperations[K]['result']), reject, timer });
                worker.postMessage({ id, method, args });
            });
        } catch (error) {
            return Promise.reject(error);
        }
    }
    public invalidate(userId: unknown, marks: TasteMark[]): void {
        if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) return;
        this.marks.set(userId, marks);
        if (this.worker) void this.request('invalidate', userId, marks).catch((error: unknown) => console.warn('Вкус не обновлён', error));
    }
    public close(): Promise<void> {
        if (this.closing) return this.closing;
        this.closed = true;
        const worker = this.worker;
        this.worker = null;
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Библиотека закрыта')); }
        this.pending.clear();
        if (!worker || worker.threadId === -1) return this.closing = Promise.resolve();
        this.closing = new Promise<void>((resolve, reject) => {
            // Сначала закрываем SQLite и порт естественным путём. Принудительная остановка только для зависшего worker.
            const timer = setTimeout(() => {
                console.warn('Worker библиотеки не завершился за 5 секунд');
                void worker.terminate().catch(reject);
            }, 5000);
            worker.once('exit', (code) => {
                clearTimeout(timer);
                if (code === 0) resolve();
                else reject(new Error('Worker библиотеки завершился с кодом ' + code));
            });
            worker.postMessage({ method: 'close' });
        });
        return this.closing;
    }
}
