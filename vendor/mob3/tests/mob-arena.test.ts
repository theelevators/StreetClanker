import { describe, expect, it, beforeAll } from "vitest";
import { App, FixedUpdate } from "mob3";
import { SyntheticInputPlugin, setInputMap, Input } from "@mob3/input";
import {
  initRapier,
  RapierPlugin,
  physicsBodyCount,
} from "@mob3/rapier";
import { MobArenaPlugin } from "../../../examples/mob-arena/src/systems.ts";
import { snapshotOf } from "../../../examples/mob-arena/src/game.ts";
import { Enemy, Transform } from "../../../examples/mob-arena/src/components.ts";

beforeAll(async () => {
  await initRapier();
});

function runScripted(seed: number, ticks: number) {
  const app = new App()
    .addPlugin(SyntheticInputPlugin())
    .addPlugin(RapierPlugin({ gravity: { x: 0, y: 0, z: 0 } }))
    .addPlugin(MobArenaPlugin({ seed }));

  for (let i = 0; i < ticks; i++) {
    const phase = (i % 240) / 240;
    setInputMap(app.world, {
      KeyW: phase < 0.25,
      KeyD: phase >= 0.25 && phase < 0.5,
      KeyS: phase >= 0.5 && phase < 0.75,
      KeyA: phase >= 0.75,
      Space: i % 15 === 0,
    });
    app.update(1 / 60);
  }
  const snap = snapshotOf(app, seed);
  app.dispose();
  return snap;
}

describe("Mob Arena Phase 3", () => {
  it("runs headless without three", () => {
    const app = new App()
      .addPlugin(SyntheticInputPlugin())
      .addPlugin(RapierPlugin({ gravity: { x: 0, y: 0, z: 0 } }))
      .addPlugin(MobArenaPlugin({ seed: 1 }));
    for (let i = 0; i < 120; i++) app.update(1 / 60);
    const snap = snapshotOf(app, 1);
    expect(snap.tick).toBe(120);
    expect(snap.entities).toBeGreaterThan(0);
    app.dispose();
  });

  it("is deterministic for same seed + input", () => {
    const a = runScripted(42, 2000);
    const b = runScripted(42, 2000);
    expect(a).toEqual(b);
  });

  it("simulates enemies without ThreeObject", () => {
    const app = new App()
      .addPlugin(SyntheticInputPlugin())
      .addPlugin(RapierPlugin({ gravity: { x: 0, y: 0, z: 0 } }))
      .addPlugin(MobArenaPlugin({ seed: 3 }));
    for (let i = 0; i < 300; i++) app.update(1 / 60);
    let enemies = 0;
    for (const _ of app.world.query(Transform).with(Enemy)) enemies++;
    expect(enemies).toBeGreaterThan(0);
    app.dispose();
  });

  it("does not leak physics bodies under churn", () => {
    const app = new App()
      .addPlugin(SyntheticInputPlugin())
      .addPlugin(RapierPlugin({ gravity: { x: 0, y: 0, z: 0 } }))
      .addPlugin(MobArenaPlugin({ seed: 9 }));

    for (let i = 0; i < 600; i++) {
      setInputMap(app.world, { Space: i % 8 === 0, KeyW: true });
      app.update(1 / 60);
    }
    const bodies = physicsBodyCount(app.world);
    const entities = app.world.entityCount();
    // bodies should track living physics entities closely
    expect(bodies).toBeLessThanOrEqual(entities + 2);
    expect(bodies).toBeLessThan(80);
    app.dispose();
  });

  it("accepts MobArena before Rapier at addPlugin time", () => {
    const app = new App()
      .addPlugin(SyntheticInputPlugin())
      .addPlugin(MobArenaPlugin({ seed: 1 }))
      .addPlugin(RapierPlugin({ gravity: { x: 0, y: 0, z: 0 } }));
    app.update(1 / 60);
    expect(app.world.entityCount()).toBeGreaterThan(0);
    app.dispose();
  });
});

describe("App dispose", () => {
  it("is idempotent and blocks update after dispose", () => {
    const app = new App().addPlugin(SyntheticInputPlugin());
    app.dispose();
    app.dispose();
    expect(() => app.update(1 / 60)).toThrow(/disposed/);
  });
});

describe("Input transients", () => {
  it("exposes justPressed within a frame then clears", () => {
    const app = new App().addPlugin(SyntheticInputPlugin());
    const input = app.world.resource(Input);
    input.setPressed("Space", true);
    expect(input.justPressed("Space")).toBe(true);
    app.update(1 / 60);
    expect(input.justPressed("Space")).toBe(false);
    expect(input.pressed("Space")).toBe(true);
    app.dispose();
  });
});

describe("Schedule ordering", () => {
  it("respects before/after constraints", () => {
    const order: string[] = [];
    const a = () => {
      order.push("a");
    };
    const b = () => {
      order.push("b");
    };
    const c = () => {
      order.push("c");
    };
    const app = new App();
    // register c, a, b with constraints a before b before c conceptually:
    app.addSystem(FixedUpdate, c);
    app.addSystem(FixedUpdate, a, { before: b });
    app.addSystem(FixedUpdate, b, { before: c });
    app.update(1 / 60);
    expect(order).toEqual(["a", "b", "c"]);
    app.dispose();
  });
});
