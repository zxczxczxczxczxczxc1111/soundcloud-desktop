// «Версии этого трека»: текстовый поиск по разным аккаунтам, точный выбор загрузки и решение «та же запись».
// Раздел страницы волны: installVersions уходит на страницу текстом вместе с волной (pageHelpers в wave.ts) и зовёт
// помощников по голому имени, поэтому импорт через пространство имён и разбор в константы. Всё, что раздел берёт
// у ядра волны, приходит объектом core; наружу он отдаёт только открытие и закрытие диалога
import * as identity from '../trackIdentity';
import type { MatchLevel, RecordingLink } from '../trackIdentity';
import * as waveLinks from '../waveLinks';
import * as waveTexts from '../waveTexts';
import type { MenuTarget, OpenTrackResult, WaveTexts, WaveTrack } from '../waveTypes';
import type { WaveWindow } from '../wave';

const { matchLevel, searchQueries } = identity;
const { trackPath } = waveLinks;
const { fillText, formatTime } = waveTexts;

export interface VersionsCore {
    texts: WaveTexts;
    host: WaveWindow;
    /** Подтверждённые группы копий (загрузка -> корень группы) и связи записей как есть */
    copyGroups(): Map<string, string>;
    recordingLinks(): RecordingLink[];
    /** Решение «та же запись» сохранено: новые группы в ядро, отметки переходят на копии заново */
    linked(groups: Map<string, string>): void;
    el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K];
    button(className: string, act: string, label: string, icon?: string): HTMLButtonElement;
    art(node: HTMLElement, track: WaveTrack, size: 't300x300' | 't500x500'): void;
    artistName(track: WaveTrack): string;
    ensureStyle(): void;
    trackOf(target: MenuTarget): Promise<WaveTrack | null>;
    ensureExclusions(): Promise<void>;
    searchTracks(q: string): Promise<WaveTrack[]>;
    showToast(text: string): void;
    openTrack(path: string, go?: boolean): Promise<OpenTrackResult>;
    ensureUser(): Promise<number>;
    loadCopyGroups(id: number): Promise<Map<string, string>>;
    render(): void;
}

