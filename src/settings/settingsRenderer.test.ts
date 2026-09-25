// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
    document.body.innerHTML = '';
});

async function openSettings(
    state: Record<string, unknown>,
    exclusions: { tracks: object[]; artists: object[]; families?: object[] } = { tracks: [], artists: [] },
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
            case 'get-accounts':
                return { accounts: [{ id: 'default', name: 'Основной аккаунт' }, { id: 'acc_1', name: 'nick_1' }], currentAccountId: 'default' };
            case 'get-update-state':
                return updateState(state.siteLanguage === 'en' ? 'en' : 'ru');
            case 'install-update-now':
                return true;
            case 'get-current-track':
                return { track: { title: '', author: '', duration: '', elapsed: '', isPlaying: false, artwork: '' }, card: null, hidden: 'idle' };
            default:
                throw new Error(channel);
        }
    });
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const on = (channel: string, listener: (...args: unknown[]) => void): void => void listeners.set(channel, listener);
    Object.assign(window, { settingsAPI: { send, invoke, on, openExternal: vi.fn() } });
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
    const { send } = await openSettings({ statusDisplayType: 1, proxyEnabled: true, proxyHost: 'localhost', webhookEnabled: false });
    expect((document.getElementById('useArtistInStatusLineToggle') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('proxyHost') as HTMLInputElement).value).toBe('localhost');
    await vi.waitFor(() => expect(document.getElementById('updateStatus')?.textContent).toBe('Установлена последняя версия.'));
    expect(document.getElementById('updateHint')?.textContent).toBe('Версия 0.1.0. Подсказка.');
    document.getElementById('close-settings')?.click();
    expect(send).toHaveBeenCalledWith('toggle-settings');
});

it('блоки главной переключаются сразу, язык сайта просит перезагрузку', async () => {
    const { send } = await openSettings({ siteLanguage: 'en', homeMore: false, homeRecent: true });
    const more = document.getElementById('homeMore') as HTMLInputElement;
    expect(more.checked).toBe(false);
    expect((document.getElementById('homeRecent') as HTMLInputElement).checked).toBe(true);
    more.click();
    expect(send).toHaveBeenCalledWith('setting-changed', { key: 'homeMore', value: true });

    const language = document.getElementById('siteLanguage') as HTMLSelectElement;
    expect(language.value).toBe('en');
    expect(language.closest('section')?.id).toBe('general');
    expect(document.querySelector('#siteLanguageList')).not.toBeNull();
    expect(document.getElementById('networkNotice')?.hidden).toBe(true);
    // Имя аккаунта по умолчанию переводится, ник с сайта нет
    const accountNames = (): string[] => [...document.querySelectorAll('#accountSelector option')].map((option) => option.textContent ?? '');
    await vi.waitFor(() => expect(accountNames()).toEqual(['Main account', 'nick_1']));
    language.value = 'ru';
    language.dispatchEvent(new Event('change', { bubbles: true }));
    expect(send).toHaveBeenCalledWith('setting-changed', { key: 'siteLanguage', value: 'ru' });
    await vi.waitFor(() => expect(accountNames()).toEqual(['Основной аккаунт', 'nick_1']));
    expect(document.getElementById('networkNotice')?.hidden).toBe(false);
    document.getElementById('applyNetwork')?.click();
    expect(send).toHaveBeenCalledWith('apply-changes');
});

it('показывает исключённое из волны и возвращает трек', async () => {
    const { invoke } = await openSettings(
        {},
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
    const { send, emit } = await openSettings({ siteLanguage: 'ru', gpuCompatibilityMode: 'auto' }, { tracks: [], artists: [{ id: 7, title: 'Станции', artist: '', url: '', at: 1 }] });
    const artists = document.getElementById('waveExcludedArtists') as HTMLElement;
    await vi.waitFor(() => expect(artists.querySelector('button')?.textContent).toBe('Вернуть'));
    expect(document.documentElement.lang).toBe('ru');
    const gpu = document.getElementById('gpuCompatibilityMode')?.parentElement?.querySelector('.dropdown-label') as HTMLElement;
    expect(gpu.textContent).toBe('Автоматически');

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
    await vi.waitFor(() => expect(gpu.textContent).toBe('Automatic'));
    emit('update-state', updateState('en'));
    expect(document.getElementById('updateHint')?.textContent).toBe('Version 0.1.0. Hint.');
    expect(russianLeft()).toEqual([]);

    language.value = 'ru';
    language.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.documentElement.lang).toBe('ru');
    expect(document.getElementById('settingsTitle')?.textContent).toBe('Настройки');
    expect(document.getElementById('proxyHost')?.getAttribute('placeholder')).toBe('Адрес');
    await vi.waitFor(() => expect(artists.querySelector('button')?.textContent).toBe('Вернуть'));
    await vi.waitFor(() => expect(gpu.textContent).toBe('Автоматически'));
});

