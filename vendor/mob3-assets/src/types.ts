import type { AssetHandle } from "./handle.js";

/** Typed asset kind — identity for loaders / registry slots. */
export type AssetType<T> = {
  readonly id: symbol;
  readonly name: string;
  /** Phantom for TypeScript inference only. */
  readonly __brand?: T;
};

export function defineAssetType<T>(name: string): AssetType<T> {
  return {
    id: Symbol(`mob3.asset.${name}`),
    name,
  };
}

export type AssetOwnership = "owned" | "external";

export type AssetStatus =
  | "absent"
  | "loading"
  | "ready"
  | "failed"
  | "cancelled";

export type AssetStateView<T> =
  | { status: "absent" }
  | { status: "loading"; progress?: number; key: string }
  | { status: "ready"; value: T; key: string }
  | { status: "failed"; error: Error; key: string }
  | { status: "cancelled"; key: string };

export type AssetRequest = {
  key: string;
  /** Optional loader-specific config; included in dedupe fingerprint when set. */
  options?: unknown;
};

export type AssetLoadContext = {
  signal: AbortSignal;
  key: string;
};

export type AssetLoader<T> = {
  load(request: AssetRequest, ctx: AssetLoadContext): Promise<T>;
  /** Called for registry-owned values on unload/dispose. */
  dispose?(value: T): void;
};

export type LoadOptions = {
  /** Fingerprinted into dedupe key when present. */
  options?: unknown;
  /**
   * When true (default), release() at refCount 0 while loading aborts the request.
   * Ready assets with refCount 0 stay cached until unload().
   */
};

export type ReleaseOptions = {
  /** If true, unload immediately when refCount hits 0. */
  unload?: boolean;
};

export type InsertOptions = {
  ownership?: AssetOwnership;
};

/** Opaque pending transition applied by AssetMaintenance. */
export type PendingTransition =
  | {
      kind: "ready";
      slot: number;
      generation: number;
      value: unknown;
      loadId: number;
    }
  | {
      kind: "failed";
      slot: number;
      generation: number;
      error: Error;
      loadId: number;
    }
  | {
      kind: "cancelled";
      slot: number;
      generation: number;
      loadId: number;
    };

export type AssetReadyEvent = {
  handle: AssetHandle<unknown>;
  key: string;
  typeName: string;
};

export type AssetFailedEvent = {
  handle: AssetHandle<unknown>;
  key: string;
  typeName: string;
  error: Error;
};
