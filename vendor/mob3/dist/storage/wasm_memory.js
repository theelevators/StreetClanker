import { bytesPerField } from "./types.js";
/** Bytes needed for one shared packed store (header + SoA columns), 8-aligned. */
export function packedStoreByteLength(meta) {
    const headerBytes = 16;
    let colBytes = 0;
    for (const k of meta.kinds) {
        const bpe = bytesPerField(k);
        colBytes = Math.ceil(colBytes / bpe) * bpe;
        colBytes += bpe * Math.max(1, meta.capacity);
    }
    colBytes = Math.ceil(colBytes / 8) * 8;
    return headerBytes + colBytes;
}
/**
 * Host-owned WebAssembly.Memory arena for WASM-compatible shared packed storage.
 * Existing SAB-backed SharedPackedStorage remains valid — this is opt-in.
 */
export class WasmMemoryArena {
    memory;
    shared;
    cursor = 0;
    maxBytes;
    constructor(options = {}) {
        const initialPages = Math.max(1, options.initialPages ?? 16);
        const maxPages = Math.max(initialPages, options.maxPages ?? 256);
        const wantShared = options.shared !== false;
        let memory;
        let shared = false;
        if (wantShared && sharedWasmMemoryAvailable()) {
            memory = new WebAssembly.Memory({
                initial: initialPages,
                maximum: maxPages,
                shared: true,
            });
            shared = true;
        }
        else {
            memory = new WebAssembly.Memory({
                initial: initialPages,
                maximum: maxPages,
            });
        }
        this.memory = memory;
        this.shared = shared;
        this.maxBytes = maxPages * 65536;
        // Reserve page 0 header for arena metadata (generation, cursor mirror)
        this.cursor = 64;
        const meta = new Int32Array(this.buffer, 0, 4);
        meta[0] = 1; // arena magic/version
        meta[1] = this.cursor;
        meta[2] = 0; // generation
    }
    get buffer() {
        return this.memory.buffer;
    }
    get region() {
        const buf = this.buffer;
        return {
            buffer: buf,
            byteLength: buf.byteLength,
        };
    }
    get generation() {
        return new Int32Array(this.buffer, 0, 4)[2];
    }
    /**
     * Allocate a fixed region. Does not grow memory — fails if capacity exceeded.
     */
    alloc(byteLength, align = 8) {
        let offset = Math.ceil(this.cursor / align) * align;
        const end = offset + byteLength;
        if (end > this.buffer.byteLength) {
            throw new Error(`WasmMemoryArena capacity exceeded: need ${end} bytes, have ${this.buffer.byteLength} (Phase 8: no grow during execution)`);
        }
        this.cursor = end;
        const meta = new Int32Array(this.buffer, 0, 4);
        meta[1] = this.cursor;
        meta[2] = (meta[2] ?? 0) + 1;
        return { byteOffset: offset, byteLength };
    }
    allocPackedStore(meta) {
        return this.alloc(packedStoreByteLength(meta), 8);
    }
}
export function sharedWasmMemoryAvailable() {
    if (typeof WebAssembly === "undefined" || typeof WebAssembly.Memory !== "function") {
        return false;
    }
    try {
        const m = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
        return m.buffer instanceof SharedArrayBuffer;
    }
    catch {
        return false;
    }
}
export function webAssemblyAvailable() {
    return typeof WebAssembly !== "undefined" && typeof WebAssembly.instantiate === "function";
}
/** Pages needed for N bytes (ceil). */
export function pagesForBytes(bytes) {
    return Math.max(1, Math.ceil(bytes / 65536));
}
//# sourceMappingURL=wasm_memory.js.map