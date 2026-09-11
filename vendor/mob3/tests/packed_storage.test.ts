import { describe, expect, it } from "vitest";
import {
  World,
  Commands,
  App,
  Update,
  component,
  tag,
  packedComponent,
  f32,
  i32,
  getPackedMeta,
  sharedArrayBufferAvailable,
} from "../src/index.js";

const Health = component({ value: 100 }, "Health");
const Enemy = tag("Enemy");
const Transform = packedComponent(
  { x: f32, y: f32, z: f32 },
  { name: "Transform" },
);
const Velocity = packedComponent(
  { x: f32, y: f32, z: f32 },
  { name: "Velocity" },
);

describe("packed storage", () => {
  it("spawns and mutates via write-through views", () => {
    const world = new World();
    const e = world.spawn(Transform({ x: 1, y: 2, z: 3 }), Velocity({ x: 0.5 }));
    const t = world.get(e, Transform)!;
    t.x += 10;
    expect(world.get(e, Transform)!.x).toBe(11);
    expect(getPackedMeta(Transform)?.fields).toEqual(["x", "y", "z"]);
  });

  it("does not promise view identity", () => {
    const world = new World();
    const e = world.spawn(Transform());
    const a = world.get(e, Transform);
    const b = world.get(e, Transform);
    // May or may not be === depending on pool; values must match
    expect(a!.x).toBe(b!.x);
    a!.x = 9;
    expect(b!.x).toBe(9); // write-through same slot if pooled differently still same store
  });

  it("supports mixed packed + object + tag queries", () => {
    const world = new World();
    world.spawn(Transform({ x: 1 }), Velocity({ x: 2 }), Health({ value: 50 }), Enemy);
    world.spawn(Transform({ x: 9 }), Health({ value: 1 })); // no Enemy

    let n = 0;
    for (const [, t, v, h] of world
      .query(Transform, Velocity, Health)
      .with(Enemy)) {
      expect(t.x).toBe(1);
      expect(v.x).toBe(2);
      expect(h.value).toBe(50);
      t.x += v.x;
      n++;
    }
    expect(n).toBe(1);
    const e = [...world.query(Transform).with(Enemy)][0]![0];
    expect(world.get(e, Transform)!.x).toBe(3);
  });

  it("swap-remove preserves mappings under churn", () => {
    const world = new World();
    const ids: number[] = [];
    for (let i = 0; i < 1000; i++) {
      ids.push(world.spawn(Transform({ x: i }), Velocity({ x: i * 2 })));
    }
    for (let i = 0; i < 500; i++) {
      world.despawn(ids[i * 2]!);
    }
    for (let i = 0; i < 500; i++) {
      ids.push(world.spawn(Transform({ x: -i }), Velocity({ x: -i })));
    }
    let count = 0;
    for (const [e, t, v] of world.query(Transform, Velocity)) {
      expect(world.isAlive(e)).toBe(true);
      expect(typeof t.x).toBe("number");
      expect(typeof v.x).toBe("number");
      count++;
    }
    expect(count).toBe(1000);
  });

  it("Commands work with mixed packed/object", () => {
    const world = new World();
    const commands = new Commands(world);
    const e = world.spawn(Transform({ x: 1 }), Health({ value: 10 }), Enemy);
    commands.remove(e, Health);
    commands.add(e, Velocity({ x: 3 }));
    commands.flush();
    expect(world.has(e, Health)).toBe(false);
    expect(world.get(e, Velocity)!.x).toBe(3);
    commands.despawn(e);
    commands.flush();
    expect(world.isAlive(e)).toBe(false);
  });

  it("aggressive churn stress", () => {
    const world = new World();
    let live: number[] = [];
    for (let round = 0; round < 20; round++) {
      while (live.length < 5000) {
        live.push(world.spawn(Transform({ x: live.length }), Velocity()));
      }
      // despawn ~50%
      const keep: number[] = [];
      for (let i = 0; i < live.length; i++) {
        if (i % 2 === 0) world.despawn(live[i]!);
        else keep.push(live[i]!);
      }
      live = keep;
      for (let i = 0; i < 2500; i++) {
        live.push(world.spawn(Transform({ x: i }), Velocity({ y: 1 })));
      }
    }
    expect(world.entityCount()).toBe(live.length);
    for (const e of live) expect(world.isAlive(e)).toBe(true);
    let q = 0;
    for (const _ of world.query(Transform, Velocity)) q++;
    expect(q).toBe(live.length);
  });
});

describe("shared packed storage", () => {
  it("creates shared store when SAB available", () => {
    if (!sharedArrayBufferAvailable()) {
      console.warn("SharedArrayBuffer unavailable — skipping");
      return;
    }
    const SharedT = packedComponent(
      { x: f32, y: f32 },
      { name: "SharedT", shared: true, capacity: 100 },
    );
    const world = new World();
    const e = world.spawn(SharedT({ x: 4, y: 5 }));
    expect(world.get(e, SharedT)!.x).toBe(4);
    world.get(e, SharedT)!.x = 8;
    expect(world.get(e, SharedT)!.x).toBe(8);
  });

  it("fails clearly when capacity exceeded", () => {
    if (!sharedArrayBufferAvailable()) return;
    const Tiny = packedComponent(
      { v: i32 },
      { name: "Tiny", shared: true, capacity: 2 },
    );
    const world = new World();
    world.spawn(Tiny({ v: 1 }));
    world.spawn(Tiny({ v: 2 }));
    expect(() => world.spawn(Tiny({ v: 3 }))).toThrow(/capacity exceeded/);
  });
});

describe("object storage remains default", () => {
  it("keeps persistent object identity", () => {
    const world = new World();
    const e = world.spawn(Health({ value: 7 }));
    const a = world.get(e, Health);
    const b = world.get(e, Health);
    expect(a).toBe(b);
    a!.value = 3;
    expect(b!.value).toBe(3);
  });

  it("App still runs with packed systems", () => {
    let sum = 0;
    const app = new App().addSystem(Update, (world) => {
      for (const [, t] of world.query(Transform)) {
        t.x += 1;
        sum += t.x;
      }
    });
    app.world.spawn(Transform({ x: 0 }));
    app.update(1 / 60);
    expect(sum).toBe(1);
    app.dispose();
  });
});
