import { type Plugin, type World } from "mob3";
import { AssetsApi } from "./api.js";
/**
 * Apply queued asset transitions early in Update.
 * Promise callbacks only enqueue; this system applies them.
 *
 * Why Update not PreUpdate: App.clearEvents() runs before each FixedUpdate,
 * which would drop AssetReady emitted in PreUpdate before gameplay Update.
 */
export declare const assetMaintenance: import("mob3").DeclaredSystem;
export type AssetsPluginOptions = {
    /** Register built-in JsonAsset loader (default true). */
    json?: boolean;
};
export declare function AssetsPlugin(options?: AssetsPluginOptions): Plugin;
export declare function getAssets(world: World): AssetsApi;
//# sourceMappingURL=plugin.d.ts.map