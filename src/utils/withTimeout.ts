/** Ожидание не уложилось в срок: страница зависла или перезагружается */
export class TimeoutError extends Error {}

// Ожидание с пределом. executeJavaScript в зависшую или перезагружающуюся страницу иначе не завершается никогда
export function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError('Тайм-аут: ' + label)), ms);
    });
    return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
