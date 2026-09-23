interface FeatureWindow extends Window {
    soundcloudAPI?: { sendProfileUpdate(username: string): void };
    __disposeSoundCloudFeatures?: () => void;
}

export function installPageFeatures(hideArtistUpsells: boolean): void {
    const host = window as FeatureWindow;
    host.__disposeSoundCloudFeatures?.();
    let profileRoot: Element | null = null;
    let username = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frames = new Map<HTMLIFrameElement, () => void>();
    const profileObserver = new MutationObserver(readProfile);
    function readProfile(): void {
        const link = profileRoot?.querySelector<HTMLAnchorElement>(
            '[data-menu-name="profile"], .header__userNavUsernameButton',
        );
        if (!link?.href) return;
        try {
            const url = new URL(link.href);
            const name = url.pathname.split('/').filter(Boolean)[0];
            if (url.hostname === 'soundcloud.com' && name && name !== username) {
                username = name;
                host.soundcloudAPI?.sendProfileUpdate(name);
            }
        } catch (error) {
            console.debug('Некорректная ссылка профиля:', error);
        }
    }
    function bindProfile(): void {
        timer = undefined;
        profileObserver.disconnect();
        profileRoot = document.querySelector('.header__userNav, .header');
        if (profileRoot) {
            profileObserver.observe(profileRoot, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['href'],
                characterData: true,
            });
            readProfile();
        }
    }
    function attachFrame(frame: HTMLIFrameElement): void {
        if (!hideArtistUpsells || frames.has(frame) || !['Artist tools', 'Sidebar modules'].includes(frame.title))
            return;
        let observer: MutationObserver | null = null;
        let style: HTMLStyleElement | null = null;
        const container = frame.closest<HTMLElement>('.webiEmbeddedModuleContainer');
        const oldDisplay = container?.style.display ?? '';
        const apply = (): void => {
            observer?.disconnect();
            style?.remove();
            observer = null;
            style = null;
            const doc = frame.contentDocument;
            if (!doc?.head || !doc.body) return;
            style = doc.createElement('style');
            style.textContent = '.MuiBox-root:has(a[href*="getstarted/fan-support"]) { display: none !important; }';
            doc.head.appendChild(style);
            const update = (): void => {
                if (container)
                    container.style.display = doc.querySelector('svg[aria-label="Paywalled feature"]')
                        ? 'none'
                        : oldDisplay;
            };
            update();
            observer = new MutationObserver(update);
            observer.observe(doc.body, { childList: true, subtree: true });
        };
        frame.addEventListener('load', apply);
        frames.set(frame, () => {
            frame.removeEventListener('load', apply);
            observer?.disconnect();
            style?.remove();
            if (container) container.style.display = oldDisplay;
        });
        apply();
    }
    const observer = new MutationObserver((records) => {
        if (!profileRoot?.isConnected && timer === undefined) timer = setTimeout(bindProfile, 250);
        if (!hideArtistUpsells) return;
        for (const [frame, dispose] of frames)
            if (!frame.isConnected) {
                dispose();
                frames.delete(frame);
            }
        for (const record of records)
            for (const node of record.addedNodes) {
                if (!(node instanceof Element)) continue;
                if (node instanceof HTMLIFrameElement) attachFrame(node);
                node.querySelectorAll('iframe').forEach(attachFrame);
            }
    });
    bindProfile();
    if (hideArtistUpsells) document.querySelectorAll('iframe').forEach(attachFrame);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const dispose = (): void => {
        observer.disconnect();
        profileObserver.disconnect();
        if (timer !== undefined) clearTimeout(timer);
        for (const cleanup of frames.values()) cleanup();
        frames.clear();
        window.removeEventListener('pagehide', dispose);
        delete host.__disposeSoundCloudFeatures;
    };
    host.__disposeSoundCloudFeatures = dispose;
    window.addEventListener('pagehide', dispose, { once: true });
}

export function pageFeaturesScript(hideArtistUpsells: boolean): string {
    return '(' + installPageFeatures.toString() + ')(' + JSON.stringify(hideArtistUpsells) + ');';
}
