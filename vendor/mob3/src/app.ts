import { World } from "./world.js";
import {
  Schedule,
  Startup,
  PreUpdate,
  FixedUpdate,
  Update,
  PostUpdate,
  PreRender,
  Render,
  PostRender,
  type ScheduleLabel,
  type SystemFn,
  type SystemConstraints,
} from "./schedule.js";
import { normalizePlugin, type Plugin, type PluginFactory } from "./plugin.js";
import { Time, createTime, MAX_DELTA, type TimeData } from "./time.js";
import type { ResourceKey } from "./resource.js";
import {
  parallelExecutor,
  type ParallelExecutor,
  type ParallelExecutorOptions,
} from "./parallel/executor.js";
import {
  WasmMemoryArena,
  type WasmMemoryArenaOptions,
} from "./storage/wasm_memory.js";
import { transformPropagation } from "./transform_propagate.js";

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

function browserRunner(app: App): void {
  let last = performance.now();
  let busy = false;
  const frame = async (now: number) => {
    if (app.isDisposed) return;
    if (busy) {
      app._rafId = requestAnimationFrame(frame);
      return;
    }
    const dt = (now - last) / 1000;
    last = now;
    busy = true;
    try {
      if (app.hasParallelExecutor) {
        await app.updateAsync(dt);
      } else {
        app.update(dt);
      }
    } finally {
      busy = false;
    }
    if (!app.isDisposed) {
      app._rafId = requestAnimationFrame(frame);
    }
  };
  app._rafId = requestAnimationFrame(frame);
}

/**
 * Ergonomic composition layer over World + Scheduler.
 */
export class App {
  readonly world: World = new World();
  readonly schedule: Schedule = new Schedule();

  private runner: AppRunner = browserRunner;
  private started = false;
  private disposed = false;
  private plugins: Plugin[] = [];
  private disposeHooks: Array<(app: App) => void> = [];
  private parallel: ParallelExecutor | null = null;
  private frameLock = false;
  /** @internal */
  _rafId: number | null = null;

