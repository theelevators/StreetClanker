import type { World } from "../world.js";
import type { SystemFn } from "../schedule.js";
import type { AccessDeclaration, DeclaredSystem, SystemMeta } from "../system.js";
import type { ResourceKey } from "../resource.js";
import type { EventType } from "../event.js";
import { AbiIdRegistry } from "./ids.js";
import type { AbiSystemModule } from "./types.js";
import { WasmAbiExecutor, type WasmModuleSource, type WasmStoreExpect } from "./wasm_executor.js";
export type WasmMode = "preferred" | "required";
export type WasmSystemDefinition = {
    name: string;
    module: WasmModuleSource;
    export?: string;
    access: AccessDeclaration;
    expects: readonly WasmStoreExpect[];
    mode?: WasmMode;
    fallback?: AbiSystemModule;
    /**
     * main — WASM on host thread (default; zero-copy arena Memory)
     * worker — still host-thread WASM inside parallel batches (Memory is not
     *   transferable as WebAssembly.Memory across workers; SAB columns remain
     *   visible to JS workers). Affinity marks planner eligibility only.
     */
    placement?: "main" | "worker";
};
export type WasmSystemMeta = SystemMeta & {
    affinity: "main" | "worker";
    wasm: true;
    abiVersion: number;
    moduleSource: WasmModuleSource;
    exportName: string;
    expects: readonly WasmStoreExpect[];
    mode: WasmMode;
    fallback?: AbiSystemModule;
    placement: "main" | "worker";
    resourceKeys: ResourceKey[];
    eventTypes: EventType[];
    ids: AbiIdRegistry;
    executor: WasmAbiExecutor | null;
    backend: "wasm";
};
declare const WASM_META: unique symbol;
export type WasmDeclaredSystem = DeclaredSystem & {
    readonly [WASM_META]: WasmSystemMeta;
};
export declare function ensureWasmExecutor(meta: WasmSystemMeta, world: World): WasmAbiExecutor;
/** Warm compile/instantiate before sync ticks. */
export declare function warmWasmSystem(world: World, meta: WasmSystemMeta): Promise<void>;
export declare function runWasmSystem(world: World, meta: WasmSystemMeta): Promise<void>;
export declare function runWasmSystemSync(world: World, meta: WasmSystemMeta): void;
/**
 * Opt-in WASM ABI system. Planner uses access/affinity — not language.
 */
export declare function wasmSystem(def: WasmSystemDefinition): WasmDeclaredSystem;
export declare function getWasmMeta(fn: SystemFn): WasmSystemMeta | undefined;
export declare function isWasmSystem(fn: SystemFn): fn is WasmDeclaredSystem;
export { WASM_META };
//# sourceMappingURL=wasm_system.d.ts.map