import { describe, expect, it, vi } from 'vitest';
import type { NativeImage } from 'electron';
import { ArtworkCache, IconicThumbnail, largerArtwork, type DwmBridge, type ThumbnailSource, type ThumbnailWindow } from './iconicThumbnail';
import type { TaskbarCard } from './taskbarCard';

const WM_THUMBNAIL = 0x0323;
const WM_PEEK = 0x0326;

function setup(render: ThumbnailSource['render'] = async () => ({ image: { id: 'card' } as unknown as NativeImage, moving: false })) {
    let clock = 1000;
    const hooks = new Map<number, (wParam: Buffer, lParam: Buffer) => void>();
    const handle = Buffer.alloc(8);
    handle.writeBigUInt64LE(0x1234n);
    const window: ThumbnailWindow = {
        getNativeWindowHandle: () => handle,
        hookWindowMessage: (message, callback) => hooks.set(message, callback),
        isDestroyed: () => false,
    };
    const dwm = {
        setIconic: vi.fn<DwmBridge['setIconic']>(() => 0),
        setThumbnail: vi.fn<DwmBridge['setThumbnail']>(() => 0),
        setLivePreview: vi.fn<DwmBridge['setLivePreview']>(() => 0),
        invalidate: vi.fn<DwmBridge['invalidate']>(() => 0),
    };
    let card: TaskbarCard | null = null;
    const source = {
        card: () => card,
        render: vi.fn(render),
        peek: vi.fn<ThumbnailSource['peek']>(async () => ({ image: { id: 'site' } as unknown as NativeImage, x: 0, y: 32 })),
    };
    const thumbnail = new IconicThumbnail(window, dwm, source, () => clock);
    const tick = (ms: number): void => {
        clock += ms;
    };
    const request = (width: number, height: number): void => {
        const lParam = Buffer.alloc(8);
        lParam.writeUInt32LE(((width & 0xffff) << 16) | (height & 0xffff));
        hooks.get(WM_THUMBNAIL)?.(Buffer.alloc(8), lParam);
    };
    const set = (patch: Partial<TaskbarCard> | null): void => {
        card = patch === null ? null : { title: 'Night Drive', artist: 'Mira Solen', artwork: '', progress: 0.3, time: '1:06 / 3:40', playing: true, motion: true, ...patch };
    };
    return { hooks, dwm, source, thumbnail, request, set, tick };
}

