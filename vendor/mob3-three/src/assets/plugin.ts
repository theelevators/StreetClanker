import type { App, Plugin } from "mob3";
import { Assets, type AssetsPluginOptions } from "@mob3/assets";
import { AssetsPlugin } from "@mob3/assets";
import { createGltfLoader, GltfAsset, type GltfLoaderOptions } from "./gltf.js";

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
export function ThreeAssetsPlugin(
  options: ThreeAssetsPluginOptions = {},
): Plugin {
  return {
    build(app: App) {
      if (!options.skipAssetsPlugin) {
        if (!app.world.tryResource(Assets)) {
          app.addPlugin(AssetsPlugin(options.assets));
        }
      }
      const reg = app.world.resource(Assets);
      if (!reg.hasLoader(GltfAsset)) {
        reg.registerLoader(GltfAsset, createGltfLoader(options.gltf));
      }
    },
  };
}
