import { normalizeAccess, SYSTEM_META } from "../system.js";
import { Time } from "../time.js";
import { getPackedMeta, isPackedComponent, } from "../storage/packed_component.js";
import { assertWorkerAccess } from "../parallel/transfer.js";
import { AbiIdRegistry } from "./ids.js";
import { buildSystemInvocation, commitAbiLocalStores, snapshotLocalWrites, storeCommitMapFromAccess, } from "./build.js";
import { AbiContext, schemaBindingFromInvocation } from "./context.js";
import { ABI_VERSION } from "./types.js";
const ABI_META = Symbol.for("mob3.abiSystemMeta");
function toModuleUrl(module) {
    return typeof module === "string" ? module : module.href;
}
function resolveDelay(meta) {
    const d = meta.delayMs;
    if (d === undefined)
        return undefined;
    return typeof d === "function" ? d() : d;
}
function assertAbiAccess(access, name) {
    assertWorkerAccess(access, name);
    for (const c of [...access.componentRead, ...access.componentWrite]) {
        if (c.isTag)
            continue;
        if (!isPackedComponent(c)) {
            throw new Error(`abiSystem '${name}': ABI v1 requires packed components (got '${getPackedMeta(c)?.name ?? c.name ?? "?"}')`);
        }
    }
}
/** Synchronous in-process ABI run (SystemFn sequential path). */
export function runAbiSystemLocalSync(world, meta) {
    const time = world.hasResource(Time) ? world.resource(Time) : null;
    const delta = time?.delta ?? 0;
    const tick = time
        ? Math.floor(time.elapsed / (time.fixedDelta || 1 / 60))
        : 0;
    const preferShared = [
        ...meta.access.componentRead,
        ...meta.access.componentWrite,
    ]
        .filter((c) => !c.isTag)
        .every((c) => !!getPackedMeta(c)?.shared);
    const invocation = buildSystemInvocation({
        world,
        systemName: meta.name,
        access: meta.access,
        resourceKeys: meta.resourceKeys,
        tick,
        delta,
        scheduleName: "local",
        preferShared,
        ids: meta.ids,
        delayMs: resolveDelay(meta),
    });
    const schema = schemaBindingFromInvocation(invocation);
    meta.module.bind?.(schema);
    if (invocation.delayMs && invocation.delayMs > 0) {
        const end = Date.now() + invocation.delayMs;
        while (Date.now() < end) {
            /* busy wait — tests only */
        }
    }
    const ctx = new AbiContext(invocation);
    meta.module.execute(ctx);
    if (invocation.stores.some((s) => s.memoryKind === "local")) {
        commitAbiLocalStores(world, storeCommitMapFromAccess(meta.access, meta.ids), snapshotLocalWrites(invocation));
    }
}
/**
 * Opt-in ABI-eligible worker system. Module-addressable — no World, no closures.
 */
export function abiSystem(def) {
    if (def.access.commands) {
        throw new Error(`abiSystem '${def.name}': commands are outside ABI v1 (host-side only)`);
    }
    if (def.system.abiVersion !== undefined &&
        def.system.abiVersion !== ABI_VERSION) {
        throw new Error(`abiSystem '${def.name}': unsupported module abiVersion ${def.system.abiVersion} (need ${ABI_VERSION})`);
    }
    const access = normalizeAccess(def.access, false);
    assertAbiAccess(access, def.name);
    const moduleUrl = toModuleUrl(def.module);
    const resourceKeys = [
        ...(def.access.resources?.read ?? []),
        ...(def.access.resources?.write ?? []),
    ];
    const eventTypes = [
        ...(def.access.events?.read ?? []),
        ...(def.access.events?.write ?? []),
    ];
    const id = Symbol(`mob3.abi.${def.name}`);
    const meta = {
        id,
        name: def.name,
        access,
        declared: true,
        affinity: "worker",
        abi: true,
        abiVersion: ABI_VERSION,
        moduleUrl,
        exportName: def.export,
        module: def.system,
        resourceKeys,
        eventTypes,
        delayMs: def.delayMs,
        ids: new AbiIdRegistry(),
    };
    const fn = ((world, _commands) => {
        runAbiSystemLocalSync(world, meta);
    });
    Object.defineProperty(fn, SYSTEM_META, { value: meta });
    Object.defineProperty(fn, ABI_META, { value: meta });
    Object.defineProperty(fn, "name", { value: def.name });
    return fn;
}
export function getAbiMeta(fn) {
    return fn[ABI_META];
}
export function isAbiSystem(fn) {
    return ABI_META in fn;
}
export { ABI_META };
//# sourceMappingURL=abi_system.js.map