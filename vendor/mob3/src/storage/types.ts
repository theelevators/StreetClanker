import type { Entity } from "../entity.js";

export type FieldKind = "f32" | "f64" | "i32" | "u32";

export const f32 = "f32" as const;
export const f64 = "f64" as const;
export const i32 = "i32" as const;
export const u32 = "u32" as const;

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

export const PACKED_META = Symbol.for("mob3.packedMeta");

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

export function bytesPerField(kind: FieldKind): number {
  switch (kind) {
    case "f32":
    case "i32":
    case "u32":
      return 4;
    case "f64":
      return 8;
  }
}

export function makeTypedArray(
  kind: FieldKind,
  buffer: ArrayBufferLike,
  byteOffset: number,
  length: number,
): Float32Array | Float64Array | Int32Array | Uint32Array {
  switch (kind) {
    case "f32":
      return new Float32Array(buffer, byteOffset, length);
    case "f64":
      return new Float64Array(buffer, byteOffset, length);
    case "i32":
      return new Int32Array(buffer, byteOffset, length);
    case "u32":
      return new Uint32Array(buffer, byteOffset, length);
  }
}
