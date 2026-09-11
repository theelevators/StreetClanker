import { resource, type World } from "mob3";
import { AssetRegistry } from "./registry.js";
import type {
  AssetLoader,
  AssetStateView,
  AssetStatus,
  AssetType,
  InsertOptions,
  ReleaseOptions,
} from "./types.js";
import type { AssetHandle } from "./handle.js";

export const Assets = resource<AssetRegistry>("Assets");

export function assetsOf(world: World): AssetRegistry {
  const a = world.tryResource(Assets);
  if (!a) {
    throw new Error("Assets resource missing — add AssetsPlugin()");
  }
  return a;
}

/** Ergonomic facade stored alongside the registry resource when useful. */
export class AssetsApi {
  constructor(readonly registry: AssetRegistry) {}

  registerLoader<T>(type: AssetType<T>, loader: AssetLoader<T>): void {
    this.registry.registerLoader(type, loader);
  }

  load<T>(type: AssetType<T>, key: string, options?: unknown): AssetHandle<T> {
    return this.registry.load(type, key, options);
  }

  insert<T>(
    type: AssetType<T>,
    key: string,
    value: T,
    opts?: InsertOptions,
  ): AssetHandle<T> {
    return this.registry.insert(type, key, value, opts);
  }

  retain<T>(handle: AssetHandle<T>): void {
    this.registry.retain(handle);
  }

  release<T>(handle: AssetHandle<T>, opts?: ReleaseOptions): void {
    this.registry.release(handle, opts);
  }

  unload<T>(handle: AssetHandle<T>): void {
    this.registry.unload(handle);
  }

  reload<T>(handle: AssetHandle<T>): AssetHandle<T> {
    return this.registry.reload(handle);
  }

  cancel<T>(handle: AssetHandle<T>): void {
    this.registry.cancel(handle);
  }

  state<T>(handle: AssetHandle<T>): AssetStateView<T> {
    return this.registry.state(handle);
  }

  status<T>(handle: AssetHandle<T>): AssetStatus {
    return this.registry.status(handle);
  }

  isReady<T>(handle: AssetHandle<T>): boolean {
    return this.registry.isReady(handle);
  }

  get<T>(handle: AssetHandle<T>): T | undefined {
    return this.registry.get(handle);
  }

  error<T>(handle: AssetHandle<T>): Error | undefined {
    return this.registry.error(handle);
  }

  refCount<T>(handle: AssetHandle<T>): number {
    return this.registry.refCount(handle);
  }

  inspect(): Array<Record<string, unknown>> {
    return this.registry.inspect();
  }

  formatRegistry(): string {
    return this.registry.formatRegistry();
  }
}
