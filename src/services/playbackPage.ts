import type { SitePlayer, SiteQueueItem, WaveTrack, WaveWindow } from './wave';
import type { PlaybackSnapshot, LocalMix } from './playbackStore';

export interface PlaybackPageHost {
    player(): SitePlayer | null;
    user(): Promise<number>;
    library: NonNullable<WaveWindow['soundcloudAPI']>['library'];
    language: string;
    snapshot(): PlaybackSnapshot | null;
    restore(snapshot: PlaybackSnapshot, tracks: WaveTrack[]): boolean;
    resolve(ids: number[]): Promise<WaveTrack[]>;
    create(track: WaveTrack): SiteQueueItem | null;
    changed(): void;
}
export interface PlaybackPage {
    ready(): Promise<boolean>;
    add(track: WaveTrack, next: boolean): void;
    /** Пакет одной пересборкой очереди; возвращает, сколько поставлено */
    addMany(tracks: WaveTrack[], next: boolean): number;
    toggle(): void;
    save(): Promise<void>;
    tick(): void;
    dispose(): void;
}

// Сериализуется для страницы целиком, без зависимостей от Node и импортированных функций.
export function installPlaybackPage(host: PlaybackPageHost): PlaybackPage {
    const ru = host.language === 'ru';
    const text = (a: string, b: string): string => ru ? a : b;
    let disposed = false;
    let restoring = false;
    let restored = false;
    let restoreFailures = 0;
    let restoreRetryAt = Infinity;
    let restoreStarted = false;
    let restorePrevious: SiteQueueItem | null | undefined;
    let dialog: HTMLDialogElement | null = null;
    let mixes: LocalMix[] = [];
    let saving: Promise<void> | null = null;
    let revision = 0;
    let queueOffset = 0;
    let lastQueue = '';
    let lastSave = 0;
    let lastState = '';
    let dragged: SiteQueueItem | null = null;
    const rowKeys = new WeakMap<SiteQueueItem, number>();
    let nextRowKey = 0;
    const style = document.createElement('style');
    style.textContent = `
      #sc-desktop-queue{color:#eee;background:#181818;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:24px;width:min(680px,92vw);max-height:84vh;box-sizing:border-box;font:inherit;font-size:14px;line-height:1.4;overflow:auto;box-shadow:0 16px 64px #0006}
      #sc-desktop-queue::backdrop{background:rgba(0,0,0,.55)}
      #sc-desktop-queue[open]{display:flex;flex-direction:column;overflow:hidden;animation:scq-enter .14s cubic-bezier(.2,0,0,1)}
      #sc-desktop-queue[open]::backdrop{animation:scq-backdrop .14s ease-out}
      @keyframes scq-enter{from{opacity:0;transform:translateY(6px)}}
      @keyframes scq-backdrop{from{opacity:0}}
      #sc-desktop-queue *{box-sizing:border-box}
      #sc-desktop-queue header,#sc-desktop-queue .scq-row,#sc-desktop-queue .scq-tools{display:flex;align-items:center;gap:8px}
      #sc-desktop-queue header{margin:0 0 18px;flex:none}#sc-desktop-queue h2{margin:0;font-size:20px;font-weight:600;letter-spacing:-.3px}
      #sc-desktop-queue .scq-count{flex:1;color:#999;font-size:12px;margin-left:2px}
      #sc-desktop-queue h3{margin:24px 0 8px;font-size:13px;font-weight:500;color:#999;flex:none}
      #sc-desktop-queue button,#sc-desktop-queue input{font:inherit;color:inherit;background:transparent;border:0;border-radius:5px}
      #sc-desktop-queue button{cursor:pointer;padding:7px 10px}#sc-desktop-queue button:disabled{opacity:.25;cursor:default}
      #sc-desktop-queue button:focus-visible,#sc-desktop-queue input:focus-visible{outline:2px solid #f50;outline-offset:2px}
      #sc-desktop-queue .scq-list{max-height:48vh;min-height:48px;flex:1 1 auto;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#555 transparent}
      #sc-desktop-queue .scq-row{min-height:48px;border-radius:6px;padding:2px 4px;gap:4px;transition:background-color .12s}
      #sc-desktop-queue .scq-row:hover,#sc-desktop-queue .scq-row:focus-within{background:#ffffff08}
      #sc-desktop-queue .scq-number{width:28px;flex-shrink:0;color:#777;text-align:center;font-size:12px;font-variant-numeric:tabular-nums}
      #sc-desktop-queue .scq-name{flex:1;min-width:0;text-align:left;padding:4px 6px;overflow:hidden;line-height:1.3}
      #sc-desktop-queue .scq-track,#sc-desktop-queue .scq-artist{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #sc-desktop-queue .scq-track{font-weight:500}#sc-desktop-queue .scq-artist{font-size:12px;color:#999;margin-top:2px}
      #sc-desktop-queue .scq-current .scq-track,#sc-desktop-queue .scq-current .scq-number{color:#ff7133}
      #sc-desktop-queue .scq-icon{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:6px;flex-shrink:0;color:#999}
      #sc-desktop-queue .scq-icon svg{width:16px;height:16px;pointer-events:none}
      #sc-desktop-queue .scq-icon,#sc-desktop-queue .scq-save{transition:background-color .12s,color .12s}
      #sc-desktop-queue .scq-row[draggable="true"]{cursor:grab}#sc-desktop-queue .scq-row.scq-drop-target{box-shadow:inset 0 2px #f50}
      #sc-desktop-queue .scq-icon:hover:not(:disabled){background:#ffffff12;color:#eee}
      #sc-desktop-queue .scq-actions{display:flex;gap:2px;opacity:0;transition:opacity .12s}
      #sc-desktop-queue .scq-row:hover .scq-actions,#sc-desktop-queue .scq-row:focus-within .scq-actions{opacity:1}
      #sc-desktop-queue .scq-message{color:#aaa;font-size:12px;margin:0 0 12px;flex:none}#sc-desktop-queue .scq-message:empty{display:none}
      #sc-desktop-queue .scq-tools{margin-top:16px;padding-top:16px;border-top:1px solid #ffffff0d;flex-wrap:wrap;flex:none}
      #sc-desktop-queue input{flex:1;min-width:120px;padding:9px 10px;background:#ffffff06;border:1px solid #ffffff12}
      #sc-desktop-queue input::placeholder{color:#777}#sc-desktop-queue .scq-save{background:#303030;font-weight:500;padding:9px 14px}
      #sc-desktop-queue .scq-save:hover{background:#3a3a3a}#sc-desktop-queue .scq-mixes{color:#999;font-size:12px;max-height:120px;min-height:20px;flex:none;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}
      #sc-desktop-queue .scq-mixes .scq-row{min-height:40px}#sc-desktop-queue .scq-mixes .scq-name{color:#ddd;font-size:14px}
      @media(hover:none){#sc-desktop-queue .scq-actions{opacity:1}}
      @media(prefers-reduced-motion:reduce){#sc-desktop-queue .scq-actions{transition:none}}
      html.scm-reduce #sc-desktop-queue,html.scm-reduce #sc-desktop-queue::backdrop,html.scm-reduce #sc-desktop-queue *{animation:none;transition:none}
      @media(prefers-reduced-motion:reduce){#sc-desktop-queue,#sc-desktop-queue::backdrop,#sc-desktop-queue *{animation:none;transition:none}}
    `;
    document.head.append(style);
    const queue = (): { player: SitePlayer; items: SiteQueueItem[]; index: number } | null => {
        const player = host.player();
        return player ? { player, items: player.getQueue().slice(), index: player.getQueueState().currentIndex } : null;
    };
    function message(value: string): void {
        const node = dialog?.querySelector('.scq-message');
        if (node) node.textContent = value;
    }
    function fail(error: unknown): void {
        console.warn('Очередь клиента:', error);
        message(text('Не удалось выполнить действие. Проверь соединение и повтори.', 'Could not finish. Check your connection and try again.'));
    }
    function button(label: string, action: () => void, title = label): HTMLButtonElement {
        const node = document.createElement('button');
        node.type = 'button'; node.textContent = label; node.title = title; node.setAttribute('aria-label', title);
        node.addEventListener('click', action); return node;
    }
    function iconButton(path: string, title: string, action: () => void): HTMLButtonElement {
        const node = button('', action, title); node.className = 'scq-icon';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.5'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
        const shape = document.createElementNS(svg.namespaceURI, 'path'); shape.setAttribute('d', path); svg.append(shape); node.append(svg);
        return node;
    }
    function changed(): void { revision++; host.changed(); void save().catch(fail); renderQueue(); }
    function move(item: SiteQueueItem, delta: number): void {
        const current = queue();
        if (!current) return;
        const at = current.items.indexOf(item);
        const to = at + delta;
        if (at <= current.index || to <= current.index || to >= current.items.length) return;
        const playing = current.player.getCurrentQueueItem();
        current.items.splice(at, 1); current.items.splice(to, 0, item);
        current.player.getQueue().reset(current.items);
        if (playing) current.player.setCurrentItem(playing, { pause: true });
        changed();
    }
    function remove(item: SiteQueueItem): void {
        const current = queue();
        if (!current || current.items.indexOf(item) <= current.index) return;
        const playing = current.player.getCurrentQueueItem();
        current.player.getQueue().reset(current.items.filter((value) => value !== item));
        if (playing) current.player.setCurrentItem(playing, { pause: true });
        changed();
    }
    function renderQueue(): void {
        const list = dialog?.querySelector('.scq-list');
        if (!list) return;
        const current = queue();
        const focused = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? document.activeElement : null;
        const focusRow = focused?.closest<HTMLElement>('[data-queue-key]');
        const focusKey = focusRow?.dataset.queueKey;
        const focusIndex = Number(focusRow?.dataset.index ?? -1);
        const focusAction = focused?.dataset.queueAction ?? 'play';
        list.textContent = '';
        const count = dialog?.querySelector('.scq-count'); if (count) count.textContent = String(current?.items.length ?? 0);
        if (!current?.items.length) { list.textContent = text('Очередь пуста', 'Queue is empty'); return; }
        queueOffset = Math.min(queueOffset, Math.floor((current.items.length - 1) / 100) * 100);
        current.items.slice(queueOffset, queueOffset + 100).forEach((item, i) => {
            const index = queueOffset + i;
            const row = document.createElement('div'); row.className = 'scq-row' + (current.index === index ? ' scq-current' : ''); row.draggable = index > current.index;
            if (!rowKeys.has(item)) rowKeys.set(item, ++nextRowKey);
            row.dataset.queueKey = String(rowKeys.get(item)); row.dataset.index = String(index);
            row.addEventListener('dragstart', () => { dragged = item; });
            row.addEventListener('dragover', (event) => { event.preventDefault(); if (dragged && index > current.index) row.classList.add('scq-drop-target'); });
            row.addEventListener('dragleave', () => row.classList.remove('scq-drop-target'));
            row.addEventListener('drop', (event) => {
                event.preventDefault(); const now = queue();
                if (dragged && now) move(dragged, now.items.indexOf(item) - now.items.indexOf(dragged));
                dragged = null; row.classList.remove('scq-drop-target');
            });
            row.addEventListener('dragend', () => { dragged = null; });
            const attrs = item.sound?.attributes;
            const number = document.createElement('span'); number.className = 'scq-number'; number.textContent = String(index + 1); number.setAttribute('aria-hidden', 'true');
            const title = attrs?.title || text('Трек', 'Track');
            const label = title + (attrs?.user?.username ? ' · ' + attrs.user.username : '');
            const play = button('', () => { current.player.setCurrentItem(item, { userInitiated: true }); changed(); }, label);
            play.className = 'scq-name'; if (index === current.index) play.setAttribute('aria-current', 'true');
            play.dataset.queueAction = 'play';
            const track = document.createElement('span'); track.className = 'scq-track'; track.textContent = title;
            const artist = document.createElement('span'); artist.className = 'scq-artist'; artist.textContent = attrs?.user?.username ?? '';
            play.append(track, artist);
            row.append(number, play);
            if (index > current.index) {
                const actions = document.createElement('div'); actions.className = 'scq-actions';
                const up = iconButton('m6 12 6-6 6 6M12 6v12', text('Выше', 'Move up'), () => move(item, -1)); up.disabled = index === current.index + 1;
                const down = iconButton('m6 12 6 6 6-6M12 6v12', text('Ниже', 'Move down'), () => move(item, 1)); down.disabled = index === current.items.length - 1;
                const drop = iconButton('m6 6 12 12M18 6 6 18', text('Удалить из очереди', 'Remove from queue'), () => remove(item));
                up.dataset.queueAction = 'up'; down.dataset.queueAction = 'down'; drop.dataset.queueAction = 'remove';
                actions.append(up, down, drop); row.append(actions);
            }
            list.append(row);
        });
        if (focusKey) {
            const row = list.querySelector('[data-queue-key="' + focusKey + '"]') ?? list.querySelector('[data-index="' + Math.min(focusIndex, current.items.length - 1) + '"]');
            const action = row?.querySelector<HTMLButtonElement>('[data-queue-action="' + focusAction + '"]');
            (action && !action.disabled ? action : row?.querySelector<HTMLButtonElement>('.scq-name'))?.focus({ preventScroll: true });
        }
        if (current.items.length > 100) {
            const controls = document.createElement('div'); controls.className = 'scq-tools';
            const prev = button(text('Назад', 'Previous'), () => { queueOffset -= 100; renderQueue(); }); prev.disabled = queueOffset === 0;
            const next = button(text('Далее', 'Next'), () => { queueOffset += 100; renderQueue(); }); next.disabled = queueOffset + 100 >= current.items.length;
            controls.append(prev, document.createTextNode(`${queueOffset + 1}-${Math.min(queueOffset + 100, current.items.length)} / ${current.items.length}`), next); list.append(controls);
        }
    }
    async function playMix(mix: LocalMix): Promise<void> {
        const request = ++revision;
        message(text('Загружаю подборку…', 'Loading mix…'));
        const tracks = await host.resolve(mix.tracks.map((track) => track.id));
        if (disposed || request !== revision) return;
        const snapshot: PlaybackSnapshot = { version: 1, at: Date.now(), index: 0, position: 0, paused: false, active: false,
            mode: 'similar', genre: null, seed: null, fallback: true,
            items: mix.tracks.map((track) => ({ track, explicit: true, wave: false })) };
        if (!host.restore(snapshot, tracks)) throw new Error('Треки подборки недоступны');
        changed(); message('');
    }
    function renderMixes(): void {
        const list = dialog?.querySelector('.scq-mixes'); if (!list) return;
        list.textContent = '';
        for (const mix of mixes) {
            const row = document.createElement('div'); row.className = 'scq-row';
            const play = button(mix.title + ' · ' + mix.tracks.length, () => { void playMix(mix).catch(fail); }); play.className = 'scq-name';
            let confirmed = false;
            const remove = iconButton('m6 6 12 12M18 6 6 18', text('Удалить подборку', 'Delete mix'), () => {
                // Подтверждение относится к конкретной локальной подборке, а не к трекам SoundCloud.
                if (!confirmed) { confirmed = true; remove.textContent = text('Удалить?', 'Delete?'); remove.style.width = 'auto'; remove.setAttribute('aria-label', text('Подтвердить удаление', 'Confirm deletion')); return; }
                    remove.disabled = true;
                    void host.user().then(async (id) => {
                        if (!await host.library?.removeMix(id, mix.id)) throw new Error('Подборка не удалена');
                        mixes = mixes.filter((item) => item.id !== mix.id); renderMixes();
                    }).catch((error: unknown) => { remove.disabled = false; fail(error); });
            });
            const actions = document.createElement('div'); actions.className = 'scq-actions'; actions.append(remove);
            row.append(play, actions); list.append(row);
        }
        if (!mixes.length) list.textContent = text('Сохранённых подборок пока нет', 'No saved mixes yet');
    }
    function toggle(): void {
        if (dialog?.open) { dialog.close(); return; }
        if (!dialog) {
            dialog = document.createElement('dialog'); dialog.id = 'sc-desktop-queue';
            dialog.addEventListener('click', (event) => {
                if (!dialog || event.target !== dialog) return;
                const bounds = dialog.getBoundingClientRect();
                if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
            });
            const header = document.createElement('header'); const title = document.createElement('h2');
            title.textContent = text('Очередь', 'Queue'); title.id = 'scq-title'; dialog.setAttribute('aria-labelledby', title.id);
            const count = document.createElement('span'); count.className = 'scq-count';
            const close = iconButton('m6 6 12 12M18 6 6 18', text('Закрыть', 'Close'), () => dialog?.close()); close.autofocus = true;
            header.append(title, count, close);
            const status = document.createElement('div'); status.className = 'scq-message'; status.setAttribute('role', 'status');
            const list = document.createElement('div'); list.className = 'scq-list';
            const tools = document.createElement('form'); tools.className = 'scq-tools';
            const name = document.createElement('input'); name.placeholder = text('Название подборки', 'Mix name'); name.setAttribute('aria-label', name.placeholder); name.maxLength = 100; name.required = true;
            const saveButton = button(text('Сохранить подборку', 'Save mix'), () => { tools.requestSubmit(); });
            saveButton.className = 'scq-save';
            tools.append(name, saveButton);
            tools.addEventListener('submit', (event) => {
                event.preventDefault(); if (saveButton.disabled) return;
                const tracks = queue()?.items.map((item) => item.sound?.attributes).filter((track): track is WaveTrack => !!track) ?? [];
                saveButton.disabled = true;
                void host.user().then(async (id) => {
                    if (!host.library) throw new Error('Хранилище недоступно');
                    const mix = await host.library.saveMix(id, name.value, tracks);
                    mixes.unshift(mix); name.value = ''; renderMixes(); message(text('Подборка сохранена на этом компьютере', 'Mix saved on this computer'));
                }).catch(fail).finally(() => { saveButton.disabled = false; });
            });
            const heading = document.createElement('h3'); heading.textContent = text('Мои подборки', 'My mixes');
            const saved = document.createElement('div'); saved.className = 'scq-mixes';
            dialog.append(header, status, list, tools, heading, saved); document.body.append(dialog);
        }
        queueOffset = Math.max(0, Math.floor((queue()?.index ?? 0) / 100) * 100);
        renderQueue(); renderMixes(); dialog.showModal();
        void host.user().then(async (id) => { mixes = await host.library?.listMixes(id) ?? []; if (!disposed) renderMixes(); }).catch(fail);
    }
    async function save(): Promise<void> {
        if (!host.library || !restored || restoring) return;
        if (saving) { await saving; return save(); }
        const snapshot = host.snapshot(); if (!snapshot) return;
        saving = (async () => {
            const id = await host.user();
            if (id && !await host.library!.saveSession(id, snapshot)) throw new Error('Сессия не сохранена');
        })();
        try { await saving; } finally { saving = null; }
    }
    async function ready(): Promise<boolean> {
        if (restored || restoring || !host.library) { if (!host.library) restored = true; return false; }
        restoring = true;
        const request = revision;
        if (!restoreStarted) { restorePrevious = host.player()?.getCurrentQueueItem(); restoreStarted = true; }
        try {
            const id = await host.user();
            const snapshot = id ? await host.library.loadSession(id) : null;
            if (!snapshot) { restored = true; return false; }
            const tracks = await host.resolve(snapshot.items.map((item) => item.track.id));
            const current = host.player()?.getCurrentQueueItem();
            // При медленном API сайт успевает вернуть свой последний трек. Это не выбор новой музыки пользователем.
            const changedTrack = current !== restorePrevious && current?.sound?.id !== snapshot.items[snapshot.index]?.track.id;
            if (disposed || request !== revision || host.player()?.isPlaying() || changedTrack) { restored = true; return false; }
            const done = host.restore(snapshot, tracks);
            restored = true;
            return done;
        } finally {
            restoring = false;
            restoreRetryAt = restored ? Infinity : Date.now() + Math.min(30000, 2000 * 2 ** Math.min(restoreFailures++, 4));
        }
    }
    function add(track: WaveTrack, next: boolean): void {
        const current = queue(); const item = host.create(track);
        if (!current || !item) { fail(new Error('Трек недоступен')); return; }
        item.explicit = true;
        const playing = current.player.getCurrentQueueItem();
        const at = next ? Math.max(0, current.index + 1) : current.items.length;
        current.items.splice(at, 0, item); current.player.getQueue().reset(current.items);
        if (playing) current.player.setCurrentItem(playing, { pause: true });
        else current.player.setCurrentItem(item, { pause: true });
        changed();
    }
    // Пакет («Слушать все N» у группы радара): порядок сохраняется, играющий трек и уже стоящие впереди не дублируются
    function addMany(tracks: WaveTrack[], next: boolean): number {
        const current = queue();
        if (!current) { fail(new Error('Очередь недоступна')); return 0; }
        const ahead = new Set(current.items.slice(Math.max(0, current.index)).map((item) => item.sound?.id));
        const items: SiteQueueItem[] = [];
        for (const track of tracks) {
            if (ahead.has(track.id)) continue;
            const item = host.create(track);
            if (!item) continue;
            ahead.add(track.id);
            item.explicit = true;
            items.push(item);
        }
        if (!items.length) return 0;
        const playing = current.player.getCurrentQueueItem();
        const at = next ? Math.max(0, current.index + 1) : current.items.length;
        current.items.splice(at, 0, ...items); current.player.getQueue().reset(current.items);
        current.player.setCurrentItem(playing ?? items[0], { pause: true });
        changed();
        return items.length;
    }
    function tick(): void {
        if (disposed) return;
        if (!restored && !restoring && Date.now() >= restoreRetryAt) void ready().catch((error: unknown) => console.warn('Сессия пока не восстановлена', error));
        const current = queue();
        const key = current ? current.index + ':' + current.items.map((item) => item.sound?.id).join(',') : '';
        if (key !== lastQueue) { lastQueue = key; if (dialog?.open) renderQueue(); }
        const state = key + ':' + host.player()?.isPlaying();
        if (Date.now() - lastSave >= 5000 || state !== lastState) {
            lastSave = Date.now(); lastState = state; void save().catch(fail);
        }
    }
    function dispose(): void { disposed = true; revision++; dialog?.remove(); style.remove(); }
    return { ready, add, addMany, toggle, save, tick, dispose };
}
