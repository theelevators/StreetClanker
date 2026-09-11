import type { WorkerPool } from "../parallel/pool.js";
import type { AbiExecutor, ExecutionResult, SystemInvocation } from "./types.js";
export type JsWorkerAbiExecutorOptions = {
    pool: WorkerPool;
    moduleUrl: string;
    exportName: string;
};
/**
 * Dispatches ABI invocations to a JS worker via the shared pool.
 * Worker receives SystemInvocation — never World.
 */
export declare class JsWorkerAbiExecutor implements AbiExecutor {
    private readonly pool;
    private readonly moduleUrl;
    private readonly exportName;
    constructor(options: JsWorkerAbiExecutorOptions);
    execute(invocation: SystemInvocation): Promise<ExecutionResult>;
    dispose(): void;
}
//# sourceMappingURL=js_worker.d.ts.map