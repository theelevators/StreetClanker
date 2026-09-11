import { normalizeAccess, SYSTEM_META } from "../system.js";
import { assertWorkerAccess, extractWorkerPayloadWithKeys, validateWorkerResult, commitWorkerWrites, commitWorkerEvents, getNumericLayout, } from "./transfer.js";
const WORKER_META = Symbol.for("mob3.workerSystemMeta");
function toModuleUrl(module) {
    return typeof module === "string" ? module : module.href;
}
function writeNamesFor(meta) {
    const names = new Set();
    for (const c of meta.access.componentWrite) {
        const layout = getNumericLayout(c);
        if (layout)
            names.add(layout.name);
    }
    return names;
}
/**
 * Run a worker system handler against World on the main thread
 * (sequential reference / fallback). Sync — uses `run` handler, not import.
 */
export function runWorkerSystemLocal(world, meta) {
    const delayMs = meta.delayMs === undefined
        ? undefined
        : typeof meta.delayMs === "function"
            ? meta.delayMs()
            : meta.delayMs;
    const { payload, ctx } = extractWorkerPayloadWithKeys(world, meta.access, meta.resourceKeys, meta.eventTypes, delayMs);
    if (delayMs && delayMs > 0) {
        const end = Date.now() + delayMs;
        while (Date.now() < end) {
            /* sync busy-wait for tests only */
        }
    }
    const result = meta.handler(payload);
    validateWorkerResult(result, writeNamesFor(meta), meta.name);
    commitWorkerWrites(world, result.writes, ctx);
    commitWorkerEvents(world, result.events, ctx);
}
/**
 * Opt-in parallel-eligible system. Module-addressable — no closure shipping.
 */
export function workerSystem(def) {
    if (def.access.commands) {
        throw new Error(`workerSystem '${def.name}': commands are main-thread only in Phase 5`);
    }
    const access = normalizeAccess(def.access, false);
    assertWorkerAccess(access, def.name);
    const moduleUrl = toModuleUrl(def.module);
    const resourceKeys = [
        ...(def.access.resources?.read ?? []),
        ...(def.access.resources?.write ?? []),
    ];
    const eventTypes = [
        ...(def.access.events?.read ?? []),
        ...(def.access.events?.write ?? []),
    ];
    const id = Symbol(`mob3.worker.${def.name}`);
    const meta = {
        id,
        name: def.name,
        access,
        declared: true,
        affinity: "worker",
        moduleUrl,
        exportName: def.export,
        handler: def.run,
        resourceKeys,
        eventTypes,
        delayMs: def.delayMs,
    };
    const fn = ((world, _commands) => {
        runWorkerSystemLocal(world, meta);
    });
    Object.defineProperty(fn, SYSTEM_META, { value: meta });
    Object.defineProperty(fn, WORKER_META, { value: meta });
    Object.defineProperty(fn, "name", { value: def.name });
    return fn;
}
export function getWorkerMeta(fn) {
    return fn[WORKER_META];
}
export function isWorkerSystem(fn) {
    return WORKER_META in fn;
}
export { WORKER_META };
//# sourceMappingURL=worker_system.js.map