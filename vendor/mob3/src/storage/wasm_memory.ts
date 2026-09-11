import { bytesPerField, type PackedComponentMeta } from "./types.js";

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
export function packedStoreByteLength(meta: PackedComponentMeta): number {
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
  readonly memory: WebAssembly.Memory;
  readonly shared: boolean;
  private cursor = 0;
  private readonly maxBytes: number;

  constructor(options: WasmMemoryArenaOptions = {}) {
    const initialPages = Math.max(1, options.initialPages ?? 16);
    const maxPages = Math.max(initialPages, options.maxPages ?? 256);
    const wantShared = options.shared !== false;

    let memory: WebAssembly.Memory;
    let shared = false;
    if (wantShared && sharedWasmMemoryAvailable()) {
      memory = new WebAssembly.Memory({
        initial: initialPages,
        maximum: maxPages,
        shared: true,
      });
      shared = true;
    } else {
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

  get buffer(): SharedArrayBuffer | ArrayBuffer {
    return this.memory.buffer as SharedArrayBuffer | ArrayBuffer;
  }

  get region(): SharedMemoryRegion {
    const buf = this.buffer;
    return {
      buffer: buf as SharedArrayBuffer,
      byteLength: buf.byteLength,
    };
  }

  get generation(): number {
    return new Int32Array(this.buffer, 0, 4)[2]!;
  }

  /**
   * Allocate a fixed region. Does not grow memory — fails if capacity exceeded.
   */
  alloc(byteLength: number, align = 8): ArenaAllocation {
    let offset = Math.ceil(this.cursor / align) * align;
    const end = offset + byteLength;
    if (end > this.buffer.byteLength) {
      throw new Error(
        `WasmMemoryArena capacity exceeded: need ${end} bytes, have ${this.buffer.byteLength} (Phase 8: no grow during execution)`,
      );
    }
    this.cursor = end;
    const meta = new Int32Array(this.buffer, 0, 4);
    meta[1] = this.cursor;
    meta[2] = (meta[2] ?? 0) + 1;
    return { byteOffset: offset, byteLength };
  }

  allocPackedStore(meta: PackedComponentMeta): ArenaAllocation {
    return this.alloc(packedStoreByteLength(meta), 8);
  }
}

export function sharedWasmMemoryAvailable(): boolean {
  if (typeof WebAssembly === "undefined" || typeof WebAssembly.Memory !== "function") {
    return false;
  }
  try {
    const m = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    return m.buffer instanceof SharedArrayBuffer;
  } catch {
    return false;
  }
}

export function webAssemblyAvailable(): boolean {
  return typeof WebAssembly !== "undefined" && typeof WebAssembly.instantiate === "function";
}

/** Pages needed for N bytes (ceil). */
export function pagesForBytes(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / 65536));
}
