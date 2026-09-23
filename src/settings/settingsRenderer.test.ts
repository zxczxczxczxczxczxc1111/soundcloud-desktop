// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
    document.body.innerHTML = '';
});

async function openSettings(
    state: Record<string, unknown>,
    exclusions: { tracks: object[]; artists: object[] } = { tracks: [], artists: [] },
): Promise<{ send: ReturnType<typeof vi.fn>; invoke: ReturnType<typeof vi.fn> }> {
    const html = readFileSync(resolve('src/settings/settings.html'), 'utf8');
    document.documentElement.innerHTML = html.replace(/<!doctype html>/i, '');
    expect(document.querySelectorAll('script:not([src])')).toHaveLength(0);
    const send = vi.fn();
    const invoke = vi.fn(async (channel: string, ...args: unknown[]): Promise<unknown> => {
        switch (channel) {
            case 'get-wave-exclusions':
                return exclusions;
            case 'remove-wave-exclusion':
                exclusions.tracks = exclusions.tracks.filter((entry) => (entry as { id: unknown }).id !== args[1]);
                return undefined;
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
    return { send, invoke };
}

it('загружает настройки из IPC и подключает закрытие без встроенных скриптов', async () => {
    const { send } = await openSettings({ theme: 'dark', statusDisplayType: 1, proxyEnabled: true, proxyHost: 'localhost', webhookEnabled: false });
    expect((document.getElementById('useArtistInStatusLineToggle') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('proxyHost') as HTMLInputElement).value).toBe('localhost');
    await vi.waitFor(() => expect(document.getElementById('updateStatus')?.textContent).toBe('Установлена последняя версия.'));
    expect(document.getElementById('updateHint')?.textContent).toBe('Версия 0.1.0. Подсказка.');
    document.getElementById('close-settings')?.click();
    expect(send).toHaveBeenCalledWith('toggle-settings');
});

it('блоки главной переключаются сразу, язык сайта просит перезагрузку', async () => {
    const { send } = await openSettings({ theme: 'dark', siteLanguage: 'en', homeMore: false, homeRecent: true });
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

it('показывает исключённое из волны и возвращает трек', async () => {
    const { invoke } = await openSettings(
        { theme: 'dark' },
        { tracks: [{ id: 5, title: '<b>Трек</b>', artist: 'Артист', url: '', at: 1 }], artists: [] },
    );
    const tracks = document.getElementById('waveExcludedTracks') as HTMLElement;
    await vi.waitFor(() => expect(tracks.querySelector('.excluded-title')?.textContent).toBe('<b>Трек</b>'));
    expect(tracks.closest('details')?.open).toBe(false);
    expect(document.getElementById('waveExcludedTracksCount')?.textContent).toBe('1');
    expect(document.getElementById('waveExcludedArtistsCount')?.textContent).toBe('0');
    expect(tracks.querySelector('b')).toBeNull();
    expect(tracks.textContent).toContain('Артист');
    expect(document.getElementById('waveExcludedArtists')?.textContent).toBe('Пусто');
    tracks.querySelector('button')?.click();
    expect(invoke).toHaveBeenCalledWith('remove-wave-exclusion', 'track', 5);
    await vi.waitFor(() => expect(tracks.textContent).toBe('Пусто'));
    expect(document.getElementById('waveExcludedTracksCount')?.textContent).toBe('0');
});

it('волна на главной включается с вкладки «Моя волна»', async () => {
    const { send } = await openSettings({ theme: 'dark', homeWave: true });
    const wave = document.getElementById('homeWave') as HTMLInputElement;
    expect(wave.closest('section')?.id).toBe('wave');
    expect(wave.checked).toBe(true);
    wave.click();
    expect(send).toHaveBeenCalledWith('setting-changed', { key: 'homeWave', value: false });
});
