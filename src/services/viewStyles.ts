interface CSSView {
    isDestroyed(): boolean;
    insertCSS(css: string): Promise<string>;
    removeInsertedCSS(key: string): Promise<void>;
}

export function splitThemeCSS(css: string | null): Record<'all' | 'content' | 'header' | 'settings', string> {
    const result = { all: '', content: '', header: '', settings: '' };
    if (!css) return result;
    const marker = /\/\*\s*@target\s+(all|content|header|settings)\s*\*\/([\s\S]*?)(?=\/\*\s*@target\s+|$)/gi;
    let match: RegExpExecArray | null;
    let found = false;
    while ((match = marker.exec(css))) {
        found = true;
        const target = match[1].toLowerCase() as keyof typeof result;
        result[target] += '\n' + match[2].replace(/\/\*\s*@end\s*\*\//gi, '');
    }
    if (!found) result.content = css;
    return result;
}

export class ViewStyles {
    private states = new WeakMap<CSSView, { key: string | null; revision: number; pending: Promise<void> }>();

    public apply(view: CSSView, css: string): Promise<void> {
        let state = this.states.get(view);
        if (!state) {
            state = { key: null, revision: 0, pending: Promise.resolve() };
            this.states.set(view, state);
        }
        const current = state;
        const revision = ++current.revision;
        // Последовательная замена не оставляет старые CSS при быстрых переключениях темы.
        current.pending = current.pending
            .catch(() => undefined)
            .then(async () => {
                if (view.isDestroyed() || revision !== current.revision) return;
                // Сначала новый CSS, потом снятие старого: иначе между вызовами успевает отрисоваться кадр без стилей.
                const previous = current.key;
                current.key = css ? await view.insertCSS(css) : null;
                if (previous && !view.isDestroyed()) await view.removeInsertedCSS(previous);
            });
        return current.pending;
    }
}
