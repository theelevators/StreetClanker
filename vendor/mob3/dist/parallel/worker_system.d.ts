import type { World } from "../world.js";
import type { SystemFn } from "../schedule.js";
import type { AccessDeclaration, DeclaredSystem, SystemMeta } from "../system.js";
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
declare const WORKER_META: unique symbol;
export type WorkerDeclaredSystem = DeclaredSystem & {
    readonly [WORKER_META]: WorkerSystemMeta;
};
/**
 * Run a worker system handler against World on the main thread
 * (sequential reference / fallback). Sync — uses `run` handler, not import.
 */
export declare function runWorkerSystemLocal(world: World, meta: WorkerSystemMeta): void;
/**
 * Opt-in parallel-eligible system. Module-addressable — no closure shipping.
 */
export declare function workerSystem(def: WorkerSystemDefinition): WorkerDeclaredSystem;
export declare function getWorkerMeta(fn: SystemFn): WorkerSystemMeta | undefined;
export declare function isWorkerSystem(fn: SystemFn): fn is WorkerDeclaredSystem;
export { WORKER_META };
//# sourceMappingURL=worker_system.d.ts.map