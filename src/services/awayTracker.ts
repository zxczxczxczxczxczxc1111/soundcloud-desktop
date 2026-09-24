// Когда пользователя не было у компьютера: экран заблокирован или система простаивала дольше порога.
// Журнал сигналов помечает такие прослушивания, обучение волны потом берёт их вполсилы
export class AwayTracker {
    // Закрытые отрезки [начало, конец], мс, по возрастанию и без пересечений
    private spans: Array<[number, number]> = [];
    private lockedSince: number | null = null;

    constructor(
        private idleSeconds: () => number,
        private now: () => number = Date.now,
        private threshold = 10 * 60000,
        private keep = 24 * 3600000,
    ) {}

    public lock(): void {
        this.lockedSince ??= this.now();
    }
    public unlock(): void {
        if (this.lockedSince === null) return;
        this.push(this.lockedSince, this.now());
        this.lockedSince = null;
    }
    /** Раз в минуту: простой дольше порога целиком, с последнего ввода, становится отрезком «не у компьютера» */
    public poll(): void {
        let idle: number;
        try {
            idle = this.idleSeconds() * 1000;
        } catch (error) {
            console.warn('Простой системы не прочитан:', error);
            return;
        }
        if (!Number.isFinite(idle) || idle < this.threshold) return;
        const end = this.now();
        this.push(end - idle, end);
    }
    /** Больше половины окна [from, to] пользователя не было у компьютера */
    public away(from: number, to: number): boolean {
        if (!(to > from)) return false;
        const spans: Array<[number, number]> = this.lockedSince === null ? this.spans : [...this.spans, [this.lockedSince, this.now()]];
        let covered = 0;
        for (const [start, end] of spans) covered += Math.max(0, Math.min(end, to) - Math.max(start, from));
        return covered * 2 > to - from;
    }
    private push(start: number, end: number): void {
        const added: Array<[number, number]> = end > start ? [[start, end]] : [];
        const merged: Array<[number, number]> = [];
        for (const span of [...this.spans, ...added].sort((a, b) => a[0] - b[0])) {
            const last = merged[merged.length - 1];
            if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
            else merged.push([span[0], span[1]]);
        }
        const oldest = this.now() - this.keep;
        this.spans = merged.filter(([, spanEnd]) => spanEnd >= oldest);
    }
}
