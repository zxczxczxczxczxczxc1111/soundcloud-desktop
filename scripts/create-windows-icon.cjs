const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.setPath('userData', path.join(app.getPath('temp'), 'soundcloud-icon-build'));
app.whenReady().then(() => {
    const source = nativeImage.createFromPath(path.resolve('assets/icons/soundcloud.png'));
    if (source.isEmpty()) throw new Error('Не удалось прочитать иконку');
    const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
    const frames = sizes.map(size => source.resize({ width: size, height: size, quality: 'best' }).toPNG());
    const header = Buffer.alloc(6 + sizes.length * 16);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    sizes.forEach((size, index) => {
        const entry = 6 + index * 16;
        header[entry] = size === 256 ? 0 : size;
        header[entry + 1] = size === 256 ? 0 : size;
        header.writeUInt16LE(1, entry + 4);
        header.writeUInt16LE(32, entry + 6);
        header.writeUInt32LE(frames[index].length, entry + 8);
        header.writeUInt32LE(offset, entry + 12);
        offset += frames[index].length;
    });
    fs.writeFileSync('assets/icons/soundcloud-win.ico', Buffer.concat([header, ...frames]));
    console.log(JSON.stringify({ dimensions: source.getSize(), cornerAlpha: source.toBitmap()[3], iconSizes: sizes }));
    app.exit(0);
});
