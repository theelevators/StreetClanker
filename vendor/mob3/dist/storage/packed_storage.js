import { bytesPerField, makeTypedArray, } from "./types.js";
/**
 * Structure-of-arrays packed numeric storage over ArrayBuffer.
 * Swap-remove on delete. Ephemeral write-through views from get().
 */
export class PackedStorage {
    kind = "packed";
    fields;
    kinds;
    name;
    capacity;
    count = 0;
    buffer;
    columns = [];
    entityToSlot = new Map();
    slotToEntity = [];
    /** Generation bump when structure changes — invalidates view freshness checks if used. */
    structGen = 0;
    viewProto;
    viewPool = [];
    constructor(meta, initialCapacity = 16) {
        this.fields = meta.fields;
        this.kinds = meta.kinds;
        this.name = meta.name;
        this.capacity = Math.max(1, initialCapacity);
        this.buffer = this.allocBuffer(this.capacity);
        this.rebuildColumns();
        this.viewProto = this.buildViewProto();
    }
    get size() {
        return this.count;
    }
    get length() {
        return this.count;
    }
    get capacitySlots() {
        return this.capacity;
    }
    get generation() {
        return this.structGen;
    }
    /** Dense entity ids for live slots `[0, count)`. */
    entityIds() {
        const out = new Uint32Array(this.count);
        for (let i = 0; i < this.count; i++)
            out[i] = this.slotToEntity[i] >>> 0;
        return out;
    }
    /** Column arrays (length === capacity; live length is `size`). */
    column(field) {
        const i = this.fields.indexOf(field);
        if (i < 0)
            throw new Error(`Unknown field '${field}' on ${this.name}`);
        return this.columns[i];
    }
    slotOf(entity) {
        return this.entityToSlot.get(entity);
    }
    entityAt(slot) {
        if (slot < 0 || slot >= this.count)
            return undefined;
        return this.slotToEntity[slot];
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
            const key = this.fields[f];
            this.columns[f][slot] = obj[key] ?? 0;
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
        this.slotToEntity.length = 0;
        this.count = 0;
        this.structGen++;
    }
    *entities() {
        for (let i = 0; i < this.count; i++) {
            yield this.slotToEntity[i];
        }
    }
    /** Dense SoA iteration without per-row object allocation. */
    forEachSlot(fn) {
        for (let i = 0; i < this.count; i++) {
            fn(i, this.slotToEntity[i]);
        }
    }
    /** Read field at slot (hot path). */
    read(fieldIndex, slot) {
        return this.columns[fieldIndex][slot];
    }
    write(fieldIndex, slot, value) {
        this.columns[fieldIndex][slot] = value;
    }
    allocSlot(entity) {
        if (this.count >= this.capacity) {
            this.grow(this.capacity * 2);
        }
        const slot = this.count++;
        this.entityToSlot.set(entity, slot);
        this.slotToEntity[slot] = entity;
        this.structGen++;
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
        this.structGen++;
    }
    grow(newCap) {
        const oldCount = this.count;
        const oldCols = this.columns;
        this.capacity = newCap;
        this.buffer = this.allocBuffer(newCap);
        this.rebuildColumns();
        for (let f = 0; f < this.fields.length; f++) {
            this.columns[f].set(oldCols[f].subarray(0, oldCount));
        }
        this.structGen++;
    }
    allocBuffer(capacity) {
        let bytes = 0;
        for (const k of this.kinds)
            bytes += bytesPerField(k) * capacity;
        // Align to 8
        bytes = Math.ceil(bytes / 8) * 8;
        return new ArrayBuffer(bytes);
    }
    rebuildColumns() {
        this.columns = [];
        let offset = 0;
        for (let f = 0; f < this.fields.length; f++) {
            const kind = this.kinds[f];
            const bpe = bytesPerField(kind);
            // align offset
            offset = Math.ceil(offset / bpe) * bpe;
            this.columns.push(makeTypedArray(kind, this.buffer, offset, this.capacity));
            offset += bpe * this.capacity;
        }
    }
    buildViewProto() {
        const proto = {};
        const self = this;
        for (let f = 0; f < this.fields.length; f++) {
            const idx = f;
            const name = this.fields[f];
            Object.defineProperty(proto, name, {
                enumerable: true,
                configurable: true,
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
        if (!view) {
            view = Object.create(this.viewProto);
        }
        view._slot = slot;
        view._store = this;
        return view;
    }
    /** Release a view back to the pool (optional; GC also fine). */
    releaseView(view) {
        if (this.viewPool.length < 256)
            this.viewPool.push(view);
    }
}
export function createPackedStorage(meta, capacity) {
    return new PackedStorage(meta, capacity ?? 16);
}
/** Describe schema for tests/debug. */
export function schemaFromMeta(meta) {
    const out = {};
    for (let i = 0; i < meta.fields.length; i++) {
        out[meta.fields[i]] = meta.kinds[i];
    }
    return out;
}
//# sourceMappingURL=packed_storage.js.map