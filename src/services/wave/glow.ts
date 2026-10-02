// Свет блока «Моей волны» (Ф3): палитра из обложки играющего трека, по ней за блоком медленно плывут мягкие пятна.
// Раздел страницы волны: функция уходит на страницу текстом вместе с волной (pageHelpers в wave.ts) и зовётся по голому имени.
// Первая версия красила блок средним цветом обложки и меняла яркость по громкости: у тёмных и пёстрых обложек средний
// цвет серый, а громкость давала мерцание. По слову владельца 02.10.2026 свет к звуку не привязан

/** Три цвета света по пикселям RGBA обложки: самые заметные яркие оттенки, приведённые к ровной светлоте (OKLCH).
 *  Оттенок весит тем больше, чем больше у него насыщенных пикселей; второй и третий берутся не ближе 45° к уже взятым и
 *  только если их вес хотя бы восьмая часть первого, иначе это соседние тона первого. У чёрно-белой обложки пустой список */
export function glowPalette(data: ArrayLike<number>): string[] {
    const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const gamma = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
    // Цвет OKLCH в #rrggbb; вне охвата sRGB насыщенность убавляется, пока цвет не влезет
    const toHex = (L: number, chroma: number, hue: number): string => {
        let c = chroma;
        for (let step = 0; step < 60; step++) {
            const A = c * Math.cos(hue);
            const B = c * Math.sin(hue);
            const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
            const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
            const s = Math.pow(L - 0.0894841775 * A - 1.291485548 * B, 3);
            const rgb = [
                4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
                -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
                -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
            ];
            if (rgb.every((value) => value >= -0.0005 && value <= 1.0005) || c <= 0.02) {
                return '#' + rgb.map((value) => Math.round(gamma(Math.min(1, Math.max(0, value))) * 255).toString(16).padStart(2, '0')).join('');
            }
            c -= 0.005;
        }
        return '';
    };
    const BINS = 24;
    const weight = new Array<number>(BINS).fill(0);
    const sumA = new Array<number>(BINS).fill(0);
    const sumB = new Array<number>(BINS).fill(0);
    const sumC = new Array<number>(BINS).fill(0);
    let total = 0;
    let vivid = 0;
    for (let i = 0; i + 3 < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        total++;
        const r = linear(data[i] / 255);
        const g = linear(data[i + 1] / 255);
        const b = linear(data[i + 2] / 255);
        const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
        const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
        const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
        const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
        const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
        const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
        const C = Math.hypot(A, B);
        // Серое, почти чёрное и почти белое оттенка не задаёт
        if (C < 0.04 || L < 0.15 || L > 0.97) continue;
        vivid++;
        const bin = Math.floor(((Math.atan2(B, A) / (2 * Math.PI) + 1) % 1) * BINS) % BINS;
        const w = C * C;
        weight[bin] += w;
        sumA[bin] += (A / C) * w;
        sumB[bin] += (B / C) * w;
        sumC[bin] += C * w;
    }
    // Цветных пикселей меньше сороковой части: обложка чёрно-белая, а оттенок пары точек случаен. Цветок или
    // надпись на чёрно-белом снимке занимают больше и становятся цветом света
    if (!total || vivid / total < 0.025) return [];
    const around = (i: number): number[] => [(i + BINS - 1) % BINS, i, (i + 1) % BINS];
    const blocked = new Set<number>();
    const picks: Array<{ hue: number; chroma: number }> = [];
    let first = 0;
    while (picks.length < 3) {
        let best = -1;
        let bestWeight = 0;
        for (let i = 0; i < BINS; i++) {
            if (blocked.has(i)) continue;
            const value = around(i).reduce((sum, k) => sum + (blocked.has(k) ? 0 : weight[k]), 0);
            if (value > bestWeight) {
                bestWeight = value;
                best = i;
            }
        }
        if (best < 0 || (picks.length > 0 && bestWeight < first / 8)) break;
        if (!picks.length) first = bestWeight;
        let a = 0;
        let b = 0;
        let c = 0;
        let w = 0;
        for (const k of around(best)) {
            if (blocked.has(k)) continue;
            a += sumA[k];
            b += sumB[k];
            c += sumC[k];
            w += weight[k];
        }
        picks.push({ hue: Math.atan2(b, a), chroma: c / w });
        for (let d = -3; d <= 3; d++) blocked.add((best + d + BINS) % BINS);
    }
    // Одного-двух оттенков мало для движения: недостающие это соседние тона первого, темнее и светлее
    const base = picks[0];
    while (picks.length < 3) picks.push({ hue: base.hue + (picks.length === 1 ? 0.45 : -0.45), chroma: base.chroma });
    const lightness = [0.7, 0.6, 0.8];
    return picks.map((pick, i) => toHex(lightness[i], Math.min(0.19, Math.max(0.11, pick.chroma * 1.2)), pick.hue));
}
