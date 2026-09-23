export function pluginInjection(id: string, code: string): string {
    return '(() => { const id = ' + JSON.stringify('scrpc-plugin-' + id) + '; document.getElementById(id)?.remove(); const script = document.createElement("script"); script.id = id; script.textContent = ' + JSON.stringify(code) + '; document.head.appendChild(script); })();';
}
export function pluginCleanup(id: string): string {
    const key = JSON.stringify('__scrpc_cleanup_' + id.replace(/[^a-zA-Z0-9_]/g, '_'));
    return '(() => { document.getElementById(' + JSON.stringify('scrpc-plugin-' + id) + ')?.remove(); const key = ' + key + '; if (typeof window[key] === "function") { try { window[key](); } finally { delete window[key]; } } })();';
}
