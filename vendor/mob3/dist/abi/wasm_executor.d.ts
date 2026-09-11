import type { AbiExecutor, AbiScalarType, ExecutionResult, SystemInvocation } from "./types.js";
import type { WasmMemoryArena } from "../storage/wasm_memory.js";
import { sharedWasmMemoryAvailable, webAssemblyAvailable } from "../storage/wasm_memory.js";
export type WasmModuleSource = URL | string | ArrayBuffer | Uint8Array | WebAssembly.Module;
export type WasmFieldExpect = {
    name: string;
    type: AbiScalarType;
};
export type WasmStoreExpect = {
    name: string;
    fields: readonly WasmFieldExpect[];
};
export type WasmAbiExecutorOptions = {
    /** WASM binary, URL, or precompiled Module. */
    module: WasmModuleSource;
    /** Exported integrate function name (default "run"). */
    exportName?: string;
    /** Host arena whose Memory is imported as env.memory. */
    arena: WasmMemoryArena;
    /** Expected packed layouts — validated once at bind. */
    expects: readonly WasmStoreExpect[];
    systemName?: string;
};
/**
 * Main-thread WASM executor for Execution ABI v1.
 * Receives SystemInvocation — never World.
 */
export declare class WasmAbiExecutor implements AbiExecutor {
    private readonly exportName;
    private readonly arena;
    private readonly expects;
    private readonly systemName;
    private readonly source;
    private module;
    private instance;
    private runFn;
    private abiVersionFn;
    private binding;
    private disposed;
    private compilePromise;
    constructor(options: WasmAbiExecutorOptions);
    get ready(): boolean;
    ensureReady(): Promise<void>;
    private compileAndInstantiate;
    /** Sync instantiate after bytes are available (warm path / Node). */
    instantiateFromBytes(bytes: BufferSource | WebAssembly.Module): void;
    /** Synchronous execute — module must already be ready. */
    executeSync(invocation: SystemInvocation): ExecutionResult;
    execute(invocation: SystemInvocation): Promise<ExecutionResult>;
    private bindInvocation;
    dispose(): void;
}
export { webAssemblyAvailable, sharedWasmMemoryAvailable };
//# sourceMappingURL=wasm_executor.d.ts.map