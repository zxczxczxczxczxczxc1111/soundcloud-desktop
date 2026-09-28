// Своя картинка превью на панели задач Windows вместо снимка окна, пока есть играющий трек. В Electron такого нет,
// поэтому функции DWM вызываются через koffi. Без трека, при любом отказе DWM или без koffi превью остаётся снимком окна
import type { NativeImage } from 'electron';
import type { TaskbarCard } from './taskbarCard';

const WM_DWMSENDICONICTHUMBNAIL = 0x0323;
const WM_DWMSENDICONICLIVEPREVIEWBITMAP = 0x0326;
const DWMWA_FORCE_ICONIC_REPRESENTATION = 7;
const DWMWA_HAS_ICONIC_BITMAP = 10;
/** Шагов полоски прогресса: без длительности на карточке картинку меняет только она */
const PROGRESS_STEPS = 100;
const ARTWORK_LIMIT = 2 * 1024 * 1024;

/** Вызовы DWM; каждый возвращает HRESULT, отрицательный значит отказ */
export interface DwmBridge {
    setIconic(hwnd: number, on: boolean): number;
    setThumbnail(hwnd: number, image: NativeImage): number;
    setLivePreview(hwnd: number, image: NativeImage, x: number, y: number): number;
    invalidate(hwnd: number): number;
}

export interface ThumbnailWindow {
    getNativeWindowHandle(): Buffer;
    hookWindowMessage(message: number, callback: (wParam: Buffer, lParam: Buffer) => void): void;
    isDestroyed(): boolean;
}

export interface ThumbnailSource {
    /** Карточка играющего трека или null, если трека нет */
    card(): TaskbarCard | null;
    render(card: TaskbarCard, width: number, height: number): Promise<NativeImage | null>;
    /** Снимок окна для подсмотра при наведении на превью и его место в окне, в физических точках */
    peek(): Promise<{ image: NativeImage; x: number; y: number } | null>;
}

type Call<A extends unknown[]> = (...args: A) => unknown;

export async function loadDwmBridge(): Promise<DwmBridge> {
    const { default: koffi } = await import('koffi');
    const dwm = koffi.load('dwmapi.dll');
    const gdi = koffi.load('gdi32.dll');
    const kernel = koffi.load('kernel32.dll');
    koffi.struct('SC_BITMAPINFOHEADER', {
        biSize: 'uint32_t', biWidth: 'int32_t', biHeight: 'int32_t', biPlanes: 'uint16_t', biBitCount: 'uint16_t',
        biCompression: 'uint32_t', biSizeImage: 'uint32_t', biXPelsPerMeter: 'int32_t', biYPelsPerMeter: 'int32_t',
        biClrUsed: 'uint32_t', biClrImportant: 'uint32_t',
    });
    koffi.struct('SC_POINT', { x: 'int32_t', y: 'int32_t' });
    const setAttribute = dwm.func('long __stdcall DwmSetWindowAttribute(intptr_t hwnd, uint32_t attr, const void *value, uint32_t size)') as Call<[number, number, Buffer, number]>;
    const setThumbnail = dwm.func('long __stdcall DwmSetIconicThumbnail(intptr_t hwnd, void *hbmp, uint32_t flags)') as Call<[number, unknown, number]>;
    const setLivePreview = dwm.func('long __stdcall DwmSetIconicLivePreviewBitmap(intptr_t hwnd, void *hbmp, const SC_POINT *client, uint32_t flags)') as Call<[number, unknown, { x: number; y: number }, number]>;
    const invalidate = dwm.func('long __stdcall DwmInvalidateIconicBitmaps(intptr_t hwnd)') as Call<[number]>;
    const createSection = gdi.func('void * __stdcall CreateDIBSection(void *hdc, const SC_BITMAPINFOHEADER *bmi, uint32_t usage, _Out_ void **bits, void *section, uint32_t offset)') as Call<[null, Record<string, number>, number, unknown[], null, number]>;
    const deleteObject = gdi.func('int __stdcall DeleteObject(void *object)') as Call<[unknown]>;
    const copyMemory = kernel.func('void __stdcall RtlMoveMemory(void *dest, const void *src, size_t length)') as Call<[unknown, Buffer, number]>;
    const result = (value: unknown): number => (typeof value === 'number' ? value : -1);
    // 32-битный DIB сверху вниз: пиксели nativeImage на Windows уже в порядке BGRA. Своя картинка непрозрачна,
    // поэтому умножение на прозрачность, которого ждёт DWM, ничего не меняет
    const withBitmap = (image: NativeImage, use: (bitmap: unknown) => number): number => {
        const scale = Math.max(1, ...image.getScaleFactors());
        const { width, height } = image.getSize(scale);
        const pixels = image.toBitmap({ scaleFactor: scale });
        if (!width || !height || pixels.length !== width * height * 4) throw new Error('Картинка превью ' + width + 'x' + height + ', байт ' + pixels.length);
        const bits: unknown[] = [null];
        const header = {
            biSize: 40, biWidth: width, biHeight: -height, biPlanes: 1, biBitCount: 32, biCompression: 0,
            biSizeImage: 0, biXPelsPerMeter: 0, biYPelsPerMeter: 0, biClrUsed: 0, biClrImportant: 0,
        };
        const bitmap = createSection(null, header, 0, bits, null, 0);
        if (!bitmap || !bits[0]) throw new Error('CreateDIBSection не выделил картинку ' + width + 'x' + height);
        try {
            copyMemory(bits[0], pixels, pixels.length);
            return use(bitmap);
        } finally {
            deleteObject(bitmap);
        }
    };
    return {
        setIconic(hwnd, on) {
            const value = Buffer.alloc(4);
            value.writeInt32LE(on ? 1 : 0);
            const force = result(setAttribute(hwnd, DWMWA_FORCE_ICONIC_REPRESENTATION, value, 4));
            const has = result(setAttribute(hwnd, DWMWA_HAS_ICONIC_BITMAP, value, 4));
            return force < 0 ? force : has;
        },
        setThumbnail: (hwnd, image) => withBitmap(image, (bitmap) => result(setThumbnail(hwnd, bitmap, 0))),
        setLivePreview: (hwnd, image, x, y) => withBitmap(image, (bitmap) => result(setLivePreview(hwnd, bitmap, { x, y }, 0))),
        invalidate: (hwnd) => result(invalidate(hwnd)),
    };
}

