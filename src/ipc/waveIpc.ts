// «Моя волна»: журнал «Нового», сигналы прослушиваний, пустая волна, отметки, вкус, подборки дня и «Моя музыка»
import type { DiagnosticJournal } from '../services/diagnosticJournal';
import type { LibraryService } from '../services/libraryService';
import type { WaveExclusions } from '../services/waveExclusions';
import type { WaveJournal } from '../services/waveJournal';
import type { WaveShelf } from '../services/waveShelf';
import type { WaveSignals } from '../services/waveSignals';
import { TASTE_PARAMS } from '../services/tasteParams';
import { validateSettingChange, type SettingChange } from '../settings/validateSetting';
import type { IpcRegistry, MessageTarget, SenderCheck, Settings, SitePage } from './ipcTypes';

export interface WaveIpcDeps {
    trustedSite: SenderCheck;
    trustedLocal: SenderCheck;
    store: Settings;
    diagnostics: Pick<DiagnosticJournal, 'record'>;
    /** Журнал и сигналы пересоздаются при повторном init: берутся в момент запроса */
    journal(): Pick<WaveJournal, 'load' | 'add'> | null;
    signals(): Pick<WaveSignals, 'add'> | null;
    exclusions: Pick<WaveExclusions, 'load' | 'set' | 'currentUser'>;
    library: Pick<LibraryService, 'request' | 'invalidate'>;
    shelf: Pick<WaveShelf, 'load' | 'save'>;
    settingsView(): MessageTarget | undefined;
    page(): SitePage;
    applySettingChange(change: SettingChange): void;
}

