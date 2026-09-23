import type { WebContents } from 'electron';

interface RecoveryActions {
    isQuitting(): boolean;
    onCrash(): void;
    onRepeatedCrash(): void;
}
export function installRendererRecovery(contents: WebContents, actions: RecoveryActions): void {
    let lastRecovery = -Infinity;
    contents.on('render-process-gone', (_event, details) => {
        if (actions.isQuitting() || details.reason === 'clean-exit') return;
        actions.onCrash();
        const now = Date.now();
        if (now - lastRecovery <= 60000) {
            actions.onRepeatedCrash();
            return;
        }
        lastRecovery = now;
        // Electron 41 падает при reload внутри незавершённого teardown renderer.
        setImmediate(() => {
            if (!actions.isQuitting() && !contents.isDestroyed()) contents.reload();
        });
    });
}
