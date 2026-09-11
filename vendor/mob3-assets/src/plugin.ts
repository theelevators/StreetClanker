import {
  Update,
  system,
  type App,
  type Plugin,
  type World,
} from "mob3";
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
  run(world: World) {
    const reg = world.tryResource(Assets);
    if (!reg || reg.isDisposed) return;
    reg.flush(world);
  },
});

export type AssetsPluginOptions = {
  /** Register built-in JsonAsset loader (default true). */
  json?: boolean;
};

export function AssetsPlugin(options: AssetsPluginOptions = {}): Plugin {
  const { json = true } = options;
  return {
    build(app: App) {
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

export function getAssets(world: World): AssetsApi {
  const reg = world.tryResource(Assets);
  if (!reg) throw new Error("Assets resource missing — add AssetsPlugin()");
  return new AssetsApi(reg);
}