export function cardKey(card: TaskbarCard): string {
    const step = card.progress < 0 ? -1 : Math.floor(Math.min(1, card.progress) * PROGRESS_STEPS);
    return [card.title, card.artist, card.artwork.length, card.playing ? 1 : 0, card.time, step].join('|');
}

function check(result: number, name: string): void {
    if (result < 0) throw new Error(name + ' 0x' + (result >>> 0).toString(16));
}

export class IconicThumbnail {
    private readonly hwnd: number;
    private on = false;
    private broken = false;
    private shown = '';
    private cache: { key: string; image: NativeImage } | null = null;
    private ticket = 0;
    constructor(
        private readonly window: ThumbnailWindow,
        private readonly dwm: DwmBridge,
        private readonly source: ThumbnailSource,
    ) {
        this.hwnd = Number(window.getNativeWindowHandle().readBigUInt64LE(0));
        window.hookWindowMessage(WM_DWMSENDICONICTHUMBNAIL, (_wParam, lParam) => this.thumbnail(lParam));
        window.hookWindowMessage(WM_DWMSENDICONICLIVEPREVIEWBITMAP, () => this.livePreview());
    }
    /** Трек сменился, встал на паузу или продвинулся на секунду. Windows просит новую картинку, только когда показывает
     * превью, поэтому здесь лишь сбрасывается старая, и только если карточка правда поменялась */
    public update(): void {
        if (this.broken || this.window.isDestroyed()) return;
        const card = this.source.card();
        this.guard(() => {
            if ((card !== null) !== this.on) {
                check(this.dwm.setIconic(this.hwnd, card !== null), 'DwmSetWindowAttribute');
                this.on = card !== null;
            }
            const key = card ? cardKey(card) : '';
            if (key === this.shown) return;
            this.shown = key;
            if (card) check(this.dwm.invalidate(this.hwnd), 'DwmInvalidateIconicBitmaps');
        });
    }
    /** После показа из трея у окна новая кнопка на панели задач: флаги и картинка ставятся заново */
    public restore(): void {
        if (this.broken || !this.on || this.window.isDestroyed()) return;
        this.guard(() => {
            check(this.dwm.setIconic(this.hwnd, true), 'DwmSetWindowAttribute');
            check(this.dwm.invalidate(this.hwnd), 'DwmInvalidateIconicBitmaps');
        });
    }
    private thumbnail(lParam: Buffer): void {
        if (this.broken || !this.on || lParam.length < 4) return;
        const card = this.source.card();
        if (!card) return;
        // Windows передаёт наибольший размер: ширина в старшем слове, высота в младшем
        const value = lParam.readUInt32LE(0);
        const width = (value >>> 16) & 0xffff;
        const height = Math.min(value & 0xffff, Math.round(width * 0.6));
        if (!width || !height) return;
        const key = cardKey(card) + '|' + width + 'x' + height;
        if (this.cache?.key === key) {
            const image = this.cache.image;
            this.guard(() => check(this.dwm.setThumbnail(this.hwnd, image), 'DwmSetIconicThumbnail'));
            return;
        }
        const ticket = ++this.ticket;
        this.source
            .render(card, width, height)
            .then((image) => {
                if (ticket !== this.ticket || this.broken || !this.on) return;
                if (!image) throw new Error('Карточка превью пустая');
                this.cache = { key, image };
                this.guard(() => check(this.dwm.setThumbnail(this.hwnd, image), 'DwmSetIconicThumbnail'));
            })
            .catch((error: unknown) => this.fail(error));
    }
    private livePreview(): void {
        if (this.broken || !this.on) return;
        this.source
            .peek()
            .then((shot) => {
                if (!shot || this.broken || !this.on) return;
                this.guard(() => check(this.dwm.setLivePreview(this.hwnd, shot.image, shot.x, shot.y), 'DwmSetIconicLivePreviewBitmap'));
            })
            .catch((error: unknown) => console.error('Снимок окна для подсмотра не снят', error));
    }
    private guard(action: () => void): void {
        try {
            action();
        } catch (error) {
            this.fail(error);
        }
    }
    // Пустое превью хуже снимка окна: после любого отказа карточка выключается до перезапуска клиента
    private fail(error: unknown): void {
        if (this.broken) return;
        this.broken = true;
        console.error('Своя картинка превью выключена', error);
        if (!this.on || this.window.isDestroyed()) return;
        this.on = false;
        try {
            this.dwm.setIconic(this.hwnd, false);
        } catch (reset) {
            console.error('Флаги превью не сняты', reset);
        }
    }
}

