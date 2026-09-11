import { describe, expect, it } from "vitest";
import {
  World,
  component,
  tag,
  resource,
  event,
  App,
  Update,
  Startup,
  FixedUpdate,
  Time,
  Commands,
  entityGeneration,
  entityIndex,
} from "../src/index.js";

const Position = component({ x: 0, y: 0, z: 0 });
const Velocity = component({ x: 0, y: 0, z: 0 });
const Health = component({ value: 100 });
const Player = tag("Player");
const Disabled = tag("Disabled");

describe("World entity/component ops", () => {
  it("spawns with components and tags", () => {
    const world = new World();
    const e = world.spawn(
      Position({ x: 1, y: 2, z: 3 }),
      Velocity({ x: 4 }),
      Player,
    );

    expect(world.isAlive(e)).toBe(true);
    expect(world.get(e, Position)).toEqual({ x: 1, y: 2, z: 3 });
    expect(world.get(e, Velocity)).toEqual({ x: 4, y: 0, z: 0 });
    expect(world.has(e, Player)).toBe(true);
  });

  it("add/remove/has/get work", () => {
    const world = new World();
    const e = world.spawn(Position());
    world.add(e, Health({ value: 50 }));
    expect(world.get(e, Health)?.value).toBe(50);
    expect(world.remove(e, Health)).toBe(true);
    expect(world.has(e, Health)).toBe(false);
  });

  it("despawn recycles index but invalidates stale handles via generation", () => {
    const world = new World();
    const a = world.spawn(Position());
    const index = entityIndex(a);
    world.despawn(a);
    expect(world.isAlive(a)).toBe(false);

    const b = world.spawn(Position());
    expect(entityIndex(b)).toBe(index);
    expect(entityGeneration(b)).toBe(entityGeneration(a) + 1);
    expect(world.isAlive(a)).toBe(false);
    expect(world.isAlive(b)).toBe(true);
    expect(world.get(a, Position)).toBeUndefined();
  });
});

describe("Queries", () => {
  it("iterates matching entities with inference-friendly tuples", () => {
    const world = new World();
    world.spawn(Position({ x: 1 }), Velocity({ x: 2 }), Player);
    world.spawn(Position({ x: 9 }));

    const rows = world.query(Position, Velocity).collect();
    expect(rows).toHaveLength(1);
    const [entity, position, velocity] = rows[0]!;
    expect(typeof entity).toBe("number");
    expect(position.x).toBe(1);
    expect(velocity.x).toBe(2);
  });

  it("supports with/without filters", () => {
    const world = new World();
    world.spawn(Position(), Velocity(), Player);
    world.spawn(Position(), Velocity(), Disabled);
    world.spawn(Position(), Velocity(), Player, Disabled);

    const activePlayers = world
      .query(Position, Velocity)
      .with(Player)
      .without(Disabled)
      .collect();

    expect(activePlayers).toHaveLength(1);
  });

  it("mutates component data in place during iteration", () => {
    const world = new World();
    const e = world.spawn(Position({ x: 0 }), Velocity({ x: 5 }));
    for (const [, position, velocity] of world.query(Position, Velocity)) {
      position.x += velocity.x;
    }
    expect(world.get(e, Position)?.x).toBe(5);
  });
});

describe("Resources", () => {
  it("inserts and reads resources", () => {
    const world = new World();
    const Score = resource<{ value: number }>("Score");
    world.insertResource(Score, { value: 10 });
    expect(world.resource(Score).value).toBe(10);
    world.removeResource(Score);
    expect(world.hasResource(Score)).toBe(false);
  });

  it("supports class constructors as keys", () => {
    class Input {
      forward = false;
    }
    const world = new World();
    world.insertResource(Input, new Input());
    expect(world.resource(Input)).toBeInstanceOf(Input);
  });
});

describe("Events", () => {
  it("delivers typed events within a schedule then clears", () => {
    const Collision = event<{ a: number; b: number }>("Collision");
    const seen: Array<{ a: number; b: number }> = [];
    let shouldSend = true;

    const app = new App()
      .addSystem(Update, (world) => {
        if (shouldSend) world.send(Collision, { a: 1, b: 2 });
      })
      .addSystem(Update, (world) => {
        for (const c of world.events(Collision)) seen.push(c);
      });

    app.update(1 / 60);
    expect(seen).toEqual([{ a: 1, b: 2 }]);

    shouldSend = false;
    seen.length = 0;
    app.update(1 / 60);
    expect(seen).toEqual([]);
  });

  it("clears events between FixedUpdate steps", () => {
    const Pulse = event<{ n: number }>("Pulse");
    const applied: number[] = [];

    const app = new App()
      .setFixedDelta(0.05)
      .addSystem(FixedUpdate, (world) => {
        world.send(Pulse, { n: 1 });
      })
      .addSystem(FixedUpdate, (world) => {
        for (const p of world.events(Pulse)) applied.push(p.n);
      });

    // 0.12s → 2 fixed steps; each step should apply exactly once
    app.update(0.12);
    expect(applied).toEqual([1, 1]);
  });
});

