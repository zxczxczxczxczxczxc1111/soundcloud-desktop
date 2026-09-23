import type { TrackInfo, TrackUpdateReason } from '../types';

interface MonitorWindow extends Window {
    soundcloudAPI?: { sendTrackUpdate(data: TrackInfo, reason: TrackUpdateReason): void };
    __soundCloudMonitor?: { dispose(): void };
}

// Функция сериализуется для страницы: все исполняемые зависимости находятся внутри неё.
export function installAudioMonitor(): void {
    const host = window as MonitorWindow;
    if (host.__soundCloudMonitor) return;
    let root: Element | null = null;
    let media: HTMLMediaElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last: TrackInfo | null = null;
    let lastAt = 0;
    let stopped = false;
    const toSeconds = (text: string): number => {
        const negative = text.trim().startsWith('-');
        const result = text
            .trim()
            .replace(/^-/, '')
            .split(':')
            .reduce((total, part) => total * 60 + (Number(part) || 0), 0);
        return negative ? -result : result;
    };
    const format = (value: number): string => {
        const total = Math.max(0, Math.floor(value));
        return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
    };
    const empty = (): TrackInfo => ({
        title: '',
        author: '',
        artwork: '',
        elapsed: '',
        duration: '',
        url: '',
        artistUrl: '',
        isPlaying: false,
        isLiked: false,
    });
    function read(): TrackInfo {
        if (!root?.isConnected) return empty();
        const query = (selector: string): Element | null => root?.querySelector(selector) ?? null;
        const artwork = query('.playbackSoundBadge__avatar .image__lightOutline span') as HTMLElement | null;
        const title = query('.playbackSoundBadge__titleLink') as HTMLAnchorElement | null;
        const artist = query('.playbackSoundBadge__lightLink');
        const metadata = navigator.mediaSession?.metadata;
        const play = query('.playControls__play, .playControl');
        const useMedia = media !== null && Number.isFinite(media.duration) && media.duration > 0;
        return {
            title:
                artwork?.getAttribute('aria-label') ||
                title?.getAttribute('title') ||
                title?.textContent?.trim() ||
                metadata?.title ||
                '',
            author: artist?.textContent?.trim() || metadata?.artist || '',
            artwork:
                artwork?.style.backgroundImage.replace(/^url\(["']?|["']?\)$/g, '') || metadata?.artwork[0]?.src || '',
            elapsed: useMedia
                ? format(media!.currentTime)
                : query('.playbackTimeline__timePassed span:last-child')?.textContent?.trim() || '',
            duration: useMedia
                ? format(media!.duration)
                : query('.playbackTimeline__duration span:last-child')?.textContent?.trim() || '',
            url: title?.href.split('?')[0] || '',
            artistUrl: artist instanceof HTMLAnchorElement ? artist.href.split('?')[0] : '',
            isPlaying: play ? play.classList.contains('playing') : useMedia && !media!.paused && !media!.ended,
            isLiked: query('.playbackSoundBadge__like')?.classList.contains('sc-button-selected') ?? false,
        };
    }
    function notify(): void {
        if (stopped) return;
        const track = read();
        if (JSON.stringify(track) === JSON.stringify(last)) return;
        const now = Date.now();
        let reason: TrackUpdateReason = 'playback-state-change';
        if (!last) reason = 'initial-state';
        else if (track.url !== last.url || track.title !== last.title || track.author !== last.author)
            reason = 'track-change';
        else if (
            track.isPlaying === last.isPlaying &&
            track.isLiked === last.isLiked &&
            track.elapsed !== last.elapsed
        ) {
            const previous = toSeconds(last.elapsed);
            const current = toSeconds(track.elapsed);
            const rawDuration = toSeconds(last.duration);
            const duration = rawDuration < 0 ? previous - rawDuration : rawDuration;
            const expected = last.isPlaying ? ((now - lastAt) / 1000) * (media?.playbackRate || 1) : 0;
            if (previous > 3 && duration > 0 && previous >= duration - 3 && current <= 3) reason = 'loop';
            else reason = Math.abs(current - previous - expected) > 2 ? 'seek-change' : 'progress';
        }
        last = track;
        lastAt = now;
        host.soundcloudAPI?.sendTrackUpdate(track, reason);
    }
    const playbackObserver = new MutationObserver(() => schedule());
    function bind(): void {
        const next = document.querySelector('.playControls');
        if (next === root) return;
        playbackObserver.disconnect();
        root = next;
        if (root)
            playbackObserver.observe(root, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['class', 'style', 'href', 'aria-label', 'title'],
            });
        else media = null;
    }
    function schedule(): void {
        if (timer !== undefined || stopped) return;
        timer = setTimeout(() => {
            timer = undefined;
            bind();
            notify();
        }, 150);
    }
    // Вне плеера проверяется только его подключение, без повторного обхода документа.
    const documentObserver = new MutationObserver(() => {
        if (!root?.isConnected) schedule();
    });
    const onMedia = (event: Event): void => {
        if (event.target instanceof HTMLAudioElement) {
            media = event.target;
            schedule();
        }
    };
    const mediaEvents = [
        'play',
        'pause',
        'ended',
        'timeupdate',
        'durationchange',
        'loadedmetadata',
        'seeked',
        'ratechange',
    ];
    for (const event of mediaEvents) document.addEventListener(event, onMedia, true);
    function dispose(): void {
        stopped = true;
        if (timer !== undefined) clearTimeout(timer);
        playbackObserver.disconnect();
        documentObserver.disconnect();
        for (const event of mediaEvents) document.removeEventListener(event, onMedia, true);
        window.removeEventListener('pagehide', dispose);
        delete host.__soundCloudMonitor;
    }
    host.__soundCloudMonitor = { dispose };
    window.addEventListener('pagehide', dispose, { once: true });
    bind();
    notify();
    documentObserver.observe(document.documentElement, { childList: true, subtree: true });
}

export const audioMonitorScript = '(' + installAudioMonitor.toString() + ')();';
