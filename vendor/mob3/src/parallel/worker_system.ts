import type { World } from "../world.js";
import type { Commands } from "../commands.js";
import type { SystemFn } from "../schedule.js";
import type { AccessDeclaration, DeclaredSystem, SystemMeta } from "../system.js";
import { normalizeAccess, SYSTEM_META } from "../system.js";
import {
  assertWorkerAccess,
  extractWorkerPayloadWithKeys,
  validateWorkerResult,
  commitWorkerWrites,
  commitWorkerEvents,
  getNumericLayout,
} from "./transfer.js";
import type { ResourceKey } from "../resource.js";
import type { EventType } from "../event.js";
import type { WorkerPayload, WorkerResult } from "./types.js";

export type WorkerSystemDefinition = {
  name: string;
  /**
   * Absolute module URL the worker will `import()`
   * (e.g. `new URL("./integrate.js", import.meta.url)`).
   */
  module: URL | string;
  /** Named export inside `module` — must implement the same logic as `run`. */
  export: string;
  /**
   * Main-thread handler (usually the same function imported from `module`).
   * Used by the sequential executor and worker-fallback path.
   */
  run: (payload: WorkerPayload) => WorkerResult;
  access: AccessDeclaration;
  /** Test/demo only: delay inside job (number or per-call factory). */
  delayMs?: number | (() => number);
};

export type WorkerSystemMeta = SystemMeta & {
  affinity: "worker";
  moduleUrl: string;
  exportName: string;
  handler: (payload: WorkerPayload) => WorkerResult;
  resourceKeys: ResourceKey[];
  eventTypes: EventType[];
  delayMs?: number | (() => number);
};

const WORKER_META = Symbol.for("mob3.workerSystemMeta");

export type WorkerDeclaredSystem = DeclaredSystem & {
  readonly [WORKER_META]: WorkerSystemMeta;
};

function toModuleUrl(module: URL | string): string {
  return typeof module === "string" ? module : module.href;
}

function writeNamesFor(meta: WorkerSystemMeta): Set<string> {
  const names = new Set<string>();
  for (const c of meta.access.componentWrite) {
    const layout = getNumericLayout(c);
    if (layout) names.add(layout.name);
  }
  return names;
}

/**
 * Run a worker system handler against World on the main thread
 * (sequential reference / fallback). Sync — uses `run` handler, not import.
 */
export function runWorkerSystemLocal(
  world: World,
  meta: WorkerSystemMeta,
): void {
  const delayMs =
    meta.delayMs === undefined
      ? undefined
      : typeof meta.delayMs === "function"
        ? meta.delayMs()
        : meta.delayMs;
  const { payload, ctx } = extractWorkerPayloadWithKeys(
    world,
    meta.access,
    meta.resourceKeys,
    meta.eventTypes,
    delayMs,
  );
  if (delayMs && delayMs > 0) {
    const end = Date.now() + delayMs;
    while (Date.now() < end) {
      /* sync busy-wait for tests only */
    }
  }
  const result = meta.handler(payload);
  validateWorkerResult(result, writeNamesFor(meta), meta.name);
  commitWorkerWrites(world, result.writes, ctx);
  commitWorkerEvents(world, result.events, ctx);
}

/**
 * Opt-in parallel-eligible system. Module-addressable — no closure shipping.
 */
export function workerSystem(def: WorkerSystemDefinition): WorkerDeclaredSystem {
  if (def.access.commands) {
    throw new Error(
      `workerSystem '${def.name}': commands are main-thread only in Phase 5`,
    );
  }

  const access = normalizeAccess(def.access, false);
  assertWorkerAccess(access, def.name);

  const moduleUrl = toModuleUrl(def.module);
  const resourceKeys = [
    ...(def.access.resources?.read ?? []),
    ...(def.access.resources?.write ?? []),
  ];
  const eventTypes = [
    ...(def.access.events?.read ?? []),
    ...(def.access.events?.write ?? []),
  ];

  const id = Symbol(`mob3.worker.${def.name}`);
  const meta: WorkerSystemMeta = {
    id,
    name: def.name,
    access,
    declared: true,
    affinity: "worker",
    moduleUrl,
    exportName: def.export,
    handler: def.run,
    resourceKeys,
    eventTypes,
    delayMs: def.delayMs,
  };

  const fn = ((world: World, _commands: Commands) => {
    runWorkerSystemLocal(world, meta);
  }) as WorkerDeclaredSystem;

  Object.defineProperty(fn, SYSTEM_META, { value: meta });
  Object.defineProperty(fn, WORKER_META, { value: meta });
  Object.defineProperty(fn, "name", { value: def.name });
  return fn;
}

export function getWorkerMeta(fn: SystemFn): WorkerSystemMeta | undefined {
  return (fn as WorkerDeclaredSystem)[WORKER_META];
}

export function isWorkerSystem(fn: SystemFn): fn is WorkerDeclaredSystem {
  return WORKER_META in (fn as object);
}

export { WORKER_META };
