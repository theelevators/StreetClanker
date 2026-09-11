import { describe, expect, it } from "vitest";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import {
  App,
  World,
  FixedUpdate,
  packedComponent,
  f32,
  i32,
  abiSystem,
  defineAbiSystem,
  InProcessAbiExecutor,
  buildSystemInvocation,
  AbiIdRegistry,
  AbiContext,
  ABI_VERSION,
  sharedArrayBufferAvailable,
  normalizeAccess,
} from "../src/index.js";
import { validateStoreSchema } from "../src/abi/context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const handlersUrl = pathToFileURL(
  path.resolve(__dirname, "fixtures/abi_handlers.mjs"),
).href;
const handlers = await import(handlersUrl);

const TOL = 1e-5;

function nearlyEqual(a: number, b: number, tol = TOL) {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
}

describe("Execution ABI v1", () => {
  it("rejects unsupported ABI version", () => {
    expect(() => {
      new AbiContext({
        abiVersion: 99 as 1,
        system: { id: 1, name: "x" },
        execution: { tick: 0, delta: 0, scheduleName: "s" },
        access: { reads: [], writes: [] },
        stores: [],
        resources: [],
      });
    }).toThrow(/Unsupported mob3 Execution ABI version 99/);
  });

  it("capability narrowing: invocation omits undeclared stores", () => {
    const Transform = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Transform", shared: true, capacity: 100 },
    );
    const Velocity = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Velocity", shared: true, capacity: 100 },
    );
    const Health = packedComponent(
      { v: f32 },
      { name: "Health", shared: true, capacity: 100 },
    );

    const world = new World();
    world.spawn(Transform({ x: 1 }), Velocity({ x: 2 }), Health({ v: 10 }));

    const access = normalizeAccess(
      { read: [Velocity], write: [Transform] },
      false,
    );
    const ids = new AbiIdRegistry();
    const inv = buildSystemInvocation({
      world,
      systemName: "integrate",
      access,
      tick: 0,
      delta: 1 / 60,
      scheduleName: "test",
      preferShared: true,
      ids,
    });

    expect(inv.stores.map((s) => s.name).sort()).toEqual([
      "Transform",
      "Velocity",
    ]);
    expect(inv.stores.find((s) => s.name === "Health")).toBeUndefined();

    const ctx = new AbiContext(inv);
    expect(ctx.storeNames().sort()).toEqual(["Transform", "Velocity"]);
    expect(() => ctx.writeByName("Velocity")).toThrow(/read-only/);
    expect(() => ctx.readByName("Health")).toThrow(/did not provide/);
  });

  it("schema mismatch rejects at bind", () => {
    const sys = defineAbiSystem({
      name: "needsZ",
      expects: [
        {
          name: "Transform",
          fields: [
            { name: "x", type: "f32" },
            { name: "y", type: "f32" },
            { name: "z", type: "f32" },
          ],
        },
      ],
      execute() {},
    });

    expect(() =>
      sys.bind?.({
        stores: [
          {
            id: 1,
            name: "Transform",
            generation: 0,
            fields: [
              { fieldId: 0, name: "x", type: "f32" },
              { fieldId: 1, name: "y", type: "f32" },
            ],
          },
        ],
      }),
    ).toThrow(/Transform\.z/);

    expect(() =>
      sys.bind?.({
        stores: [
          {
            id: 1,
            name: "Transform",
            generation: 0,
            fields: [
              { fieldId: 0, name: "x", type: "f32" },
              { fieldId: 1, name: "y", type: "f32" },
              { fieldId: 2, name: "z", type: "i32" },
            ],
          },
        ],
      }),
    ).toThrow(/as f32, got i32/);
  });

  it("no World on ABI context", () => {
    const ctx = new AbiContext({
      abiVersion: ABI_VERSION,
      system: { id: 1, name: "t" },
      execution: { tick: 0, delta: 0, scheduleName: "s" },
      access: { reads: [], writes: [] },
      stores: [],
      resources: [],
    });
    expect("world" in ctx).toBe(false);
    expect((ctx as unknown as { world?: unknown }).world).toBeUndefined();
    expect((ctx as unknown as { app?: unknown }).app).toBeUndefined();
    expect((ctx as unknown as { commands?: unknown }).commands).toBeUndefined();
  });

  it("InProcess vs JsWorker executor equivalence (shared)", async () => {
    if (!sharedArrayBufferAvailable()) return;

    const Transform = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Transform", shared: true, capacity: 120_000 },
    );
    const Velocity = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Velocity", shared: true, capacity: 120_000 },
    );

    const N = 10_000;
    const ticks = 50;

    function seed(world: World) {
      for (let i = 0; i < N; i++) {
        world.spawn(
          Transform({ x: i * 0.01, y: 1, z: 0 }),
          Velocity({ x: 1, y: 0.5, z: -0.25 }),
        );
      }
    }

    function snap(world: World) {
      const t = world.ensureStorage(Transform) as {
        column(n: string): Float32Array;
        size: number;
      };
      const v = world.ensureStorage(Velocity) as {
        column(n: string): Float32Array;
        size: number;
      };
      return {
        tx: Float32Array.from(t.column("x").subarray(0, t.size)),
        ty: Float32Array.from(t.column("y").subarray(0, t.size)),
        tz: Float32Array.from(t.column("z").subarray(0, t.size)),
        vx: Float32Array.from(v.column("x").subarray(0, v.size)),
      };
    }

    // --- InProcess ---
    const w1 = new World();
    seed(w1);
    const ids = new AbiIdRegistry();
    const access = normalizeAccess(
      { read: [Velocity], write: [Transform] },
      false,
    );
    const inProcess = new InProcessAbiExecutor({
      resolve: () => handlers.integrate,
    });
    for (let t = 0; t < ticks; t++) {
      const inv = buildSystemInvocation({
        world: w1,
        systemName: "integrate",
        access,
        tick: t,
        delta: 1 / 60,
        scheduleName: "FixedUpdate",
        preferShared: true,
        ids,
      });
      const r = await inProcess.execute(inv);
      expect(r.status).toBe("ok");
    }
    const s1 = snap(w1);

    // --- Worker shared via App ---
    const integrate = abiSystem({
      name: "integrate",
      module: handlersUrl,
      export: "integrate",
      system: handlers.integrate,
      access: { read: [Velocity], write: [Transform] },
    });
    const app = new App({
      parallel: { workers: 2, dataPath: "shared" },
    });
    app.setFixedDelta(1 / 60);
    app.addSystem(FixedUpdate, integrate);
    seed(app.world);
    for (let t = 0; t < ticks; t++) {
      await app.updateAsync(1 / 60);
    }
    const s2 = snap(app.world);

    expect(s1.tx.length).toBe(s2.tx.length);
    for (let i = 0; i < s1.tx.length; i++) {
      nearlyEqual(s1.tx[i]!, s2.tx[i]!);
      nearlyEqual(s1.ty[i]!, s2.ty[i]!);
      nearlyEqual(s1.tz[i]!, s2.tz[i]!);
    }

    const timings = app.parallelExecutor?.lastBatchTimings() ?? [];
    expect(timings.some((t) => t.path === "abi-shared")).toBe(true);

    app.dispose();
    inProcess.dispose();
  });

  it("determinism: sequential / in-process / worker copy / worker shared", async () => {
    if (!sharedArrayBufferAvailable()) return;

    const Transform = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Transform", shared: true, capacity: 5_000 },
    );
    const Velocity = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Velocity", shared: true, capacity: 5_000 },
    );

    const N = 200;
    const ticks = 200;

    function makeSystem() {
      return abiSystem({
        name: "integrate",
        module: handlersUrl,
        export: "integrate",
        system: handlers.integrate,
        access: { read: [Velocity], write: [Transform] },
      });
    }

    function seed(app: App) {
      for (let i = 0; i < N; i++) {
        app.world.spawn(
          Transform({ x: i, y: i * 0.5, z: 1 }),
          Velocity({ x: 0.1, y: -0.05, z: 0.02 }),
        );
      }
    }

    function snap(app: App) {
      return [...app.world.query(Transform, Velocity)]
        .map(([e, t, v]) => ({
          e,
          tx: t.x,
          ty: t.y,
          tz: t.z,
          vx: v.x,
        }))
        .sort((a, b) => a.e - b.e);
    }

    const seq = new App();
    seq.setFixedDelta(1 / 60);
    seq.addSystem(FixedUpdate, makeSystem());
    seed(seq);

    const copy = new App({
      parallel: { workers: 2, dataPath: "copy" },
    });
    copy.setFixedDelta(1 / 60);
    copy.addSystem(FixedUpdate, makeSystem());
    seed(copy);

    const shared = new App({
      parallel: { workers: 2, dataPath: "shared" },
    });
    shared.setFixedDelta(1 / 60);
    shared.addSystem(FixedUpdate, makeSystem());
    seed(shared);

    for (let t = 0; t < ticks; t++) {
      seq.update(1 / 60);
      await copy.updateAsync(1 / 60);
      await shared.updateAsync(1 / 60);
    }

    const a = snap(seq);
    const b = snap(copy);
    const c = snap(shared);
    expect(b.length).toBe(a.length);
    expect(c.length).toBe(a.length);
    for (let i = 0; i < a.length; i++) {
      nearlyEqual(a[i]!.tx, b[i]!.tx);
      nearlyEqual(a[i]!.tx, c[i]!.tx);
      nearlyEqual(a[i]!.ty, b[i]!.ty);
      nearlyEqual(a[i]!.tz, c[i]!.tz);
    }

    seq.dispose();
    copy.dispose();
    shared.dispose();
  });

  it("IDs stable across repeated plan compilation within App", async () => {
    const Transform = packedComponent(
      { x: f32 },
      { name: "Transform", shared: true, capacity: 100 },
    );
    const Velocity = packedComponent(
      { x: f32 },
      { name: "Velocity", shared: true, capacity: 100 },
    );
    const access = normalizeAccess(
      { read: [Velocity], write: [Transform] },
      false,
    );
    const world = new World();
    world.spawn(Transform({ x: 1 }), Velocity({ x: 2 }));
    const ids = new AbiIdRegistry();
    const a = buildSystemInvocation({
      world,
      systemName: "integrate",
      access,
      tick: 0,
      delta: 0,
      scheduleName: "s",
      preferShared: true,
      ids,
    });
    const b = buildSystemInvocation({
      world,
      systemName: "integrate",
      access,
      tick: 1,
      delta: 0,
      scheduleName: "s",
      preferShared: true,
      ids,
    });
    expect(a.system.id).toBe(b.system.id);
    expect(a.stores.map((s) => s.storeId)).toEqual(
      b.stores.map((s) => s.storeId),
    );
  });

  it("type mismatch i32 vs f32", () => {
    const store = {
      storeId: 1,
      componentId: 1,
      name: "T",
      generation: 0,
      count: 0,
      capacity: 1,
      memoryKind: "local" as const,
      fields: [
        {
          fieldId: 0,
          name: "x",
          type: "i32" as const,
          buffer: new ArrayBuffer(4),
          byteOffset: 0,
          length: 1,
        },
      ],
      entities: new Uint32Array(0),
    };
    expect(() =>
      validateStoreSchema(store, [{ name: "x", type: "f32" }], "sys"),
    ).toThrow(/expected f32, got i32/);
    void i32;
  });

  it("100k entity InProcess vs Worker shared field equality", async () => {
    if (!sharedArrayBufferAvailable()) return;

    const Transform = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Transform", shared: true, capacity: 120_000 },
    );
    const Velocity = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Velocity", shared: true, capacity: 120_000 },
    );

    const N = 100_000;
    const ticks = 10;

    function seed(world: World) {
      for (let i = 0; i < N; i++) {
        world.spawn(
          Transform({ x: i * 0.001, y: 1, z: 0 }),
          Velocity({ x: 1, y: 0.5, z: -0.25 }),
        );
      }
    }

    function columns(world: World) {
      const t = world.ensureStorage(Transform) as {
        column(n: string): Float32Array;
        size: number;
      };
      return {
        x: Float32Array.from(t.column("x").subarray(0, t.size)),
        y: Float32Array.from(t.column("y").subarray(0, t.size)),
        z: Float32Array.from(t.column("z").subarray(0, t.size)),
      };
    }

    const wIn = new World();
    seed(wIn);
    const ids = new AbiIdRegistry();
    const access = normalizeAccess(
      { read: [Velocity], write: [Transform] },
      false,
    );
    const exec = new InProcessAbiExecutor({
      resolve: () => handlers.integrate,
    });
    for (let t = 0; t < ticks; t++) {
      const r = await exec.execute(
        buildSystemInvocation({
          world: wIn,
          systemName: "integrate",
          access,
          tick: t,
          delta: 1 / 60,
          scheduleName: "FixedUpdate",
          preferShared: true,
          ids,
        }),
      );
      expect(r.status).toBe("ok");
    }
    const a = columns(wIn);

    const app = new App({ parallel: { workers: 2, dataPath: "shared" } });
    app.setFixedDelta(1 / 60);
    app.addSystem(
      FixedUpdate,
      abiSystem({
        name: "integrate",
        module: handlersUrl,
        export: "integrate",
        system: handlers.integrate,
        access: { read: [Velocity], write: [Transform] },
      }),
    );
    seed(app.world);
    for (let t = 0; t < ticks; t++) await app.updateAsync(1 / 60);
    const b = columns(app.world);

    expect(a.x.length).toBe(N);
    for (let i = 0; i < N; i++) {
      nearlyEqual(a.x[i]!, b.x[i]!);
      nearlyEqual(a.y[i]!, b.y[i]!);
      nearlyEqual(a.z[i]!, b.z[i]!);
    }
    app.dispose();
    exec.dispose();
  });

  it("10k-tick ABI determinism (seq vs shared worker)", async () => {
    if (!sharedArrayBufferAvailable()) return;

    const Transform = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Transform", shared: true, capacity: 500 },
    );
    const Velocity = packedComponent(
      { x: f32, y: f32, z: f32 },
      { name: "Velocity", shared: true, capacity: 500 },
    );

    function make() {
      return abiSystem({
        name: "integrate",
        module: handlersUrl,
        export: "integrate",
        system: handlers.integrate,
        access: { read: [Velocity], write: [Transform] },
      });
    }

    function build(parallel: boolean) {
      const app = parallel
        ? new App({ parallel: { workers: 2, dataPath: "shared" } })
        : new App();
      app.setFixedDelta(1 / 60);
      app.addSystem(FixedUpdate, make());
      for (let i = 0; i < 40; i++) {
        app.world.spawn(
          Transform({ x: i, y: 0, z: 0 }),
          Velocity({ x: 0.01, y: 0, z: 0 }),
        );
      }
      return app;
    }

    const seq = build(false);
    const par = build(true);
    for (let t = 0; t < 10_000; t++) {
      seq.update(1 / 60);
      await par.updateAsync(1 / 60);
    }
    const snap = (app: App) =>
      [...app.world.query(Transform)]
        .map(([e, tr]) => ({ e, x: tr.x }))
        .sort((a, b) => a.e - b.e);
    const a = snap(seq);
    const b = snap(par);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) nearlyEqual(a[i]!.x, b[i]!.x);
    seq.dispose();
    par.dispose();
  });
});
