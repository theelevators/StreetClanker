import { type ComponentType } from "../component.js";
import { PACKED_META, type FieldSchema, type InferSchema, type PackedComponentMeta, f32, f64, i32, u32 } from "./types.js";
export type PackedComponentOptions = {
    name?: string;
    /** Use SharedArrayBuffer-backed storage (fixed capacity). */
    shared?: boolean;
    /** Required when shared; used as initial capacity for local packed too. */
    capacity?: number;
    /**
     * When shared: "sab" (default) or "wasm" (World WasmMemoryArena slice).
     * WASM-backed storage is opt-in — not all shared components become WASM memory.
     */
    backing?: "sab" | "wasm";
};
export type PackedComponentType<S extends FieldSchema> = ComponentType<InferSchema<S>> & {
    readonly [PACKED_META]: PackedComponentMeta;
};
/**
 * Opt-in packed numeric component (SoA). Object `component()` remains default.
 *
 * @example
 * const Transform = packedComponent({ x: f32, y: f32, z: f32 }, { name: "Transform" });
 * const SharedPos = packedComponent({ x: f32, y: f32, z: f32 }, {
 *   name: "SharedPos",
 *   shared: true,
 *   capacity: 100_000,
 * });
 */
export declare function packedComponent<S extends FieldSchema>(schema: S, options?: PackedComponentOptions): PackedComponentType<S>;
export declare function getPackedMeta(type: ComponentType): PackedComponentMeta | undefined;
export declare function isPackedComponent(type: ComponentType): boolean;
export { f32, f64, i32, u32, PACKED_META };
//# sourceMappingURL=packed_component.d.ts.map