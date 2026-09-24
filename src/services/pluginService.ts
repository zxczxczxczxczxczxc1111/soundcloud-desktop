import { pluginInjection, pluginCleanup } from './pluginScripts';
import { PluginProcess } from './pluginProcess';
import { isTrustedLocalSender } from '../trustedViews';
import { app, ipcMain, type BrowserView } from 'electron';
import { readFileSync, existsSync, readdirSync, statSync, watch, mkdirSync } from 'fs';
import path, { join, basename, extname } from 'path';
import type ElectronStore from 'electron-store';
import { EventEmitter } from 'events';
import { parseMetadata, type FileMetadata } from '../utils/metadataParser';

export interface PluginInfo {
    id: string;
    filePath: string;
    metadata: FileMetadata;
    enabled: boolean;
}

interface PluginRuntime { process: PluginProcess; code: string; }

export class PluginService {
    private store: ElectronStore;
    private plugins: Map<string, PluginInfo> = new Map();
    private runtimes: Map<string, PluginRuntime> = new Map();
    private pluginsPath: string;
    private emitter = new EventEmitter();
    private stopWatching?: () => void;
    private contentView: BrowserView | null = null;

    constructor(store: ElectronStore) {
        this.store = store;
        // assign dynamic environment path
        this.pluginsPath = this.getPluginsPath();
        this.ensurePluginsDirectory();
        this.scanPlugins();
        this.setupIpcHandlers();
        this.startWatching();
        this.enableSavedPlugins();
    }

    private ensurePluginsDirectory(): void {
        try {
            if (!existsSync(this.pluginsPath)) {
                mkdirSync(this.pluginsPath, { recursive: true });
            }
        } catch (error) {
            console.error('Failed to create plugins directory:', error);
        }
    }

    private scanPlugins(): void {
        try {
            if (!existsSync(this.pluginsPath)) return;

            const enabledMap = (this.store.get('enabledPlugins', {}) as Record<string, boolean>) || {};
            const files = readdirSync(this.pluginsPath);

            for (const file of files) {
                const filePath = join(this.pluginsPath, file);
                const stat = statSync(filePath);

                if (!stat.isFile() || extname(file).toLowerCase() !== '.js') continue;

                try {
                    const source = readFileSync(filePath, 'utf-8');
                    const metadata = parseMetadata(source, 'js');
                    const id = basename(file, '.js');

                    if (!metadata.name) metadata.name = id;

                    this.plugins.set(id, {
                        id,
                        filePath,
                        metadata,
                        enabled: !!enabledMap[id],
                    });
                } catch (error) {
                    console.error(`Failed to load plugin ${file}:`, error);
                }
            }
        } catch (error) {
            console.error('Failed to scan plugins:', error);
        }
    }

    private startWatching(): void {
        try {
            if (!existsSync(this.pluginsPath)) return;
            if (this.stopWatching) {
                this.stopWatching();
                this.stopWatching = undefined;
            }

            let debounce: ReturnType<typeof setTimeout> | undefined;
            const watcher = watch(this.pluginsPath, { persistent: true }, (_eventType, filename) => {
                if (!filename || extname(filename).toLowerCase() !== '.js') return;
                clearTimeout(debounce);
                debounce = setTimeout(() => this.refreshPlugins(), 200);
            });

            this.stopWatching = () => {
                clearTimeout(debounce);
                try {
                    watcher.close();
                } catch (error) { console.error('Не удалось остановить наблюдение за плагинами:', error); }
            };
        } catch (error) {
            console.error('Failed to watch plugins folder:', error);
        }
    }

    private enableSavedPlugins(): void {
        for (const [id, plugin] of this.plugins) {
            if (plugin.enabled) {
                this.activatePlugin(id);
            }
        }
    }

