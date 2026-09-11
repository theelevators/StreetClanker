import { ObjectStorage } from "./object_storage.js";
import { createPackedStorage } from "./packed_storage.js";
import { createSharedPackedStorage } from "./shared_packed.js";
import { getPackedMeta } from "./packed_component.js";
export function createStorageFor(type, ctx = {}) {
    if (type.isTag) {
        return new ObjectStorage();
    }
    const meta = getPackedMeta(type);
    if (!meta)
        return new ObjectStorage();
    if (meta.shared) {
        return createSharedPackedStorage(meta, ctx.wasmArena ?? null);
    }
    return createPackedStorage(meta, meta.capacity > 16 ? meta.capacity : 16);
}
export { ObjectStorage } from "./object_storage.js";
export { PackedStorage, createPackedStorage } from "./packed_storage.js";
export { SharedPackedStorage, createSharedPackedStorage, sharedArrayBufferAvailable, columnsFromDescriptor, } from "./shared_packed.js";
export { WasmMemoryArena, sharedWasmMemoryAvailable, webAssemblyAvailable, packedStoreByteLength, pagesForBytes, } from "./wasm_memory.js";
export { packedComponent, getPackedMeta, isPackedComponent, f32, f64, i32, u32, PACKED_META, } from "./packed_component.js";
//# sourceMappingURL=index.js.map