export function registerWaveIpc(ipc: IpcRegistry, deps: WaveIpcDeps): void {
    const { trustedSite: isTrustedSoundCloudSender, trustedLocal: isTrustedLocalSender, store, diagnostics, exclusions, library, shelf } = deps;
    ipc.removeHandler('soundcloud:wave-journal:load');
    ipc.removeAllListeners('soundcloud:wave-journal:add');
    ipc.handle('soundcloud:wave-journal:load', (event, userId: unknown) => (isTrustedSoundCloudSender(event) ? deps.journal()?.load(userId) ?? [] : []));
    ipc.on('soundcloud:wave-journal:add', (event, userId: unknown, ids: unknown) => {
        if (isTrustedSoundCloudSender(event)) deps.journal()?.add(userId, ids);
    });
    // Журнал сигналов: как слушается каждый трек, из него потом учится подбор
    ipc.removeAllListeners('soundcloud:wave-signals:add');
    ipc.on('soundcloud:wave-signals:add', (event, userId: unknown, signals: unknown) => {
        if (isTrustedSoundCloudSender(event)) deps.signals()?.add(userId, signals);
    });
    ipc.removeAllListeners('soundcloud:wave-empty');
    ipc.on('soundcloud:wave-empty', (event, counts: unknown) => {
        if (!isTrustedSoundCloudSender(event) || !counts || typeof counts !== 'object') return;
        const value = counts as Record<string, unknown>;
        const count = (input: unknown): number => (typeof input === 'number' && Number.isSafeInteger(input) && input >= 0 ? Math.min(input, 10000) : 0);
        diagnostics.record('wave.empty', { waveSeen: count(value.seen), waveArtistTracks: count(value.artistTracks), waveMoodTags: count(value.moodTags) });
    });
    // Отметки волны («Не нравится», скрытые артисты, «Не сейчас», «Больше такого»): ставит страница, снимает и F1
    for (const channel of ['soundcloud:wave-exclusions:load', 'soundcloud:wave-exclusions:set', 'get-wave-exclusions', 'remove-wave-exclusion', 'soundcloud:wave-taste', 'soundcloud:wave-shelf:load', 'soundcloud:wave-shelf:save', 'soundcloud:wave-library:load', 'soundcloud:wave-library:save', 'soundcloud:wave-library:heard']) ipc.removeHandler(channel);
    ipc.handle('soundcloud:wave-exclusions:load', (event, userId: unknown) =>
        isTrustedSoundCloudSender(event) ? exclusions.load(userId) : null,
    );
    ipc.handle('soundcloud:wave-exclusions:set', (event, userId: unknown, kind: unknown, entry: unknown, excluded: unknown) => {
        if (!isTrustedSoundCloudSender(event)) return false;
        const saved = exclusions.set(userId, kind, entry, excluded);
        if (saved) {
            deps.settingsView()?.send('wave-exclusions-changed');
            // «Больше такого» учит модель вкуса, «Не нравится» снимает его с трека
            library.invalidate(userId, exclusions.load(userId).more.map((entry) => ({ id: entry.id, artist: entry.artistId ?? 0, genre: entry.genre ?? '', tags: entry.tags ?? '', at: entry.at })));
        }
        return saved;
    });
    ipc.handle('get-wave-exclusions', (event) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        return exclusions.load(exclusions.currentUser());
    });
    ipc.handle('remove-wave-exclusion', (event, kind: unknown, id: unknown) => {
        if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');
        const userId = exclusions.currentUser();
        if (!exclusions.set(userId, kind, { id }, false)) throw new Error('Отметка не снята');
        library.invalidate(userId, exclusions.load(userId).more.map((entry) => ({ id: entry.id, artist: entry.artistId ?? 0, genre: entry.genre ?? '', tags: entry.tags ?? '', at: entry.at })));
        // Страница держит отметки у себя, поэтому перечитывает их по сигналу
        const page = deps.page();
        if (!page.isDestroyed())
            page.executeJavaScript('window.__scWaveExclusionsChanged && window.__scWaveExclusionsChanged()').catch((error: unknown) => {
                console.warn('Волна не перечитала исключения:', error);
            });
    });
    ipc.handle('soundcloud:wave-taste', async (event, userId: unknown) => {
        if (!isTrustedSoundCloudSender(event)) return null;
        try {
            return await library.request('profile', userId);
        } catch (error) {
            console.warn('Вкус волны не посчитан:', error);
            return null;
        }
    });
    // Подборки дня: снимок собирает страница, main хранит его до полуночи и подсказывает, что звучало за 30 дней
    ipc.handle('soundcloud:wave-shelf:load', async (event, userId: unknown) => {
        if (!isTrustedSoundCloudSender(event)) return null;
        let recent: number[] = [];
        type ShelfTrack = { id: number; artist: number; title: string; artistName: string; genre: string; tags: string; path: string; artwork: string; dur: number };
        // Прослушанное от 30 секунд за 90 дней с жанром и тегами: из него тоже строятся жанры полки
        const heard = new Map<number, ShelfTrack>();
        try {
            if (typeof userId === 'number' && Number.isSafeInteger(userId) && userId > 0) {
                const since = Date.now() - 30 * 86400000;
                const plays = await library.request('tastePlays', userId, Date.now() - 90 * 86400000);
                recent = [...new Set(plays.filter((play) => play.at >= since).map((play) => play.id))].slice(-5000);
                for (const play of plays)
                    if (play.heard >= 30000 && !heard.has(play.id))
                        heard.set(play.id, { id: play.id, artist: play.artist, title: play.title, artistName: play.artistName, genre: play.genre, tags: play.tags, path: play.path, artwork: play.artwork, dur: play.dur });
            }
        } catch (error) {
            console.warn('Недавние прослушивания для подборок не прочитаны:', error);
        }
        // Треки своих и сохранённых плейлистов из хранилища рекомендаций: жанры полки берут и их (Э6).
        // Пути и обложки там нет: обложки карточки берутся у лайков, треки при раскрытии перечитывает trackBatch.
        // share это доля лайка, как в модели вкуса: вкус хранит только тысячу самых весомых треков, и слабые плейлистные
        // из него выпадают, поэтому полка получает долю напрямую
        let playlists: Array<ShelfTrack & { share: number }> = [];
        try {
            if (typeof userId === 'number' && Number.isSafeInteger(userId) && userId > 0)
                playlists = (await library.request('playlistTracks', userId)).flatMap((entry) => (entry.upload ? [{
                    id: entry.id, artist: entry.upload.uploader, title: entry.upload.title, artistName: entry.upload.uploaderName, genre: entry.upload.genre,
                    tags: entry.upload.tags, path: '', artwork: '', dur: entry.upload.duration, share: entry.own ? TASTE_PARAMS.playlistOwn : TASTE_PARAMS.playlistSaved,
                }] : [])).slice(0, 5000);
        } catch (error) {
            console.warn('Треки плейлистов для подборок не прочитаны:', error);
        }
        // Лайки за 30 дней по датам библиотеки: в «Давно не слушал» они не идут. Лайк без даты свежим не считается
        let fresh: number[] = [];
        try {
            if (typeof userId === 'number' && Number.isSafeInteger(userId) && userId > 0) {
                const since = Date.now() - 30 * 86400000;
                fresh = (await library.request('libraryMembers', userId, 'likes'))
                    .filter((member) => member.added >= since)
                    .map((member) => Number(member.key.slice('sc:track:'.length)))
                    .filter((id) => Number.isSafeInteger(id) && id > 0)
                    .slice(0, 5000);
            }
        } catch (error) {
            console.warn('Свежие лайки для подборок не прочитаны:', error);
        }
        return { snapshot: shelf.load(userId), recent, heard: [...heard.values()].slice(-3000), playlists, fresh };
    });
    ipc.handle('soundcloud:wave-shelf:save', (event, userId: unknown, snapshot: unknown) =>
        isTrustedSoundCloudSender(event) ? shelf.save(userId, snapshot) : false,
    );
    // «Моя музыка»: выбор источников и режим живут в настройках (попадают в резервную копию), ввод проверяется как смена в F1
    ipc.handle('soundcloud:wave-library:load', (event) => {
        if (!isTrustedSoundCloudSender(event)) return null;
        const value = store.get('myMusic');
        return validateSettingChange({ key: 'myMusic', value }) ? value : null;
    });
    ipc.handle('soundcloud:wave-library:save', (event, value: unknown) => {
        if (!isTrustedSoundCloudSender(event)) return false;
        const change = { key: 'myMusic', value };
        if (!validateSettingChange(change)) return false;
        deps.applySettingChange(change);
        return true;
    });
    // Слышанное в клиенте за 3 дня от 30 секунд: в перемешивании «Моей музыки» оно не играет
    ipc.handle('soundcloud:wave-library:heard', async (event, userId: unknown) => {
        if (!isTrustedSoundCloudSender(event) || typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) return [];
        try {
            const plays = await library.request('tastePlays', userId, Date.now() - 3 * 86400000);
            return [...new Set(plays.filter((play) => play.heard >= 30000).map((play) => play.id))].slice(0, 20000);
        } catch (error) {
            console.warn('Слышанное за 3 дня не прочитано:', error);
            return [];
        }
    });
}