/** Обложка покрупнее: в плеере сайта стоит 50x50, превью нужно до 180 точек при масштабе 150% */
export function largerArtwork(url: string): string {
    return url.replace(/-(?:t\d+x\d+|large|small|badge|tiny|mini|crop)(\.(?:jpg|jpeg|png|webp))(\?.*)?$/i, '-t300x300$1');
}

/** Обложка для карточки data:-адресом, чтобы холст в шапке не зависел от чужого CORS. Помнит одну последнюю */
export class ArtworkCache {
    private url = '';
    private data = '';
    private loading = '';
    constructor(
        private readonly fetcher: (url: string) => Promise<Response>,
        private readonly ready: () => void,
    ) {}
    public get(source: string): string {
        const url = largerArtwork(source);
        if (!url) return '';
        if (url === this.url) return this.data;
        if (url !== this.loading) void this.load(url);
        return '';
    }
    private async load(url: string): Promise<void> {
        this.loading = url;
        try {
            const address = new URL(url);
            if (address.protocol !== 'https:' || !/(^|\.)sndcdn\.com$/.test(address.hostname)) throw new Error('Обложка не с sndcdn.com: ' + address.hostname);
            const response = await this.fetcher(url);
            if (!response.ok) throw new Error('Обложка ответила ' + response.status);
            const type = response.headers.get('content-type') ?? '';
            if (!/^image\/(jpeg|png|webp)$/.test(type.split(';')[0].trim())) throw new Error('Обложка не картинка: ' + type);
            const body = Buffer.from(await response.arrayBuffer());
            if (body.length > ARTWORK_LIMIT) throw new Error('Обложка больше 2 МБ');
            if (this.loading !== url) return;
            this.url = url;
            this.data = 'data:' + type.split(';')[0].trim() + ';base64,' + body.toString('base64');
            this.ready();
        } catch (error) {
            // Без обложки карточка рисуется с пустым квадратом, повтор будет со следующим треком
            console.error('Обложка для превью не загружена', error);
            if (this.loading === url) {
                this.url = url;
                this.data = '';
            }
        } finally {
            if (this.loading === url) this.loading = '';
        }
    }
}
