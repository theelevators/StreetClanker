import type { Entity } from "../entity.js";
export type FieldKind = "f32" | "f64" | "i32" | "u32";
export declare const f32: "f32";
export declare const f64: "f64";
export declare const i32: "i32";
export declare const u32: "u32";
export type FieldSchema = Record<string, FieldKind>;
export type InferSchema<S extends FieldSchema> = {
    [K in keyof S]: number;
};
export type StorageKind = "object" | "packed" | "shared";
/**
 * Minimal storage contract for mob3 component values.
 */
export interface ComponentStorage {
    readonly kind: StorageKind;
    readonly size: number;
    has(entity: Entity): boolean;
    /** Object storage: persistent ref. Packed: ephemeral write-through view. */
    get(entity: Entity): unknown | undefined;
    set(entity: Entity, value: unknown): void;
    remove(entity: Entity): boolean;
    clear(): void;
    entities(): IterableIterator<Entity>;
}
export declare const PACKED_META: unique symbol;
export type PackedComponentMeta = {
    schema: FieldSchema;
    fields: string[];
    kinds: FieldKind[];
    shared: boolean;
    capacity: number;
    name: string;
    /**
     * shared storage backing:
     * - sab (default): standalone SharedArrayBuffer
     * - wasm: slice of World WasmMemoryArena (WebAssembly.Memory)
     */
    backing?: "sab" | "wasm";
};
export declare function bytesPerField(kind: FieldKind): number;
export declare function makeTypedArray(kind: FieldKind, buffer: ArrayBufferLike, byteOffset: number, length: number): Float32Array | Float64Array | Int32Array | Uint32Array;
//# sourceMappingURL=types.d.ts.map