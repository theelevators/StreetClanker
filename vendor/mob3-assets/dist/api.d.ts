import { type World } from "mob3";
import { AssetRegistry } from "./registry.js";
import type { AssetLoader, AssetStateView, AssetStatus, AssetType, InsertOptions, ReleaseOptions } from "./types.js";
import type { AssetHandle } from "./handle.js";
export declare const Assets: import("mob3").ResourceType<AssetRegistry>;
export declare function assetsOf(world: World): AssetRegistry;
/** Ergonomic facade stored alongside the registry resource when useful. */
export declare class AssetsApi {
    readonly registry: AssetRegistry;
    constructor(registry: AssetRegistry);
    registerLoader<T>(type: AssetType<T>, loader: AssetLoader<T>): void;
    load<T>(type: AssetType<T>, key: string, options?: unknown): AssetHandle<T>;
    insert<T>(type: AssetType<T>, key: string, value: T, opts?: InsertOptions): AssetHandle<T>;
    retain<T>(handle: AssetHandle<T>): void;
    release<T>(handle: AssetHandle<T>, opts?: ReleaseOptions): void;
    unload<T>(handle: AssetHandle<T>): void;
    reload<T>(handle: AssetHandle<T>): AssetHandle<T>;
    cancel<T>(handle: AssetHandle<T>): void;
    state<T>(handle: AssetHandle<T>): AssetStateView<T>;
    status<T>(handle: AssetHandle<T>): AssetStatus;
    isReady<T>(handle: AssetHandle<T>): boolean;
    get<T>(handle: AssetHandle<T>): T | undefined;
    error<T>(handle: AssetHandle<T>): Error | undefined;
    refCount<T>(handle: AssetHandle<T>): number;
    inspect(): Array<Record<string, unknown>>;
    formatRegistry(): string;
}
//# sourceMappingURL=api.d.ts.map