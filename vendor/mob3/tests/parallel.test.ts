import { describe, expect, it } from "vitest";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import {
  App,
  Update,
  FixedUpdate,
  component,
  resource,
  event,
  workerSystem,
  system,
  workersSupported,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const handlersUrl = pathToFileURL(
  path.resolve(__dirname, "fixtures/handlers.mjs"),
).href;

const handlers = await import(handlersUrl);

const CompX = component({ v: 0 }, "CompX");
const CompY = component({ v: 0 }, "CompY");
const CompZ = component({ v: 0 }, "CompZ");
const CompC = component({ v: 0 }, "CompC");
const Position = component({ x: 0, y: 0, z: 0 }, "Position");
const Velocity = component({ x: 0, y: 0, z: 0 }, "Velocity");
const SlotA = component({ v: 0 }, "SlotA");
const SlotB = component({ v: 0 }, "SlotB");
const SlotC = component({ v: 0 }, "SlotC");
const TimeRes = resource<{ delta: number }>("Time");
const TickEvent = event<{ from: string }>("TickEvent");

function snapshotNumeric(app: App) {
  const rows: Array<Record<string, number>> = [];
  for (const [e, p, v] of app.world.query(Position, Velocity)) {
    rows.push({
      e,
      px: p.x,
      py: p.y,
      pz: p.z,
      vx: v.x,
      vy: v.y,
      vz: v.z,
    });
  }
  rows.sort((a, b) => a.e - b.e);
  return rows;
}

describe("Phase 5 parallel execution", () => {
  it("reports workers supported in Node", () => {
    expect(workersSupported()).toBe(true);
  });

  it("batch: A,B then C sees both commits", async () => {
    const sysA = workerSystem({
      name: "writeY",
      module: handlersUrl,
      export: "writeY",
      run: handlers.writeY,
      access: { read: [CompX], write: [CompY] },
    });
    const sysB = workerSystem({
      name: "writeZ",
      module: handlersUrl,
      export: "writeZ",
      run: handlers.writeZ,
      access: { read: [CompX], write: [CompZ] },
    });
    const sysC = workerSystem({
      name: "readYZ",
      module: handlersUrl,
      export: "readYZ",
      run: handlers.readYZ,
      access: { read: [CompY, CompZ], write: [CompC] },
    });

    const app = new App({ parallel: { workers: 2 } })
      .addSystem(Update, sysA, { before: sysC })
      .addSystem(Update, sysB, { before: sysC })
      .addSystem(Update, sysC);

    app.world.spawn(CompX({ v: 5 }), CompY(), CompZ(), CompC());

    const plan = app.inspectSchedule(Update);
    expect(plan.batches.length).toBeGreaterThanOrEqual(2);

    await app.updateAsync(1 / 60);

    const c = [...app.world.query(CompC)][0]![1];
    expect(c.v).toBe(33);

    app.dispose();
  });

  it("sequential vs parallel determinism over many ticks", async () => {
    const N = 200;
    const TICKS = 200;

    function build(parallel: boolean) {
      const integrate = workerSystem({
        name: "heavyIntegrate",
        module: handlersUrl,
        export: "heavyIntegrate",
        run: handlers.heavyIntegrate,
        access: {
          read: [Velocity],
          write: [Position],
          resources: { read: [TimeRes] },
        },
      });
      const damp = workerSystem({
        name: "scaleVelocity",
        module: handlersUrl,
        export: "scaleVelocity",
        run: handlers.scaleVelocity,
        access: { write: [Velocity] },
      });
      const app = parallel
        ? new App({ parallel: { workers: 2 } })
        : new App();
      app.insertResource(TimeRes, { delta: 1 / 60 });
      app.addSystem(FixedUpdate, integrate);
      app.addSystem(FixedUpdate, damp);
      for (let i = 0; i < N; i++) {
        app.world.spawn(
          Position({ x: i * 0.01, y: 0, z: -i * 0.02 }),
          Velocity({ x: 1, y: 0.5, z: -0.25 }),
        );
      }
      return app;
    }

    const seq = build(false);
    const par = build(true);
    expect(par.parallelExecutor?.usingWorkers).toBe(true);

    for (let t = 0; t < TICKS; t++) {
      seq.update(1 / 60);
      await par.updateAsync(1 / 60);
    }

    expect(snapshotNumeric(par)).toEqual(snapshotNumeric(seq));
    seq.dispose();
    par.dispose();
  });

  it("10k-tick determinism on smaller world", async () => {
    const N = 40;
    const TICKS = 10_000;

    function build(parallel: boolean) {
      const integrate = workerSystem({
        name: "heavyIntegrate",
        module: handlersUrl,
        export: "heavyIntegrate",
        run: handlers.heavyIntegrate,
        access: {
          read: [Velocity],
          write: [Position],
          resources: { read: [TimeRes] },
        },
      });
      const damp = workerSystem({
        name: "scaleVelocity",
        module: handlersUrl,
        export: "scaleVelocity",
        run: handlers.scaleVelocity,
        access: { write: [Velocity] },
      });
      const app = parallel
        ? new App({ parallel: { workers: 2 } })
        : new App();
      app.insertResource(TimeRes, { delta: 1 / 60 });
      app.addSystem(FixedUpdate, integrate);
      app.addSystem(FixedUpdate, damp);
      for (let i = 0; i < N; i++) {
        app.world.spawn(
          Position({ x: i, y: i * 0.5, z: 0 }),
          Velocity({ x: 0.1, y: 0.2, z: 0.3 }),
        );
      }
      return app;
    }

    const seq = build(false);
    const par = build(true);

    for (let t = 0; t < TICKS; t++) {
      seq.update(1 / 60);
      await par.updateAsync(1 / 60);
    }

    expect(snapshotNumeric(par)).toEqual(snapshotNumeric(seq));
    seq.dispose();
    par.dispose();
  }, 180_000);

  it("completion order does not affect commits or events", async () => {
    const orders: string[][] = [];

    for (let trial = 0; trial < 8; trial++) {
      const delays = [
        5 + (trial % 3) * 4,
        1 + ((trial + 1) % 3) * 5,
        8 + ((trial + 2) % 3) * 3,
      ];
      const seen: string[] = [];
      const a = workerSystem({
        name: `delayA_${trial}`,
        module: handlersUrl,
        export: "delayA",
        run: handlers.delayA,
        access: {
          write: [SlotA],
          events: { write: [TickEvent] },
        },
        delayMs: delays[0],
      });
      const b = workerSystem({
        name: `delayB_${trial}`,
        module: handlersUrl,
        export: "delayB",
        run: handlers.delayB,
        access: {
          write: [SlotB],
          events: { write: [TickEvent] },
        },
        delayMs: delays[1],
      });
      const c = workerSystem({
        name: `delayC_${trial}`,
        module: handlersUrl,
        export: "delayC",
        run: handlers.delayC,
        access: {
          write: [SlotC],
          events: { write: [TickEvent] },
        },
        delayMs: delays[2],
      });
      const capture = system({
        name: "capture",
        access: { events: { read: [TickEvent] } },
        run(world) {
          for (const e of world.events(TickEvent)) seen.push(e.from);
        },
      });

      const app = new App({ parallel: { workers: 3 } })
        .addSystem(Update, a)
        .addSystem(Update, b)
        .addSystem(Update, c)
        .addSystem(Update, capture, { after: [a, b, c] });

      app.world.spawn(SlotA({ v: 0 }), SlotB({ v: 0 }), SlotC({ v: 0 }));
      await app.updateAsync(1 / 60);

      const [, sa] = [...app.world.query(SlotA)][0]!;
      const [, sb] = [...app.world.query(SlotB)][0]!;
      const [, sc] = [...app.world.query(SlotC)][0]!;
      expect(sa.v).toBe(1);
      expect(sb.v).toBe(10);
      expect(sc.v).toBe(100);
      expect(seen).toEqual(["A", "B", "C"]);
      orders.push([...seen]);
      app.dispose();
    }

    for (const o of orders) expect(o).toEqual(["A", "B", "C"]);
  }, 60_000);

  it("rejects undeclared worker writes before commit", async () => {
    const liar = workerSystem({
      name: "liar",
      module: handlersUrl,
      export: "lieAboutWrites",
      run: handlers.lieAboutWrites,
      access: { read: [Position], write: [Velocity] },
    });
    const app = new App({ parallel: { workers: 1 } }).addSystem(Update, liar);
    app.world.spawn(
      Position({ x: 1, y: 2, z: 3 }),
      Velocity({ x: 4, y: 5, z: 6 }),
    );

    await expect(app.updateAsync(1 / 60)).rejects.toThrow(
      /undeclared write to Position/,
    );

    const [, p] = [...app.world.query(Position)][0]!;
    expect(p.x).toBe(1);
    app.dispose();
  });

  it("dispose terminates workers and allows recreate", async () => {
    for (let i = 0; i < 5; i++) {
      const damp = workerSystem({
        name: `damp_${i}`,
        module: handlersUrl,
        export: "scaleVelocity",
        run: handlers.scaleVelocity,
        access: { write: [Velocity] },
      });
      const app = new App({ parallel: { workers: 2 } }).addSystem(Update, damp);
      app.world.spawn(Velocity({ x: 1, y: 1, z: 1 }));
      await app.updateAsync(1 / 60);
      app.dispose();
      expect(app.isDisposed).toBe(true);
    }
  });

  it("plain systems still run on main inside parallel executor", async () => {
    let ran = false;
    const damp = workerSystem({
      name: "scaleVelocity",
      module: handlersUrl,
      export: "scaleVelocity",
      run: handlers.scaleVelocity,
      access: { write: [Velocity] },
    });
    const mainSys = system({
      name: "flag",
      access: { read: [Velocity] },
      run() {
        ran = true;
      },
    });
    const app = new App({ parallel: { workers: 2 } })
      .addSystem(Update, damp)
      .addSystem(Update, mainSys);
    app.world.spawn(Velocity({ x: 2, y: 2, z: 2 }));
    await app.updateAsync(1 / 60);
    expect(ran).toBe(true);
    const [, v] = [...app.world.query(Velocity)][0]!;
    expect(v.x).toBeCloseTo(1.98);
    app.dispose();
  });

  it("update() remains sequential reference even with parallel configured", () => {
    const damp = workerSystem({
      name: "scaleVelocity",
      module: handlersUrl,
      export: "scaleVelocity",
      run: handlers.scaleVelocity,
      access: { write: [Velocity] },
    });
    const app = new App({ parallel: { workers: 2 } }).addSystem(Update, damp);
    app.world.spawn(Velocity({ x: 1, y: 0, z: 0 }));
    app.update(1 / 60);
    const [, v] = [...app.world.query(Velocity)][0]!;
    expect(v.x).toBeCloseTo(0.99);
    app.dispose();
  });
});
