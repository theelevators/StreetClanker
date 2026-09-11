import type { ComponentType } from "../component.js";
import type { ComponentStorage } from "./types.js";
import type { WasmMemoryArena } from "./wasm_memory.js";
export type StorageFactoryContext = {
    wasmArena?: WasmMemoryArena | null;
};
export declare function createStorageFor(type: ComponentType, ctx?: StorageFactoryContext): ComponentStorage;
export type { ComponentStorage } from "./types.js";
export { ObjectStorage } from "./object_storage.js";
export { PackedStorage, createPackedStorage } from "./packed_storage.js";
export { SharedPackedStorage, createSharedPackedStorage, sharedArrayBufferAvailable, columnsFromDescriptor, type SharedStoreDescriptor, } from "./shared_packed.js";
export { WasmMemoryArena, sharedWasmMemoryAvailable, webAssemblyAvailable, packedStoreByteLength, pagesForBytes, type WasmMemoryArenaOptions, type SharedMemoryRegion, } from "./wasm_memory.js";
export { packedComponent, getPackedMeta, isPackedComponent, f32, f64, i32, u32, PACKED_META, type PackedComponentOptions, type PackedComponentType, } from "./packed_component.js";
export { type FieldKind, type FieldSchema, type InferSchema, type StorageKind, type PackedComponentMeta, } from "./types.js";
//# sourceMappingURL=index.d.ts.map