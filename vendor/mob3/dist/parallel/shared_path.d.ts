import type { World } from "../world.js";
import type { WorkerSystemMeta } from "./worker_system.js";
import { type SharedStoreDescriptor } from "../storage/shared_packed.js";
export type SharedWorkerPayload = {
    mode: "shared";
    stores: Record<string, SharedStoreDescriptor>;
    resources: Record<string, unknown>;
    writeNames: string[];
    delayMs?: number;
};
/** True when every non-tag component access uses SharedPackedStorage. */
export declare function canUseSharedPath(world: World, meta: WorkerSystemMeta): boolean;
export declare function extractSharedWorkerPayload(world: World, meta: WorkerSystemMeta, delayMs?: number): SharedWorkerPayload;
//# sourceMappingURL=shared_path.d.ts.map