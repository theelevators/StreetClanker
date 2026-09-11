import { type AssetLoader } from "../types.js";
export type JsonAssetData = unknown;
export declare const JsonAsset: import("../types.js").AssetType<unknown>;
export type JsonLoaderOptions = {
    /** Map of key → JSON value or async factory (tests / memory). */
    sources?: Record<string, unknown | (() => Promise<unknown>)>;
    /** Optional fetch-like for URL keys. */
    fetchJson?: (key: string, signal: AbortSignal) => Promise<unknown>;
};
/**
 * Generic JSON loader — proves @mob3/assets is not GLTF infrastructure.
 * Default: resolves from `options.sources` or parses `key` if it looks like JSON.
 */
export declare function createJsonLoader(opts?: JsonLoaderOptions): AssetLoader<JsonAssetData>;
//# sourceMappingURL=json.d.ts.map