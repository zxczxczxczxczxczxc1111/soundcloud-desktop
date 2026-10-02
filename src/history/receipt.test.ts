import { expect, it } from 'vitest';
import { medianPlays, receiptImage, receiptName } from './receipt';

// Однопиксельный PNG
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==';

it('medianPlays: медиана по известным числам, меньше пяти значит нет ответа', () => {
    const tracks = (plays: unknown[]): object[] => plays.map((value, id) => ({ id, plays: value }));
    expect(medianPlays(tracks([500, 20, 9000, 70, 1000]))).toBe(500);
    expect(medianPlays(tracks([10, 20, 30, 40, 50, 61]))).toBe(35);
    // Неизвестные и кривые значения не считаются
    expect(medianPlays(tracks([10, null, 'x', -5, Infinity, 20, 30, 40, 50]))).toBe(30);
    expect(medianPlays(tracks([1, 2, 3, 4]))).toBeNull();
    expect(medianPlays(null)).toBeNull();
    expect(medianPlays([null, 5, 'x'])).toBeNull();
});

it('receiptImage: только PNG в data:image/png', () => {
    const buffer = receiptImage('data:image/png;base64,' + PIXEL);
    expect(buffer?.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(receiptImage('data:image/jpeg;base64,' + PIXEL)).toBeNull();
    // Не PNG внутри
    expect(receiptImage('data:image/png;base64,' + Buffer.from('<svg/>').toString('base64'))).toBeNull();
    expect(receiptImage('data:image/png;base64,')).toBeNull();
    expect(receiptImage('data:image/png;base64,iVBOR w0K')).toBeNull();
    expect(receiptImage(42)).toBeNull();
    // Больше 8 МБ
    expect(receiptImage('data:image/png;base64,iVBORw0KGgoA' + 'A'.repeat(12 * 1024 * 1024))).toBeNull();
});

it('receiptName: дата по местному времени', () => {
    expect(receiptName(new Date(2026, 9, 2, 23, 59))).toBe('soundcloud-week-2026-10-02.png');
    expect(receiptName(new Date(2027, 0, 9))).toBe('soundcloud-week-2027-01-09.png');
});
