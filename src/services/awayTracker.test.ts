import { expect, it, vi } from 'vitest';
import { AwayTracker } from './awayTracker';

const MIN = 60000;

it('заблокированный экран: прослушивание внутри блокировки помечено, до неё нет', () => {
    let now = 100 * MIN;
    const tracker = new AwayTracker(() => 0, () => now);
    tracker.lock();
    now = 130 * MIN;
    // Экран ещё заблокирован: открытый отрезок тоже считается
    expect(tracker.away(105 * MIN, 110 * MIN)).toBe(true);
    tracker.unlock();
    expect(tracker.away(105 * MIN, 110 * MIN)).toBe(true);
    expect(tracker.away(90 * MIN, 99 * MIN)).toBe(false);
    // Меньше половины окна без пользователя: не помечено
    expect(tracker.away(95 * MIN, 102 * MIN)).toBe(false);
});

it('простой дольше порога считается с последнего ввода, короче порога нет', () => {
    let now = 100 * MIN;
    let idle = 5 * 60;
    const tracker = new AwayTracker(() => idle, () => now);
    tracker.poll();
    expect(tracker.away(95 * MIN, 100 * MIN)).toBe(false);
    now = 120 * MIN;
    idle = 25 * 60;
    tracker.poll();
    now = 121 * MIN;
    idle = 26 * 60;
    tracker.poll();
    expect(tracker.away(96 * MIN, 99 * MIN)).toBe(true);
    expect(tracker.away(119 * MIN, 121 * MIN)).toBe(true);
    expect(tracker.away(90 * MIN, 94 * MIN)).toBe(false);
});

it('старые отрезки забываются, сбой чтения простоя не роняет', () => {
    let now = 100 * MIN;
    const tracker = new AwayTracker(() => { throw new Error('нет данных'); }, () => now, 10 * MIN, 60 * MIN);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    tracker.poll();
    expect(warn).toHaveBeenCalled();
    tracker.lock();
    now = 110 * MIN;
    tracker.unlock();
    now = 200 * MIN;
    tracker.lock();
    tracker.unlock();
    expect(tracker.away(101 * MIN, 109 * MIN)).toBe(false);
    warn.mockRestore();
});
