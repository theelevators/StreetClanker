import type { World } from "mob3";
import { type AssetHandle } from "./handle.js";
import type { AssetLoader, AssetStateView, AssetStatus, AssetType, InsertOptions, ReleaseOptions } from "./types.js";
export declare function makeDedupeKey(type: AssetType<unknown>, key: string, options?: unknown): string;
/**
 * Renderer-agnostic asset registry.
 * Promise completions only enqueue; call `flush()` from AssetMaintenance.
 */
export declare class AssetRegistry {
    private slots;
    private free;
    private byDedupe;
    private loaders;
    private pending;
    private disposed;
    private nextLoadId;
    /** Test instrumentation */
    loaderInvocationCount: number;
    get isDisposed(): boolean;
    registerLoader<T>(type: AssetType<T>, loader: AssetLoader<T>): void;
    hasLoader(type: AssetType<unknown>): boolean;
    load<T>(type: AssetType<T>, key: string, options?: unknown): AssetHandle<T>;
    insert<T>(type: AssetType<T>, key: string, value: T, opts?: InsertOptions): AssetHandle<T>;
    retain<T>(handle: AssetHandle<T>): void;
    release<T>(handle: AssetHandle<T>, opts?: ReleaseOptions): void;
    cancel<T>(handle: AssetHandle<T>): void;
    unload<T>(handle: AssetHandle<T>): void;
    reload<T>(handle: AssetHandle<T>): AssetHandle<T>;
    state<T>(handle: AssetHandle<T>): AssetStateView<T>;
    status<T>(handle: AssetHandle<T>): AssetStatus;
    isReady<T>(handle: AssetHandle<T>): boolean;
    get<T>(handle: AssetHandle<T>): T | undefined;
    error<T>(handle: AssetHandle<T>): Error | undefined;
    refCount<T>(handle: AssetHandle<T>): number;
    /** Apply queued promise completions. Called by AssetMaintenance. */
    flush(world: World): void;
    inspect(): Array<Record<string, unknown>>;
    formatRegistry(): string;
    /** Tear down for App.dispose — abort, dispose owned, ignore late completions. */
    dispose(): void;
    private startLoad;
    private liveSlot;
    private allocSlot;
    private unloadInternal;
    private disposeSlotValue;
    private disposeValue;
    private assertLive;
}
//# sourceMappingURL=registry.d.ts.map