import { Commands } from "../commands.js";
import { getSystemMeta } from "../system.js";
import { extractWorkerPayloadWithKeys, validateWorkerResult, commitWorkerWrites, commitWorkerEvents, getNumericLayout, } from "./transfer.js";
import { getWorkerMeta } from "./worker_system.js";
import { createWorkerPool, } from "./pool.js";
import { canUseSharedPath, extractSharedWorkerPayload, } from "./shared_path.js";
import { getAbiMeta } from "../abi/abi_system.js";
import { ensureWasmExecutor, getWasmMeta, } from "../abi/wasm_system.js";
import { AbiIdRegistry } from "../abi/ids.js";
import { buildSystemInvocation, collectTransferables, commitAbiLocalStores, storeCommitMapFromAccess, } from "../abi/build.js";
import { Time } from "../time.js";
import { getPackedMeta } from "../storage/packed_component.js";
function nowMs() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
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
function resolveDelay(meta) {
    const d = meta.delayMs;
    if (d === undefined)
        return undefined;
    return typeof d === "function" ? d() : d;
}
function canUseAbiShared(world, meta) {
    const types = [
        ...meta.access.componentRead,
        ...meta.access.componentWrite,
    ];
    let saw = false;
    for (const c of types) {
        if (c.isTag)
            continue;
        const packed = getPackedMeta(c);
        if (!packed?.shared)
            return false;
        saw = true;
    }
    return saw;
}
/**
 * Executes a compiled plan using Phase 4 batches.
 * ABI systems go through Execution ABI; legacy workerSystem keeps Phase 5/6 payloads.
 */
