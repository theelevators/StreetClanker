import { Update, system, } from "mob3";
import { Assets, AssetsApi } from "./api.js";
import { AssetRegistry } from "./registry.js";
import { AssetFailed, AssetReady } from "./events.js";
import { JsonAsset, createJsonLoader } from "./loaders/json.js";
/**
 * Apply queued asset transitions early in Update.
 * Promise callbacks only enqueue; this system applies them.
 *
 * Why Update not PreUpdate: App.clearEvents() runs before each FixedUpdate,
 * which would drop AssetReady emitted in PreUpdate before gameplay Update.
 */
export const assetMaintenance = system({
    name: "assetMaintenance",
    access: {
        resources: { write: [Assets] },
        events: { write: [AssetReady, AssetFailed] },
    },
    run(world) {
        const reg = world.tryResource(Assets);
        if (!reg || reg.isDisposed)
            return;
        reg.flush(world);
    },
});
export function AssetsPlugin(options = {}) {
    const { json = true } = options;
    return {
        build(app) {
            const registry = new AssetRegistry();
            app.insertResource(Assets, registry);
            if (json) {
                registry.registerLoader(JsonAsset, createJsonLoader());
            }
            app.addSystem(Update, assetMaintenance);
            app.onDispose(() => {
                registry.dispose();
            });
        },
    };
}
export function getAssets(world) {
    const reg = world.tryResource(Assets);
    if (!reg)
        throw new Error("Assets resource missing — add AssetsPlugin()");
    return new AssetsApi(reg);
}
//# sourceMappingURL=plugin.js.map