import type { Entity } from "../entity.js";
import { type ComponentStorage, type FieldKind, type FieldSchema, type PackedComponentMeta, type StorageKind } from "./types.js";
type Column = Float32Array | Float64Array | Int32Array | Uint32Array;
/**
 * Structure-of-arrays packed numeric storage over ArrayBuffer.
 * Swap-remove on delete. Ephemeral write-through views from get().
 */
export declare class PackedStorage implements ComponentStorage {
    readonly kind: StorageKind;
    readonly fields: string[];
    readonly kinds: FieldKind[];
    readonly name: string;
    private capacity;
    private count;
    private buffer;
    private columns;
    private readonly entityToSlot;
    private slotToEntity;
    /** Generation bump when structure changes — invalidates view freshness checks if used. */
    private structGen;
    private readonly viewProto;
    private readonly viewPool;
    constructor(meta: PackedComponentMeta, initialCapacity?: number);
    get size(): number;
    get length(): number;
    get capacitySlots(): number;
    get generation(): number;
    /** Dense entity ids for live slots `[0, count)`. */
    entityIds(): Uint32Array;
    /** Column arrays (length === capacity; live length is `size`). */
    column(field: string): Column;
    slotOf(entity: Entity): number | undefined;
    entityAt(slot: number): Entity | undefined;
    has(entity: Entity): boolean;
    get(entity: Entity): unknown | undefined;
    set(entity: Entity, value: unknown): void;
    remove(entity: Entity): boolean;
    clear(): void;
    entities(): IterableIterator<Entity>;
    /** Dense SoA iteration without per-row object allocation. */
    forEachSlot(fn: (slot: number, entity: Entity) => void): void;
    /** Read field at slot (hot path). */
    read(fieldIndex: number, slot: number): number;
    write(fieldIndex: number, slot: number, value: number): void;
    private allocSlot;
    private swapRemove;
    private grow;
    private allocBuffer;
    private rebuildColumns;
    private buildViewProto;
    private acquireView;
    /** Release a view back to the pool (optional; GC also fine). */
    releaseView(view: PackedView): void;
}
export type PackedView = {
    _slot: number;
    _store: PackedStorage;
} & Record<string, number>;
export declare function createPackedStorage(meta: PackedComponentMeta, capacity?: number): PackedStorage;
/** Describe schema for tests/debug. */
export declare function schemaFromMeta(meta: PackedComponentMeta): FieldSchema;
export {};
//# sourceMappingURL=packed_storage.d.ts.map