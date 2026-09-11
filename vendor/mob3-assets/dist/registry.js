import { makeHandle } from "./handle.js";
import { AssetFailed, AssetReady } from "./events.js";
function fingerprintOptions(options) {
    if (options === undefined)
        return "";
    try {
        return JSON.stringify(options);
    }
    catch {
        return String(options);
    }
}
export function makeDedupeKey(type, key, options) {
    return `${type.name}::${key}::${fingerprintOptions(options)}`;
}
/**
 * Renderer-agnostic asset registry.
 * Promise completions only enqueue; call `flush()` from AssetMaintenance.
 */
export class AssetRegistry {
    slots = [];
    free = [];
    byDedupe = new Map();
    loaders = new Map();
    pending = [];
    disposed = false;
    nextLoadId = 1;
    /** Test instrumentation */
    loaderInvocationCount = 0;
    get isDisposed() {
        return this.disposed;
    }
    registerLoader(type, loader) {
        this.assertLive();
        this.loaders.set(type.id, loader);
    }
    hasLoader(type) {
        return this.loaders.has(type.id);
    }
    load(type, key, options) {
        this.assertLive();
        const dedupeKey = makeDedupeKey(type, key, options);
        const existing = this.byDedupe.get(dedupeKey);
        if (existing !== undefined) {
            const slot = this.slots[existing];
            if (slot &&
                slot.generation > 0 &&
                (slot.status === "loading" ||
                    slot.status === "ready" ||
                    slot.status === "failed")) {
                slot.refCount++;
                return makeHandle(type, existing, slot.generation, key);
            }
        }
        const index = this.allocSlot();
        const generation = 1;
        const loadId = this.nextLoadId++;
        const controller = new AbortController();
        const slot = {
            type: type,
            key,
            dedupeKey,
            generation,
            status: "loading",
            refCount: 1,
            ownership: "owned",
            loadId,
            controller,
            inflight: true,
        };
        this.slots[index] = slot;
        this.byDedupe.set(dedupeKey, index);
        this.startLoad(index, type, { key, options }, controller, loadId);
        return makeHandle(type, index, generation, key);
    }
    insert(type, key, value, opts = {}) {
        this.assertLive();
        const ownership = opts.ownership ?? "owned";
        const dedupeKey = makeDedupeKey(type, key);
        const existing = this.byDedupe.get(dedupeKey);
        if (existing !== undefined) {
            const slot = this.slots[existing];
            if (slot && slot.status === "ready") {
                slot.refCount++;
                return makeHandle(type, existing, slot.generation, key);
            }
        }
        const index = this.allocSlot();
        const generation = 1;
        this.slots[index] = {
            type: type,
            key,
            dedupeKey,
            generation,
            status: "ready",
            value,
            refCount: 1,
            ownership,
            loadId: 0,
            inflight: false,
        };
        this.byDedupe.set(dedupeKey, index);
        return makeHandle(type, index, generation, key);
    }
    retain(handle) {
        const slot = this.liveSlot(handle);
        if (!slot)
            return;
        slot.refCount++;
    }
    release(handle, opts = {}) {
        const slot = this.liveSlot(handle);
        if (!slot)
            return;
        slot.refCount = Math.max(0, slot.refCount - 1);
        if (slot.refCount > 0)
            return;
        if (slot.status === "loading" && slot.controller) {
            slot.controller.abort();
            // Cancellation applied when promise settles or immediately mark cancelled
            this.pending.push({
                kind: "cancelled",
                slot: handle.index,
                generation: handle.generation,
                loadId: slot.loadId,
            });
        }
        if (opts.unload || slot.status === "cancelled") {
            this.unloadInternal(handle.index, handle.generation);
        }
    }
    cancel(handle) {
        this.release(handle, { unload: false });
    }
    unload(handle) {
        const slot = this.liveSlot(handle);
        if (!slot)
            return;
        if (slot.refCount > 0) {
            // Force drop refs for explicit unload
            slot.refCount = 0;
        }
        if (slot.status === "loading" && slot.controller) {
            slot.controller.abort();
        }
        this.unloadInternal(handle.index, handle.generation);
    }
    reload(handle) {
        this.assertLive();
        const slot = this.liveSlot(handle);
        if (!slot) {
            throw new Error(`Cannot reload ${handle.typeName} "${handle.key}": handle is absent/stale`);
        }
        const type = slot.type;
        const key = slot.key;
        const dedupeKey = slot.dedupeKey;
        // Bump generation so stale completions cannot revive
        this.disposeSlotValue(slot);
        slot.generation++;
        slot.status = "loading";
        slot.value = undefined;
        slot.error = undefined;
        slot.progress = undefined;
        slot.loadId = this.nextLoadId++;
        slot.controller = new AbortController();
        slot.inflight = true;
        if (slot.refCount < 1)
            slot.refCount = 1;
        this.byDedupe.set(dedupeKey, handle.index);
        this.startLoad(handle.index, type, { key }, slot.controller, slot.loadId);
        return makeHandle(type, handle.index, slot.generation, key);
    }
    state(handle) {
        const slot = this.liveSlot(handle);
        if (!slot)
            return { status: "absent" };
        switch (slot.status) {
            case "loading":
                return { status: "loading", progress: slot.progress, key: slot.key };
            case "ready":
                return { status: "ready", value: slot.value, key: slot.key };
            case "failed":
                return {
                    status: "failed",
                    error: slot.error ?? new Error("unknown"),
                    key: slot.key,
                };
            case "cancelled":
                return { status: "cancelled", key: slot.key };
            default:
                return { status: "absent" };
        }
    }
    status(handle) {
        return this.state(handle).status;
    }
    isReady(handle) {
        return this.status(handle) === "ready";
    }
    get(handle) {
        const s = this.state(handle);
        return s.status === "ready" ? s.value : undefined;
    }
    error(handle) {
        const s = this.state(handle);
        return s.status === "failed" ? s.error : undefined;
    }
    refCount(handle) {
        return this.liveSlot(handle)?.refCount ?? 0;
    }
    /** Apply queued promise completions. Called by AssetMaintenance. */
    flush(world) {
        if (this.disposed) {
            this.pending.length = 0;
            return;
        }
        const batch = this.pending.splice(0, this.pending.length);
        for (const t of batch) {
            const slot = this.slots[t.slot];
            if (!slot || slot.generation !== t.generation)
                continue;
            if (t.loadId !== slot.loadId)
                continue;
            if (t.kind === "ready") {
                if (slot.status !== "loading" && slot.status !== "cancelled")
                    continue;
                if (slot.refCount === 0 && slot.status === "cancelled") {
                    // Released while loading — dispose value if we got it late
                    this.disposeValue(slot, t.value);
                    this.unloadInternal(t.slot, t.generation);
                    continue;
                }
                slot.status = "ready";
                slot.value = t.value;
                slot.error = undefined;
                slot.inflight = false;
                slot.controller = undefined;
                world.send(AssetReady, {
                    handle: makeHandle(slot.type, t.slot, slot.generation, slot.key),
                    key: slot.key,
                    typeName: slot.type.name,
                });
            }
            else if (t.kind === "failed") {
                if (slot.status !== "loading")
                    continue;
                slot.status = "failed";
                slot.error = t.error;
                slot.inflight = false;
                slot.controller = undefined;
                world.send(AssetFailed, {
                    handle: makeHandle(slot.type, t.slot, slot.generation, slot.key),
                    key: slot.key,
                    typeName: slot.type.name,
                    error: t.error,
                });
            }
            else if (t.kind === "cancelled") {
                if (slot.status !== "loading")
                    continue;
                slot.status = "cancelled";
                slot.inflight = false;
                if (slot.refCount === 0) {
                    this.unloadInternal(t.slot, t.generation);
                }
            }
        }
    }
    inspect() {
        const out = [];
        for (let i = 0; i < this.slots.length; i++) {
            const s = this.slots[i];
            if (!s || s.generation === 0)
                continue;
            out.push({
                index: i,
                generation: s.generation,
                type: s.type.name,
                key: s.key,
                status: s.status,
                refs: s.refCount,
                ownership: s.ownership,
                error: s.error?.message,
            });
        }
        return out;
    }
    formatRegistry() {
        const lines = ["Assets", "────────────────────────"];
        for (const row of this.inspect()) {
            lines.push(`${row.key}`, `  type: ${row.type}`, `  state: ${row.status}`, `  refs: ${row.refs}`);
            if (row.error)
                lines.push(`  error: ${row.error}`);
        }
        if (lines.length === 2)
            lines.push("(empty)");
        return lines.join("\n");
    }
    /** Tear down for App.dispose — abort, dispose owned, ignore late completions. */
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        for (let i = 0; i < this.slots.length; i++) {
            const slot = this.slots[i];
            if (!slot)
                continue;
            if (slot.controller) {
                try {
                    slot.controller.abort();
                }
                catch {
                    /* ignore */
                }
            }
            this.disposeSlotValue(slot);
            slot.generation = 0;
            slot.status = "absent";
            this.slots[i] = null;
        }
        this.byDedupe.clear();
        this.pending.length = 0;
        this.free.length = 0;
    }
    startLoad(index, type, request, controller, loadId) {
        const loader = this.loaders.get(type.id);
        if (!loader) {
            this.pending.push({
                kind: "failed",
                slot: index,
                generation: this.slots[index].generation,
                error: new Error(`No loader registered for asset type "${type.name}"`),
                loadId,
            });
            return;
        }
        this.loaderInvocationCount++;
        const generation = this.slots[index].generation;
        let promise;
        try {
            promise = Promise.resolve(loader.load(request, {
                signal: controller.signal,
                key: request.key,
            }));
        }
        catch (err) {
            const error = err instanceof Error ? err : new Error(String(err ?? "asset load failed"));
            this.pending.push({
                kind: "failed",
                slot: index,
                generation,
                error,
                loadId,
            });
            return;
        }
        promise.then((value) => {
            if (this.disposed) {
                this.disposeValue(this.slots[index], value);
                return;
            }
            this.pending.push({
                kind: "ready",
                slot: index,
                generation,
                value,
                loadId,
            });
        }, (err) => {
            if (this.disposed)
                return;
            if (controller.signal.aborted) {
                this.pending.push({
                    kind: "cancelled",
                    slot: index,
                    generation,
                    loadId,
                });
                return;
            }
            const error = err instanceof Error
                ? err
                : new Error(String(err ?? "asset load failed"));
            this.pending.push({
                kind: "failed",
                slot: index,
                generation,
                error,
                loadId,
            });
        });
    }
    liveSlot(handle) {
        if (this.disposed)
            return null;
        const slot = this.slots[handle.index];
        if (!slot)
            return null;
        if (slot.generation !== handle.generation)
            return null;
        if (slot.type.id !== handle.typeId)
            return null;
        return slot;
    }
    allocSlot() {
        if (this.free.length)
            return this.free.pop();
        this.slots.push(null);
        return this.slots.length - 1;
    }
    unloadInternal(index, generation) {
        const slot = this.slots[index];
        if (!slot || slot.generation !== generation)
            return;
        this.disposeSlotValue(slot);
        this.byDedupe.delete(slot.dedupeKey);
        slot.generation = 0;
        slot.status = "absent";
        slot.value = undefined;
        slot.error = undefined;
        slot.refCount = 0;
        slot.inflight = false;
        slot.controller = undefined;
        this.slots[index] = null;
        this.free.push(index);
    }
    disposeSlotValue(slot) {
        if (slot.value !== undefined && slot.ownership === "owned") {
            this.disposeValue(slot, slot.value);
        }
        slot.value = undefined;
    }
    disposeValue(slot, value) {
        if (!slot || slot.ownership !== "owned")
            return;
        const loader = this.loaders.get(slot.type.id);
        try {
            loader?.dispose?.(value);
        }
        catch {
            /* dispose best-effort */
        }
    }
    assertLive() {
        if (this.disposed) {
            throw new Error("AssetRegistry is disposed");
        }
    }
}
//# sourceMappingURL=registry.js.map