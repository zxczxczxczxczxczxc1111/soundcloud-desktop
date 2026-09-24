// Тёмный значок SoundCloud для предпросмотра статуса, тот же, что загружен в Discord.
const SOUNDCLOUD_BADGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAFIUlEQVR42u2aO4sUWxCAq04/pl+z06PICuOO+EJMVBAWFUQwMFD8CRqIroEmC8IGCgqLYDKKyQYamhiogaJgaCKmKmykiAiLyTrTz9Ovc84NijvB5eL07l6vCl3B0D00feqrdw2DmzZtgj9ZGPzh0gA0AA1AA9AANAANQAPQADQADUAD0AA0AOsU/WcfgIiapimlpJQAwBhDRCkl3f7uAIyxPM+TJGGMtVotRMzzXAjhOI5t21JKpdRvCsAYA4A0Tfv9/unTp48cOTIzM8MYW1lZefv27fPnz5eXlzudjqZpG3QF/ozfhZRSRVEIIY4fP/7o0SPf9//xQBzHDx48uHXrVp7ntm0LIX5xEiulKBg0TQMA0zSPHTuWZdnRo0d938+yTAhBcS+EqKrK87z5+fmXL19u3ryZc07u+gUAiMgYU0ppmqbrulIqDMMkSbZu3bq0tGTbdpqmSild1zVNY4wxxsZPlmU5Ozv75MkT0zSFEIj4fwMgYlVVnPMgCK5cuXL58uUgCC5dutTv9xljvu9bliWl/FfNENEwjLIsDx06dP369SAINE1bHwNbq9J0DCJmWbZz586bN29KKffv3793714p5Y0bNw4cOKCU8n3fcZyqqn5UQHRdSjk3N7dnzx7yFbnoZwEgYlEURVEgoq7reZ7v2rXr/PnziNjpdGzb1jTNdV2yPSI6jvPj7EREpZTruidPnkzT1LKsOI6/f/8+NtN/BkDNqCzLbdu29Xq9sizTNK2qqt1u27btuu7U1JTnee12u9VqdTqdVqsFAHXKC6XQwsLC+/fv37x58+LFi4sXL+Z5XlVVzczWa8Z6VVVJkty7d68sy7m5ufv379++fds0Tdu2p6ambNvO89x1XQBwXdeyLAKYWOPJ0r1er9frAcD27dtPnDhx5syZc+fOVVVFLXxDHkBEzvnu3bsXFxcBYMeOHf1+3zCMCxcu7Nu3j+LV8zzTNE3TdBwHACzLMk2TLmo2KRo0qMgWRXHq1KnBYBDHcR0nsIku5pzPzs7Oz893u13f97vd7pYtWwBgenqaFHUch5LPMAwAMAxD13W6qDkpUDkev0QIcfbs2YMHD9IMslEPKKWmp6eVUjMzM7quO47j+z4idrtdCgDTNMcajMe1cXisozrTSw4fPpxl2UYBSMjShmGQonRLnwBQVRUFABVNShgAWPeQQ33d87w6DqyVxGEYAsBoNCJd0zQFgLIsi6KgiU0IUZYl5xwA8jzPsgwAOOfrdgIifv78uU4S6xONgYjfvn2TUq6srGRZlud5EAQ0kJGiYRhyzjnnURQBQJIkSZIQ2DoAhBA0tL5+/drzvIlunAAgpbQs68OHD0tLS5zz4XDIOSdXDIfDsizLshyNRkEQBEEQRVFRFKPRKI5jKWUYhpqmCSHqjzo0OAHA1atXV1dXfd+f2Ekme8C27Y8fP167dg0Avn79WhQF7SjD4VAplf4tcRxTg4uiKEkSKWUQBFRY1jQdrK6uLiwsPH78uI72tXKArEK1ZTAYUN28e/fuly9fAODOnTuGYTx79ixJEtM0B4PB8vJyGIaLi4tSylevXj18+ND3fQrFHx+Upum7d++ePn366dOnbrdbc0lYw0JDsxDVnyiKqG2ladputylfLcuKosiyLE3T4jhut9vUv2leqFl8qJHXX3HWtpGRFWkBGC/plHaUMPQ9PUChv6ZlBRGFEGtalLH5q0ED0AA0AA1AA9AANAANQAPQADQADUAD0AD8mfIX6D7c8Va+XZUAAAAASUVORK5CYII=';

