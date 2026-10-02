import { expect, it } from 'vitest';
import { lastWeek, recapImage, recapName, recapPeople } from './recap';

// Однопиксельный PNG
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==';

it('recapImage: только PNG в data:image/png', () => {
    const buffer = recapImage('data:image/png;base64,' + PIXEL);
    expect(buffer?.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(recapImage('data:image/jpeg;base64,' + PIXEL)).toBeNull();
    // Не PNG внутри
    expect(recapImage('data:image/png;base64,' + Buffer.from('<svg/>').toString('base64'))).toBeNull();
    expect(recapImage('data:image/png;base64,')).toBeNull();
    expect(recapImage('data:image/png;base64,iVBOR w0K')).toBeNull();
    expect(recapImage(42)).toBeNull();
    // Больше 12 МБ
    expect(recapImage('data:image/png;base64,iVBORw0KGgoA' + 'A'.repeat(17 * 1024 * 1024))).toBeNull();
});

it('recapName: по неделе ISO, без недели по местной дате', () => {
    expect(recapName(2026, 40, new Date(2026, 9, 2))).toBe('soundcloud-week-2026-40.png');
    expect(recapName(2027, 1, new Date(2027, 0, 9))).toBe('soundcloud-week-2027-01.png');
    expect(recapName('2026', 40, new Date(2026, 9, 2, 23, 59))).toBe('soundcloud-week-2026-10-02.png');
    expect(recapName(2026, 54, new Date(2027, 0, 9))).toBe('soundcloud-week-2027-01-09.png');
});

it('lastWeek: прошлая неделя с понедельника по местному времени, номер по ISO', () => {
    // Пятница 2 октября 2026: прошлая неделя с 21 по 28 сентября, 39-я
    const week = lastWeek(new Date(2026, 9, 2, 16, 0));
    expect(week).toEqual({ from: new Date(2026, 8, 21).getTime(), to: new Date(2026, 8, 28).getTime(), id: '2026-39' });
    // Понедельник с самого утра уже считает только что закончившуюся неделю
    expect(lastWeek(new Date(2026, 8, 28, 0, 5)).id).toBe('2026-39');
    expect(lastWeek(new Date(2026, 8, 27, 23, 55)).id).toBe('2026-38');
    // Неделя на стыке лет: 28 декабря 2026 - 3 января 2027 это 53-я неделя 2026 года
    expect(lastWeek(new Date(2027, 0, 6)).id).toBe('2026-53');
    // 29 декабря 2025 - 4 января 2026 это 1-я неделя 2026 года
    expect(lastWeek(new Date(2026, 0, 7)).id).toBe('2026-01');
});

it('recapPeople: ник и ссылка проверяются, картинки только с sndcdn и только по спрошенным путям', () => {
    const people = recapPeople(
        {
            me: { username: '  nightdriver  ', permalink: 'nightdriver', avatar: 'https://i1.sndcdn.com/avatars-1-large.jpg' },
            avatars: { '/burial': 'https://i1.sndcdn.com/avatars-2-large.jpg', '/evil': 'https://evil.example/a.jpg', '/other': 'https://i1.sndcdn.com/x.jpg' },
        },
        ['/burial', '/evil'],
    );
    expect(people).toEqual({ me: { username: 'nightdriver', permalink: 'nightdriver', avatar: 'https://i1.sndcdn.com/avatars-1-large.jpg' }, avatars: { '/burial': 'https://i1.sndcdn.com/avatars-2-large.jpg' } });
    expect(recapPeople({ me: { username: 'x', permalink: '../evil', avatar: 'javascript:alert(1)' } }, [])).toEqual({ me: { username: 'x', permalink: '', avatar: '' }, avatars: {} });
    expect(recapPeople({ me: { username: '' } }, [])).toEqual({ me: null, avatars: {} });
    expect(recapPeople(null, [])).toBeNull();
});