describe("Commands", () => {
  it("defers spawn until flush", () => {
    const world = new World();
    const commands = new Commands(world);
    const e = commands.spawn(Position({ x: 3 }));
    expect(world.isAlive(e)).toBe(false);
    commands.flush();
    expect(world.isAlive(e)).toBe(true);
    expect(world.get(e, Position)?.x).toBe(3);
  });

  it("defers despawn until flush so query iteration stays safe", () => {
    const world = new World();
    const a = world.spawn(Position({ x: 1 }), Health({ value: 0 }));
    const b = world.spawn(Position({ x: 2 }), Health({ value: 10 }));

    const app = new App();
    // Use world from app to test schedule flush
    app.world.spawn(Position({ x: 1 }), Health({ value: 0 }));
    app.world.spawn(Position({ x: 2 }), Health({ value: 10 }));

    app.addSystem(Update, (world, commands) => {
      for (const [entity, health] of world.query(Health)) {
        if (health.value <= 0) commands.despawn(entity);
      }
      // Still see both during the system
      expect(world.query(Health).collect()).toHaveLength(2);
    });

    app.addSystem(Update, (world) => {
      expect(world.query(Health).collect()).toHaveLength(1);
    });

    app.update(1 / 60);
    void a;
    void b;
  });

  it("applies ops in insertion order; despawn then add is a no-op", () => {
    const world = new World();
    const e = world.spawn(Position());
    const commands = new Commands(world);
    commands.despawn(e);
    commands.add(e, Health({ value: 1 }));
    commands.flush();
    expect(world.isAlive(e)).toBe(false);
  });

  it("ignores commands on stale entities", () => {
    const world = new World();
    const stale = world.spawn(Position());
    world.despawn(stale);
    world.spawn(Position()); // recycle index

    const commands = new Commands(world);
    commands.add(stale, Health({ value: 1 }));
    commands.despawn(stale);
    commands.flush();
    expect(world.query(Health).collect()).toHaveLength(0);
  });

  it("spawn via commands is visible to the next system", () => {
    const app = new App()
      .addSystem(Update, (_world, commands) => {
        commands.spawn(Position({ x: 9 }), Player);
      })
      .addSystem(Update, (world) => {
        expect(world.query(Position).with(Player).collect()).toHaveLength(1);
      });
    app.update(1 / 60);
  });
});

describe("App + scheduler", () => {
  it("runs Startup once and Update each frame", () => {
    const log: string[] = [];
    const app = new App()
      .addSystem(Startup, () => log.push("startup"))
      .addSystem(Update, () => log.push("update"));

    app.update(1 / 60);
    app.update(1 / 60);
    expect(log).toEqual(["startup", "update", "update"]);
  });

  it("runs FixedUpdate based on accumulator with fixed delta", () => {
    const deltas: number[] = [];
    const app = new App()
      .setFixedDelta(0.05)
      .addSystem(FixedUpdate, (world) => {
        deltas.push(world.resource(Time).delta);
      });

    app.update(0.12);
    expect(deltas).toEqual([0.05, 0.05]);
  });

  it("exposes Time resource", () => {
    const app = new App();
    app.update(0.016);
    const time = app.world.resource(Time);
    expect(time.delta).toBeCloseTo(0.016, 3);
    expect(time.elapsed).toBeCloseTo(0.016, 3);
  });

  it("builds plugins via public API", () => {
    const Flag = resource<{ ok: boolean }>("Flag");
    let built = false;
    const app = new App().addPlugin({
      build(a) {
        built = true;
        a.insertResource(Flag, { ok: true });
      },
    });
    expect(built).toBe(true);
    expect(app.world.resource(Flag).ok).toBe(true);
  });
});

describe("Plugins composition", () => {
  it("composes multiple plugins", () => {
    const A = resource<{ n: number }>("A");
    const B = resource<{ n: number }>("B");
    const app = new App()
      .addPlugin({
        build(a) {
          a.insertResource(A, { n: 1 });
        },
      })
      .addPlugin({
        build(a) {
          a.insertResource(B, { n: 2 });
        },
      });
    expect(app.world.resource(A).n).toBe(1);
    expect(app.world.resource(B).n).toBe(2);
  });
});
