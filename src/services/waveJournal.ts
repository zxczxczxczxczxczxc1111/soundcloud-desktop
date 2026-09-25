import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

const LIMIT = 20000;
const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
/** Содержимое файла журнала: только id треков, последние LIMIT */
export const cleanJournal = (value: unknown): number[] => (Array.isArray(value) ? value.filter(isId).slice(-LIMIT) : []);

// Журнал прослушанного для режима «Новое»: история SoundCloud отдаёт только 200 последних треков.
// Файл на каждого пользователя SoundCloud, хранятся только id треков, старые вытесняются
export class WaveJournal {
    private cache = new Map<number, number[]>();
    private dirty = new Set<number>();
    private timer: ReturnType<typeof setTimeout> | undefined;

    constructor(private directory: string, private delay = 2000) {}

    private file(userId: number): string {
        return join(this.directory, 'journal-' + userId + '.json');
    }
    private read(userId: number): number[] {
        const cached = this.cache.get(userId);
        if (cached) return cached;
        let ids: number[] = [];
        try {
            ids = cleanJournal(JSON.parse(readFileSync(this.file(userId), 'utf8')));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Журнал волны не прочитан:', error);
        }
        this.cache.set(userId, ids);
        return ids;
    }
    public load(userId: unknown): number[] {
        return isId(userId) ? this.read(userId).slice() : [];
    }
    public add(userId: unknown, input: unknown): void {
        if (!isId(userId) || !Array.isArray(input)) return;
        const ids = this.read(userId);
        const seen = new Set(ids);
        let changed = false;
        for (const id of input.slice(0, 500)) {
            if (!isId(id) || seen.has(id)) continue;
            seen.add(id);
            ids.push(id);
            changed = true;
        }
        if (!changed) return;
        if (ids.length > LIMIT) ids.splice(0, ids.length - LIMIT);
        this.dirty.add(userId);
        if (this.timer === undefined) {
            this.timer = setTimeout(() => this.flush(), this.delay);
            this.timer.unref?.();
        }
    }
    public flush(): void {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
        if (!this.dirty.size) return;
        try {
            mkdirSync(this.directory, { recursive: true });
        } catch (error) {
            console.warn('Папка журнала волны не создана:', error);
            return;
        }
        for (const userId of [...this.dirty]) if (this.write(userId)) this.dirty.delete(userId);
    }
    private write(userId: number): boolean {
        const target = this.file(userId);
        try {
            writeFileSync(target + '.tmp', JSON.stringify(this.cache.get(userId) ?? []), 'utf8');
            renameSync(target + '.tmp', target);
            return true;
        } catch (error) {
            console.warn('Журнал волны не записан:', error);
            return false;
        }
    }
    /**
     * Слить журнал из резервной копии: недостающие id встают перед текущими как более старые, лимит прежний.
     * Возвращает прежний журнал для отката или null, если файл не записан
     */
    public merge(userId: unknown, input: readonly number[]): number[] | null {
        if (!isId(userId)) return null;
        const current = this.read(userId);
        const previous = current.slice();
        const seen = new Set(current);
        const older = [...new Set(input.filter((id) => isId(id) && !seen.has(id)))];
        if (!older.length) return previous;
        this.cache.set(userId, [...older, ...current].slice(-LIMIT));
        try {
            mkdirSync(this.directory, { recursive: true });
        } catch (error) {
            console.warn('Папка журнала волны не создана:', error);
        }
        if (this.write(userId)) {
            this.dirty.delete(userId);
            return previous;
        }
        this.cache.set(userId, current);
        return null;
    }
    /** Вернуть журнал, снятый merge, если восстановление копии откатывается */
    public restore(userId: unknown, ids: readonly number[]): boolean {
        if (!isId(userId)) return false;
        this.cache.set(userId, ids.slice());
        if (this.write(userId)) {
            this.dirty.delete(userId);
            return true;
        }
        this.dirty.add(userId);
        return false;
    }
}
