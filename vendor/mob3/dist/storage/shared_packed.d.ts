import type { Entity } from "../entity.js";
import { type ComponentStorage, type FieldKind, type PackedComponentMeta, type StorageKind } from "./types.js";
import type { WasmMemoryArena } from "./wasm_memory.js";
type Column = Float32Array | Float64Array | Int32Array | Uint32Array;
export type SharedPackedBacking = {
    /** Full shared buffer (SAB or WASM memory.buffer). */
    buffer: SharedArrayBuffer;
    /** Byte offset of this store's 16-byte header within buffer. */
    byteOffset: number;
    /** Optional owning WASM memory (same buffer). */
    wasmMemory?: WebAssembly.Memory;
};
/**
 * Fixed-capacity SoA over SharedArrayBuffer (standalone or arena slice).
 * Structural mutation is main-thread only.
 */
export declare class SharedPackedStorage implements ComponentStorage {
    readonly kind: StorageKind;
    readonly fields: string[];
    readonly kinds: FieldKind[];
    readonly name: string;
    readonly capacity: number;
    /** Absolute byte offset of store header in sab. */
    readonly storeByteOffset: number;
    readonly wasmMemory: WebAssembly.Memory | null;
    private count;
    private readonly sab;
    private readonly header;
    private columns;
    private readonly entityToSlot;
    private slotToEntity;
    private readonly viewProto;
    private readonly viewPool;
    private structGen;
    constructor(meta: PackedComponentMeta, backing?: SharedPackedBacking);
    get size(): number;
    get generation(): number;
    entityIds(): Uint32Array;
    get sharedBuffer(): SharedArrayBuffer;
    /** True when columns live in a WebAssembly.Memory buffer. */
    get isWasmBacked(): boolean;
    workerDescriptor(): SharedStoreDescriptor;
    column(field: string): Column;
    /** Absolute byte offset of a field column base. */
    fieldByteOffset(field: string): number;
    has(entity: Entity): boolean;
    get(entity: Entity): unknown | undefined;
    set(entity: Entity, value: unknown): void;
    remove(entity: Entity): boolean;
    clear(): void;
    entities(): IterableIterator<Entity>;
    forEachSlot(fn: (slot: number, entity: Entity) => void): void;
    private allocSlot;
    private swapRemove;
    private rebuildColumns;
    private buildViewProto;
    private acquireView;
}
export type SharedStoreDescriptor = {
    name: string;
    fields: string[];
    kinds: FieldKind[];
    capacity: number;
    count: number;
    sab: SharedArrayBuffer;
    /** Absolute byte offset of the 16-byte header within sab. */
    headerBytes: number;
    entities: Uint32Array;
};
export declare function createSharedPackedStorage(meta: PackedComponentMeta, arena?: WasmMemoryArena | null): SharedPackedStorage;
/** Rebuild column views in a worker from a descriptor. */
export declare function columnsFromDescriptor(desc: SharedStoreDescriptor): {
    columns: Column[];
    count: number;
};
export declare function sharedArrayBufferAvailable(): boolean;
export {};
//# sourceMappingURL=shared_packed.d.ts.map