import type { World } from "../world.js";
import type { ScheduleLabel } from "../schedule.js";
import type { CompiledSchedule, ExecutionPlan } from "../execution_plan.js";
import type { TimingStore } from "../execution_plan.js";
import { type WorkerPool, type WorkerPoolOptions, type PoolMode } from "./pool.js";
import { AbiIdRegistry } from "../abi/ids.js";
export type ParallelTimings = {
    dispatchMs: number;
    execMs: number;
    transferMs: number;
    commitMs: number;
    barrierMs: number;
    path?: "copy" | "shared" | "main" | "abi-shared" | "abi-copy" | "wasm-shared";
};
export type ParallelDataPath = "copy" | "shared" | "auto";
export type ParallelExecutorOptions = WorkerPoolOptions & {
    mode?: PoolMode;
    /**
     * copy — always Phase 5 extract/commit
     * shared — require shared stores (error if unavailable)
     * auto — shared when all accesses are SharedPackedStorage (default)
     */
    dataPath?: ParallelDataPath;
};
/**
 * Executes a compiled plan using Phase 4 batches.
 * ABI systems go through Execution ABI; legacy workerSystem keeps Phase 5/6 payloads.
 */
export declare class ParallelExecutor {
    readonly pool: WorkerPool;
    readonly mode: PoolMode;
    readonly dataPath: ParallelDataPath;
    readonly ids: AbiIdRegistry;
    private readonly batchTimings;
    private active;
    constructor(options?: ParallelExecutorOptions);
    get usingWorkers(): boolean;
    dispose(): void;
    run(compiled: CompiledSchedule, world: World, timings?: TimingStore): Promise<void>;
    lastBatchTimings(): readonly ParallelTimings[];
    clearTimings(): void;
}
export type ScheduleRunner = {
    run(label: ScheduleLabel, world: World): void;
    runAsync?(label: ScheduleLabel, world: World): Promise<void>;
};
export declare function parallelExecutor(options?: ParallelExecutorOptions): ParallelExecutor;
export type { ExecutionPlan };
//# sourceMappingURL=executor.d.ts.map