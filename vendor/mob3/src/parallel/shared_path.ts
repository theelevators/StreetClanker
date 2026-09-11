import type { World } from "../world.js";
import type { WorkerSystemMeta } from "./worker_system.js";
import {
  SharedPackedStorage,
  type SharedStoreDescriptor,
} from "../storage/shared_packed.js";
import { getPackedMeta } from "../storage/packed_component.js";
import { getNumericLayout } from "./transfer.js";

export type SharedWorkerPayload = {
  mode: "shared";
  stores: Record<string, SharedStoreDescriptor>;
  resources: Record<string, unknown>;
  writeNames: string[];
  delayMs?: number;
};

function cloneResource(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      /* fallthrough */
    }
  }
  return JSON.parse(JSON.stringify(value));
}

/** True when every non-tag component access uses SharedPackedStorage. */
export function canUseSharedPath(
  world: World,
  meta: WorkerSystemMeta,
): boolean {
  const types = [
    ...meta.access.componentRead,
    ...meta.access.componentWrite,
  ];
  let sawData = false;
  for (const c of types) {
    if (c.isTag) continue;
    const packed = getPackedMeta(c);
    if (!packed?.shared) return false;
    const store = world.ensureStorage(c);
    if (!(store instanceof SharedPackedStorage) && store.kind !== "shared") {
      return false;
    }
    sawData = true;
  }
  return sawData;
}

export function extractSharedWorkerPayload(
  world: World,
  meta: WorkerSystemMeta,
  delayMs?: number,
): SharedWorkerPayload {
  const stores: Record<string, SharedStoreDescriptor> = {};
  const types = new Set([
    ...meta.access.componentRead,
    ...meta.access.componentWrite,
  ]);
  for (const c of types) {
    if (c.isTag) continue;
    const store = world.ensureStorage(c);
    if (!(store instanceof SharedPackedStorage)) {
      throw new Error(
        `Expected SharedPackedStorage for '${getPackedMeta(c)?.name}'`,
      );
    }
    const desc = store.workerDescriptor();
    stores[desc.name] = desc;
  }

  const resources: Record<string, unknown> = {};
  for (const key of meta.resourceKeys) {
    const name =
      typeof key === "object" && key && "name" in key
        ? String((key as { name?: string }).name ?? "Resource")
        : typeof key === "function"
          ? key.name || "Resource"
          : "Resource";
    if (world.hasResource(key)) {
      resources[name] = cloneResource(world.resource(key));
    }
  }

  const writeNames: string[] = [];
  for (const c of meta.access.componentWrite) {
    const layout = getNumericLayout(c);
    if (layout) writeNames.push(layout.name);
  }

  return {
    mode: "shared",
    stores,
    resources,
    writeNames,
    delayMs,
  };
}
