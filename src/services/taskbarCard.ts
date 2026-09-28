// Картинка превью на панели задач Windows: обложка, название, артист и ход трека. Рисуется на холсте в странице шапки
// и уходит туда текстом функции, поэтому всё исполняемое лежит внутри drawTaskbarCard
export interface TaskbarCard {
    title: string;
    artist: string;
    /** Обложка data:-адресом или пустая строка */
    artwork: string;
    /** Доля прослушанного от 0 до 1, меньше нуля полоски нет */
    progress: number;
    /** Позиция и длительность «1:05 / 3:40» или пустая строка */
    time: string;
    playing: boolean;
}

export async function drawTaskbarCard(card: TaskbarCard, width: number, height: number): Promise<string> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return '';
    // При масштабе 100% Windows даёт превью 200 точек в ширину, при 150% в полтора раза больше
    const unit = width / 200;
    const pad = Math.round(10 * unit);
    const side = height - pad * 2;
    context.fillStyle = '#121212';
    context.fillRect(0, 0, width, height);
    const cover = await new Promise<HTMLImageElement | null>((resolve) => {
        if (!card.artwork) {
            resolve(null);
            return;
        }
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = card.artwork;
    });
    context.save();
    context.beginPath();
    context.roundRect(pad, pad, side, side, Math.round(6 * unit));
    context.clip();
    if (cover && cover.naturalWidth > 0 && cover.naturalHeight > 0) {
        const crop = Math.min(cover.naturalWidth, cover.naturalHeight);
        context.drawImage(cover, (cover.naturalWidth - crop) / 2, (cover.naturalHeight - crop) / 2, crop, crop, pad, pad, side, side);
    } else {
        context.fillStyle = 'rgba(255, 255, 255, 0.08)';
        context.fillRect(pad, pad, side, side);
    }
    context.restore();

    const left = pad + side + Math.round(10 * unit);
    const room = width - left - pad;
    const font = '"Segoe UI", system-ui, sans-serif';
    const cut = (text: string): string => {
        if (context.measureText(text).width <= room) return text;
        let rest = text;
        while (rest && context.measureText(rest + '…').width > room) rest = rest.slice(0, -1);
        return rest.trimEnd() + '…';
    };
    // Название до двух строк по словам, хвост второй строки обрезается многоточием
    const wrap = (text: string): string[] => {
        const words = text.split(/\s+/).filter(Boolean);
        let first = '';
        while (words.length) {
            const next = first ? first + ' ' + words[0] : words[0];
            if (context.measureText(next).width > room) break;
            first = next;
            words.shift();
        }
        if (!first) return [cut(text)];
        return words.length ? [first, cut(words.join(' '))] : [first];
    };
    const titleSize = Math.round(14 * unit);
    const titleLine = Math.round(18 * unit);
    const artistSize = Math.round(12 * unit);
    const artistLine = Math.round(16 * unit);
    const timeSize = Math.round(11 * unit);
    const bar = Math.max(2, Math.round(3 * unit));
    const barY = pad + side - bar;
    // Время стоит над полоской, название и артист по центру оставшегося места
    const timeY = barY - Math.round(5 * unit) - timeSize;
    context.textBaseline = 'top';
    context.font = '600 ' + titleSize + 'px ' + font;
    const lines = wrap(card.title);
    const block = lines.length * titleLine + Math.round(2 * unit) + artistLine;
    const free = (card.time ? timeY - Math.round(6 * unit) : barY) - pad;
    let y = pad + Math.max(0, Math.round((free - block) / 2));
    context.fillStyle = 'rgba(255, 255, 255, 0.92)';
    for (const line of lines) {
        context.fillText(line, left, y);
        y += titleLine;
    }
    y += Math.round(2 * unit);
    context.font = artistSize + 'px ' + font;
    context.fillStyle = 'rgba(255, 255, 255, 0.6)';
    context.fillText(cut(card.artist), left, y);
    if (card.time) {
        context.font = timeSize + 'px ' + font;
        context.fillText(cut(card.time), left, timeY);
    }
    if (card.progress >= 0) {
        context.fillStyle = 'rgba(255, 255, 255, 0.16)';
        context.beginPath();
        context.roundRect(left, barY, room, bar, bar / 2);
        context.fill();
        const done = Math.round(room * Math.min(1, card.progress));
        if (done > 0) {
            context.fillStyle = card.playing ? '#ff5500' : 'rgba(255, 255, 255, 0.5)';
            context.beginPath();
            context.roundRect(left, barY, Math.max(done, bar), bar, bar / 2);
            context.fill();
        }
    }
    return canvas.toDataURL('image/png');
}

export function taskbarCardScript(card: TaskbarCard, width: number, height: number): string {
    return '(' + drawTaskbarCard.toString() + ')(' + JSON.stringify(card) + ', ' + width + ', ' + height + ')';
}
