import { bytesPerField, makeTypedArray, } from "./types.js";
/**
 * Fixed-capacity SoA over SharedArrayBuffer (standalone or arena slice).
 * Structural mutation is main-thread only.
 */
export class SharedPackedStorage {
    kind = "shared";
    fields;
    kinds;
    name;
    capacity;
    /** Absolute byte offset of store header in sab. */
    storeByteOffset;
    wasmMemory;
    count = 0;
    sab;
    header;
    columns = [];
    entityToSlot = new Map();
    slotToEntity;
    viewProto;
    viewPool = [];
    structGen = 0;
    constructor(meta, backing) {
        this.fields = meta.fields;
        this.kinds = meta.kinds;
        this.name = meta.name;
        this.capacity = Math.max(1, meta.capacity);
        this.slotToEntity = new Array(this.capacity);
        let colBytes = 0;
        for (const k of this.kinds) {
            const bpe = bytesPerField(k);
            colBytes = Math.ceil(colBytes / bpe) * bpe;
            colBytes += bpe * this.capacity;
        }
        colBytes = Math.ceil(colBytes / 8) * 8;
        const headerBytes = 16;
        const need = headerBytes + colBytes;
        if (backing) {
            if (backing.byteOffset + need > backing.buffer.byteLength) {
                throw new Error(`Shared packed region too small for '${meta.name}': need ${need} at ${backing.byteOffset}`);
            }
            this.sab = backing.buffer;
            this.storeByteOffset = backing.byteOffset;
            this.wasmMemory = backing.wasmMemory ?? null;
        }
        else {
            this.sab = new SharedArrayBuffer(need);
            this.storeByteOffset = 0;
            this.wasmMemory = null;
        }
        this.header = new Int32Array(this.sab, this.storeByteOffset, 4);
        this.header[0] = 0;
        this.header[1] = this.capacity;
        this.header[2] = 0;
        this.rebuildColumns(headerBytes);
        this.viewProto = this.buildViewProto();
    }
    get size() {
        return this.count;
    }
    get generation() {
        return this.structGen;
    }
    entityIds() {
        const out = new Uint32Array(this.count);
        for (let i = 0; i < this.count; i++)
            out[i] = this.slotToEntity[i] >>> 0;
        return out;
    }
    get sharedBuffer() {
        return this.sab;
    }
    /** True when columns live in a WebAssembly.Memory buffer. */
    get isWasmBacked() {
        return this.wasmMemory !== null;
    }
    workerDescriptor() {
        return {
            name: this.name,
            fields: [...this.fields],
            kinds: [...this.kinds],
            capacity: this.capacity,
            count: this.count,
            sab: this.sab,
            /** Absolute offset of this store's header (0 for standalone SAB). */
            headerBytes: this.storeByteOffset,
            entities: Uint32Array.from(this.slotToEntity.slice(0, this.count).map((e) => e >>> 0)),
        };
    }
    column(field) {
        const i = this.fields.indexOf(field);
        if (i < 0)
            throw new Error(`Unknown field '${field}'`);
        return this.columns[i];
    }
    /** Absolute byte offset of a field column base. */
    fieldByteOffset(field) {
        const col = this.column(field);
        return col.byteOffset;
    }
    has(entity) {
        return this.entityToSlot.has(entity);
    }
    get(entity) {
        const slot = this.entityToSlot.get(entity);
        if (slot === undefined)
            return undefined;
        return this.acquireView(slot);
    }
    set(entity, value) {
        const obj = value;
        let slot = this.entityToSlot.get(entity);
        if (slot === undefined) {
            slot = this.allocSlot(entity);
        }
        for (let f = 0; f < this.fields.length; f++) {
            this.columns[f][slot] = obj[this.fields[f]] ?? 0;
        }
    }
    remove(entity) {
        const slot = this.entityToSlot.get(entity);
        if (slot === undefined)
            return false;
        this.swapRemove(slot);
        return true;
    }
    clear() {
        this.entityToSlot.clear();
        this.count = 0;
        this.header[0] = 0;
        this.structGen++;
        this.header[2] = this.structGen;
    }
    *entities() {
        for (let i = 0; i < this.count; i++)
            yield this.slotToEntity[i];
    }
    forEachSlot(fn) {
        for (let i = 0; i < this.count; i++)
            fn(i, this.slotToEntity[i]);
    }
    allocSlot(entity) {
        if (this.count >= this.capacity) {
            throw new Error(`Shared packed storage capacity exceeded: ${this.name} capacity=${this.capacity}`);
        }
        const slot = this.count++;
        this.header[0] = this.count;
        this.entityToSlot.set(entity, slot);
        this.slotToEntity[slot] = entity;
        this.structGen++;
        this.header[2] = this.structGen;
        return slot;
    }
    swapRemove(slot) {
        const last = this.count - 1;
        const removed = this.slotToEntity[slot];
        this.entityToSlot.delete(removed);
        if (slot !== last) {
            const moved = this.slotToEntity[last];
            this.slotToEntity[slot] = moved;
            this.entityToSlot.set(moved, slot);
            for (let f = 0; f < this.columns.length; f++) {
                this.columns[f][slot] = this.columns[f][last];
            }
        }
        this.count--;
        this.header[0] = this.count;
        this.structGen++;
        this.header[2] = this.structGen;
    }
    rebuildColumns(headerBytes) {
        this.columns = [];
        let offset = this.storeByteOffset + headerBytes;
        for (let f = 0; f < this.fields.length; f++) {
            const kind = this.kinds[f];
            const bpe = bytesPerField(kind);
            offset = Math.ceil(offset / bpe) * bpe;
            this.columns.push(makeTypedArray(kind, this.sab, offset, this.capacity));
            offset += bpe * this.capacity;
        }
    }
    buildViewProto() {
        const proto = {};
        const self = this;
        for (let f = 0; f < this.fields.length; f++) {
            const idx = f;
            Object.defineProperty(proto, this.fields[f], {
                enumerable: true,
                get() {
                    return self.columns[idx][this._slot];
                },
                set(v) {
                    self.columns[idx][this._slot] = v;
                },
            });
        }
        return proto;
    }
    acquireView(slot) {
        let view = this.viewPool.pop();
        if (!view)
            view = Object.create(this.viewProto);
        view._slot = slot;
        view._store = this;
        return view;
    }
}
export function createSharedPackedStorage(meta, arena) {
    if (typeof SharedArrayBuffer === "undefined") {
        throw new Error(`SharedArrayBuffer unavailable — cannot create shared storage for '${meta.name}'`);
    }
    if (meta.backing === "wasm") {
        if (!arena) {
            throw new Error(`Component '${meta.name}' requires WasmMemoryArena (world.setWasmArena / App wasmArena option)`);
        }
        const alloc = arena.allocPackedStore(meta);
        if (!(arena.buffer instanceof SharedArrayBuffer)) {
            throw new Error(`WasmMemoryArena buffer is not SharedArrayBuffer — shared WASM memory required for '${meta.name}'`);
        }
        return new SharedPackedStorage(meta, {
            buffer: arena.buffer,
            byteOffset: alloc.byteOffset,
            wasmMemory: arena.memory,
        });
    }
    return new SharedPackedStorage(meta);
}
/** Rebuild column views in a worker from a descriptor. */
export function columnsFromDescriptor(desc) {
    const columns = [];
    let offset = desc.headerBytes + 16;
    for (let f = 0; f < desc.fields.length; f++) {
        const kind = desc.kinds[f];
        const bpe = bytesPerField(kind);
        offset = Math.ceil(offset / bpe) * bpe;
        columns.push(makeTypedArray(kind, desc.sab, offset, desc.capacity));
        offset += bpe * desc.capacity;
    }
    const header = new Int32Array(desc.sab, desc.headerBytes, 4);
    return { columns, count: header[0] };
}
export function sharedArrayBufferAvailable() {
    if (typeof SharedArrayBuffer === "undefined")
        return false;
    if (typeof process !== "undefined" && process.versions?.node)
        return true;
    if (typeof crossOriginIsolated !== "undefined")
        return !!crossOriginIsolated;
    return true;
}
//# sourceMappingURL=shared_packed.js.map