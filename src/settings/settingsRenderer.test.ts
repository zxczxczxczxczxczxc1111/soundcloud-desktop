// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
    document.body.innerHTML = '';
});

it('загружает настройки из IPC и подключает закрытие без встроенных скриптов', async () => {
    const html = readFileSync(resolve('src/settings/settings.html'), 'utf8');
    document.documentElement.innerHTML = html.replace(/<!doctype html>/i, '');
    expect(document.querySelectorAll('script:not([src])')).toHaveLength(0);
    const send = vi.fn();
    const invoke = vi.fn(async (channel: string): Promise<unknown> => {
        switch (channel) {
            case 'get-settings-state':
                return {
                    theme: 'dark',
                    statusDisplayType: 1,
                    proxyEnabled: true,
                    proxyHost: 'localhost',
                    webhookEnabled: false,
                };
            case 'get-custom-themes':
            case 'get-plugins':
                return [];
            case 'get-current-custom-theme':
                return 'none';
            case 'get-accounts':
                return { accounts: [], currentAccountId: 'default' };
            case 'get-current-track':
                return { title: '', author: '', duration: '', elapsed: '', isPlaying: false, artwork: '' };
            default:
                throw new Error(channel);
        }
    });
    Object.assign(window, { settingsAPI: { send, invoke, on: vi.fn(), openExternal: vi.fn(), openPath: vi.fn() } });
    window.eval(readFileSync(resolve('src/settings/settings.js'), 'utf8'));
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('settings-ready'));
    expect((document.getElementById('useArtistInStatusLineToggle') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('proxyHost') as HTMLInputElement).value).toBe('localhost');
    document.getElementById('close-settings')?.click();
    expect(send).toHaveBeenCalledWith('toggle-settings');
});
