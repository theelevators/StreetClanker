import type { World } from "../world.js";
import type { SystemFn } from "../schedule.js";
import type { AccessDeclaration, DeclaredSystem, SystemMeta } from "../system.js";
import type { ResourceKey } from "../resource.js";
import type { EventType } from "../event.js";
import { AbiIdRegistry } from "./ids.js";
import type { AbiSystemModule } from "./types.js";
export type AbiSystemDefinition = {
    name: string;
    /**
     * Absolute module URL the worker will `import()`
     * (e.g. `new URL("./integrate.js", import.meta.url)`).
     */
    module: URL | string;
    /** Named export — must be an AbiSystemModule (defineAbiSystem result). */
    export: string;
    /**
     * Local module instance for sequential / in-process execution.
     * Same object workers import — no closure shipping.
     */
    system: AbiSystemModule;
    access: AccessDeclaration;
    /** Test/demo only. */
    delayMs?: number | (() => number);
};
export type AbiSystemMeta = SystemMeta & {
    affinity: "worker";
    abi: true;
    abiVersion: number;
    moduleUrl: string;
    exportName: string;
    module: AbiSystemModule;
    resourceKeys: ResourceKey[];
    eventTypes: EventType[];
    delayMs?: number | (() => number);
    ids: AbiIdRegistry;
};
declare const ABI_META: unique symbol;
export type AbiDeclaredSystem = DeclaredSystem & {
    readonly [ABI_META]: AbiSystemMeta;
};
/** Synchronous in-process ABI run (SystemFn sequential path). */
export declare function runAbiSystemLocalSync(world: World, meta: AbiSystemMeta): void;
/**
 * Opt-in ABI-eligible worker system. Module-addressable — no World, no closures.
 */
export declare function abiSystem(def: AbiSystemDefinition): AbiDeclaredSystem;
export declare function getAbiMeta(fn: SystemFn): AbiSystemMeta | undefined;
export declare function isAbiSystem(fn: SystemFn): fn is AbiDeclaredSystem;
export { ABI_META };
//# sourceMappingURL=abi_system.d.ts.map