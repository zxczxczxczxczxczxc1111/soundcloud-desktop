import type { Session } from 'electron';
interface BlockingEngine {
    enableBlockingInSession(session: Session): unknown;
    disableBlockingInSession(session: Session): void;
}
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import fetch from 'cross-fetch';

export class AdblockService {
    private blocker: BlockingEngine | null = null;
    private loading: Promise<BlockingEngine> | null = null;
    private revision = 0;
    private active = false;
    constructor(
        private session: Session,
        private cachePath: string,
    ) {}
    public async setEnabled(enabled: boolean): Promise<void> {
        const revision = ++this.revision;
        if (!enabled) {
            if (this.active && this.blocker) this.blocker.disableBlockingInSession(this.session);
            this.active = false;
            return;
        }
        if (!this.loading)
            this.loading = this.load().catch((error: unknown) => {
                this.loading = null;
                throw error;
            });
        const blocker = await this.loading;
        if (revision !== this.revision) return;
        if (!this.active) {
            blocker.enableBlockingInSession(this.session);
            this.active = true;
        }
    }
    private async load(): Promise<BlockingEngine> {
        const { ElectronBlocker, fullLists } = await import('@ghostery/adblocker-electron');
        await mkdir(dirname(this.cachePath), { recursive: true });
        const blocker = await ElectronBlocker.fromLists(
            (url) => fetch(url, { signal: AbortSignal.timeout(15000) }),
            fullLists,
            { enableCompression: true },
            { path: this.cachePath, read: readFile, write: writeFile },
        );
        this.blocker = blocker;
        return blocker;
    }
    public dispose(): void {
        void this.setEnabled(false);
    }
}
