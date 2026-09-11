import type { ScheduleLabel, SystemFn } from "./schedule.js";
import { type SystemMeta, type SystemId } from "./system.js";
export type DependencyEdge = {
    from: SystemId;
    to: SystemId;
    fromName: string;
    toName: string;
    kind: "before" | "after";
};
export type AccessConflict = {
    a: SystemId;
    b: SystemId;
    aName: string;
    bName: string;
    reasons: string[];
    /** True if an explicit order edge already serializes them. */
    ordered: boolean;
};
export type SystemTiming = {
    invocations: number;
    totalMs: number;
    lastMs: number;
    minMs: number;
    maxMs: number;
    avgMs: number;
};
export type PlanSystem = {
    id: SystemId;
    name: string;
    declared: boolean;
    access: SystemMeta["access"];
    /** Phase 5: main vs worker-eligible. */
    affinity: "main" | "worker";
    /** Phase 8: backend label for diagnostics (does not affect planning). */
    backend?: "main" | "js-worker" | "abi-js" | "wasm";
    timing?: SystemTiming;
};
export type ExecutionPlan = {
    schedule: ScheduleLabel;
    scheduleName: string;
    systems: PlanSystem[];
    /** Execution order (sequential). */
    order: SystemId[];
    dependencies: DependencyEdge[];
    conflicts: AccessConflict[];
    /** Theoretical parallel batches (informational). */
    batches: SystemId[][];
    diagnostics: string[];
};
export type CompiledSchedule = {
    plan: ExecutionPlan;
    /** Resolved SystemFn in sequential order. */
    runOrder: SystemFn[];
};
type Entry = {
    system: SystemFn;
    meta: SystemMeta;
    before: SystemFn[];
    after: SystemFn[];
    registrationIndex: number;
};
export declare class TimingStore {
    private readonly timings;
    record(id: SystemId, ms: number): void;
    get(id: SystemId): SystemTiming | undefined;
    clear(): void;
}
/**
 * Compile entries into an execution plan.
 * Sequential order matches Phase 3 topo semantics (deps + registration ties).
 * Access analysis does NOT reorder systems.
 */
export declare function compileExecutionPlan(label: ScheduleLabel, entries: Entry[], timings?: TimingStore, options?: {
    strict?: boolean;
}): CompiledSchedule;
export declare function formatExecutionPlan(plan: ExecutionPlan): string;
/** JSON-serializable snapshot of an execution plan (symbols → strings). */
export declare function planToJson(plan: ExecutionPlan): Record<string, unknown>;
export {};
//# sourceMappingURL=execution_plan.d.ts.map