describe('своя картинка превью на панели задач', () => {
    it('включается с треком, просит перерисовку только при смене карточки и выключается без трека', () => {
        const { dwm, thumbnail, set } = setup();
        thumbnail.update();
        expect(dwm.setIconic).not.toHaveBeenCalled();
        set({});
        thumbnail.update();
        expect(dwm.setIconic).toHaveBeenLastCalledWith(0x1234, true);
        expect(dwm.invalidate).toHaveBeenCalledTimes(1);
        // Та же доля полоски: картинка прежняя
        set({ progress: 0.301 });
        thumbnail.update();
        expect(dwm.invalidate).toHaveBeenCalledTimes(1);
        set({ progress: 0.301, time: '1:07 / 3:40' });
        thumbnail.update();
        set({ progress: 0.301, time: '1:07 / 3:40', playing: false });
        thumbnail.update();
        expect(dwm.invalidate).toHaveBeenCalledTimes(3);
        set(null);
        thumbnail.update();
        expect(dwm.setIconic).toHaveBeenLastCalledWith(0x1234, false);
        expect(dwm.setIconic).toHaveBeenCalledTimes(2);
    });

    it('на запрос Windows рисует карточку в отданный размер и повторно отдаёт её из запаса', async () => {
        const { dwm, source, thumbnail, request, set } = setup();
        request(200, 109);
        expect(source.render).not.toHaveBeenCalled();
        set({});
        thumbnail.update();
        request(200, 109);
        await vi.waitFor(() => expect(dwm.setThumbnail).toHaveBeenCalledTimes(1));
        expect(source.render).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Night Drive' }), 200, 109, 0);
        request(200, 109);
        expect(dwm.setThumbnail).toHaveBeenCalledTimes(2);
        expect(source.render).toHaveBeenCalledTimes(1);
        // Слишком высокое место режется до пропорции карточки
        request(300, 400);
        await vi.waitFor(() => expect(dwm.setThumbnail).toHaveBeenCalledTimes(3));
        expect(source.render).toHaveBeenLastCalledWith(expect.anything(), 300, 180, 0);
    });

    it('с бегущей строкой просит следующий кадр, пока Windows запрашивает превью, и начинает строку заново после закрытия', async () => {
        vi.useFakeTimers();
        const { dwm, source, thumbnail, request, set, tick } = setup(async () => ({ image: { id: 'frame' } as unknown as NativeImage, moving: true }));
        set({ title: 'THE STRONGEST | GOJO X SUKUNA - Hardtekk' });
        thumbnail.update();
        expect(dwm.invalidate).toHaveBeenCalledTimes(1);
        request(200, 109);
        await vi.waitFor(() => expect(dwm.setThumbnail).toHaveBeenCalledTimes(1));
        await vi.advanceTimersByTimeAsync(66);
        expect(dwm.invalidate).toHaveBeenCalledTimes(2);
        // Windows пришла за кадром: тот же ключ, но кадр рисуется заново с новым сдвигом
        tick(70);
        request(200, 109);
        await vi.waitFor(() => expect(dwm.setThumbnail).toHaveBeenCalledTimes(2));
        expect(source.render).toHaveBeenLastCalledWith(expect.anything(), 200, 109, 70);
        await vi.advanceTimersByTimeAsync(66);
        expect(dwm.invalidate).toHaveBeenCalledTimes(3);
        // Превью закрыто: запроса нет, следующий кадр не просится
        await vi.advanceTimersByTimeAsync(1000);
        expect(dwm.invalidate).toHaveBeenCalledTimes(3);
        tick(5000);
        request(200, 109);
        await vi.waitFor(() => expect(dwm.setThumbnail).toHaveBeenCalledTimes(3));
        expect(source.render).toHaveBeenLastCalledWith(expect.anything(), 200, 109, 0);
        vi.useRealTimers();
    });

    it('подсмотр через превью получает снимок сайта на его месте в окне', async () => {
        const { dwm, hooks, thumbnail, set } = setup();
        set({});
        thumbnail.update();
        hooks.get(WM_PEEK)?.(Buffer.alloc(8), Buffer.alloc(8));
        await vi.waitFor(() => expect(dwm.setLivePreview).toHaveBeenCalledWith(0x1234, { id: 'site' }, 0, 32));
    });

    it('после отказа DWM или пустой карточки возвращается обычный снимок окна и больше не трогается', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const first = setup();
        first.set({});
        first.thumbnail.update();
        first.dwm.setThumbnail.mockReturnValue(-2147024809);
        first.request(200, 109);
        await vi.waitFor(() => expect(first.dwm.setIconic).toHaveBeenLastCalledWith(0x1234, false));
        first.set({ title: 'Other' });
        first.thumbnail.update();
        expect(first.dwm.invalidate).toHaveBeenCalledTimes(1);
        const second = setup(async () => null);
        second.set({});
        second.thumbnail.update();
        second.request(200, 109);
        await vi.waitFor(() => expect(second.dwm.setIconic).toHaveBeenLastCalledWith(0x1234, false));
        expect(second.dwm.setThumbnail).not.toHaveBeenCalled();
        expect(errors).toHaveBeenCalled();
        errors.mockRestore();
    });
});

describe('обложка для превью', () => {
    it('берёт крупный размер у ссылок сайта', () => {
        expect(largerArtwork('https://i1.sndcdn.com/artworks-abc-t50x50.jpg')).toBe('https://i1.sndcdn.com/artworks-abc-t300x300.jpg');
        expect(largerArtwork('https://i1.sndcdn.com/avatars-abc-large.png')).toBe('https://i1.sndcdn.com/avatars-abc-t300x300.png');
        expect(largerArtwork('https://i1.sndcdn.com/artworks-abc-original.jpg')).toBe('https://i1.sndcdn.com/artworks-abc-original.jpg');
    });

    it('грузит картинку только с sndcdn.com, отдаёт её data:-адресом и не повторяет отказ', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const fetcher = vi.fn(async () => new Response(Buffer.from([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }));
        const ready = vi.fn();
        const cache = new ArtworkCache(fetcher, ready);
        expect(cache.get('https://evil.example/a-t50x50.jpg')).toBe('');
        await vi.waitFor(() => expect(errors).toHaveBeenCalled());
        expect(fetcher).not.toHaveBeenCalled();
        expect(cache.get('https://evil.example/a-t50x50.jpg')).toBe('');
        expect(cache.get('https://i1.sndcdn.com/artworks-abc-t50x50.jpg')).toBe('');
        await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
        expect(fetcher).toHaveBeenCalledWith('https://i1.sndcdn.com/artworks-abc-t300x300.jpg');
        expect(cache.get('https://i1.sndcdn.com/artworks-abc-t50x50.jpg')).toBe('data:image/jpeg;base64,AQID');
        errors.mockRestore();
    });
});
