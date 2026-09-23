import { expect, it, vi } from 'vitest';
import type { IpcMainEvent, WebContents } from 'electron';
import { isTrustedLocalSender, trustLocalView } from './trustedViews';
it('доверяет только зарегистрированной странице и её главному фрейму', () => {
    let url = 'file:///settings.html';
    const frame = {};
    const contents = { getURL: () => url, mainFrame: frame, setWindowOpenHandler: vi.fn(), on: vi.fn(), once: vi.fn() } as unknown as WebContents;
    const event = { sender: contents, senderFrame: frame } as Pick<IpcMainEvent, 'sender' | 'senderFrame'>;
    expect(isTrustedLocalSender(event)).toBe(false);
    trustLocalView(contents, url);
    expect(isTrustedLocalSender(event)).toBe(true);
    expect(isTrustedLocalSender({ ...event, senderFrame: {} as IpcMainEvent['senderFrame'] })).toBe(false);
    url = 'https://soundcloud.com';
    expect(isTrustedLocalSender(event)).toBe(false);
});
