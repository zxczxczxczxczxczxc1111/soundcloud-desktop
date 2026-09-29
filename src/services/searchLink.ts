interface SearchLinkWindow extends Window {
    __disposeSearchLink?: () => void;
    __scNavigate?: (path: string) => boolean;
}

// Ссылка, вставленная в поиск сайта: адрес страницы soundcloud.com без меток шаринга (si, utm, ref) или короткая ссылка
// on.soundcloud.com, которую раскрывает клиент. Всё остальное остаётся обычным поиском.
// Уходит на страницу текстом вместе с installSearchLink, поэтому всё нужное объявлено внутри
export function pastedLink(text: string): string | null {
    const value = text.trim();
    if (!value || value.length > 1000 || /\s/.test(value)) return null;
    let url: URL;
    try {
        url = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
    } catch {
        return null;
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.port) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.hostname === 'on.soundcloud.com') return parts.length === 1 && /^[a-z0-9]{1,64}$/i.test(parts[0]) ? 'https://on.soundcloud.com/' + parts[0] : null;
    if (!['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'].includes(url.hostname)) return null;
    // Вход, выход и привязка аккаунтов по вставке не открываются
    const account = ['logout', 'signin', 'signup', 'login', 'connect', 'oauth', 'oauth2', 'email-preferences'];
    if (parts.length < 1 || parts.length > 4 || account.includes(parts[0].toLowerCase())) return null;
    if (!parts.every((part) => /^[a-z0-9_-]{1,255}$/i.test(part))) return null;
    // Регистр различает только секретный ключ s-... приватной ссылки
    return 'https://soundcloud.com/' + parts.map((part, index) => (index >= 2 && /^s-/.test(part) ? part : part.toLowerCase())).join('/');
}

// Вставка ссылки в поиск сайта сразу открывает её страницу; набранная руками ссылка открывается по Enter
export function installSearchLink(parse: (text: string) => string | null): void {
    const host = window as SearchLinkWindow;
    host.__disposeSearchLink?.();
    const field = (target: EventTarget | null): HTMLInputElement | null =>
        target instanceof HTMLInputElement && target.closest('form.headerSearch') ? target : null;
    const open = (input: HTMLInputElement, link: string): void => {
        input.value = '';
        input.blur();
        // Переход внутри сайта не обрывает музыку. Секретную ссылку он не берёт, её и короткую on.soundcloud.com ведёт клиент
        if (link.startsWith('https://soundcloud.com/') && host.__scNavigate?.(new URL(link).pathname)) return;
        location.assign(link);
    };
    const take = (event: Event, input: HTMLInputElement, link: string | null): void => {
        if (!link) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        open(input, link);
    };
    const onPaste = (event: ClipboardEvent): void => {
        const input = field(event.target);
        if (!input) return;
        // Ссылкой считается вставка, после которой в поле не останется другого текста
        const rest = input.value.slice(0, input.selectionStart ?? 0) + input.value.slice(input.selectionEnd ?? input.value.length);
        if (!rest.trim()) take(event, input, parse(event.clipboardData?.getData('text/plain') ?? ''));
    };
    const onKey = (event: KeyboardEvent): void => {
        const input = event.key === 'Enter' && !event.isComposing ? field(event.target) : null;
        if (input) take(event, input, parse(input.value));
    };
    const onSubmit = (event: SubmitEvent): void => {
        const form = event.target instanceof HTMLFormElement && event.target.matches('form.headerSearch') ? event.target : null;
        const input = form?.querySelector<HTMLInputElement>('input[name="q"]');
        if (input) take(event, input, parse(input.value));
    };
    window.addEventListener('paste', onPaste, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('submit', onSubmit, true);
    const dispose = (): void => {
        window.removeEventListener('paste', onPaste, true);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('submit', onSubmit, true);
        window.removeEventListener('pagehide', dispose);
        delete host.__disposeSearchLink;
    };
    host.__disposeSearchLink = dispose;
    window.addEventListener('pagehide', dispose, { once: true });
}

export function searchLinkScript(): string {
    return '(' + installSearchLink.toString() + ')(' + pastedLink.toString() + ');';
}
