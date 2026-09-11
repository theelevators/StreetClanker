export {
  defineAssetType,
  type AssetType,
  type AssetOwnership,
  type AssetStatus,
  type AssetStateView,
  type AssetRequest,
  type AssetLoadContext,
  type AssetLoader,
  type LoadOptions,
  type ReleaseOptions,
  type InsertOptions,
  type PendingTransition,
  type AssetReadyEvent,
  type AssetFailedEvent,
} from "./types.js";

export {
  type AssetHandle,
  makeHandle,
  handlesEqual,
} from "./handle.js";

export { AssetRegistry, makeDedupeKey } from "./registry.js";
export { Assets, AssetsApi, assetsOf } from "./api.js";
export {
  AssetsPlugin,
  assetMaintenance,
  getAssets,
  type AssetsPluginOptions,
} from "./plugin.js";
export { AssetReady, AssetFailed } from "./events.js";

export {
  JsonAsset,
  createJsonLoader,
  type JsonAssetData,
  type JsonLoaderOptions,
} from "./loaders/json.js";

export {
  FakeAsset,
  createFakeLoader,
  type FakeAssetData,
  type FakeController,
} from "./loaders/fake.js";