it('открывается сразу на английском, если сайт английский', async () => {
    await openSettings({ siteLanguage: 'en' });
    expect(document.getElementById('settingsTitle')?.textContent).toBe('Settings');
    await vi.waitFor(() => expect(document.getElementById('waveExcludedTracks')?.textContent).toBe('Empty'));
    expect(document.getElementById('proxyHost')?.getAttribute('placeholder')).toBe('Host');
    expect(russianLeft()).toEqual([]);
});

it('строки карточки: метка встаёт под курсор, ввод сохраняется одной отправкой, «Как было» возвращает шаблон', async () => {
    const { send } = await openSettings({ discordLine1: '{track} · {genre}', discordHiddenArtists: 'Art' });
    const line1 = document.getElementById('discordLine1') as HTMLInputElement;
    const line2 = document.getElementById('discordLine2') as HTMLInputElement;
    const artists = document.getElementById('discordHiddenArtists') as HTMLTextAreaElement;
    expect(line1.value).toBe('{track} · {genre}');
    expect(line2.value).toBe('{artist}');
    expect(artists.value).toBe('Art');
    expect((document.getElementById('discordCoverText') as HTMLInputElement).value).toBe('');

    line2.focus();
    line2.setSelectionRange(0, 0);
    const token = document.querySelector<HTMLElement>('[data-token="{plays}"]')!;
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    token.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    token.click();
    expect(line2.value).toBe('{plays}{artist}');
    expect(document.activeElement).toBe(line2);
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('setting-changed', { key: 'discordLine2', value: '{plays}{artist}' }));

    for (const value of ['Art, B', 'Art, Bo', 'Art, Bob']) {
        artists.value = value;
        artists.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('setting-changed', { key: 'discordHiddenArtists', value: 'Art, Bob' }));
    expect(send.mock.calls.filter(([, change]) => (change as { key?: string })?.key === 'discordHiddenArtists')).toHaveLength(1);

    document.getElementById('discordTemplateReset')?.click();
    expect(line1.value).toBe('{track}');
    expect(line2.value).toBe('{artist}');
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('setting-changed', { key: 'discordLine1', value: '{track}' }));
    expect(send).toHaveBeenCalledWith('setting-changed', { key: 'discordLine2', value: '{artist}' });
    expect(send.mock.calls.some(([, change]) => (change as { key?: string })?.key === 'discordCoverText')).toBe(false);
});

it('предпросмотр рисует карточку из main и объясняет, почему её нет', async () => {
    const { send, emit } = await openSettings({ discordIncognito: false });
    const track = { title: 'Song', author: 'Art', duration: '3:00', elapsed: '0:10', isPlaying: false, artwork: '', url: 'https://soundcloud.com/art/song' };
    emit('presence-preview-update', {
        track,
        card: { details: 'Song · techno', state: '1,5 млн', largeText: 'Art', image: 'soundcloud-logo', statusLine: 'Art' },
        hidden: null,
    });
    const content = document.querySelector('#activitySectionPreview .activity-content-preview') as HTMLElement;
    expect(content.querySelector('.activity-name-preview')?.textContent).toBe('Song · techno');
    expect(content.querySelector('.activity-details-text-preview')?.textContent).toBe('1,5 млн');
    expect(content.querySelector<HTMLElement>('.activity-image-preview')?.title).toBe('Art');
    expect(content.querySelector('.activity-image-preview img')?.getAttribute('src')).not.toBe('');
    expect(content.querySelector('.member-line-preview b')?.textContent).toBe('Art');
    expect(content.querySelector('.member-line-preview')?.textContent).not.toContain('Listening to');
    expect(document.getElementById('noActivityPreview')?.style.display).toBe('none');

    emit('presence-preview-update', { track, card: null, hidden: 'incognito' });
    expect(document.querySelector('.activity-content-preview')).toBeNull();
    const empty = document.getElementById('noActivityPreview') as HTMLElement;
    expect(empty.style.display).toBe('block');
    expect(empty.textContent).toBe('Инкогнито: Discord не видит, что играет');
    emit('presence-preview-update', { track, card: null, hidden: 'genre' });
    expect(empty.textContent).toBe('Жанр в списке скрытых, Discord его не видит');

    const incognito = document.getElementById('discordIncognito') as HTMLInputElement;
    expect(incognito.checked).toBe(false);
    incognito.click();
    expect(send).toHaveBeenCalledWith('setting-changed', { key: 'discordIncognito', value: true });
    // Переключили из трея или клавишей: галочка догоняет
    emit('discord-incognito-changed', false);
    expect(incognito.checked).toBe(false);
});

