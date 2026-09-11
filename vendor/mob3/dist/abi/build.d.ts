import type { ComponentType } from "../component.js";
import type { World } from "../world.js";
import type { NormalizedAccess } from "../system.js";
import type { ResourceKey } from "../resource.js";
import { AbiIdRegistry } from "./ids.js";
import { type MemoryKind, type StoreInvocation, type SystemInvocation } from "./types.js";
export type BuildInvocationOptions = {
    world: World;
    systemName: string;
    access: NormalizedAccess;
    resourceKeys?: ResourceKey[];
    tick: number;
    delta: number;
    scheduleName: string;
    /** Prefer shared SAB descriptors when available. */
    preferShared: boolean;
    ids: AbiIdRegistry;
    /** Force memory mode for all stores (testing). */
    forceMode?: MemoryKind;
    delayMs?: number;
};
/**
 * Build an ABI SystemInvocation for a system's declared access.
 * Capability narrowing: only declared components appear.
 */
export declare function buildSystemInvocation(opts: BuildInvocationOptions): SystemInvocation;
/** Map storeId → component type used when committing local writes. */
export declare function storeCommitMapFromAccess(access: NormalizedAccess, ids: AbiIdRegistry): Map<number, ComponentType>;
/** Collect transferable ArrayBuffers from a local-mode invocation. */
export declare function collectTransferables(inv: SystemInvocation): ArrayBuffer[];
/**
 * After a local/copy ABI execution, write mutated columns back into world storage.
 */
export declare function commitAbiLocalStores(world: World, storeMap: Map<number, ComponentType>, resultStores: StoreInvocation[]): void;
/** Snapshot write stores from an in-process context for local commit. */
export declare function snapshotLocalWrites(invocation: SystemInvocation): StoreInvocation[];
//# sourceMappingURL=build.d.ts.map