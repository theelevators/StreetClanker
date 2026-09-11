import { describe, expect, it } from "vitest";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import {
  App,
  FixedUpdate,
  packedComponent,
  f32,
  resource,
  workerSystem,
  sharedArrayBufferAvailable,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const handlersUrl = pathToFileURL(
  path.resolve(__dirname, "fixtures/shared_handlers.mjs"),
).href;
const handlers = await import(handlersUrl);

const Position = packedComponent(
  { x: f32, y: f32, z: f32 },
  { name: "Position", shared: true, capacity: 50_000 },
);
const Velocity = packedComponent(
  { x: f32, y: f32, z: f32 },
  { name: "Velocity", shared: true, capacity: 50_000 },
);
const Heat = packedComponent(
  { v: f32 },
  { name: "Heat", shared: true, capacity: 50_000 },
);
const Wobble = packedComponent(
  { v: f32 },
  { name: "Wobble", shared: true, capacity: 50_000 },
);
const SimConfig = resource<{ work: number }>("SimConfig");

describe("shared parallel path", () => {
  it("runs independent shared systems without copy commit", async () => {
    if (!sharedArrayBufferAvailable()) {
      console.warn("SAB unavailable");
      return;
    }

    const force = workerSystem({
      name: "force",
      module: handlersUrl,
      export: "force",
      run: handlers.force,
      access: {
        read: [Position],
        write: [Velocity],
        resources: { read: [SimConfig] },
      },
    });
    const heat = workerSystem({
      name: "heat",
      module: handlersUrl,
      export: "heat",
      run: handlers.heat,
      access: {
        read: [Position],
        write: [Heat],
        resources: { read: [SimConfig] },
      },
    });
    const wobble = workerSystem({
      name: "wobble",
      module: handlersUrl,
      export: "wobble",
      run: handlers.wobble,
      access: {
        read: [Position],
        write: [Wobble],
        resources: { read: [SimConfig] },
      },
    });

    const app = new App({
      parallel: { workers: 2, dataPath: "shared" },
    });
    app.insertResource(SimConfig, { work: 20 });
    app.setFixedDelta(1 / 60);
    app.addSystem(FixedUpdate, force);
    app.addSystem(FixedUpdate, heat);
    app.addSystem(FixedUpdate, wobble);

    for (let i = 0; i < 100; i++) {
      app.world.spawn(
        Position({ x: i * 0.01, y: 1, z: 0 }),
        Velocity(),
        Heat({ v: 1 }),
        Wobble({ v: 1 }),
      );
    }

    await app.updateAsync(1 / 60);
    const timings = app.parallelExecutor?.lastBatchTimings() ?? [];
    expect(timings.some((t) => t.path === "shared")).toBe(true);

    // Heat should have decayed
    const [, h] = [...app.world.query(Heat)][0]!;
    expect(h.v).toBeLessThan(1);
    app.dispose();
  });

  it("shared vs sequential determinism", async () => {
    if (!sharedArrayBufferAvailable()) return;

    function build(parallel: boolean) {
      const force = workerSystem({
        name: "force",
        module: handlersUrl,
        export: "force",
        run: handlers.force,
        access: {
          read: [Position],
          write: [Velocity],
          resources: { read: [SimConfig] },
        },
      });
      const heat = workerSystem({
        name: "heat",
        module: handlersUrl,
        export: "heat",
        run: handlers.heat,
        access: {
          read: [Position],
          write: [Heat],
          resources: { read: [SimConfig] },
        },
      });
      const app = parallel
        ? new App({ parallel: { workers: 2, dataPath: "auto" } })
        : new App();
      app.insertResource(SimConfig, { work: 10 });
      app.setFixedDelta(1 / 60);
      app.addSystem(FixedUpdate, force);
      app.addSystem(FixedUpdate, heat);
      for (let i = 0; i < 50; i++) {
        app.world.spawn(
          Position({ x: i, y: i * 0.5, z: 0 }),
          Velocity({ x: 1, y: 0, z: 0 }),
          Heat({ v: 2 }),
          Wobble(),
        );
      }
      return app;
    }

    const seq = build(false);
    const par = build(true);
    for (let t = 0; t < 100; t++) {
      seq.update(1 / 60);
      await par.updateAsync(1 / 60);
    }

    const snap = (app: App) =>
      [...app.world.query(Position, Velocity, Heat)]
        .map(([e, p, v, h]) => ({
          e,
          px: p.x,
          vx: v.x,
          hv: h.v,
        }))
        .sort((a, b) => a.e - b.e);

    expect(snap(par)).toEqual(snap(seq));
    seq.dispose();
    par.dispose();
  });
});