it('скачанное обновление можно поставить из F1 с перезапуском', async () => {
    const { invoke, emit } = await openSettings({});
    const install = document.getElementById('installUpdate') as HTMLButtonElement;
    await vi.waitFor(() => expect(document.getElementById('updateStatus')?.textContent).toBe('Установлена последняя версия.'));
    expect(install.hidden).toBe(true);
    emit('update-state', { ...updateState('ru'), mode: 'installer', status: 'Версия 0.2.0 скачана.', canInstall: true });
    expect(install.hidden).toBe(false);
    expect(install.textContent).toBe('Установить и перезапустить');
    install.click();
    expect(install.disabled).toBe(true);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('install-update-now'));
    emit('update-state', { ...updateState('ru'), mode: 'installer', canInstall: false });
    expect(install.hidden).toBe(true);
});

it('радар: день, время и часовой пояс уходят в main, неполное время не сохраняется; «Только эта версия» снимается', async () => {
    const exclusions = { tracks: [], artists: [], families: [{ id: 555, title: 'Song', artist: 'Art', url: '', at: 1, artistId: 900 }] };
    const { send, invoke } = await openSettings({ siteLanguage: 'en', radarDay: 5, radarTime: '09:00', radarZone: 'Europe/Moscow' }, exclusions);
    const day = document.getElementById('radarDay') as HTMLSelectElement;
    const time = document.getElementById('radarTime') as HTMLInputElement;
    const zone = document.getElementById('radarZone') as HTMLSelectElement;
    expect(day.closest('section')?.id).toBe('wave');
    expect(day.value).toBe('5');
    expect(day.parentElement?.querySelector('.dropdown-label')?.textContent).toBe('Friday');
    expect(time.value).toBe('09:00');
    expect(zone.value).toBe('Europe/Moscow');

    day.value = '0';
    day.dispatchEvent(new Event('change', { bubbles: true }));
    expect(send).toHaveBeenCalledWith('setting-changed', { key: 'radarDay', value: 0 });
    time.value = '18:30';
    time.dispatchEvent(new Event('change', { bubbles: true }));
    expect(send).toHaveBeenCalledWith('setting-changed', { key: 'radarTime', value: '18:30' });
    time.value = '';
    time.dispatchEvent(new Event('change', { bubbles: true }));
    expect(time.value).toBe('18:30');
    expect(send.mock.calls.filter(([, change]) => (change as { key?: string })?.key === 'radarTime')).toHaveLength(1);
    zone.value = 'Asia/Tokyo';
    zone.dispatchEvent(new Event('change', { bubbles: true }));
    expect(send).toHaveBeenCalledWith('setting-changed', { key: 'radarZone', value: 'Asia/Tokyo' });

    const families = document.getElementById('waveFamilies') as HTMLElement;
    await vi.waitFor(() => expect(families.querySelector('.excluded-title')?.textContent).toBe('Song'));
    expect(document.getElementById('waveFamiliesCount')?.textContent).toBe('1');
    families.querySelector('button')?.click();
    expect(invoke).toHaveBeenCalledWith('remove-wave-exclusion', 'family', 555);
    expect(russianLeft()).toEqual([]);
});

it('волна на главной включается с вкладки «Моя волна»', async () => {
    const { send } = await openSettings({ homeWave: true });
    const wave = document.getElementById('homeWave') as HTMLInputElement;
    expect(wave.closest('section')?.id).toBe('wave');
    expect(wave.checked).toBe(true);
    wave.click();
    expect(send).toHaveBeenCalledWith('setting-changed', { key: 'homeWave', value: false });
});
