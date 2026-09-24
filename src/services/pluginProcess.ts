import { utilityProcess, type UtilityProcess } from 'electron';
import { join } from 'path';

export type PluginCommand = { kind: 'load'; source: string; filename: string } | { kind: 'track'; track: Record<string, unknown> } | { kind: 'disable' };

export class PluginProcess {
    private child: UtilityProcess;
    private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
    private sequence = 0;
    private closed = false;
    private trackBusy = false;
    private latestTrack: Record<string, unknown> | null = null;

    constructor(private failure: (error: Error) => void) {
        this.child = utilityProcess.fork(join(__dirname, 'pluginWorker.js'), [], { serviceName: 'SoundCloud plugin', stdio: 'pipe' });
        this.child.on('message', (message: unknown) => {
            if (!message || typeof message !== 'object') return;
            const reply = message as Record<string, unknown>;
            if (typeof reply.id !== 'number') return;
            const request = this.pending.get(reply.id);
            if (!request) return;
            clearTimeout(request.timer);
            this.pending.delete(reply.id);
            if (reply.ok === true) request.resolve(reply.value);
            else request.reject(new Error(typeof reply.error === 'string' ? reply.error : 'Ошибка плагина'));
        });
        this.child.on('exit', (code) => { if (!this.closed) this.fail(new Error('Процесс плагина завершился: ' + code)); });
        this.child.stderr?.on('data', (data: Buffer) => console.error('Плагин:', data.toString().slice(0, 4096)));
        this.child.stdout?.on('data', (data: Buffer) => console.log('Плагин:', data.toString().slice(0, 4096)));
    }
    public request(command: PluginCommand): Promise<unknown> {
        if (this.closed) return Promise.reject(new Error('Плагин остановлен'));
        const id = ++this.sequence;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => this.fail(new Error('Плагин не отвечает')), 3000);
            this.pending.set(id, { resolve, reject, timer });
            try { this.child.postMessage({ id, command }); }
            catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
        });
    }
    public notifyTrack(track: Record<string, unknown>): void {
        this.latestTrack = track;
        if (!this.trackBusy) void this.drainTracks();
    }
    private async drainTracks(): Promise<void> {
        this.trackBusy = true;
        try {
            while (this.latestTrack && !this.closed) {
                const track = this.latestTrack;
                this.latestTrack = null;
                await this.request({ kind: 'track', track });
            }
        } catch (error) { if (!this.closed) this.fail(error instanceof Error ? error : new Error(String(error))); }
        finally { this.trackBusy = false; }
    }
    private terminate(): void {
        this.closed = true;
        this.latestTrack = null;
        for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Плагин остановлен')); }
        this.pending.clear();
        this.child.kill();
    }
    private fail(error: Error): void {
        if (this.closed) return;
        this.terminate();
        this.failure(error);
    }
    public async dispose(): Promise<void> {
        if (this.closed) return;
        try { await this.request({ kind: 'disable' }); }
        catch (error) { if (!this.closed) console.error('Ошибка остановки плагина:', error); }
        finally { if (!this.closed) this.terminate(); }
    }
}
