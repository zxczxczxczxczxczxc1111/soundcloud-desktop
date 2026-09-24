import { normalizeTrackInfo } from '../utils/trackParser';
import type { WebhookTrackData, TrackUpdateReason } from '../types';
interface Settings {
    get(key: string, fallback?: unknown): unknown;
    set(key: string, value: unknown): void;
    delete(key: string): void;
}
interface ListeningState {
    id: string;
    data: WebhookTrackData;
    artist: string;
    track: string;
    duration: number;
    playedMs: number;
    playingSince: number | null;
    attempted: boolean;
}
function seconds(value: string): number {
    const parts = value.trim().replace(/^-/, '').split(':').map(Number);
    if (parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
    return parts.reduce((total, part) => total * 60 + part, 0) * (value.trim().startsWith('-') ? -1 : 1);
}
export class WebhookService {
    private state: ListeningState | null = null;
    private latest: { data: WebhookTrackData; playing: boolean } | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private requests = new Set<AbortController>();
    constructor(private store: Settings) {}
    private settle(state: ListeningState): void {
        if (state.playingSince !== null) {
            state.playedMs += Math.max(0, Date.now() - state.playingSince);
            state.playingSince = Date.now();
        }
    }
    private threshold(state: ListeningState): number {
        const percent = Number(this.store.get('webhookTriggerPercentage', 50));
        return (state.duration * 1000 * Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 50))) / 100;
    }
    private cancelTimer(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }
    private schedule(): void {
        this.cancelTimer();
        const state = this.state;
        if (
            !state ||
            state.playingSince === null ||
            state.attempted ||
            state.duration <= 0 ||
            this.store.get('webhookEnabled') !== true
        )
            return;
        this.settle(state);
        const remaining = Math.max(0, this.threshold(state) - state.playedMs);
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.send(state);
        }, remaining);
        this.timer.unref?.();
    }
    private async send(state: ListeningState): Promise<void> {
        if (state.attempted || this.store.get('webhookEnabled') !== true) return;
        const url = this.store.get('webhookUrl');
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
        // Один запрос на прослушивание. Повтор POST после таймаута может дублировать уже принятые данные.
        state.attempted = true;
        const controller = new AbortController();
        this.requests.add(controller);
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
            const response = await fetch(url, {
                method: 'POST',
                signal: controller.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    timestamp: new Date().toISOString(),
                    artist: state.artist,
                    track: state.track,
                    duration: state.duration,
                    originUrl: state.data.url,
                    trackArt: state.data.artwork,
                }),
            });
            if (!response.ok) console.error('Webhook: сервер отклонил запрос, HTTP', response.status);
        } catch (error) {
            if (this.store.get('webhookEnabled') === true)
                console.error('Webhook: не удалось отправить событие:', error);
        } finally {
            clearTimeout(timeout);
            this.requests.delete(controller);
        }
    }
    public async updateTrackInfo(
        data: WebhookTrackData,
        playing = true,
        reason: TrackUpdateReason = 'progress',
    ): Promise<void> {
        this.latest = { data: { ...data }, playing };
        if (this.store.get('webhookEnabled') !== true) return;
        const previous = this.state;
        if (previous) this.settle(previous);
        if (!data.title || !data.author) {
            this.cancelTimer();
            this.state = null;
            return;
        }
        const normalized = normalizeTrackInfo(
            data.title,
            data.author,
            this.store.get('trackParserEnabled', true) === true,
        );
        const id = data.url || normalized.artist + '\0' + normalized.track;
        const rawDuration = seconds(data.duration);
        const duration = rawDuration < 0 ? Math.max(0, seconds(data.elapsed)) - rawDuration : rawDuration;
        if (!previous || previous.id !== id || reason === 'loop') {
            if (
                previous &&
                !previous.attempted &&
                previous.duration > 0 &&
                previous.playedMs >= this.threshold(previous)
            )
                void this.send(previous);
            this.state = {
                id,
                data: { ...data },
                artist: normalized.artist,
                track: normalized.track,
                duration,
                playedMs: 0,
                playingSince: playing ? Date.now() : null,
                attempted: false,
            };
        } else {
            previous.data = { ...data };
            previous.artist = normalized.artist;
            previous.track = normalized.track;
            previous.duration = duration;
            previous.playingSince = playing ? Date.now() : null;
        }
        this.schedule();
    }
    public setTriggerPercentage(value: number): void {
        this.store.set('webhookTriggerPercentage', Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 50);
        this.schedule();
    }
    public setWebhookUrl(value: string): void {
        this.store.set('webhookUrl', value);
    }
    public setEnabled(enabled: boolean): void {
        this.store.set('webhookEnabled', enabled);
        if (!enabled) {
            this.dispose();
            return;
        }
        if (this.latest) void this.updateTrackInfo(this.latest.data, this.latest.playing);
    }
    public dispose(): void {
        this.cancelTimer();
        for (const request of this.requests) request.abort();
        this.requests.clear();
        this.state = null;
    }
    public disconnect(): void {
        this.setEnabled(false);
        this.store.delete('webhookUrl');
    }
}
