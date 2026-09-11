import { type PackedComponentMeta } from "./types.js";
export type SharedMemoryRegion = {
    buffer: SharedArrayBuffer;
    byteLength: number;
};
export type WasmMemoryArenaOptions = {
    /** Initial WebAssembly memory pages (64KiB). Default 16 (~1MiB). */
    initialPages?: number;
    /** Maximum pages (fixed — Phase 8 does not grow during execution). */
    maxPages?: number;
    /** Prefer shared memory when available (default true). */
    shared?: boolean;
};
export type ArenaAllocation = {
    byteOffset: number;
    byteLength: number;
};
/** Bytes needed for one shared packed store (header + SoA columns), 8-aligned. */
export declare function packedStoreByteLength(meta: PackedComponentMeta): number;
/**
 * Host-owned WebAssembly.Memory arena for WASM-compatible shared packed storage.
 * Existing SAB-backed SharedPackedStorage remains valid — this is opt-in.
 */
export declare class WasmMemoryArena {
    readonly memory: WebAssembly.Memory;
    readonly shared: boolean;
    private cursor;
    private readonly maxBytes;
    constructor(options?: WasmMemoryArenaOptions);
    get buffer(): SharedArrayBuffer | ArrayBuffer;
    get region(): SharedMemoryRegion;
    get generation(): number;
    /**
     * Allocate a fixed region. Does not grow memory — fails if capacity exceeded.
     */
    alloc(byteLength: number, align?: number): ArenaAllocation;
    allocPackedStore(meta: PackedComponentMeta): ArenaAllocation;
}
export declare function sharedWasmMemoryAvailable(): boolean;
export declare function webAssemblyAvailable(): boolean;
/** Pages needed for N bytes (ceil). */
export declare function pagesForBytes(bytes: number): number;
//# sourceMappingURL=wasm_memory.d.ts.map