const layouts = new WeakMap();
function isNumericDefaults(defaults) {
    if (defaults === null || typeof defaults !== "object" || Array.isArray(defaults)) {
        return false;
    }
    const vals = Object.values(defaults);
    return vals.length > 0 && vals.every((v) => typeof v === "number");
}
import { getPackedMeta } from "../storage/packed_component.js";
/** True if component defaults are a plain numeric record (worker-transferable). */
export function isWorkerSafeComponent(type) {
    if (type.isTag)
        return true;
    if (getPackedMeta(type))
        return true;
    return isNumericDefaults(type.defaults);
}
export function getNumericLayout(type) {
    if (type.isTag)
        return null;
    const cached = layouts.get(type);
    if (cached)
        return cached;
    const packed = getPackedMeta(type);
    if (packed) {
        const layout = {
            type,
            name: packed.name,
            fields: [...packed.fields],
        };
        layouts.set(type, layout);
        return layout;
    }
    if (!isNumericDefaults(type.defaults))
        return null;
    const fields = Object.keys(type.defaults);
    const name = type.name &&
        type.name !== "factory"
        ? type.name
        : type.id.description ?? "Component";
    const layout = { type, name, fields };
    layouts.set(type, layout);
    return layout;
}
function resourceName(key) {
    if (typeof key === "symbol")
        return key.description ?? "Resource";
    if (typeof key === "object" &&
        key !== null &&
        "name" in key &&
        typeof key.name === "string") {
        return key.name;
    }
    if (typeof key === "function")
        return key.name || "Resource";
    return "Resource";
}
function cloneResource(value) {
    if (value === null || typeof value !== "object")
        return value;
    // Prefer structuredClone when available
    if (typeof structuredClone === "function") {
        try {
            return structuredClone(value);
        }
        catch {
            // fall through
        }
    }
    return JSON.parse(JSON.stringify(value));
}
export function assertWorkerAccess(access, systemName) {
    if (access.opaque) {
        throw new Error(`workerSystem '${systemName}' cannot be opaque`);
    }
    if (access.commands) {
        throw new Error(`workerSystem '${systemName}' cannot use Commands (main-thread only in Phase 5)`);
    }
    for (const c of access.componentRead) {
        if (!isWorkerSafeComponent(c)) {
            throw new Error(`workerSystem '${systemName}' reads non-transferable component '${c.name ?? "?"}'`);
        }
    }
    for (const c of access.componentWrite) {
        if (c.isTag) {
            throw new Error(`workerSystem '${systemName}' cannot write tags (structural); use Commands on main`);
        }
        if (!isWorkerSafeComponent(c)) {
            throw new Error(`workerSystem '${systemName}' writes non-transferable component '${c.name ?? "?"}'`);
        }
    }
}
/**
 * Collect entities that have all required data components and tag filters.
 */