export function installVersions(core: VersionsCore): { open(target: MenuTarget): Promise<void>; close(): void } {
    const { texts: T, host, el, button, art, artistName, ensureStyle, trackOf, ensureExclusions, searchTracks, showToast, openTrack, ensureUser, loadCopyGroups, render } = core;
    const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
    let versionsBox: HTMLElement | null = null;
    let versionsRequest = 0;
    let versionsReturn: HTMLElement | null = null;
    let versionsTrack: WaveTrack | null = null;
    let versionsFound: WaveTrack[] = [];
    function closeVersions(): void {
        versionsRequest++;
        versionsBox?.remove();
        versionsBox = null;
        versionsTrack = null;
        versionsFound = [];
        document.removeEventListener('keydown', onVersionsKey, true);
        const back = versionsReturn;
        versionsReturn = null;
        if (back?.isConnected) back.focus();
    }
    // Esc закрывает, Tab ходит по кругу внутри диалога
    function onVersionsKey(event: KeyboardEvent): void {
        if (!versionsBox) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeVersions();
            return;
        }
        if (event.key !== 'Tab') return;
        const items = [...versionsBox.querySelectorAll<HTMLElement>('button:not(:disabled)')];
        if (!items.length) return;
        const at = items.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at < 0 || at === items.length - 1 ? 0 : at + 1);
        event.preventDefault();
        items[next].focus();
    }
    // Та же запись: подтверждённая группа (пользователь главнее каталога), иначе разбор пары
    function versionLevel(track: WaveTrack, other: WaveTrack): MatchLevel {
        const a = core.copyGroups().get('sc:track:' + track.id);
        if (other.id !== track.id && a && a === core.copyGroups().get('sc:track:' + other.id)) return 'confirmed';
        return matchLevel(track, other, core.recordingLinks());
    }
    function versionsStatus(text: string): HTMLElement {
        const line = el('div', 'scw-hint', text);
        line.setAttribute('role', 'status');
        return line;
    }
    function renderVersions(): void {
        const body = versionsBox?.querySelector<HTMLElement>('.scw-dialog-body');
        const track = versionsTrack;
        if (!body || !track) return;
        const focused = document.activeElement instanceof HTMLElement && body.contains(document.activeElement)
            ? (document.activeElement.dataset.act ?? '') + '|' + (document.activeElement.dataset.track ?? '')
            : '';
        body.textContent = '';
        const same: Array<[WaveTrack, MatchLevel]> = [[track, 'same-upload']];
        const other: Array<[WaveTrack, MatchLevel]> = [];
        for (const found of versionsFound) {
            if (found.id === track.id) continue;
            const level = versionLevel(track, found);
            if (level === 'confirmed' || level === 'probable') same.push([found, level]);
            else if (level === 'version') other.push([found, level]);
        }
        const section = (title: string, rows: Array<[WaveTrack, MatchLevel]>, empty: string): void => {
            body.append(el('div', 'scw-dialog-h', title));
            if (!rows.length) {
                body.append(el('div', 'scw-hint', empty));
                return;
            }
            const list = el('div', 'scw-vlist');
            for (const [item, level] of rows) {
                const line = el('div', 'scw-vrow');
                const play = el('button', 'scw-vplay');
                play.type = 'button';
                play.dataset.act = 'version-play';
                play.dataset.track = String(item.id);
                const cover = el('div', 'scw-art');
                art(cover, item, 't300x300');
                const text = el('div', 'scw-row-t');
                text.append(el('b', '', (item.title ?? '').trim() || '…'), el('span', '', artistName(item)));
                play.append(cover, text);
                const end = el('div', 'scw-row-e');
                const badge = level === 'same-upload' ? T.versionsThis : level === 'confirmed' ? T.versionsConfirmed : level === 'probable' ? T.versionsProbable : '';
                if (badge) end.append(el('span', 'scw-badge', badge));
                end.append(el('span', 'scw-row-d', formatTime(item.full_duration || item.duration || 0)));
                line.append(play, end);
                // Решение пользователя: подтверждённую пару можно разъединить, остальные объединить
                if (level !== 'same-upload') {
                    const link = el('button', 'scw-btn', level === 'confirmed' ? T.versionsUnlink : T.versionsLink);
                    link.type = 'button';
                    link.dataset.act = level === 'confirmed' ? 'version-unlink' : 'version-link';
                    link.dataset.track = String(item.id);
                    line.append(link);
                }
                list.append(line);
            }
            body.append(list);
        };
        section(T.versionsSame, same, T.versionsEmpty);
        section(T.versionsOther, other, T.versionsEmpty);
        if (focused) {
            const [act, id] = focused.split('|');
            body.querySelector<HTMLElement>('[data-act="' + act + '"][data-track="' + id + '"]')?.focus();
        }
    }
    async function openVersions(target: MenuTarget): Promise<void> {
        closeVersions();
        ensureStyle();
        const request = versionsRequest;
        versionsReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const back = el('div', 'scw-dialog-back');
        const dialog = el('div', 'scw-dialog');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'scw-versions-title');
        const head = el('div', 'scw-dialog-top');
        const title = el('b', '', T.menuVersions);
        title.id = 'scw-versions-title';
        const close = button('scw-icon', 'versions-close', T.dialogClose, 'x');
        close.title = T.dialogClose;
        head.append(title, close);
        const body = el('div', 'scw-dialog-body');
        body.append(versionsStatus(T.versionsLoading));
        dialog.append(head, body);
        back.append(dialog);
        back.addEventListener('click', onVersionsClick);
        document.body.append(back);
        document.addEventListener('keydown', onVersionsKey, true);
        versionsBox = back;
        close.focus();
        try {
            const [track] = await Promise.all([trackOf(target), ensureExclusions()]);
            if (request !== versionsRequest) return;
            if (!track) throw new Error('Трек не распознан');
            title.textContent = fillText(T.versionsTitle, { title: (track.title ?? '').trim() || '…' });
            // Для явного действия только текстовый поиск этой версии и других версий песни
            const queries = searchQueries(track).filter((query) => query.purpose !== 'songs');
            let failed = 0;
            const lists = await Promise.all(queries.map((query) => searchTracks(query.q).catch((error: unknown) => {
                failed++;
                console.warn('Версии: поиск не удался', error);
                return [] as WaveTrack[];
            })));
            if (request !== versionsRequest) return;
            if (queries.length && failed === queries.length) throw new Error('Поиск не ответил');
            const seen = new Set<number>();
            versionsTrack = track;
            versionsFound = lists.flat().filter((item) => !seen.has(item.id) && !!seen.add(item.id));
            renderVersions();
        } catch (error) {
            if (request !== versionsRequest) return;
            console.warn('Версии: список не собран', error);
            body.textContent = '';
            body.append(versionsStatus(T.versionsFailed));
        }
    }
    function onVersionsClick(event: MouseEvent): void {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        if (!target.closest('.scw-dialog')) {
            closeVersions();
            return;
        }
        const control = target.closest<HTMLElement>('[data-act]');
        const id = Number(control?.dataset.track);
        switch (control?.dataset.act) {
            case 'versions-close':
                closeVersions();
                return;
            case 'version-play': {
                // Играет ровно выбранная загрузка, страница сайта не меняется
                const item = [versionsTrack, ...versionsFound].find((track) => track?.id === id);
                const path = item ? trackPath(item.permalink_url) : '';
                if (!path) {
                    showToast(T.toastFailed);
                    return;
                }
                void openTrack(path, false).then((result) => {
                    if (result !== 'played' && result !== 'superseded') showToast(T.toastFailed);
                }, (error: unknown) => {
                    console.warn('Версии: трек не включился', error);
                    showToast(T.toastFailed);
                });
                return;
            }
            case 'version-link':
            case 'version-unlink':
                void linkVersion(id, control.dataset.act === 'version-link');
                return;
        }
    }
    async function linkVersion(id: number, same: boolean): Promise<void> {
        const track = versionsTrack;
        const request = versionsRequest;
        if (!track || !isId(id)) return;
        try {
            const user = await ensureUser();
            const saved = user ? await host.soundcloudAPI?.recommend?.setRecordingLink?.(user, 'sc:track:' + track.id, 'sc:track:' + id, same) : false;
            if (saved !== true) {
                showToast(T.toastNotSaved);
                return;
            }
            // Связи перечитываются: запреты и слышанное сразу переходят на подтверждённые копии
            core.linked(await loadCopyGroups(user));
            showToast(same ? T.toastLinked : T.toastUnlinked);
            if (request === versionsRequest) renderVersions();
            render();
        } catch (error) {
            console.warn('Версии: решение не сохранено', error);
            showToast(T.toastFailed);
        }
    }
    return { open: openVersions, close: closeVersions };
}
