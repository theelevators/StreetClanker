import { getPackedMeta, isPackedComponent, } from "../storage/packed_component.js";
import { SharedPackedStorage } from "../storage/shared_packed.js";
import { ABI_VERSION, } from "./types.js";
function fieldMem(fieldId, name, type, arr) {
    return {
        fieldId,
        name,
        type,
        buffer: arr.buffer,
        byteOffset: arr.byteOffset,
        length: arr.length,
    };
}
function cloneResource(value) {
    if (value === null || typeof value !== "object")
        return value;
    if (typeof structuredClone === "function") {
        try {
            return structuredClone(value);
        }
        catch {
            /* fallthrough */
        }
    }
    return JSON.parse(JSON.stringify(value));
}
function resourceName(key) {
    if (typeof key === "object" && key && "name" in key) {
        return String(key.name ?? "Resource");
    }
    if (typeof key === "function")
        return key.name || "Resource";
    return "Resource";
}
function buildFromStorage(storeId, componentId, name, fields, kinds, storage, mode, generation) {
    const fieldDescs = fields.map((fname, i) => {
        const col = storage.column(fname);
        return fieldMem(i, fname, kinds[i], col);
    });
    return {
        storeId,
        componentId,
        name,
        generation,
        count: storage.size,
        capacity: storage instanceof SharedPackedStorage
            ? storage.capacity
            : storage.capacitySlots,
        memoryKind: mode,
        fields: fieldDescs,
        entities: storage.entityIds(),
    };
}
/**
 * Build an ABI SystemInvocation for a system's declared access.
 * Capability narrowing: only declared components appear.
 */
export function buildSystemInvocation(opts) {
    const reads = [];
    const writes = [];
    const stores = [];
    const seen = new Set();
    const storeMap = new Map();
    const add = (c, writable) => {
        if (c.isTag)
            return;
        if (seen.has(c)) {
            if (writable) {
                const id = opts.ids.storeId(c);
                if (!writes.includes(id))
                    writes.push(id);
            }
            return;
        }
        seen.add(c);
        if (!isPackedComponent(c)) {
            throw new Error(`ABI v1 only supports packed components; "${String(c.name ?? c)}" is not packed.`);
        }
        const meta = getPackedMeta(c);
        const storeId = opts.ids.storeId(c);
        storeMap.set(storeId, c);
        const storage = opts.world.ensureStorage(c);
        const isShared = storage instanceof SharedPackedStorage;
        const mode = opts.forceMode ??
            (opts.preferShared && isShared ? "shared" : "local");
        const generation = storage.generation;
        if (mode === "local") {
            // Copy columns into standalone buffers (copy path / local packed).
            const fieldDescs = meta.fields.map((fname, i) => {
                const col = storage.column(fname);
                const kind = meta.kinds[i];
                const copy = kind === "f32"
                    ? new Float32Array(col)
                    : kind === "f64"
                        ? new Float64Array(col)
                        : kind === "i32"
                            ? new Int32Array(col)
                            : new Uint32Array(col);
                return fieldMem(i, fname, kind, copy);
            });
            const ents = storage.entityIds();
            stores.push({
                storeId,
                componentId: storeId,
                name: meta.name,
                generation,
                count: storage.size,
                capacity: storage instanceof SharedPackedStorage
                    ? storage.capacity
                    : storage.capacitySlots,
                memoryKind: "local",
                fields: fieldDescs,
                entities: new Uint32Array(ents),
            });
        }
        else {
            stores.push(buildFromStorage(storeId, storeId, meta.name, meta.fields, meta.kinds, storage, "shared", generation));
        }
        if (writable)
            writes.push(storeId);
        else
            reads.push(storeId);
    };
    for (const c of opts.access.componentRead)
        add(c, false);
    for (const c of opts.access.componentWrite)
        add(c, true);
    const writeSet = new Set(writes);
    const readOnly = reads.filter((id) => !writeSet.has(id));
    const access = { reads: readOnly, writes };
    const resources = [];
    for (const key of opts.resourceKeys ?? []) {
        const name = resourceName(key);
        if (opts.world.hasResource(key)) {
            resources.push({ name, value: cloneResource(opts.world.resource(key)) });
        }
    }
    return {
        abiVersion: ABI_VERSION,
        system: {
            id: opts.ids.systemId(opts.systemName),
            name: opts.systemName,
        },
        execution: {
            tick: opts.tick,
            delta: opts.delta,
            scheduleName: opts.scheduleName,
        },
        stores,
        access,
        resources,
        delayMs: opts.delayMs,
    };
}
/** Map storeId → component type used when committing local writes. */
export function storeCommitMapFromAccess(access, ids) {
    const map = new Map();
    for (const c of [
        ...access.componentRead,
        ...access.componentWrite,
    ]) {
        if (c.isTag || !isPackedComponent(c))
            continue;
        map.set(ids.storeId(c), c);
    }
    return map;
}
/** Collect transferable ArrayBuffers from a local-mode invocation. */
export function collectTransferables(inv) {
    const out = [];
    const seen = new Set();
    for (const s of inv.stores) {
        if (s.memoryKind !== "local")
            continue;
        for (const f of s.fields) {
            if (seen.has(f.buffer))
                continue;
            if (f.buffer instanceof SharedArrayBuffer)
                continue;
            seen.add(f.buffer);
            out.push(f.buffer);
        }
        if (!seen.has(s.entities.buffer) &&
            !(s.entities.buffer instanceof SharedArrayBuffer)) {
            seen.add(s.entities.buffer);
            out.push(s.entities.buffer);
        }
    }
    return out;
}
/**
 * After a local/copy ABI execution, write mutated columns back into world storage.
 */
export function commitAbiLocalStores(world, storeMap, resultStores) {
    for (const rs of resultStores) {
        if (rs.memoryKind !== "local")
            continue;
        const type = storeMap.get(rs.storeId);
        if (!type)
            continue;
        const storage = world.ensureStorage(type);
        const n = Math.min(rs.count, storage.size);
        for (const f of rs.fields) {
            const col = storage.column(f.name);
            const src = f.type === "f32"
                ? new Float32Array(f.buffer, f.byteOffset, f.length)
                : f.type === "f64"
                    ? new Float64Array(f.buffer, f.byteOffset, f.length)
                    : f.type === "i32"
                        ? new Int32Array(f.buffer, f.byteOffset, f.length)
                        : new Uint32Array(f.buffer, f.byteOffset, f.length);
            col.set(src.subarray(0, n));
        }
    }
}
/** Snapshot write stores from an in-process context for local commit. */
export function snapshotLocalWrites(invocation) {
    return invocation.stores
        .filter((s) => s.memoryKind === "local" &&
        invocation.access.writes.includes(s.storeId))
        .map((s) => ({
        ...s,
        fields: s.fields.map((f) => ({ ...f })),
        entities: s.entities,
    }));
}
//# sourceMappingURL=build.js.map