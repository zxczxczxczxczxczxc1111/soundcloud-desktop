// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
    document.body.innerHTML = '';
});

async function openSettings(state: Record<string, unknown>): Promise<ReturnType<typeof vi.fn>> {
    const html = readFileSync(resolve('src/settings/settings.html'), 'utf8');
    document.documentElement.innerHTML = html.replace(/<!doctype html>/i, '');
    expect(document.querySelectorAll('script:not([src])')).toHaveLength(0);
    const send = vi.fn();
    const invoke = vi.fn(async (channel: string): Promise<unknown> => {
        switch (channel) {
            case 'get-settings-state':
                return state;
            case 'get-custom-themes':
            case 'get-plugins':
                return [];
            case 'get-current-custom-theme':
                return 'none';
            case 'get-accounts':
                return { accounts: [], currentAccountId: 'default' };
            case 'get-update-state':
                return { mode: 'portable', version: '0.1.0', enabled: true, hint: 'Подсказка.', status: 'Установлена последняя версия.', releaseUrl: '' };
            case 'get-current-track':
                return { title: '', author: '', duration: '', elapsed: '', isPlaying: false, artwork: '' };
            default:
                throw new Error(channel);
        }
    });
    Object.assign(window, { settingsAPI: { send, invoke, on: vi.fn(), openExternal: vi.fn(), openPath: vi.fn() } });
    window.eval(readFileSync(resolve('src/settings/settings.js'), 'utf8'));
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('settings-ready'));
    return send;
}

it('загружает настройки из IPC и подключает закрытие без встроенных скриптов', async () => {
    const send = await openSettings({ theme: 'dark', statusDisplayType: 1, proxyEnabled: true, proxyHost: 'localhost', webhookEnabled: false });
    expect((document.getElementById('useArtistInStatusLineToggle') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('proxyHost') as HTMLInputElement).value).toBe('localhost');
    await vi.waitFor(() => expect(document.getElementById('updateStatus')?.textContent).toBe('Установлена последняя версия.'));
    expect(document.getElementById('updateHint')?.textContent).toBe('Версия 0.1.0. Подсказка.');
    document.getElementById('close-settings')?.click();
    expect(send).toHaveBeenCalledWith('toggle-settings');
});

it('блоки главной переключаются сразу, язык сайта просит перезагрузку', async () => {
    const send = await openSettings({ theme: 'dark', siteLanguage: 'en', homeMore: false, homeRecent: true });
    const more = document.getElementById('homeMore') as HTMLInputElement;
    expect(more.checked).toBe(false);
    expect((document.getElementById('homeRecent') as HTMLInputElement).checked).toBe(true);
    more.click();
    expect(send).toHaveBeenCalledWith('setting-changed', { key: 'homeMore', value: true });

    const language = document.getElementById('siteLanguage') as HTMLSelectElement;
    expect(language.value).toBe('en');
    expect(document.querySelector('#siteLanguageList')).not.toBeNull();
    expect(document.getElementById('networkNotice')?.hidden).toBe(true);
    language.value = 'ru';
    language.dispatchEvent(new Event('change', { bubbles: true }));
    expect(send).toHaveBeenCalledWith('setting-changed', { key: 'siteLanguage', value: 'ru' });
    expect(document.getElementById('networkNotice')?.hidden).toBe(false);
    document.getElementById('applyNetwork')?.click();
    expect(send).toHaveBeenCalledWith('apply-changes');
});
