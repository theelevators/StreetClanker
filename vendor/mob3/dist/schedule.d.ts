import type { World } from "./world.js";
import { Commands } from "./commands.js";
import { TimingStore, type ExecutionPlan } from "./execution_plan.js";
import type { ParallelExecutor } from "./parallel/executor.js";
/**
 * A system is behavior operating against world state.
 * Structural mutations should go through `commands` and apply after the system returns.
 */
export type SystemFn = (world: World, commands: Commands) => void;
export type ScheduleLabel = string | symbol;
export type SystemConstraints = {
    /** This system must run before these systems (same schedule label). */
    before?: SystemFn | SystemFn[];
    /** This system must run after these systems (same schedule label). */
    after?: SystemFn | SystemFn[];
};
/** Built-in schedule labels. */
export declare const Startup: unique symbol;
export declare const PreUpdate: unique symbol;
export declare const FixedUpdate: unique symbol;
export declare const Update: unique symbol;
export declare const PostUpdate: unique symbol;
export declare const PreRender: unique symbol;
export declare const Render: unique symbol;
export declare const PostRender: unique symbol;
export declare const DEFAULT_SCHEDULE_ORDER: ScheduleLabel[];
export type ScheduleDiagnosticsOptions = {
    /** Record per-system timings. */
    timings?: boolean;
    strict?: boolean;
};
/**
 * Schedule of systems for a label, with compiled execution plans.
 */
export declare class Schedule {
    private readonly entries;
    private readonly compiled;
    private dirty;
    private nextIndex;
    private timingsEnabled;
    private strict;
    readonly timingStore: TimingStore;
    /** Optional Phase 5 parallel executor. */
    parallel: ParallelExecutor | null;
    enableTimings(enabled?: boolean): void;
    enableStrict(enabled?: boolean): void;
    setParallelExecutor(executor: ParallelExecutor | null): void;
    addSystem(label: ScheduleLabel, system: SystemFn, constraints?: SystemConstraints): this;
    order(label: ScheduleLabel, system: SystemFn, constraints: SystemConstraints): this;
    /** Sequential reference executor (Phase 4). */
    run(label: ScheduleLabel, world: World): void;
    /**
     * Parallel-aware async run. Uses ParallelExecutor when set; otherwise
     * behaves like sequential `run`.
     */
    runAsync(label: ScheduleLabel, world: World): Promise<void>;
    systems(label: ScheduleLabel): readonly SystemFn[];
    plan(label: ScheduleLabel): ExecutionPlan;
    inspect(): Record<string, number>;
    private compile;
}
//# sourceMappingURL=schedule.d.ts.map