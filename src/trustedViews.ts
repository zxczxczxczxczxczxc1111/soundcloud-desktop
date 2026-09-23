import type { IpcMainEvent, WebContents } from 'electron';
import { pathToFileURL } from 'url';

const trusted = new WeakMap<WebContents, string>();
export function trustLocalView(contents: WebContents, url: string): void {
    const first = !trusted.has(contents);
    trusted.set(contents, url);
    if (!first) return;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, target) => {
        if (target !== trusted.get(contents)) event.preventDefault();
    });
    contents.once('destroyed', () => trusted.delete(contents));
}
export function trustLocalFile(contents: WebContents, file: string): void {
    trustLocalView(contents, pathToFileURL(file).href);
}
export function isTrustedLocalSender(event: Pick<IpcMainEvent, 'sender' | 'senderFrame'>): boolean {
    const url = trusted.get(event.sender);
    return url !== undefined && event.senderFrame === event.sender.mainFrame && url === event.sender.getURL();
}