  constructor(options: AppOptions = {}) {
    this.world.insertResource(Time, createTime());
    this.addSystem(PostUpdate, transformPropagation);
    if (options.wasmArena) {
      const opts =
        options.wasmArena === true
          ? ({ initialPages: 64, maxPages: 1024, shared: true } satisfies WasmMemoryArenaOptions)
          : options.wasmArena;
      this.world.setWasmArena(new WasmMemoryArena(opts));
    }
    if (options.parallel) {
      const opts =
        options.parallel === true ? {} : (options.parallel as ParallelExecutorOptions);
      this.setParallelExecutor(parallelExecutor(opts));
    }
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get hasParallelExecutor(): boolean {
    return this.parallel !== null;
  }

  get parallelExecutor(): ParallelExecutor | null {
    return this.parallel;
  }

  setParallelExecutor(executor: ParallelExecutor | null): this {
    this.assertNotDisposed();
    this.parallel?.dispose();
    this.parallel = executor;
    this.schedule.setParallelExecutor(executor);
    return this;
  }

  addPlugin(plugin: PluginFactory): this {
    this.assertNotDisposed();
    const normalized = normalizePlugin(plugin);
    this.plugins.push(normalized);
    normalized.build(this);
    return this;
  }

  addSystem(
    label: ScheduleLabel,
    system: SystemFn,
    constraints?: SystemConstraints,
  ): this {
    this.assertNotDisposed();
    this.schedule.addSystem(label, system, constraints);
    return this;
  }

  order(
    label: ScheduleLabel,
    system: SystemFn,
    constraints: SystemConstraints,
  ): this {
    this.assertNotDisposed();
    this.schedule.order(label, system, constraints);
    return this;
  }

  insertResource<T>(key: ResourceKey<T>, value: T): this {
    this.assertNotDisposed();
    this.world.insertResource(key, value);
    return this;
  }

  setRunner(runner: AppRunner): this {
    this.assertNotDisposed();
    this.runner = runner;
    return this;
  }

  setFixedDelta(seconds: number): this {
    this.world.resource(Time).fixedDelta = seconds;
    return this;
  }

  onDispose(fn: (app: App) => void): this {
    this.disposeHooks.push(fn);
    return this;
  }

  enableDiagnostics(
    options: { timings?: boolean; strict?: boolean } = {},
  ): this {
    this.schedule.enableTimings(options.timings ?? true);
    if (options.strict !== undefined) {
      this.schedule.enableStrict(options.strict);
    }
    return this;
  }

  inspectSchedule(label: ScheduleLabel) {
    return this.schedule.plan(label);
  }

  /** Synchronous frame — always uses the sequential executor. */
  update(deltaSeconds: number): void {
    this.assertNotDisposed();
    this.world.beginFrame();
    this.ensureStartupSync();

    const time = this.world.resource(Time);
    this.advanceTime(time, deltaSeconds);

    this.schedule.run(PreUpdate, this.world);

    time.fixedAccumulator += time.delta;
    const frameDelta = time.delta;
    let steps = 0;
    const maxSteps = 5;
    while (time.fixedAccumulator >= time.fixedDelta && steps < maxSteps) {
      this.world.clearEvents();
      time.delta = time.fixedDelta;
      this.schedule.run(FixedUpdate, this.world);
      time.fixedAccumulator -= time.fixedDelta;
      steps++;
    }
    if (steps === maxSteps) {
      time.fixedAccumulator = 0;
    }
    time.delta = frameDelta;

    this.schedule.run(Update, this.world);
    this.schedule.run(PostUpdate, this.world);
    this.schedule.run(PreRender, this.world);
    this.schedule.run(Render, this.world);
    this.schedule.run(PostRender, this.world);

    this.world.clearEvents();
  }

  /**
   * Async frame. When a parallel executor is configured, worker batches run
   * concurrently; otherwise identical to `update`.
   */
  async updateAsync(deltaSeconds: number): Promise<void> {
    this.assertNotDisposed();
    if (this.frameLock) {
      throw new Error("App.updateAsync: overlapping frames are not allowed");
    }
    this.frameLock = true;
    try {
      this.world.beginFrame();
      await this.ensureStartupAsync();

      const time = this.world.resource(Time);
      this.advanceTime(time, deltaSeconds);

      await this.schedule.runAsync(PreUpdate, this.world);

      time.fixedAccumulator += time.delta;
      const frameDelta = time.delta;
      let steps = 0;
      const maxSteps = 5;
      while (time.fixedAccumulator >= time.fixedDelta && steps < maxSteps) {
        this.world.clearEvents();
        time.delta = time.fixedDelta;
        await this.schedule.runAsync(FixedUpdate, this.world);
        time.fixedAccumulator -= time.fixedDelta;
        steps++;
      }
      if (steps === maxSteps) {
        time.fixedAccumulator = 0;
      }
      time.delta = frameDelta;

      await this.schedule.runAsync(Update, this.world);
      await this.schedule.runAsync(PostUpdate, this.world);
      await this.schedule.runAsync(PreRender, this.world);
      await this.schedule.runAsync(Render, this.world);
      await this.schedule.runAsync(PostRender, this.world);

      this.world.clearEvents();
    } finally {
      this.frameLock = false;
    }
  }

  run(): this {
    this.assertNotDisposed();
    void this.ensureStartupAsync().then(() => this.runner(this));
    return this;
  }

  stop(): void {
    if (this._rafId !== null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.parallel?.dispose();
    this.parallel = null;
    this.schedule.setParallelExecutor(null);
    for (let i = this.plugins.length - 1; i >= 0; i--) {
      this.plugins[i]!.dispose?.(this);
    }
    for (let i = this.disposeHooks.length - 1; i >= 0; i--) {
      this.disposeHooks[i]!(this);
    }
    this.disposeHooks.length = 0;
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("App has been disposed");
    }
  }

  private ensureStartupSync(): void {
    if (this.started) return;
    this.started = true;
    this.schedule.run(Startup, this.world);
  }

  private async ensureStartupAsync(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.schedule.runAsync(Startup, this.world);
  }

  private advanceTime(time: TimeData, deltaSeconds: number): void {
    time.rawDelta = deltaSeconds;
    time.delta = Math.min(Math.max(deltaSeconds, 0), MAX_DELTA);
    time.elapsed += time.delta;
  }
}

export {
  Startup,
  PreUpdate,
  FixedUpdate,
  Update,
  PostUpdate,
  PreRender,
  Render,
  PostRender,
};