async function initializeSettings() {
    const initial = await window.settingsAPI.invoke('get-settings-state');
    // Панель говорит на языке сайта. Ключ словаря это русская строка, поэтому разметка остаётся русской
    const englishText = window.SETTINGS_EN || {};
    let language = initial.siteLanguage === 'en' ? 'en' : 'ru';
    const tr = (text) => (language === 'en' && Object.hasOwn(englishText, text) ? englishText[text] : text);
    for (const [key, value] of Object.entries(initial)) {
        const element = document.getElementById(key);
        if (!(element instanceof HTMLInputElement)) continue;
        if (element.type === 'checkbox') element.checked = value === true;
        else element.value = String(value ?? '');
    }
    document.addEventListener('keydown', (event) => {
        if (event.repeat || (event.key !== 'F1' && event.key !== 'Escape')) return;
        event.preventDefault();
        ipcRenderer.send('toggle-settings');
    });
    document.getElementById('darkMode').checked = initial.theme !== 'light';
    document.getElementById('useArtistInStatusLineToggle').checked = initial.statusDisplayType === 1;
    document.getElementById('siteLanguage').value = initial.siteLanguage === 'en' ? 'en' : 'ru';
    document.documentElement.classList.toggle('theme-light', initial.theme === 'light');
    for (const [id, setting] of [
        ['proxyFields', 'proxyEnabled'],
        ['webhookFields', 'webhookEnabled'],
        ['webhookFields2', 'webhookEnabled'],
        ['discordDetails', 'discordRichPresence'],
    ]) {
        const element = document.getElementById(id);
        if (element) element.style.display = initial[setting] ? 'block' : 'none';
    }

    // Разделы: слева список, справа виден один раздел
    const navButtons = [...document.querySelectorAll('.nav-list button')];
    for (const button of navButtons) {
        button.addEventListener('click', () => {
            for (const other of navButtons) {
                const active = other === button;
                other.setAttribute('aria-current', String(active));
                const section = document.getElementById(other.dataset.target);
                if (section) section.hidden = !active;
            }
        });
    }
    // Включённые прокси или вебхук легко забыть, поэтому у раздела точка
    function updateAdvancedMarker() {
        const active = document.getElementById('proxyEnabled').checked || document.getElementById('webhookEnabled').checked;
        document.getElementById('advancedNav').classList.toggle('has-active', active);
    }
    updateAdvancedMarker();

    document.getElementById('backdrop').addEventListener('click', () => window.settingsAPI.send('toggle-settings'));

    // Прокси, блокировке рекламы и языку сайта нужна перезагрузка страницы, остальное применяется сразу
    const networkNotice = document.getElementById('networkNotice');
    const showNetworkNotice = () => {
        networkNotice.hidden = false;
    };
    document.getElementById('applyNetwork').addEventListener('click', () => {
        networkNotice.hidden = true;
        window.settingsAPI.send('apply-changes');
    });

    const ipcRenderer = {
        send: (channel, ...args) => window.settingsAPI.send(channel, ...args),
        invoke: (channel, ...args) => window.settingsAPI.invoke(channel, ...args),
        on: (channel, listener) => window.settingsAPI.on(channel, (...args) => listener(null, ...args)),
    };
    const shell = {
        openExternal: (url) => window.settingsAPI.openExternal(url),
        openPath: (targetPath) => window.settingsAPI.openPath(targetPath),
    };

    // data loading functions
    async function loadCustomThemes() {
        try {
            const themes = await ipcRenderer.invoke('get-custom-themes');
            const currentTheme = await ipcRenderer.invoke('get-current-custom-theme');
            const selector = document.getElementById('customThemeSelector');
            if (!selector) return;

            while (selector.children.length > 1) {
                selector.removeChild(selector.lastChild);
            }

            themes.forEach((theme) => {
                const option = document.createElement('option');
                option.value = theme.name;
                option.textContent = theme.name;
                selector.appendChild(option);
            });

            selector.value = currentTheme || 'none';
        } catch (error) {
            console.error('Failed to load custom themes:', error);
        }
    }

    async function loadPlugins() {
        try {
            const plugins = await ipcRenderer.invoke('get-plugins');
            const list = document.getElementById('pluginList');
            if (!list) return;

            list.innerHTML = '';

            if (!plugins || plugins.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'no-plugins';
                empty.textContent = tr('Папка плагинов пуста');
                list.appendChild(empty);
                return;
            }

            plugins.forEach((p) => {
                const card = document.createElement('div');
                card.className = 'plugin-card';
                const hasHomepage = p.metadata.homepage && p.metadata.homepage.trim() !== '';
                const nameClass = hasHomepage ? 'plugin-name has-homepage' : 'plugin-name';

                const header = document.createElement('div');
                header.className = 'plugin-header';

                const spanWrapper = document.createElement('span');
                const nameEl = document.createElement('span');
                nameEl.className = nameClass;
                nameEl.textContent = p.metadata.name || p.id;
                if (hasHomepage) {
                    nameEl.dataset.homepage = p.metadata.homepage;
                    nameEl.title = tr('Открыть страницу плагина');
                    nameEl.addEventListener('click', (e) => {
                        e.stopPropagation();
                        ipcRenderer.send('show-plugin-homepage-dialog', nameEl.dataset.homepage);
                    });
                }
                spanWrapper.appendChild(nameEl);

                const versionEl = document.createElement('span');
                versionEl.className = 'plugin-version';
                versionEl.textContent = 'v' + (p.metadata.version || '?');
                spanWrapper.appendChild(versionEl);
                header.appendChild(spanWrapper);

                const toggle = document.createElement('label');
                toggle.className = 'toggle';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.dataset.pluginId = p.id;
                checkbox.checked = p.enabled;
                checkbox.addEventListener('change', async (e) => {
                    const enabled = e.target.checked;
                    await ipcRenderer.invoke('set-plugin-enabled', p.id, enabled);
                });
                const slider = document.createElement('span');
                slider.className = 'slider';
                toggle.appendChild(checkbox);
                toggle.appendChild(slider);
                header.appendChild(toggle);
                card.appendChild(header);

                if (p.metadata.description) {
                    const descEl = document.createElement('div');
                    descEl.className = 'plugin-desc';
                    descEl.textContent = p.metadata.description;
                    card.appendChild(descEl);
                }

                if (p.metadata.author && p.metadata.author !== 'Unknown') {
                    const authorEl = document.createElement('div');
                    authorEl.className = 'plugin-author';
                    authorEl.textContent = tr('Автор:') + ' ' + p.metadata.author;
                    card.appendChild(authorEl);
                }

                list.appendChild(card);
            });
        } catch (error) {
            console.error('Failed to load plugins:', error);
        }
    }

    async function loadAccounts() {
        try {
            const data = await ipcRenderer.invoke('get-accounts');
            const selector = document.getElementById('accountSelector');
            if (!selector) return;

            selector.innerHTML = '';
            data.accounts.forEach((acc) => {
                const option = document.createElement('option');
                option.value = acc.id;
                // Имена по умолчанию хранятся по-русски и переводятся при показе; ник с сайта остаётся как есть
                option.textContent = tr(acc.name);
                selector.appendChild(option);
            });
            selector.value = data.currentAccountId || 'default';
        } catch (e) {
            console.error('Failed to load accounts:', e);
        }
    }

    document.getElementById('exportDiagnostics').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const status = document.getElementById('diagnosticsStatus');
        button.disabled = true;
        status.textContent = '';
        try {
            const saved = await ipcRenderer.invoke('export-diagnostics');
            status.textContent = saved ? tr('Журнал сохранён, его можно отправить для разбора проблемы') : '';
        } catch (error) {
            console.error('Не удалось сохранить журнал:', error);
            status.textContent = tr('Не удалось сохранить журнал, попробуй другую папку');
        } finally { button.disabled = false; }
    });

    document.getElementById('openDataFolder').addEventListener('click', () => {
        ipcRenderer.invoke('open-data-folder').catch((error) => console.error('Не удалось открыть папку данных:', error));
    });

    function renderUpdateState(state) {
        if (!state) return;
        const toggle = document.getElementById('autoUpdateEnabled');
        toggle.checked = state.enabled;
        toggle.disabled = state.mode === 'dev';
        document.getElementById('checkUpdates').disabled = state.mode === 'dev' || !state.enabled;
        // В режиме разработки подсказка совпадает со статусом, второй раз её не выводим
        const hint = state.hint !== state.status ? state.hint : '';
        document.getElementById('updateHint').textContent = [tr('Версия') + ' ' + state.version + '.', hint].filter(Boolean).join(' ');
        document.getElementById('updateStatus').textContent = state.status;
    }

    document.getElementById('checkUpdates').addEventListener('click', () => {
        ipcRenderer.invoke('check-updates').catch((error) => console.error('Не удалось проверить обновления:', error));
    });

    document.getElementById('autoUpdateEnabled').addEventListener('change', (e) => {
        ipcRenderer.send('setting-changed', { key: 'autoUpdateEnabled', value: e.target.checked });
    });
    document.getElementById('openReleasePage').addEventListener('click', () => {
        ipcRenderer.invoke('open-release-page').catch((error) => console.error('Не удалось открыть страницу релиза:', error));
    });
    ipcRenderer.on('update-state', (_, state) => renderUpdateState(state));
    ipcRenderer
        .invoke('get-update-state')
        .then(renderUpdateState)
        .catch((error) => console.error('Не удалось получить состояние обновлений:', error));

    // Свой выпадающий список поверх скрытого select: значение и событие change остаются у select
    function enhanceSelect(select) {
        const wrap = document.createElement('div');
        wrap.className = 'dropdown';
        select.parentNode.insertBefore(wrap, select);
        wrap.appendChild(select);
        select.classList.add('native-select');
        select.tabIndex = -1;
        select.setAttribute('aria-hidden', 'true');

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'input dropdown-button';
        button.setAttribute('aria-haspopup', 'listbox');
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-label', select.getAttribute('aria-label') || '');
        const label = document.createElement('span');
        label.className = 'dropdown-label';
        // Подпись и список повторяют текст option, переводится только он
        label.setAttribute('data-no-i18n', '');
        button.appendChild(label);
        const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        chevron.setAttribute('class', 'chev');
        chevron.setAttribute('viewBox', '0 0 24 24');
        const chevronPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        chevronPath.setAttribute('d', 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z');
        chevron.appendChild(chevronPath);
        button.appendChild(chevron);

        const list = document.createElement('div');
        list.className = 'dropdown-list';
        list.id = select.id + 'List';
        list.setAttribute('role', 'listbox');
        list.setAttribute('data-no-i18n', '');
        list.hidden = true;
        button.setAttribute('aria-controls', list.id);
        wrap.appendChild(button);
        wrap.appendChild(list);

        let activeIndex = -1;
        const sync = () => {
            const selected = select.options[select.selectedIndex];
            label.textContent = selected ? selected.textContent : '';
            button.disabled = select.options.length === 0;
        };
        const highlight = (index) => {
            activeIndex = index;
            [...list.children].forEach((item, itemIndex) => item.classList.toggle('active', itemIndex === index));
            const item = list.children[index];
            if (!item) return;
            button.setAttribute('aria-activedescendant', item.id);
            item.scrollIntoView?.({ block: 'nearest' });
        };
        const close = () => {
            list.hidden = true;
            button.setAttribute('aria-expanded', 'false');
            button.removeAttribute('aria-activedescendant');
        };
        const choose = (index) => {
            close();
            if (index < 0 || index === select.selectedIndex) return;
            select.selectedIndex = index;
            sync();
            select.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const open = () => {
            if (button.disabled) return;
            list.textContent = '';
            [...select.options].forEach((option, index) => {
                const item = document.createElement('div');
                item.className = 'dropdown-option';
                item.id = list.id + '-' + index;
                item.setAttribute('role', 'option');
                item.setAttribute('aria-selected', String(index === select.selectedIndex));
                item.textContent = option.textContent;
                // Фокус остаётся на кнопке, иначе список закроется раньше клика
                item.addEventListener('mousedown', (event) => event.preventDefault());
                item.addEventListener('click', () => choose(index));
                item.addEventListener('mousemove', () => highlight(index));
                list.appendChild(item);
            });
            list.hidden = false;
            button.setAttribute('aria-expanded', 'true');
            highlight(select.selectedIndex);
        };

        button.addEventListener('click', () => (list.hidden ? open() : close()));
        button.addEventListener('blur', close);
        button.addEventListener('keydown', (event) => {
            const count = select.options.length;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (list.hidden) open();
                else highlight((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
            } else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                if (list.hidden) open();
                else choose(activeIndex);
            } else if (event.key === 'Escape' && !list.hidden) {
                // Esc закрывает список, а не всю панель
                event.preventDefault();
                event.stopPropagation();
                close();
            }
        });
        // Списки заполняются асинхронно: подпись обновляется при смене вариантов
        new MutationObserver(sync).observe(select, { childList: true, subtree: true, characterData: true });
        sync();
    }
    for (const id of ['customThemeSelector', 'accountSelector', 'siteLanguage']) {
        const select = document.getElementById(id);
        if (select) enhanceSelect(select);
    }

    // Статичные подписи меняются на месте, русский оригинал узла хранится для обратного переключения.
    // Внутри data-no-i18n пользовательские названия, а свои подписи там код рисует через tr()
    const sourceText = new WeakMap();
    const sourceAttributes = new WeakMap();
    const words = (text) => text.replace(/\s+/g, ' ').trim();
    function applyLanguage() {
        document.documentElement.lang = language;
        const walker = document.createTreeWalker(document.body, window.NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (node.parentElement?.closest('[data-no-i18n]')) continue;
            if (!sourceText.has(node)) {
                if (!Object.hasOwn(englishText, words(node.nodeValue))) continue;
                sourceText.set(node, node.nodeValue);
            }
            const source = sourceText.get(node);
            const next = language === 'en' ? englishText[words(source)] : source;
            if (node.nodeValue !== next) node.nodeValue = next;
        }
        for (const element of document.body.querySelectorAll('[title], [aria-label], [placeholder], [alt]')) {
            if (element.closest('[data-no-i18n]')) continue;
            const sources = sourceAttributes.get(element) || {};
            for (const name of ['title', 'aria-label', 'placeholder', 'alt']) {
                const value = element.getAttribute(name);
                if (!(name in sources) && value !== null && Object.hasOwn(englishText, value)) sources[name] = value;
                if (name in sources) element.setAttribute(name, tr(sources[name]));
            }
            sourceAttributes.set(element, sources);
        }
    }
    applyLanguage();

    // initilization

    loadCustomThemes();
    loadPlugins();
    ipcRenderer.on('plugins-changed', () => loadPlugins());
    loadAccounts();

    // account manager event listeners
    ipcRenderer.on('accounts-updated', loadAccounts);

    const accSelector = document.getElementById('accountSelector');
    if (accSelector) {
        accSelector.addEventListener('change', (e) => {
            ipcRenderer.send('switch-account', e.target.value);
        });
    }

    const addBtn = document.getElementById('addAccountBtn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            ipcRenderer.send('add-account');
        });
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            ipcRenderer.send('logout-account');
        });
    }

    // standard UI event listeners
    document.getElementById('customThemeSelector')?.addEventListener('change', async (e) => {
        const themeName = e.target.value;
        try {
            await ipcRenderer.invoke('apply-custom-theme', themeName);
            ipcRenderer.send('setting-changed', { key: 'customTheme', value: themeName });
        } catch (error) {
            console.error('Failed to apply custom theme:', error);
        }
    });

    document.getElementById('openThemesFolder')?.addEventListener('click', async () => {
        try {
            const themesPath = await ipcRenderer.invoke('get-themes-folder-path');
            shell.openPath(themesPath);
        } catch (error) {
            console.error('Failed to open themes folder:', error);
        }
    });

    document.getElementById('refreshThemes')?.addEventListener('click', async () => {
        try {
            await ipcRenderer.invoke('refresh-custom-themes');
            await loadCustomThemes();
        } catch (error) {
            console.error('Failed to refresh themes:', error);
        }
    });



    document.getElementById('openPluginsFolder')?.addEventListener('click', async () => {
        try {
            const pluginsPath = await ipcRenderer.invoke('get-plugins-folder-path');
            shell.openPath(pluginsPath);
        } catch (error) {
            console.error('Failed to open plugins folder:', error);
        }
    });

    document.getElementById('refreshPlugins')?.addEventListener('click', async () => {
        try {
            await ipcRenderer.invoke('refresh-plugins');
            await loadPlugins();
        } catch (error) {
            console.error('Failed to refresh plugins:', error);
        }
    });

    // UI customization toggles
    document.getElementById('hidePromotions')?.addEventListener('change', (e) => {
        ipcRenderer.send('setting-changed', { key: 'hidePromotions', value: e.target.checked });
    });

    document.getElementById('hideEventsNearYou')?.addEventListener('change', (e) => {
        ipcRenderer.send('setting-changed', { key: 'hideEventsNearYou', value: e.target.checked });
    });

    document.getElementById('hideArtistUpsells')?.addEventListener('change', (e) => {
        ipcRenderer.send('setting-changed', { key: 'hideArtistUpsells', value: e.target.checked });
    });

    document.getElementById('fullShuffle')?.addEventListener('change', (e) => {
        ipcRenderer.send('setting-changed', { key: 'fullShuffle', value: e.target.checked });
    });
    document.getElementById('reduceMotion')?.addEventListener('change', (e) => {
        ipcRenderer.send('setting-changed', { key: 'reduceMotion', value: e.target.checked });
    });

    // Перевод сайта ставится до его скриптов, поэтому сайт ждёт перезагрузки, а панель переводится сразу.
    // Строки обновлений main присылает заново уже на новом языке
    document.getElementById('siteLanguage').addEventListener('change', (e) => {
        ipcRenderer.send('setting-changed', { key: 'siteLanguage', value: e.target.value });
        showNetworkNotice();
        language = e.target.value === 'en' ? 'en' : 'ru';
        applyLanguage();
        document.getElementById('diagnosticsStatus').textContent = '';
        loadAccounts();
        loadPlugins();
        loadWaveExclusions();
        updatePreview(lastPreview);
    });

    // Блоки главной и волна на главной прячутся сразу, без перезагрузки
    for (const input of document.querySelectorAll('#home input[type="checkbox"], #wave input[type="checkbox"]'))
        input.addEventListener('change', (e) => {
            ipcRenderer.send('setting-changed', { key: e.target.id, value: e.target.checked });
        });

    // Исключённое из волны: отметки ставятся в меню по ПКМ на сайте, здесь только возврат
    function renderExcluded(containerId, kind, entries) {
        const box = document.getElementById(containerId);
        if (!box) return;
        const count = document.getElementById(containerId + 'Count');
        if (count) count.textContent = String(entries.length);
        box.textContent = '';
        if (!entries.length) {
            const empty = document.createElement('div');
            empty.className = 'hint pad';
            empty.textContent = tr('Пусто');
            box.appendChild(empty);
            return;
        }
        for (const entry of entries) {
            const row = document.createElement('div');
            row.className = 'row';
            const text = document.createElement('span');
            text.className = 'text';
            const title = document.createElement('span');
            title.className = 'excluded-title';
            title.textContent = entry.title || tr(kind === 'track' ? 'Трек' : 'Артист') + ' ' + entry.id;
            title.title = title.textContent;
            text.appendChild(title);
            if (entry.artist) {
                const artist = document.createElement('span');
                artist.className = 'hint excluded-title';
                artist.textContent = entry.artist;
                text.appendChild(artist);
            }
            const restore = document.createElement('button');
            restore.type = 'button';
            restore.className = 'text-btn';
            restore.textContent = tr('Вернуть');
            restore.addEventListener('click', () => {
                restore.disabled = true;
                ipcRenderer.invoke('remove-wave-exclusion', kind, entry.id).then(loadWaveExclusions, (error) => {
                    console.error('Не удалось вернуть в волну:', error);
                    restore.disabled = false;
                });
            });
            row.append(text, restore);
            box.appendChild(row);
        }
    }
    async function loadWaveExclusions() {
        try {
            const data = await ipcRenderer.invoke('get-wave-exclusions');
            renderExcluded('waveExcludedTracks', 'track', Array.isArray(data?.tracks) ? data.tracks : []);
            renderExcluded('waveExcludedArtists', 'artist', Array.isArray(data?.artists) ? data.artists : []);
        } catch (error) {
            console.error('Не удалось загрузить исключения волны:', error);
        }
    }
    ipcRenderer.on('wave-exclusions-changed', () => loadWaveExclusions());
    loadWaveExclusions();

    document.getElementById('proxyEnabled')?.addEventListener('change', (e) => {
        const isEnabled = e.target.checked;
        document.getElementById('proxyFields').style.display = isEnabled ? 'block' : 'none';
        ipcRenderer.send('setting-changed', { key: 'proxyEnabled', value: isEnabled });
        updateAdvancedMarker();
        showNetworkNotice();
    });

    document.getElementById('proxyHost')?.addEventListener('change', (e) => {
        ipcRenderer.send('setting-changed', { key: 'proxyHost', value: e.target.value });
        showNetworkNotice();
    });

    for (const key of ['proxyUsername', 'proxyPassword'])
        document.getElementById(key).addEventListener('change', (event) => {
            ipcRenderer.send('setting-changed', { key, value: event.target.value });
            if (key === 'proxyPassword') event.target.value = '';
            showNetworkNotice();
        });
    document.getElementById('proxyPort')?.addEventListener('change', (e) => {
        ipcRenderer.send('setting-changed', { key: 'proxyPort', value: e.target.value });
        showNetworkNotice();
    });

    document.getElementById('webhookEnabled')?.addEventListener('change', (e) => {
        const isEnabled = e.target.checked;
        document.getElementById('webhookFields').style.display = isEnabled ? 'block' : 'none';
        document.getElementById('webhookFields2').style.display = isEnabled ? 'block' : 'none';
        ipcRenderer.send('setting-changed', { key: 'webhookEnabled', value: isEnabled });
        updateAdvancedMarker();
    });

    document.getElementById('webhookUrl')?.addEventListener('change', (e) => {
        ipcRenderer.send('setting-changed', { key: 'webhookUrl', value: e.target.value });
    });

    document.getElementById('webhookTriggerPercentage')?.addEventListener('input', (e) => {
        let value = parseInt(e.target.value);
        if (value < 0) value = 0;
        if (value > 100) value = 100;
        if (isNaN(value)) value = 50;

        e.target.value = value;
        ipcRenderer.send('setting-changed', { key: 'webhookTriggerPercentage', value: value });
    });

    document.getElementById('webhookExampleToggle')?.addEventListener('click', (e) => {
        const toggle = e.currentTarget;
        const content = document.getElementById('webhookExampleContent');
        const expand = content.style.display !== 'block';
        content.style.display = expand ? 'block' : 'none';
        toggle.setAttribute('aria-expanded', String(expand));
    });

    document.getElementById('darkMode')?.addEventListener('change', (e) => {
        const isDark = e.target.checked;
        ipcRenderer.send('setting-changed', { key: 'theme', value: isDark ? 'dark' : 'light' });
        document.documentElement.classList.toggle('theme-light', !isDark);
        document.documentElement.classList.toggle('theme-dark', isDark);
    });

    document.getElementById('minimizeToTray')?.addEventListener('change', (e) => {
        ipcRenderer.send('setting-changed', { key: 'minimizeToTray', value: e.target.checked });
    });

    document.getElementById('navigationControlsEnabled')?.addEventListener('change', (e) => {
        ipcRenderer.send('setting-changed', { key: 'navigationControlsEnabled', value: e.target.checked });
    });

    document.getElementById('trackParserEnabled')?.addEventListener('change', (e) => {
        ipcRenderer.send('setting-changed', { key: 'trackParserEnabled', value: e.target.checked });
    });

    document.getElementById('displayGithubLink')?.addEventListener('change', (e) => {
        ipcRenderer.send('setting-changed', { key: 'displayGithubLink', value: e.target.checked });
        updatePreview(lastPreview);
    });

    document.getElementById('displaySCSmallIcon')?.addEventListener('change', (e) => {
        ipcRenderer.send('setting-changed', { key: 'displaySCSmallIcon', value: e.target.checked });
        updatePreview(lastPreview);
    });

    document.getElementById('adBlocker')?.addEventListener('change', (e) => {
        ipcRenderer.send('setting-changed', { key: 'adBlocker', value: e.target.checked });
        showNetworkNotice();
    });

    document.getElementById('discordRichPresence')?.addEventListener('change', (e) => {
        document.getElementById('discordDetails').style.display = e.target.checked ? 'block' : 'none';
        ipcRenderer.send('setting-changed', { key: 'discordRichPresence', value: e.target.checked });
    });

    document.getElementById('displayButtons')?.addEventListener('change', (e) => {
        ipcRenderer.send('setting-changed', { key: 'displayButtons', value: e.target.checked });
        updatePreview(lastPreview);
    });

    document.getElementById('useArtistInStatusLineToggle')?.addEventListener('change', (e) => {
        const useState = e.target.checked;
        ipcRenderer.send('setting-changed', { key: 'statusDisplayType', value: useState ? 1 : 0 });
    });

    // Инкогнито: переключается и отсюда, и из трея, и по Ctrl+Shift+N
    const incognito = document.getElementById('discordIncognito');
    incognito?.addEventListener('change', (e) => {
        ipcRenderer.send('setting-changed', { key: 'discordIncognito', value: e.target.checked });
    });
    ipcRenderer.on('discord-incognito-changed', (_, value) => {
        if (incognito) incognito.checked = value === true;
    });

    // Строки карточки и стоп-листы: сохраняются на ходу, предпросмотр собирает main
    const TEMPLATE_DEFAULTS = { discordLine1: '{track}', discordLine2: '{artist}', discordCoverText: '' };
    const textSettings = ['discordLine1', 'discordLine2', 'discordCoverText', 'discordHiddenArtists', 'discordHiddenGenres'];
    const textTimers = new Map();
    const saveText = (field) => {
        clearTimeout(textTimers.get(field.id));
        textTimers.set(field.id, setTimeout(() => {
            textTimers.delete(field.id);
            ipcRenderer.send('setting-changed', { key: field.id, value: field.value });
        }, 250));
    };
    for (const key of textSettings) {
        const field = document.getElementById(key);
        if (!field) continue;
        const value = initial[key];
        field.value = typeof value === 'string' ? value : TEMPLATE_DEFAULTS[key] ?? '';
        field.addEventListener('input', () => saveText(field));
    }
    // Метка вставляется в последнее поле строки, где стоял курсор
    let templateField = document.getElementById('discordLine1');
    for (const key of Object.keys(TEMPLATE_DEFAULTS)) document.getElementById(key)?.addEventListener('focus', (e) => (templateField = e.target));
    document.getElementById('discordTokens')?.addEventListener('mousedown', (event) => {
        // Фокус остаётся в поле, иначе курсор потеряет место вставки
        if (event.target.closest('[data-token]')) event.preventDefault();
    });
    document.getElementById('discordTokens')?.addEventListener('click', (event) => {
        const token = event.target.closest('[data-token]')?.dataset.token;
        if (!token || !templateField) return;
        const start = templateField.selectionStart ?? templateField.value.length;
        const end = templateField.selectionEnd ?? start;
        const next = templateField.value.slice(0, start) + token + templateField.value.slice(end);
        if (next.length > templateField.maxLength) return;
        templateField.value = next;
        templateField.focus();
        templateField.setSelectionRange(start + token.length, start + token.length);
        saveText(templateField);
    });
    document.getElementById('discordTemplateReset')?.addEventListener('click', () => {
        for (const [key, value] of Object.entries(TEMPLATE_DEFAULTS)) {
            const field = document.getElementById(key);
            if (!field || field.value === value) continue;
            field.value = value;
            saveText(field);
        }
    });

    // rich presence preview logic

    let progressInterval = null;
    // Последний трек нужен, чтобы перерисовать предпросмотр при смене опций
    let lastPreview = null;

    function parseTimeToMs(time) {
        if (!time) return 0;
        const isNegative = time.trim().startsWith('-');
        const raw = isNegative ? time.trim().slice(1) : time.trim();
        const parts = raw.split(':').map((p) => Number(p));
        let seconds = 0;
        for (const part of parts) {
            seconds = seconds * 60 + (isNaN(part) ? 0 : part);
        }
        const ms = seconds * 1000;
        return isNegative ? -ms : ms;
    }

    function formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    function safeText(value, fallback) {
        return typeof value === 'string' && value.trim() ? value : fallback;
    }

    function safeRemoteUrl(value) {
        if (typeof value !== 'string' || !value.trim()) return '';
        try {
            const parsed = new URL(value);
            return parsed.protocol === 'https:' ? parsed.href : '';
        } catch {
            return '';
        }
    }

    function createTextElement(className, text) {
        const el = document.createElement('div');
        el.className = className;
        el.textContent = text;
        return el;
    }

    function appendSmallBadge(imageWrap, options) {
        if (options.displaySCSmallIcon || options.displayGithubLink) {
            const smallIcon = document.createElement('div');
            smallIcon.className = 'small-icon-preview';
            const icon = document.createElement('img');
            icon.src = options.displayGithubLink
                ? 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'
                : SOUNDCLOUD_BADGE;
            icon.alt = options.displayGithubLink ? 'GitHub' : 'SoundCloud';
            if (options.displayGithubLink) {
                smallIcon.title = tr('SoundCloud на GitHub');
                smallIcon.style.cursor = 'pointer';
                smallIcon.setAttribute('role', 'link');
                smallIcon.tabIndex = 0;
                const openRepository = () => shell.openExternal('https://github.com/zxczxczxczxczxczxc1111/soundcloud-desktop');
                smallIcon.addEventListener('click', openRepository);
                smallIcon.addEventListener('keydown', event => { if (event.key === 'Enter') openRepository(); });
            }
            icon.style.width = '16px';
            icon.style.height = '16px';
            icon.style.borderRadius = '50%';
            smallIcon.appendChild(icon);
            imageWrap.appendChild(smallIcon);
        }

    }

    // Карточку собирает main (шаблоны, стоп-листы, запасная обложка), здесь она только рисуется
    function createPlayingPreview(trackInfo, card, options) {
        const fragment = document.createDocumentFragment();
        fragment.appendChild(createTextElement('activity-header-preview', 'Listening to SoundCloud'));

        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'flex-start';
        row.style.gap = '12px';

        const imageWrap = document.createElement('div');
        imageWrap.className = 'activity-image-preview';
        // Ключ ассета приложения Discord вместо адреса: логотип SoundCloud
        const artworkUrl = card.image === 'soundcloud-logo' ? SOUNDCLOUD_BADGE : safeRemoteUrl(card.image);
        if (artworkUrl) {
            const img = document.createElement('img');
            img.src = artworkUrl;
            img.alt = tr('Обложка трека');
            img.addEventListener('error', () => {
                img.style.display = 'none';
            });
            imageWrap.appendChild(img);
        }
        if (card.largeText) imageWrap.title = card.largeText;

        appendSmallBadge(imageWrap, options);

        const details = document.createElement('div');
        details.className = 'activity-details-preview';
        if (card.details) details.appendChild(createTextElement('activity-name-preview', card.details));
        if (card.state) details.appendChild(createTextElement('activity-details-text-preview', card.state));

        const progressContainer = document.createElement('div');
        progressContainer.className = 'progress-bar-container-preview';
        const progressBar = document.createElement('div');
        progressBar.className = 'progress-bar-preview';
        const progressFill = document.createElement('div');
        progressFill.className = 'progress-bar-fill-preview';
        progressFill.id = 'progressFillPreview';
        progressBar.appendChild(progressFill);
        progressContainer.appendChild(progressBar);

        const timeDisplay = document.createElement('div');
        timeDisplay.className = 'time-display-preview';
        const currentTime = document.createElement('span');
        currentTime.id = 'currentTimePreview';
        currentTime.textContent = safeText(trackInfo.elapsed, '0:00');
        const totalTime = document.createElement('span');
        totalTime.id = 'totalTimePreview';
        totalTime.textContent = safeText(trackInfo.duration, '0:00');
        timeDisplay.appendChild(currentTime);
        timeDisplay.appendChild(totalTime);
        progressContainer.appendChild(timeDisplay);
        details.appendChild(progressContainer);

        const trackUrl = safeRemoteUrl(trackInfo.url);
        if (options.displayButtons && trackUrl) {
            const buttons = document.createElement('div');
            buttons.className = 'activity-buttons-preview';
            const button = document.createElement('button');
            button.className = 'activity-button-preview';
            button.textContent = tr('Слушать в SoundCloud');
            button.addEventListener('click', () => shell.openExternal(trackUrl));
            buttons.appendChild(button);
            details.appendChild(buttons);
        }

        row.appendChild(imageWrap);
        row.appendChild(details);
        fragment.appendChild(row);

        const member = document.createElement('div');
        member.className = 'member-line-preview';
        member.textContent = tr('Под ником:') + ' ';
        // В списке участников Discord под ником значок ноты и сама строка, без «Listening to»
        const memberNote = document.createElement('span');
        memberNote.className = 'member-line-note';
        memberNote.setAttribute('aria-hidden', 'true');
        memberNote.textContent = '♫';
        member.appendChild(memberNote);
        const memberText = document.createElement('b');
        memberText.textContent = safeText(card.statusLine, 'SoundCloud');
        member.appendChild(memberText);
        fragment.appendChild(member);
        return fragment;
    }

    // Почему карточки нет, если её прячет сам клиент
    const HIDDEN_TEXT = {
        incognito: 'Инкогнито: Discord не видит, что играет',
        artist: 'Артист в списке скрытых, Discord его не видит',
        genre: 'Жанр в списке скрытых, Discord его не видит',
    };
    function updatePreview(preview) {
        lastPreview = preview;
        const activitySection = document.getElementById('activitySectionPreview');
        const noActivity = document.getElementById('noActivityPreview');
        const existingContent = activitySection?.querySelector('.activity-content-preview');
        if (existingContent) existingContent.remove();

        const trackInfo = preview?.track;
        const card = preview?.card;
        if (!trackInfo || !card) {
            if (noActivity) noActivity.textContent = tr(HIDDEN_TEXT[preview?.hidden] ?? 'Сейчас ничего не играет');
            if (noActivity) noActivity.style.display = 'block';
            clearInterval(progressInterval);
            return;
        }
        if (noActivity) noActivity.style.display = 'none';

        const activityContent = document.createElement('div');
        activityContent.className = 'activity-content-preview';
        // Название трека это данные. «Слушать в SoundCloud» и «SoundCloud на GitHub» Discord получает на языке приложения, как здесь
        activityContent.setAttribute('data-no-i18n', '');
        activityContent.appendChild(
            createPlayingPreview(trackInfo, card, {
                displaySCSmallIcon: document.getElementById('displaySCSmallIcon')?.checked || false,
                displayGithubLink: document.getElementById('displayGithubLink')?.checked || false,
                displayButtons: document.getElementById('displayButtons')?.checked || false,
            }),
        );
        startProgressUpdate(trackInfo);
        if (activitySection) activitySection.appendChild(activityContent);
    }

    function startProgressUpdate(trackInfo) {
        clearInterval(progressInterval);

        if (!trackInfo.isPlaying || !trackInfo.elapsed || !trackInfo.duration) return;

        const startTime = Date.now();
        const elapsedMs = parseTimeToMs(trackInfo.elapsed);
        const totalMs = parseTimeToMs(trackInfo.duration);

        function updateProgress() {
            const now = Date.now();
            const currentElapsed = elapsedMs + (now - startTime);
            const progress = Math.min((currentElapsed / totalMs) * 100, 100);

            const progressFill = document.getElementById('progressFillPreview');
            const currentTimeEl = document.getElementById('currentTimePreview');

            if (progressFill) progressFill.style.width = `${progress}%`;
            if (currentTimeEl) currentTimeEl.textContent = formatTime(currentElapsed);

            if (progress >= 100) clearInterval(progressInterval);
        }

        updateProgress();
        progressInterval = setInterval(updateProgress, 1000);
    }

    // external event triggers
    ipcRenderer.on('presence-preview-update', (_, preview) => {
        updatePreview(preview);
    });

    ipcRenderer.on('theme-changed', (_, isDark) => {
        const dm = document.getElementById('darkMode');
        if (dm) dm.checked = isDark;
        document.documentElement.classList.toggle('theme-light', !isDark);
    });

    ipcRenderer.on('update-translations', () => {
        ipcRenderer.invoke('get-translations').then((translations) => {
            document.querySelectorAll('[data-i18n]').forEach((element) => {
                const key = element.getAttribute('data-i18n');
                if (key && translations[key]) {
                    if (element.tagName === 'H2' && element.querySelector('svg')) {
                        const svg = element.querySelector('svg');
                        element.textContent = translations[key];
                        if (svg) element.appendChild(svg);
                    } else {
                        element.textContent = translations[key];
                    }
                }
            });

            document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
                const key = element.getAttribute('data-i18n-placeholder');
                if (key && translations[key]) {
                    element.setAttribute('placeholder', translations[key]);
                }
            });

            document.querySelectorAll('[data-i18n-title]').forEach((element) => {
                const key = element.getAttribute('data-i18n-title');
                if (key && translations[key]) {
                    element.setAttribute('title', translations[key]);
                }
            });
        });
    });

    document
        .getElementById('close-settings')
        .addEventListener('click', () => window.settingsAPI.send('toggle-settings'));
    updatePreview(await ipcRenderer.invoke('get-current-track'));
    window.settingsAPI.send('settings-ready');
}
initializeSettings().catch((error) => {
    console.error('Settings initialization failed:', error);
    // Язык панели applyLanguage ставит в lang, до него остаётся русский из разметки
    document.body.textContent = document.documentElement.lang === 'en'
        ? 'Settings failed to load. Close the panel and open it again.'
        : 'Не удалось загрузить настройки. Закройте и откройте панель повторно.';
    document.body.style.opacity = '1';
});
