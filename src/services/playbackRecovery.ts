import type { SitePlayer } from './wave';
export interface RecoveryHost { player(): SitePlayer | null; refresh(): void; checkpoint(): Promise<void>; language: string }
export interface PlaybackRecovery { tick(): void; resume(): void; dispose(): void }

// Повторяет запуск того же элемента, не заменяя очередь. Явная пауза отменяет попытки.
export function installPlaybackRecovery(host: RecoveryHost): PlaybackRecovery {
    const ru = host.language === 'ru';
    const text = (a: string, b: string): string => ru ? a : b;
    const status = document.createElement('div');
    status.id = 'sc-playback-status'; status.setAttribute('role', 'status');
    status.style.cssText = 'position:fixed;right:16px;bottom:62px;max-width:360px;padding:8px 12px;border-radius:8px;background:#242424;color:#eee;z-index:2147483001;font:inherit;font-size:13px;line-height:1.5;box-shadow:0 2px 12px #0006';
    status.hidden = true; document.body.append(status);
    let online = navigator.onLine;
    let intended = false;
    let attempts = 0;
    let lastAttempt = 0;
    let lastProgress = Date.now();
    let track = 0;
    let position = -1;
    let disposed = false;
    let recovering = false;
    let pausedByUser = false;
    const show = (label: string): void => { if (status.textContent !== label) status.textContent = label; status.hidden = !label; };
    function retry(): void {
        const p = host.player();
        if (!online || !p || !intended || pausedByUser || !p.getCurrentSound() || disposed) return;
        if (attempts >= 3) { show(text('Воспроизведение не восстановилось. Нажми Play для повтора.', 'Playback could not recover. Press Play to retry.')); return; }
        if (Date.now() - lastAttempt < (attempts + 1) * 5000) return;
        attempts++; lastAttempt = Date.now(); recovering = true;
        show(text('Восстанавливаю воспроизведение…', 'Recovering playback…'));
        try { p.pauseCurrent({ userInitiated: false }); p.playCurrent({ userInitiated: false }); }
        catch (error) { console.warn('Воспроизведение пока не восстановлено', error); }
    }
    function tick(): void {
        if (disposed) return;
        const p = host.player(); const sound = p?.getCurrentSound();
        if (!p || !sound) return;
        const at = typeof sound.currentTime === 'function' ? sound.currentTime() : 0;
        if (track !== sound.id || (at > position && at - position < 10000)) {
            track = sound.id; lastProgress = Date.now(); attempts = 0; recovering = false;
            if (p.isPlaying()) pausedByUser = false;
            if (online) show('');
        }
        position = at;
        if (online && !recovering) intended = p.isPlaying();
        if (!p.isPlaying() && !recovering && online) { if (pausedByUser) show(''); return; }
        if (intended && !pausedByUser && Date.now() - lastProgress > 12000) {
            if (!online) show(text('Нет сети. Продолжим после подключения.', 'Offline. Waiting for a connection.'));
            else { show(text('Буферизация…', 'Buffering…')); retry(); }
        }
    }
    const onOffline = (): void => {
        intended = host.player()?.isPlaying() === true; online = false; recovering = intended;
        show(text('Нет сети. Очередь сохранена.', 'Offline. Your queue is kept.'));
        void host.checkpoint().catch((error: unknown) => console.warn('Сессия не сохранена при потере сети', error));
    };
    const onOnline = (): void => { online = true; lastAttempt = 0; attempts = 0; host.refresh(); if (intended && !pausedByUser) retry(); else show(''); };
    const onCommand = (event: Event): void => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target?.closest('.playControls__play,.playControl,[data-act="play"]')) return;
        pausedByUser = host.player()?.isPlaying() === true;
        intended = !pausedByUser; recovering = false; attempts = 0; lastProgress = Date.now(); show('');
    };
    function resume(): void {
        online = navigator.onLine; attempts = 0; lastAttempt = 0; host.refresh();
        if (host.player()?.isPlaying()) intended = true;
        if (online && intended && !pausedByUser) retry();
    }
    window.addEventListener('offline', onOffline); window.addEventListener('online', onOnline);
    document.addEventListener('click', onCommand, true);
    return { tick, resume, dispose: () => { disposed = true; status.remove(); window.removeEventListener('offline', onOffline); window.removeEventListener('online', onOnline); document.removeEventListener('click', onCommand, true); } };
}