    private activatePlugin(id: string): boolean {
        const plugin = this.plugins.get(id);
        if (!plugin) return false;
        if (this.runtimes.has(id)) return true;
        try {
            const source = readFileSync(plugin.filePath, 'utf-8');
            const child = new PluginProcess((error) => {
                if (this.runtimes.get(id)?.process !== child) return;
                console.error('Плагин отключён:', id, error);
                this.deactivatePlugin(id);
                plugin.enabled = false;
                this.persistEnabledState();
                this.emitter.emit('plugins-changed');
            });
            const runtime = { process: child, code: '' };
            this.runtimes.set(id, runtime);
            void child.request({ kind: 'load', source, filename: plugin.filePath }).then((code) => {
                if (this.runtimes.get(id) !== runtime) return;
                runtime.code = typeof code === 'string' ? code : '';
                this.injectContentScript(id, runtime.code);
            }).catch((error: unknown) => {
                if (this.runtimes.get(id) !== runtime) return;
                console.error('Не удалось загрузить плагин:', id, error);
                this.deactivatePlugin(id);
                plugin.enabled = false;
                this.persistEnabledState();
                this.emitter.emit('plugins-changed');
            });
            return true;
        } catch (error) { console.error('Не удалось запустить плагин:', error); return false; }
    }
    private deactivatePlugin(id: string): void {
        const runtime = this.runtimes.get(id);
        if (!runtime) return;
        this.runtimes.delete(id);
        this.removeContentScript(id);
        void runtime.process.dispose();
    }
    private injectContentScript(id: string, code: string): void {
        const contents = this.contentView?.webContents;
        if (!contents || contents.isDestroyed() || !code.trim()) return;
        const wrapped = pluginInjection(id, code);
        void contents.executeJavaScript(wrapped).catch((error: unknown) => console.error('Не удалось внедрить плагин:', id, error));
    }
    private removeContentScript(id: string): void {
        const contents = this.contentView?.webContents;
        if (!contents || contents.isDestroyed()) return;
        const cleanup = pluginCleanup(id);
        void contents.executeJavaScript(cleanup).catch((error: unknown) => { if (!contents.isDestroyed()) console.error('Не удалось очистить плагин:', id, error); });
    }

    public setContentView(view: BrowserView): void {
        this.contentView = view;
    }

    public injectAllContentScripts(): void {
        for (const [id, runtime] of this.runtimes) {
            this.injectContentScript(id, runtime.code);
        }
    }

    private persistEnabledState(): void {
        const map: Record<string, boolean> = {};
        for (const [id, plugin] of this.plugins) {
            if (plugin.enabled) map[id] = true;
        }
        this.store.set('enabledPlugins', map);
    }

    public setPluginEnabled(id: string, enabled: boolean): boolean {
        const plugin = this.plugins.get(id);
        if (!plugin) return false;

        plugin.enabled = enabled;
        this.persistEnabledState();

        if (enabled) {
            return this.activatePlugin(id);
        } else {
            this.deactivatePlugin(id);
            return true;
        }
    }

    public getPlugins(): PluginInfo[] {
        return Array.from(this.plugins.values());
    }

    public refreshPlugins(): void {
        const previouslyEnabled = new Set<string>();
        for (const [id, plugin] of this.plugins) {
            if (plugin.enabled) previouslyEnabled.add(id);
        }

        for (const id of this.runtimes.keys()) {
            this.deactivatePlugin(id);
        }

        this.plugins.clear();
        this.scanPlugins();

        for (const id of previouslyEnabled) {
            const plugin = this.plugins.get(id);
            if (plugin) {
                plugin.enabled = true;
                this.activatePlugin(id);
            }
        }

        this.persistEnabledState();
        this.emitter.emit('plugins-changed');
    }

    public notifyTrackChange(track: Record<string, unknown>): void {
        for (const [id, runtime] of this.runtimes) {
            try {
                runtime.process.notifyTrack({ ...track });
            } catch (e) {
                console.error(`[plugin:${id}] onTrackChange error:`, e);
            }
        }
    }

    public dispose(): void {
        this.stopWatching?.();
        for (const id of this.runtimes.keys()) this.deactivatePlugin(id);
    }

    public getPluginsPath(): string {
        // Как и темы, плагины лежат в профиле: у dev-запуска свой профиль soundcloud-desktop-dev
        return path.join(app.getPath('userData'), 'plugins');
    }

    public onPluginsChanged(listener: () => void): () => void {
        this.emitter.on('plugins-changed', listener);
        return () => this.emitter.off('plugins-changed', listener);
    }

    private setupIpcHandlers(): void {
        ipcMain.handle('get-plugins', (event) => {
            if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');

            return this.getPlugins().map((p) => ({
                id: p.id,
                metadata: p.metadata,
                enabled: p.enabled,
            }));
        });

        ipcMain.handle('set-plugin-enabled', (_, id: string, enabled: boolean) => {
            if (!isTrustedLocalSender(_)) throw new Error('Недопустимый отправитель IPC');
            if (typeof id !== 'string' || typeof enabled !== 'boolean') return false;

            return this.setPluginEnabled(id, enabled);
        });

        ipcMain.handle('get-plugins-folder-path', (event) => {
            if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');

            return this.pluginsPath;
        });

        ipcMain.handle('refresh-plugins', (event) => {
            if (!isTrustedLocalSender(event)) throw new Error('Недопустимый отправитель IPC');

            this.refreshPlugins();
            return this.getPlugins().map((p) => ({
                id: p.id,
                metadata: p.metadata,
                enabled: p.enabled,
            }));
        });
    }
}
