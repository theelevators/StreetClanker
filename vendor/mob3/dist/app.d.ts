import { World } from "./world.js";
import { Schedule, Startup, PreUpdate, FixedUpdate, Update, PostUpdate, PreRender, Render, PostRender, type ScheduleLabel, type SystemFn, type SystemConstraints } from "./schedule.js";
import { type PluginFactory } from "./plugin.js";
import type { ResourceKey } from "./resource.js";
import { type ParallelExecutor, type ParallelExecutorOptions } from "./parallel/executor.js";
import { type WasmMemoryArenaOptions } from "./storage/wasm_memory.js";
export type AppRunner = (app: App) => void | Promise<void>;
export type AppOptions = {
    /**
     * Enable Phase 5 parallel batch execution.
     * Use `updateAsync` / async runner when set.
     */
    parallel?: boolean | ParallelExecutorOptions;
    /**
     * Opt-in WasmMemoryArena for `backing: "wasm"` packed stores (Phase 8).
     */
    wasmArena?: boolean | WasmMemoryArenaOptions;
};
/**
 * Ergonomic composition layer over World + Scheduler.
 */
export declare class App {
    readonly world: World;
    readonly schedule: Schedule;
    private runner;
    private started;
    private disposed;
    private plugins;
    private disposeHooks;
    private parallel;
    private frameLock;
    /** @internal */
    _rafId: number | null;
    constructor(options?: AppOptions);
    get isDisposed(): boolean;
    get hasParallelExecutor(): boolean;
    get parallelExecutor(): ParallelExecutor | null;
    setParallelExecutor(executor: ParallelExecutor | null): this;
    addPlugin(plugin: PluginFactory): this;
    addSystem(label: ScheduleLabel, system: SystemFn, constraints?: SystemConstraints): this;
    order(label: ScheduleLabel, system: SystemFn, constraints: SystemConstraints): this;
    insertResource<T>(key: ResourceKey<T>, value: T): this;
    setRunner(runner: AppRunner): this;
    setFixedDelta(seconds: number): this;
    onDispose(fn: (app: App) => void): this;
    enableDiagnostics(options?: {
        timings?: boolean;
        strict?: boolean;
    }): this;
    inspectSchedule(label: ScheduleLabel): import("./execution_plan.js").ExecutionPlan;
    /** Synchronous frame — always uses the sequential executor. */
    update(deltaSeconds: number): void;
    /**
     * Async frame. When a parallel executor is configured, worker batches run
     * concurrently; otherwise identical to `update`.
     */
    updateAsync(deltaSeconds: number): Promise<void>;
    run(): this;
    stop(): void;
    dispose(): void;
    private assertNotDisposed;
    private ensureStartupSync;
    private ensureStartupAsync;
    private advanceTime;
}
export { Startup, PreUpdate, FixedUpdate, Update, PostUpdate, PreRender, Render, PostRender, };
//# sourceMappingURL=app.d.ts.map