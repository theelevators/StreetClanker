const META = Symbol.for("mob3.systemMeta");
let systemSeq = 0;
function resourceKeyId(key) {
    if (typeof key === "object" &&
        key !== null &&
        "id" in key &&
        typeof key.id === "symbol") {
        return key.id;
    }
    return key;
}
export function normalizeAccess(access, opaque) {
    const out = {
        componentRead: new Set(),
        componentWrite: new Set(),
        resourceRead: new Set(),
        resourceWrite: new Set(),
        eventRead: new Set(),
        eventWrite: new Set(),
        commands: false,
        opaque,
    };
    if (opaque || !access) {
        out.opaque = true;
        return out;
    }
    for (const c of access.read ?? [])
        out.componentRead.add(c);
    for (const c of access.write ?? [])
        out.componentWrite.add(c);
    for (const r of access.resources?.read ?? []) {
        out.resourceRead.add(resourceKeyId(r));
    }
    for (const r of access.resources?.write ?? []) {
        out.resourceWrite.add(resourceKeyId(r));
    }
    for (const e of access.events?.read ?? [])
        out.eventRead.add(e);
    for (const e of access.events?.write ?? [])
        out.eventWrite.add(e);
    out.commands = !!access.commands;
    return out;
}
/**
 * Attach inspectable access metadata to a system.
 * Returns a callable SystemFn compatible with `app.addSystem`.
 */
export function system(def) {
    const id = Symbol(`mob3.system.${def.name}:${systemSeq++}`);
    const meta = {
        id,
        name: def.name,
        access: normalizeAccess(def.access, false),
        declared: true,
    };
    const fn = ((world, commands) => {
        def.run(world, commands);
    });
    Object.defineProperty(fn, META, { value: meta });
    Object.defineProperty(fn, "name", { value: def.name });
    return fn;
}
const opaqueMeta = new WeakMap();
export function getSystemMeta(fn) {
    const declared = fn[META];
    if (declared)
        return declared;
    let meta = opaqueMeta.get(fn);
    if (!meta) {
        const name = fn.name && fn.name.length > 0 ? fn.name : "anonymous";
        meta = {
            id: Symbol(`mob3.opaque.${name}`),
            name,
            access: normalizeAccess(undefined, true),
            declared: false,
        };
        opaqueMeta.set(fn, meta);
    }
    return meta;
}
/** Peek without allocating opaque metadata (for missing-target diagnostics). */
export function peekSystemMeta(fn) {
    const declared = fn[META];
    if (declared)
        return declared;
    return opaqueMeta.get(fn);
}
export function isDeclaredSystem(fn) {
    return META in fn;
}
/** True if two access sets conflict. */
export function accessesConflict(a, b) {
    if (a.opaque || b.opaque)
        return true;
    if (a.commands && b.commands)
        return true;
    for (const c of a.componentWrite) {
        if (b.componentWrite.has(c) || b.componentRead.has(c))
            return true;
    }
    for (const c of a.componentRead) {
        if (b.componentWrite.has(c))
            return true;
    }
    for (const r of a.resourceWrite) {
        if (b.resourceWrite.has(r) || b.resourceRead.has(r))
            return true;
    }
    for (const r of a.resourceRead) {
        if (b.resourceWrite.has(r))
            return true;
    }
    for (const e of a.eventWrite) {
        if (b.eventWrite.has(e) || b.eventRead.has(e))
            return true;
    }
    for (const e of a.eventRead) {
        if (b.eventWrite.has(e))
            return true;
    }
    return false;
}
export function describeAccessConflict(a, b) {
    const reasons = [];
    if (a.opaque || b.opaque) {
        reasons.push("opaque/undeclared access");
        return reasons;
    }
    if (a.commands && b.commands)
        reasons.push("both issue Commands");
    const pushOverlap = (label, aw, ar, bw, br) => {
        for (const x of aw) {
            if (bw.has(x))
                reasons.push(`${label} write/write`);
            else if (br.has(x))
                reasons.push(`${label} write/read`);
        }
        for (const x of ar) {
            if (bw.has(x))
                reasons.push(`${label} read/write`);
        }
    };
    pushOverlap("component", a.componentWrite, a.componentRead, b.componentWrite, b.componentRead);
    pushOverlap("resource", a.resourceWrite, a.resourceRead, b.resourceWrite, b.resourceRead);
    pushOverlap("event", a.eventWrite, a.eventRead, b.eventWrite, b.eventRead);
    return [...new Set(reasons)];
}
export { META as SYSTEM_META };
//# sourceMappingURL=system.js.map