export class ParallelExecutor {
    pool;
    mode;
    dataPath;
    ids;
    batchTimings = [];
    active = false;
    constructor(options = {}) {
        this.mode = options.mode ?? "preferred";
        this.dataPath = options.dataPath ?? "auto";
        this.pool = createWorkerPool(options);
        this.ids = new AbiIdRegistry();
    }
    get usingWorkers() {
        return this.pool.available;
    }
    dispose() {
        this.pool.dispose();
    }
    async run(compiled, world, timings) {
        if (this.active) {
            throw new Error("ParallelExecutor: overlapping frame/schedule execution is not allowed");
        }
        this.active = true;
        try {
            const { plan, runOrder } = compiled;
            if (runOrder.length === 0)
                return;
            const fnById = new Map();
            for (let i = 0; i < plan.order.length; i++) {
                fnById.set(plan.order[i], runOrder[i]);
            }
            const commands = new Commands(world);
            const time = world.hasResource(Time) ? world.resource(Time) : null;
            const delta = time?.delta ?? 0;
            const tick = time
                ? Math.floor(time.elapsed / (time.fixedDelta || 1 / 60))
                : 0;
            for (let bi = 0; bi < plan.batches.length; bi++) {
                const batch = plan.batches[bi];
                const barrierStart = nowMs();
                const jobs = batch.map((id) => {
                    const fn = fnById.get(id);
                    const wasmMeta = getWasmMeta(fn);
                    if (wasmMeta) {
                        wasmMeta.ids = this.ids;
                        return {
                            id,
                            fn,
                            workerMeta: null,
                            abiMeta: null,
                            wasmMeta,
                            kind: "wasm",
                        };
                    }
                    const ameta = getAbiMeta(fn);
                    if (ameta) {
                        ameta.ids = this.ids;
                        return {
                            id,
                            fn,
                            workerMeta: null,
                            abiMeta: ameta,
                            wasmMeta: null,
                            kind: "abi",
                        };
                    }
                    const wmeta = getWorkerMeta(fn);
                    return {
                        id,
                        fn,
                        workerMeta: wmeta ?? null,
                        abiMeta: null,
                        wasmMeta: null,
                        kind: wmeta ? "worker" : "main",
                    };
                });
                const prepared = jobs.map((job) => {
                    if (job.kind === "main") {
                        return { job, path: "main", dispatchMs: 0, transferMs: 0 };
                    }
                    const t0 = nowMs();
                    if (job.kind === "wasm" && job.wasmMeta) {
                        const abiInvocation = buildSystemInvocation({
                            world,
                            systemName: job.wasmMeta.name,
                            access: job.wasmMeta.access,
                            resourceKeys: job.wasmMeta.resourceKeys,
                            tick,
                            delta,
                            scheduleName: plan.scheduleName ?? "schedule",
                            preferShared: true,
                            ids: this.ids,
                        });
                        return {
                            job,
                            path: "wasm-shared",
                            abiInvocation,
                            dispatchMs: 0,
                            transferMs: nowMs() - t0,
                        };
                    }
                    if (job.kind === "abi" && job.abiMeta) {
                        const wantShared = this.dataPath === "shared" ||
                            (this.dataPath === "auto" &&
                                canUseAbiShared(world, job.abiMeta));
                        if (this.dataPath === "shared" && !canUseAbiShared(world, job.abiMeta)) {
                            throw new Error(`dataPath=shared but ABI system '${job.abiMeta.name}' lacks SharedPackedStorage accesses`);
                        }
                        const preferShared = wantShared && canUseAbiShared(world, job.abiMeta);
                        const abiInvocation = buildSystemInvocation({
                            world,
                            systemName: job.abiMeta.name,
                            access: job.abiMeta.access,
                            resourceKeys: job.abiMeta.resourceKeys,
                            tick,
                            delta,
                            scheduleName: plan.scheduleName ?? "schedule",
                            preferShared,
                            ids: this.ids,
                            delayMs: resolveDelay(job.abiMeta),
                        });
                        return {
                            job,
                            path: preferShared ? "abi-shared" : "abi-copy",
                            abiInvocation,
                            dispatchMs: 0,
                            transferMs: nowMs() - t0,
                        };
                    }
                    const meta = job.workerMeta;
                    const wantShared = this.dataPath === "shared" ||
                        (this.dataPath === "auto" && canUseSharedPath(world, meta));
                    if (this.dataPath === "shared" && !canUseSharedPath(world, meta)) {
                        throw new Error(`dataPath=shared but system '${meta.name}' lacks SharedPackedStorage accesses`);
                    }
                    if (wantShared && canUseSharedPath(world, meta)) {
                        const sharedPayload = extractSharedWorkerPayload(world, meta, resolveDelay(meta));
                        return {
                            job,
                            path: "shared",
                            sharedPayload,
                            dispatchMs: 0,
                            transferMs: nowMs() - t0,
                        };
                    }
                    const payloadCtx = extractWorkerPayloadWithKeys(world, meta.access, meta.resourceKeys, meta.eventTypes, resolveDelay(meta));
                    return {
                        job,
                        path: "copy",
                        payloadCtx,
                        dispatchMs: 0,
                        transferMs: nowMs() - t0,
                    };
                });
                await Promise.all(prepared.map(async (p) => {
                    const tDispatch = nowMs();
                    try {
                        if (p.job.kind === "wasm" && p.job.wasmMeta && p.abiInvocation) {
                            const ex = ensureWasmExecutor(p.job.wasmMeta, world);
                            await ex.ensureReady();
                            p.result = ex.executeSync(p.abiInvocation);
                            const er = p.result;
                            if (er.status === "error") {
                                throw new Error(er.error ?? `WASM system '${p.job.wasmMeta.name}' failed`);
                            }
                        }
                        else if (p.job.kind === "abi" && p.job.abiMeta && p.abiInvocation) {
                            if (this.pool.available) {
                                const transfer = collectTransferables(p.abiInvocation);
                                p.result = (await this.pool.runJob(p.job.abiMeta.moduleUrl, p.job.abiMeta.exportName, p.abiInvocation, p.job.abiMeta.name, transfer.length ? transfer : undefined));
                            }
                            else if (this.mode === "required") {
                                throw new Error(`Workers unavailable (required) for ABI '${p.job.abiMeta.name}'`);
                            }
                            else {
                                const t0 = nowMs();
                                p.job.fn(world, commands);
                                commands.flush();
                                p.result = {
                                    abiVersion: 1,
                                    systemId: p.abiInvocation.system.id,
                                    status: "ok",
                                    execMs: nowMs() - t0,
                                };
                            }
                            const er = p.result;
                            if (er.status === "error") {
                                throw new Error(er.error ?? `ABI system '${p.job.abiMeta.name}' failed`);
                            }
                        }
                        else if (p.job.kind === "worker" && p.job.workerMeta) {
                            const payload = p.path === "shared"
                                ? p.sharedPayload
                                : p.payloadCtx.payload;
                            if (this.pool.available) {
                                p.result = await this.pool.runJob(p.job.workerMeta.moduleUrl, p.job.workerMeta.exportName, payload, p.job.workerMeta.name);
                            }
                            else if (this.mode === "required") {
                                throw new Error(`Workers unavailable (required) for '${p.job.workerMeta.name}'`);
                            }
                            else if (p.path === "shared") {
                                const t0 = nowMs();
                                p.job.fn(world, commands);
                                commands.flush();
                                p.result = { writes: [], execMs: nowMs() - t0 };
                            }
                            else {
                                const t0 = nowMs();
                                const result = p.job.workerMeta.handler(p.payloadCtx.payload);
                                p.result = {
                                    ...result,
                                    execMs: result.execMs ?? nowMs() - t0,
                                };
                            }
                            if (p.path === "copy") {
                                validateWorkerResult(p.result, writeNamesFor(p.job.workerMeta), p.job.workerMeta.name);
                            }
                            else if (p.result.writes?.length) {
                                validateWorkerResult(p.result, writeNamesFor(p.job.workerMeta), p.job.workerMeta.name);
                            }
                        }
                        else {
                            const t0 = nowMs();
                            p.job.fn(world, commands);
                            commands.flush();
                            if (timings) {
                                timings.record(getSystemMeta(p.job.fn).id, nowMs() - t0);
                            }
                        }
                    }
                    catch (err) {
                        p.error =
                            err instanceof Error ? err : new Error(String(err));
                    }
                    p.dispatchMs = nowMs() - tDispatch;
                }));
                const failed = prepared.find((p) => p.error);
                if (failed)
                    throw failed.error;
                const tCommit = nowMs();
                for (const p of prepared) {
                    if (p.job.kind === "wasm" && p.result && p.job.wasmMeta) {
                        const er = p.result;
                        if (timings) {
                            timings.record(p.job.wasmMeta.id, (er.execMs ?? 0) + p.transferMs);
                        }
                        continue;
                    }
                    if (p.job.kind === "abi" && p.result && p.job.abiMeta && p.abiInvocation) {
                        const er = p.result;
                        if (p.path === "abi-copy" && er.localWrites?.length) {
                            commitAbiLocalStores(world, storeCommitMapFromAccess(p.job.abiMeta.access, this.ids), er.localWrites);
                        }
                        if (er.events?.length) {
                            for (const batch of er.events) {
                                const et = p.job.abiMeta.eventTypes.find((e) => (e.name ?? "Event") === batch.name);
                                if (!et) {
                                    throw new Error(`ABI system returned unknown event '${batch.name}'`);
                                }
                                for (const payload of batch.payloads) {
                                    world.send(et, payload);
                                }
                            }
                        }
                        if (timings) {
                            timings.record(p.job.abiMeta.id, (er.execMs ?? 0) + p.transferMs);
                        }
                        continue;
                    }
                    if (p.job.kind !== "worker" || !p.result || !p.job.workerMeta)
                        continue;
                    const wr = p.result;
                    if (p.path === "copy" && p.payloadCtx) {
                        commitWorkerWrites(world, wr.writes, p.payloadCtx.ctx);
                        commitWorkerEvents(world, wr.events, p.payloadCtx.ctx);
                    }
                    else if (p.path === "shared") {
                        if (wr.events?.length && p.payloadCtx) {
                            commitWorkerEvents(world, wr.events, p.payloadCtx.ctx);
                        }
                        else if (wr.events?.length) {
                            for (const batch of wr.events) {
                                const et = p.job.workerMeta.eventTypes.find((e) => (e.name ?? "Event") === batch.name);
                                if (!et) {
                                    throw new Error(`Worker returned unknown event '${batch.name}'`);
                                }
                                for (const payload of batch.payloads) {
                                    world.send(et, payload);
                                }
                            }
                        }
                    }
                    if (timings) {
                        timings.record(p.job.workerMeta.id, (wr.execMs ?? 0) + p.transferMs);
                    }
                }
                // Off-main shared/WASM writes bypass per-row change ticks — mark stores coarsely.
                for (const p of prepared) {
                    if (p.path !== "shared" &&
                        p.path !== "abi-shared" &&
                        p.path !== "wasm-shared") {
                        continue;
                    }
                    const writes = p.job.wasmMeta?.access.componentWrite ??
                        p.job.abiMeta?.access.componentWrite ??
                        p.job.workerMeta?.access.componentWrite;
                    if (!writes)
                        continue;
                    for (const type of writes) {
                        world.markStoreChanged(type);
                    }
                }
                const commitMs = nowMs() - tCommit;
                const barrierMs = nowMs() - barrierStart;
                const pathHint = prepared.some((x) => x.path === "wasm-shared")
                    ? "wasm-shared"
                    : prepared.some((x) => x.path === "abi-shared")
                        ? "abi-shared"
                        : prepared.some((x) => x.path === "abi-copy")
                            ? "abi-copy"
                            : prepared.some((x) => x.path === "shared")
                                ? "shared"
                                : prepared.some((x) => x.path === "copy")
                                    ? "copy"
                                    : "main";
                this.batchTimings.push({
                    dispatchMs: Math.max(...prepared.map((x) => x.dispatchMs), 0),
                    execMs: Math.max(...prepared.map((x) => {
                        const r = x.result;
                        return r?.execMs ?? 0;
                    }), 0),
                    transferMs: prepared.reduce((a, x) => a + x.transferMs, 0),
                    commitMs,
                    barrierMs,
                    path: pathHint,
                });
            }
        }
        finally {
            this.active = false;
        }
    }
    lastBatchTimings() {
        return this.batchTimings;
    }
    clearTimings() {
        this.batchTimings.length = 0;
    }
}
export function parallelExecutor(options = {}) {
    return new ParallelExecutor(options);
}
//# sourceMappingURL=executor.js.map