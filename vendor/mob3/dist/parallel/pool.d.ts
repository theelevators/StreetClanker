/**
 * Browser-safe worker pool for BoxClub.
 * Node worker_threads path omitted so Vite never pulls node: builtins.
 */
import type { WorkerPayload, WorkerResult } from "./types.js";
export type PoolMode = "preferred" | "required";
export type WorkerPoolOptions = {
    workers?: number;
    mode?: PoolMode;
    /** Override worker entry path/URL (tests). */
    workerUrl?: URL | string;
};
export interface WorkerPool {
    readonly size: number;
    readonly available: boolean;
    runJob(moduleUrl: string, exportName: string, payload: WorkerPayload | Record<string, unknown>, systemName: string, transferList?: ArrayBuffer[]): Promise<WorkerResult>;
    dispose(): void;
}
/**
 * Reusable worker pool (browser module Workers).
 */
export declare function createWorkerPool(options?: WorkerPoolOptions): WorkerPool;
/** Whether this environment can construct Workers. */
export declare function workersSupported(): boolean;
//# sourceMappingURL=pool.d.ts.map