function collectEntities(world, dataTypes, tagFilters) {
    if (dataTypes.length === 0)
        return [];
    // Walk smallest store
    let best = dataTypes[0];
    let bestSize = Infinity;
    for (const t of dataTypes) {
        // access via query iteration
        let n = 0;
        for (const _ of world.query(t))
            n++;
        if (n < bestSize) {
            bestSize = n;
            best = t;
        }
    }
    const out = [];
    outer: for (const [entity] of world.query(best)) {
        for (const t of dataTypes) {
            if (t !== best && !world.has(entity, t))
                continue outer;
        }
        for (const tag of tagFilters) {
            if (!world.has(entity, tag))
                continue outer;
        }
        out.push(entity);
    }
    return out;
}
function packSlice(world, layout, entities) {
    const { fields, name } = layout;
    const data = new Float32Array(entities.length * fields.length);
    const ents = new Uint32Array(entities.length);
    for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        ents[i] = e >>> 0;
        const comp = world.get(e, layout.type);
        const base = i * fields.length;
        for (let f = 0; f < fields.length; f++) {
            data[base + f] = comp[fields[f]] ?? 0;
        }
    }
    return { name, fields: [...fields], entities: ents, data };
}
export function extractWorkerPayload(world, access, ctx, delayMs) {
    const tagFilters = [];
    const dataTypes = [];
    for (const c of [...access.componentRead, ...access.componentWrite]) {
        if (c.isTag)
            tagFilters.push(c);
        else
            dataTypes.push(c);
    }
    // Unique data types
    const uniqueData = [...new Set(dataTypes)];
    const entities = collectEntities(world, uniqueData, tagFilters);
    const components = {};
    for (const t of uniqueData) {
        const layout = getNumericLayout(t);
        if (!layout)
            continue;
        ctx.byName.set(layout.name, layout);
        components[layout.name] = packSlice(world, layout, entities);
    }
    const resources = {};
    for (const key of access.resourceRead) {
        // key may be symbol id from normalizeAccess — resolve from world
        // We need original ResourceKey. Store from access declaration instead.
    }
    void resources;
    return {
        components,
        resources: {},
        delayMs,
    };
}
/** Extract using original AccessDeclaration resource keys. */
export function extractWorkerPayloadWithKeys(world, access, resourceKeys, eventTypes, delayMs) {
    const ctx = {
        byName: new Map(),
        eventsByName: new Map(),
        resourcesByName: new Map(),
    };
    for (const e of eventTypes)
        ctx.eventsByName.set(e.name ?? "Event", e);
    const tagFilters = [];
    const dataTypes = [];
    for (const c of [...access.componentRead, ...access.componentWrite]) {
        if (c.isTag)
            tagFilters.push(c);
        else
            dataTypes.push(c);
    }
    const uniqueData = [...new Set(dataTypes)];
    const entities = collectEntities(world, uniqueData, tagFilters);
    const components = {};
    for (const t of uniqueData) {
        const layout = getNumericLayout(t);
        if (!layout)
            continue;
        ctx.byName.set(layout.name, layout);
        components[layout.name] = packSlice(world, layout, entities);
    }
    const resources = {};
    for (const key of resourceKeys) {
        const name = resourceName(key);
        ctx.resourcesByName.set(name, key);
        if (world.hasResource(key)) {
            resources[name] = cloneResource(world.resource(key));
        }
    }
    return {
        payload: { components, resources, delayMs },
        ctx,
    };
}
export function validateWorkerResult(result, allowedWriteNames, systemName) {
    for (const w of result.writes) {
        if (!allowedWriteNames.has(w.name)) {
            throw new Error(`Worker system "${systemName}" attempted undeclared write to ${w.name}`);
        }
    }
}
export function commitWorkerWrites(world, writes, ctx) {
    for (const slice of writes) {
        const layout = ctx.byName.get(slice.name);
        if (!layout) {
            throw new Error(`Unknown write component '${slice.name}' at commit`);
        }
        const { fields } = layout;
        const n = slice.entities.length;
        for (let i = 0; i < n; i++) {
            const entity = slice.entities[i];
            if (!world.isAlive(entity))
                continue;
            const comp = world.get(entity, layout.type);
            if (!comp)
                continue;
            const base = i * fields.length;
            for (let f = 0; f < fields.length; f++) {
                comp[fields[f]] = slice.data[base + f];
            }
        }
    }
}
export function commitWorkerEvents(world, events, ctx) {
    if (!events)
        return;
    for (const batch of events) {
        const type = ctx.eventsByName.get(batch.name);
        if (!type) {
            throw new Error(`Worker returned unknown event '${batch.name}'`);
        }
        for (const payload of batch.payloads) {
            world.send(type, payload);
        }
    }
}
/** Run a worker handler on the main thread (fallback / sequential reference). */
export async function runHandlerLocal(moduleUrl, exportName, payload) {
    if (payload.delayMs && payload.delayMs > 0) {
        await new Promise((r) => setTimeout(r, payload.delayMs));
    }
    const mod = await import(/* @vite-ignore */ moduleUrl);
    const fn = mod[exportName];
    if (typeof fn !== "function") {
        throw new Error(`Export '${exportName}' not found in ${moduleUrl}`);
    }
    const t0 = nowMs();
    const result = fn(payload);
    const execMs = nowMs() - t0;
    return { ...result, execMs: result.execMs ?? execMs };
}
function nowMs() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}
//# sourceMappingURL=transfer.js.map