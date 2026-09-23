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
): Promise<{ send: ReturnType<typeof vi.fn>; invoke: ReturnType<typeof vi.fn>; emit: (channel: string, ...args: unknown[]) => void }> {
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
                return updateState(state.siteLanguage === 'en' ? 'en' : 'ru');
            case 'get-current-track':
                return { title: '', author: '', duration: '', elapsed: '', isPlaying: false, artwork: '' };
            default:
                throw new Error(channel);
        }
    });
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const on = (channel: string, listener: (...args: unknown[]) => void): void => void listeners.set(channel, listener);
    Object.assign(window, { settingsAPI: { send, invoke, on, openExternal: vi.fn(), openPath: vi.fn() } });
    window.eval(readFileSync(resolve('src/settings/settingsText.js'), 'utf8'));
    window.eval(readFileSync(resolve('src/settings/settings.js'), 'utf8'));
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('settings-ready'));
    return { send, invoke, emit: (channel, ...args) => listeners.get(channel)?.(...args) };
}

// Строки обновлений main присылает уже на языке панели
function updateState(language: 'ru' | 'en'): Record<string, unknown> {
    const [hint, status] = language === 'en' ? ['Hint.', 'You have the latest version.'] : ['Подсказка.', 'Установлена последняя версия.'];
    return { mode: 'portable', version: '0.1.0', enabled: true, hint, status, releaseUrl: '' };
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

// Кириллица вне data-no-i18n: там только пользовательские названия и самоназвание языка
function russianLeft(): string[] {
    const left: string[] = [];
    const cyrillic = /[А-Яа-яЁё]/;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode())
        if (cyrillic.test(node.nodeValue ?? '') && !node.parentElement?.closest('[data-no-i18n]')) left.push(node.nodeValue ?? '');
    for (const element of document.body.querySelectorAll('[title], [aria-label], [placeholder], [alt]'))
        for (const name of ['title', 'aria-label', 'placeholder', 'alt']) {
            const value = element.getAttribute(name);
            if (value && cyrillic.test(value) && !element.closest('[data-no-i18n]')) left.push(value);
        }
    return left;
}

it('переводит панель на английский и обратно без перезагрузки', async () => {
    const { send, emit } = await openSettings({ theme: 'dark', siteLanguage: 'ru' }, { tracks: [], artists: [{ id: 7, title: 'Станции', artist: '', url: '', at: 1 }] });
    const artists = document.getElementById('waveExcludedArtists') as HTMLElement;
    await vi.waitFor(() => expect(artists.querySelector('button')?.textContent).toBe('Вернуть'));
    expect(document.documentElement.lang).toBe('ru');
    const theme = document.getElementById('customThemeSelector')?.parentElement?.querySelector('.dropdown-label') as HTMLElement;
    expect(theme.textContent).toBe('Без темы');

    const language = document.getElementById('siteLanguage') as HTMLSelectElement;
    language.value = 'en';
    language.dispatchEvent(new Event('change', { bubbles: true }));
    expect(send).toHaveBeenCalledWith('setting-changed', { key: 'siteLanguage', value: 'en' });
    expect(document.documentElement.lang).toBe('en');
    expect(document.getElementById('settingsTitle')?.textContent).toBe('Settings');
    expect(document.getElementById('close-settings')?.getAttribute('title')).toBe('Close, F1 or Esc');
    expect(document.getElementById('homeMore')?.closest('label')?.textContent).toBe('More of what you like');
    expect(language.closest('.row')?.querySelector('.text')?.textContent).toBe('Language');
    await vi.waitFor(() => expect(artists.querySelector('button')?.textContent).toBe('Restore'));
    // Название совпало с подписью панели, но это данные
    expect(artists.querySelector('.excluded-title')?.textContent).toBe('Станции');
    expect(document.getElementById('waveExcludedTracks')?.textContent).toBe('Empty');
    await vi.waitFor(() => expect(document.getElementById('pluginList')?.textContent).toBe('The plugins folder is empty'));
    await vi.waitFor(() => expect(theme.textContent).toBe('No theme'));
    emit('update-state', updateState('en'));
    expect(document.getElementById('updateHint')?.textContent).toBe('Version 0.1.0. Hint.');
    expect(russianLeft()).toEqual([]);

    language.value = 'ru';
    language.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.documentElement.lang).toBe('ru');
    expect(document.getElementById('settingsTitle')?.textContent).toBe('Настройки');
    expect(document.getElementById('proxyHost')?.getAttribute('placeholder')).toBe('Адрес');
    await vi.waitFor(() => expect(artists.querySelector('button')?.textContent).toBe('Вернуть'));
    await vi.waitFor(() => expect(theme.textContent).toBe('Без темы'));
});

it('открывается сразу на английском, если сайт английский', async () => {
    await openSettings({ theme: 'dark', siteLanguage: 'en' });
    expect(document.getElementById('settingsTitle')?.textContent).toBe('Settings');
    await vi.waitFor(() => expect(document.getElementById('waveExcludedTracks')?.textContent).toBe('Empty'));
    expect(document.getElementById('proxyHost')?.getAttribute('placeholder')).toBe('Host');
    expect(russianLeft()).toEqual([]);
});

it('волна на главной включается с вкладки «Моя волна»', async () => {
    const { send } = await openSettings({ theme: 'dark', homeWave: true });
    const wave = document.getElementById('homeWave') as HTMLInputElement;
    expect(wave.closest('section')?.id).toBe('wave');
    expect(wave.checked).toBe(true);
    wave.click();
    expect(send).toHaveBeenCalledWith('setting-changed', { key: 'homeWave', value: false });
});
