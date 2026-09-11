import type { Plugin } from "mob3";
import { type AssetsPluginOptions } from "@mob3/assets";
import { type GltfLoaderOptions } from "./gltf.js";
export type ThreeAssetsPluginOptions = {
    assets?: AssetsPluginOptions;
    gltf?: GltfLoaderOptions;
    /** Skip registering AssetsPlugin if already added. Default false. */
    skipAssetsPlugin?: boolean;
};
/**
 * Registers GltfAsset loader via public Assets APIs.
 * Also installs AssetsPlugin unless skipAssetsPlugin.
 */
export declare function ThreeAssetsPlugin(options?: ThreeAssetsPluginOptions): Plugin;
//# sourceMappingURL=plugin.d.ts.map