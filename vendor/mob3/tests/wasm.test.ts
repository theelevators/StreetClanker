import { describe, expect, it } from "vitest";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import {
  App,
  World,
  FixedUpdate,
  packedComponent,
  f32,
  wasmSystem,
  warmWasmSystem,
  getWasmMeta,
  ensureWasmExecutor,
  InProcessAbiExecutor,
  buildSystemInvocation,
  AbiIdRegistry,
  WasmMemoryArena,
  sharedWasmMemoryAvailable,
  webAssemblyAvailable,
  normalizeAccess,
  formatExecutionPlan,
  Time,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmUrl = pathToFileURL(
  path.resolve(__dirname, "fixtures/wasm/integrate.wasm"),
).href;
const trapUrl = pathToFileURL(
  path.resolve(__dirname, "fixtures/wasm/trap.wasm"),
).href;
const badAbiUrl = pathToFileURL(
  path.resolve(__dirname, "fixtures/wasm/bad_abi.wasm"),
).href;
const f32Fallback = await import(
  pathToFileURL(path.resolve(__dirname, "fixtures/abi_integrate_f32.mjs")).href
);

const EXPECTS = [
  {
    name: "Transform",
    fields: [
      { name: "x", type: "f32" as const },
      { name: "y", type: "f32" as const },
      { name: "z", type: "f32" as const },
    ],
  },
  {
    name: "Velocity",
    fields: [
      { name: "x", type: "f32" as const },
      { name: "y", type: "f32" as const },
      { name: "z", type: "f32" as const },
    ],
  },
];

const TOL = 1e-5;
function nearly(a: number, b: number, tol = TOL) {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
}

describe("Phase 8 WASM executor", () => {
  it("spike: JS and WASM share WebAssembly.Memory with zero copies", async () => {
    if (!sharedWasmMemoryAvailable()) return;
    const memory = new WebAssembly.Memory({
      initial: 1,
      maximum: 1,
      shared: true,
    });
    const view = new Float32Array(memory.buffer, 0, 4);
    view.set([1, 2, 3, 4]);
    const bytes = await (
      await import("node:fs/promises")
    ).readFile(path.resolve(__dirname, "fixtures/wasm/double.wasm"));
    const inst = await WebAssembly.instantiate(bytes, { env: { memory } });
    (inst.instance.exports.go as (b: number, n: number) => void)(0, 4);
    expect([...view]).toEqual([2, 4, 6, 8]);
    expect(view.buffer).toBe(memory.buffer);
  });

  it("rejects unsupported ABI version from WASM module", async () => {
    if (!sharedWasmMemoryAvailable()) return;
    const world = new World();
    world.setWasmArena(new WasmMemoryArena({ initialPages: 4, maxPages: 16 }));
    const Transform = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Transform", shared: true, capacity: 10, backing: "wasm" },
    );
    const Velocity = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Velocity", shared: true, capacity: 10, backing: "wasm" },
    );
    world.spawn(Transform(), Velocity());

    const sys = wasmSystem({
      name: "bad",
      module: badAbiUrl,
      access: { read: [Velocity], write: [Transform] },
      expects: EXPECTS,
      mode: "required",
    });
    const meta = getWasmMeta(sys)!;
    const ex = ensureWasmExecutor(meta, world);
    await expect(ex.ensureReady()).rejects.toThrow(/ABI v2/);
  });

  it("surfaces WASM traps", async () => {
    if (!sharedWasmMemoryAvailable()) return;
    const Transform = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Transform", shared: true, capacity: 8, backing: "wasm" },
    );
    const Velocity = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Velocity", shared: true, capacity: 8, backing: "wasm" },
    );
    const app = new App({ wasmArena: { initialPages: 4, maxPages: 16 } });
    const sys = wasmSystem({
      name: "trap",
      module: trapUrl,
      access: { read: [Velocity], write: [Transform] },
      expects: EXPECTS,
      mode: "required",
    });
    app.setFixedDelta(1 / 60);
    app.addSystem(FixedUpdate, sys);
    app.world.spawn(Transform({ x: 1 }), Velocity({ x: 1 }));
    await warmWasmSystem(app.world, getWasmMeta(sys)!);
    expect(() => app.update(1 / 60)).toThrow(/unreachable|failed|trap/i);
    app.dispose();
  });

  it("100k: JS ABI InProcess ≡ WASM shared (f32 tolerance)", async () => {
    if (!sharedWasmMemoryAvailable() || !webAssemblyAvailable()) return;

    const N = 100_000;
    const ticks = 5;
    const dt = 1 / 60;
    const pages = Math.ceil(((N + 10) * 4 * 3 * 2 + 4096) / 65536) + 8;

    const TransformW = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Transform", shared: true, capacity: N + 10, backing: "wasm" },
    );
    const VelocityW = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Velocity", shared: true, capacity: N + 10, backing: "wasm" },
    );

    const appW = new App({
      wasmArena: { initialPages: pages, maxPages: pages + 64, shared: true },
    });
    appW.setFixedDelta(dt);
    const wsys = wasmSystem({
      name: "integrate",
      module: wasmUrl,
      access: { read: [VelocityW], write: [TransformW] },
      expects: EXPECTS,
      mode: "required",
    });
    appW.addSystem(FixedUpdate, wsys);
    for (let i = 0; i < N; i++) {
      appW.world.spawn(
        TransformW({ x: i * 0.001, y: 1, z: 0 }),
        VelocityW({ x: 1, y: 0.5, z: -0.25 }),
      );
    }
    await warmWasmSystem(appW.world, getWasmMeta(wsys)!);
    for (let t = 0; t < ticks; t++) appW.update(dt);

    const TransformJ = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Transform", shared: true, capacity: N + 10, backing: "wasm" },
    );
    const VelocityJ = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Velocity", shared: true, capacity: N + 10, backing: "wasm" },
    );
    const appJ = new App({
      wasmArena: { initialPages: pages, maxPages: pages + 64, shared: true },
    });
    const ids = new AbiIdRegistry();
    const access = normalizeAccess(
      { read: [VelocityJ], write: [TransformJ] },
      false,
    );
    const exec = new InProcessAbiExecutor({
      resolve: () => f32Fallback.integrateJs,
    });
    for (let i = 0; i < N; i++) {
      appJ.world.spawn(
        TransformJ({ x: i * 0.001, y: 1, z: 0 }),
        VelocityJ({ x: 1, y: 0.5, z: -0.25 }),
      );
    }
    for (let t = 0; t < ticks; t++) {
      const r = await exec.execute(
        buildSystemInvocation({
          world: appJ.world,
          systemName: "integrate",
          access,
          tick: t,
          delta: dt,
          scheduleName: "FixedUpdate",
          preferShared: true,
          ids,
        }),
      );
      expect(r.status).toBe("ok");
    }

    const col = (world: World, C: typeof TransformW, f: string) => {
      const s = world.ensureStorage(C) as {
        column(n: string): Float32Array;
        size: number;
      };
      return s.column(f).subarray(0, s.size);
    };
    const ax = col(appW.world, TransformW, "x");
    const bx = col(appJ.world, TransformJ, "x");
    expect(ax.length).toBe(N);
    for (let i = 0; i < N; i++) nearly(ax[i]!, bx[i]!);

    const store = appW.world.ensureStorage(TransformW) as {
      sharedBuffer: SharedArrayBuffer;
      wasmMemory: WebAssembly.Memory | null;
      isWasmBacked: boolean;
    };
    expect(store.isWasmBacked).toBe(true);
    expect(store.sharedBuffer).toBe(store.wasmMemory!.buffer);

    appW.dispose();
    appJ.dispose();
    exec.dispose();
  });

  it("10k-tick determinism: f32 JS ≡ WASM", async () => {
    if (!sharedWasmMemoryAvailable()) return;
    const N = 40;
    const dt = 1 / 60;

    const TW = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Transform", shared: true, capacity: 100, backing: "wasm" },
    );
    const VW = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Velocity", shared: true, capacity: 100, backing: "wasm" },
    );
    const wasmApp = new App({ wasmArena: { initialPages: 8, maxPages: 32 } });
    wasmApp.setFixedDelta(dt);
    const wsys = wasmSystem({
      name: "integrate",
      module: wasmUrl,
      access: { read: [VW], write: [TW] },
      expects: EXPECTS,
      mode: "required",
    });
    wasmApp.addSystem(FixedUpdate, wsys);
    for (let i = 0; i < N; i++) {
      wasmApp.world.spawn(TW({ x: i }), VW({ x: 0.01 }));
    }
    await warmWasmSystem(wasmApp.world, getWasmMeta(wsys)!);

    const TJ = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Transform", shared: true, capacity: 100, backing: "wasm" },
    );
    const VJ = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Velocity", shared: true, capacity: 100, backing: "wasm" },
    );
    const jsWorld = new World();
    jsWorld.setWasmArena(new WasmMemoryArena({ initialPages: 8, maxPages: 32 }));
    jsWorld.insertResource(Time, {
      delta: dt,
      elapsed: 0,
      fixedDelta: dt,
      fixedAccumulator: 0,
      rawDelta: dt,
    });
    const ids = new AbiIdRegistry();
    const access = normalizeAccess({ read: [VJ], write: [TJ] }, false);
    const exec = new InProcessAbiExecutor({
      resolve: () => f32Fallback.integrateJs,
    });
    for (let i = 0; i < N; i++) {
      jsWorld.spawn(TJ({ x: i }), VJ({ x: 0.01 }));
    }

    for (let t = 0; t < 10_000; t++) {
      wasmApp.update(dt);
      jsWorld.resource(Time).delta = dt;
      jsWorld.resource(Time).elapsed += dt;
      await exec.execute(
        buildSystemInvocation({
          world: jsWorld,
          systemName: "integrate",
          access,
          tick: t,
          delta: dt,
          scheduleName: "FixedUpdate",
          preferShared: true,
          ids,
        }),
      );
    }

    const a = [...wasmApp.world.query(TW)].map(([, tr]) => tr.x);
    const b = [...jsWorld.query(TJ)].map(([, tr]) => tr.x);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) nearly(a[i]!, b[i]!);
    wasmApp.dispose();
    exec.dispose();
  });

  it("backend label does not alter conflict planning", () => {
    const Transform = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Transform", shared: true, capacity: 10, backing: "wasm" },
    );
    const Velocity = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Velocity", shared: true, capacity: 10, backing: "wasm" },
    );
    const app = new App({ wasmArena: true });
    const integrate = wasmSystem({
      name: "integrate",
      module: wasmUrl,
      access: { read: [Velocity], write: [Transform] },
      expects: EXPECTS,
      fallback: f32Fallback.integrateJs,
    });
    app.addSystem(FixedUpdate, integrate);
    app.addSystem(FixedUpdate, () => {});
    const plan = app.inspectSchedule(FixedUpdate);
    expect(plan.systems.find((s) => s.name === "integrate")?.backend).toBe(
      "wasm",
    );
    expect(formatExecutionPlan(plan)).toMatch(/backend: wasm/);
    app.dispose();
  });

  it("lifecycle: dispose prevents further execute", async () => {
    if (!sharedWasmMemoryAvailable()) return;
    const Transform = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Transform", shared: true, capacity: 8, backing: "wasm" },
    );
    const Velocity = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Velocity", shared: true, capacity: 8, backing: "wasm" },
    );
    const app = new App({ wasmArena: { initialPages: 4, maxPages: 16 } });
    const sys = wasmSystem({
      name: "integrate",
      module: wasmUrl,
      access: { read: [Velocity], write: [Transform] },
      expects: EXPECTS,
      mode: "required",
    });
    app.addSystem(FixedUpdate, sys);
    app.world.spawn(Transform(), Velocity({ x: 1 }));
    const meta = getWasmMeta(sys)!;
    await warmWasmSystem(app.world, meta);
    meta.executor!.dispose();
    meta.executor = null;
    expect(() => app.update(1 / 60)).toThrow(/not ready|disposed/);
    app.dispose();
  });

  it("mixed batch: wasm + main in one plan", async () => {
    if (!sharedWasmMemoryAvailable()) return;
    const Transform = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Transform", shared: true, capacity: 200, backing: "wasm" },
    );
    const Velocity = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Velocity", shared: true, capacity: 200, backing: "wasm" },
    );
    const app = new App({
      wasmArena: { initialPages: 16, maxPages: 64 },
      parallel: { workers: 2, dataPath: "shared" },
    });
    app.setFixedDelta(1 / 60);
    const integrate = wasmSystem({
      name: "integrate",
      module: wasmUrl,
      access: { read: [Velocity], write: [Transform] },
      expects: EXPECTS,
      mode: "required",
      placement: "worker",
    });
    let mainRan = false;
    app.addSystem(FixedUpdate, integrate);
    app.addSystem(FixedUpdate, () => {
      mainRan = true;
    });
    for (let i = 0; i < 50; i++) {
      app.world.spawn(Transform({ x: i }), Velocity({ x: 1 }));
    }
    await warmWasmSystem(app.world, getWasmMeta(integrate)!);
    await app.updateAsync(1 / 60);
    expect(mainRan).toBe(true);
    app.dispose();
  });
});
