function resolveWorkerCount(requested) {
    let hw = 4;
    if (typeof navigator !== "undefined" && navigator.hardwareConcurrency) {
        hw = navigator.hardwareConcurrency;
    }
    const def = Math.min(Math.max(1, hw - 1), 4);
    return Math.max(1, requested ?? def);
}
function browserEntryHref(override) {
    if (override)
        return String(override);
    return new URL("./worker_entry_browser.mjs", import.meta.url).href;
}
/**
 * Reusable worker pool (browser module Workers).
 */
export function createWorkerPool(options = {}) {
    const mode = options.mode ?? "preferred";
    const size = resolveWorkerCount(options.workers);
    const pending = new Map();
    const idle = [];
    const all = [];
    let nextId = 1;
    let disposed = false;
    let available = false;
    const finish = (id, data) => {
        const p = pending.get(id);
        if (!p)
            return;
        pending.delete(id);
        idle.push(p.worker);
        if (data.type === "error") {
            p.reject(new Error(`Worker system "${p.systemName}" failed:\n${data.error}`));
        }
        else {
            p.resolve(data.result);
        }
    };
    try {
        if (typeof Worker === "undefined") {
            throw new Error("Workers unavailable");
        }
        const href = browserEntryHref(options.workerUrl);
        for (let i = 0; i < size; i++) {
            const w = new Worker(href, { type: "module" });
            const adapter = {
                post: (msg, transferList) => transferList?.length
                    ? w.postMessage(msg, transferList)
                    : w.postMessage(msg),
                terminate: () => w.terminate(),
            };
            w.onmessage = (ev) => finish(ev.data.id, ev.data);
            w.onerror = (err) => {
                console.error("[mob3] worker error", err);
            };
            all.push(adapter);
            idle.push(adapter);
        }
        available = true;
    }
    catch (err) {
        if (mode === "required")
            throw err;
        available = false;
    }
    return {
        get size() {
            return all.length;
        },
        get available() {
            return available && !disposed;
        },
        runJob(moduleUrl, exportName, payload, systemName, transferList) {
            if (!available || disposed) {
                return Promise.reject(new Error("Worker pool unavailable"));
            }
            const worker = idle.pop();
            if (!worker) {
                return Promise.reject(new Error("Worker pool saturated"));
            }
            const id = nextId++;
            return new Promise((resolve, reject) => {
                pending.set(id, { resolve, reject, systemName, worker });
                worker.post({
                    type: "run",
                    id,
                    moduleUrl,
                    exportName,
                    payload,
                }, transferList);
            });
        },
        dispose() {
            disposed = true;
            for (const w of all)
                w.terminate();
            all.length = 0;
            idle.length = 0;
            pending.clear();
            available = false;
        },
    };
}
/** Whether this environment can construct Workers. */
export function workersSupported() {
    return typeof Worker !== "undefined";
}
//# sourceMappingURL=pool.js.map