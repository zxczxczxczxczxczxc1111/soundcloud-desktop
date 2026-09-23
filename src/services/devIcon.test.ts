import { expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ nativeImage: {} }));
import { tintIconBitmap } from './devIcon';
it('красит чёрное в оранжевый, белое оставляет белым и сохраняет прозрачность', () => {
    const bitmap = Buffer.from([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 128, 0, 0, 0, 0]);
    expect([...tintIconBitmap(bitmap)]).toEqual([0, 0x55, 0xff, 255, 255, 255, 255, 255, 0, 43, 128, 128, 0, 0, 0, 0]);
});
