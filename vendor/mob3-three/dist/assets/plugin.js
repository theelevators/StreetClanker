import { Assets } from "@mob3/assets";
import { AssetsPlugin } from "@mob3/assets";
import { createGltfLoader, GltfAsset } from "./gltf.js";
/**
 * Registers GltfAsset loader via public Assets APIs.
 * Also installs AssetsPlugin unless skipAssetsPlugin.
 */
export function ThreeAssetsPlugin(options = {}) {
    return {
        build(app) {
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
//# sourceMappingURL=plugin.js.map