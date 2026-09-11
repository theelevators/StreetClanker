import { ABI_VERSION } from "./types.js";
import { collectTransferables } from "./build.js";
/**
 * Dispatches ABI invocations to a JS worker via the shared pool.
 * Worker receives SystemInvocation — never World.
 */
export class JsWorkerAbiExecutor {
    pool;
    moduleUrl;
    exportName;
    constructor(options) {
        this.pool = options.pool;
        this.moduleUrl = options.moduleUrl;
        this.exportName = options.exportName;
    }
    async execute(invocation) {
        if (!this.pool.available) {
            throw new Error(`JsWorkerAbiExecutor: worker pool unavailable for '${invocation.system.name}'`);
        }
        const transfer = collectTransferables(invocation);
        const result = (await this.pool.runJob(this.moduleUrl, this.exportName, invocation, invocation.system.name, transfer.length ? transfer : undefined));
        if (result && "abiVersion" in result && result.abiVersion != null) {
            return result;
        }
        return {
            abiVersion: ABI_VERSION,
            systemId: invocation.system.id,
            status: "ok",
            events: result.events,
            localWrites: result.localWrites,
            execMs: result.execMs,
        };
    }
    dispose() {
        /* pool owned by ParallelExecutor */
    }
}
//# sourceMappingURL=js_worker.js.map