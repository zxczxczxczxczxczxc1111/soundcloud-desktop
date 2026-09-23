import { nativeImage, type NativeImage } from 'electron';

// Оранжевая подложка вместо чёрной: dev-запуск и тестовую сборку видно рядом с установленным клиентом
const accent = [0x00, 0x55, 0xff];

// Пиксели BGRA с домноженной альфой, так toBitmap отдаёт их на Windows. Иконка серая, яркость берётся по зелёному.
export function tintIconBitmap(bitmap: Buffer): Buffer {
    const out = Buffer.from(bitmap);
    for (let i = 0; i + 3 < out.length; i += 4) {
        const alpha = out[i + 3];
        if (alpha === 0) continue;
        const light = Math.min(1, out[i + 1] / alpha);
        for (let c = 0; c < 3; c++) out[i + c] = Math.round(((accent[c] + (255 - accent[c]) * light) * alpha) / 255);
    }
    return out;
}

export function tintIcon(image: NativeImage): NativeImage {
    const source = image.getSize().width > 256 ? image.resize({ width: 256 }) : image;
    return nativeImage.createFromBitmap(tintIconBitmap(source.toBitmap()), source.getSize());
}
