import { describe, expect, it } from "vitest";
import {
  App,
  World,
  Transform,
  GlobalTransform,
  Parent,
  Children,
  Name,
  transformPropagation,
} from "../src/index.js";

function propagate(world: World): void {
  transformPropagation(world, null as never);
}

describe("Phase 9 hierarchy", () => {
  it("parents, children, roots, cycle rejection", () => {
    const w = new World();
    w.beginFrame();
    const root = w.spawn(Transform(), Name({ value: "Root" }));
    const a = w.spawn(Transform(), Name({ value: "A" }));
    const b = w.spawn(Transform(), Name({ value: "B" }));
    w.setParent(a, root);
    w.setParent(b, a);

    expect(w.parent(a)).toBe(root);
    expect(w.parent(b)).toBe(a);
    expect([...w.children(root)]).toEqual([a]);
    expect([...w.children(a)]).toEqual([b]);
    expect(w.root(b)).toBe(root);
    expect(w.validateHierarchy()).toEqual([]);

    expect(() => w.setParent(root, b)).toThrow(/cycle/);
    expect(() => w.setParent(a, a)).toThrow(/itself/);
  });

  it("reparent preserve local vs global", () => {
    const w = new World();
    w.beginFrame();
    const root = w.spawn(Transform({ x: 10 }));
    const child = w.spawn(Transform({ x: 5 }));
    w.setParent(child, root, { preserve: "local" });
    propagate(w);

    const g1 = w.get(child, GlobalTransform)!;
    expect(g1.x).toBeCloseTo(15);

    w.setParent(child, null, { preserve: "global" });
    expect(w.get(child, Transform)!.x).toBeCloseTo(15);
    expect(w.parent(child)).toBeNull();
  });

  it("despawn cascade vs detach", () => {
    const w = new World();
    w.beginFrame();
    const ship = w.spawn(Name({ value: "Ship" }));
    const turret = w.spawnChild(ship, Name({ value: "Turret" }));
    const engine = w.spawnChild(ship, Name({ value: "Engine" }));

    w.despawn(ship, { hierarchy: "cascade" });
    expect(w.isAlive(ship)).toBe(false);
    expect(w.isAlive(turret)).toBe(false);
    expect(w.isAlive(engine)).toBe(false);

    const ship2 = w.spawn(Name({ value: "Ship2" }));
    const t2 = w.spawnChild(ship2, Name({ value: "T2" }));
    w.despawn(ship2, { hierarchy: "detach" });
    expect(w.isAlive(ship2)).toBe(false);
    expect(w.isAlive(t2)).toBe(true);
    expect(w.parent(t2)).toBeNull();
  });

  it("robot arm rotation propagates", () => {
    const app = new App();
    const base = app.world.spawn(Transform());
    const j1 = app.world.spawnChild(base, Transform({ y: 1 }));
    const j2 = app.world.spawnChild(j1, Transform({ y: 1 }));
    const tool = app.world.spawnChild(j2, Transform({ y: 1 }));

    app.update(1 / 60);
    app.world.getMut(j1, Transform)!.rz = Math.PI / 2;
    app.update(1 / 60);

    const g = app.world.get(tool, GlobalTransform)!;
    expect(Math.hypot(g.x, g.y, g.z)).toBeGreaterThan(1);
    // rz=π/2 on j1: each +Y link maps toward -X; base offset keeps y≈1
    expect(g.x).toBeCloseTo(-2, 5);
    expect(g.y).toBeCloseTo(1, 5);
    expect(app.world.validateHierarchy()).toEqual([]);
    app.dispose();
  });

  it("change detection: getMut marks changed; bare get does not", () => {
    const app = new App();
    const e = app.world.spawn(Transform({ x: 1 }));
    app.update(1 / 60);

    app.world.beginFrame();
    const t = app.world.get(e, Transform)!;
    t.x = 99;
    expect(app.world.isChanged(e, Transform)).toBe(false);

    app.world.beginFrame();
    app.world.getMut(e, Transform)!.x = 3;
    expect(app.world.isChanged(e, Transform)).toBe(true);

    const changed = [...app.world.query(Transform).changed(Transform)];
    expect(changed.some(([ent]) => ent === e)).toBe(true);
    app.dispose();
  });

  it("deep hierarchy does not blow the stack", () => {
    const w = new World();
    w.beginFrame();
    let prev = w.spawn(Transform());
    for (let i = 0; i < 2000; i++) {
      const n = w.spawn(Transform({ y: 0.01 }));
      w.setParent(n, prev);
      prev = n;
    }
    expect(() => propagate(w)).not.toThrow();
    expect(w.validateHierarchy()).toEqual([]);
    const tip = w.get(prev, GlobalTransform)!;
    expect(tip.y).toBeCloseTo(20, 0);
  });

  it("wide dirty: root change dirties subtree; unrelated untouched", () => {
    const w = new World();
    w.beginFrame();
    const root = w.spawn(Transform());
    const kids: number[] = [];
    for (let i = 0; i < 100; i++) {
      kids.push(w.spawnChild(root, Transform({ x: i })));
    }
    const other = w.spawn(Transform({ x: 999 }));
    propagate(w);
    w.beginFrame();
    w.getMut(root, Transform)!.x = 10;
    expect(w.hierarchyDirtyCount()).toBeGreaterThan(100);
    propagate(w);
    expect(w.get(kids[50]!, GlobalTransform)!.x).toBeCloseTo(60);
    expect(w.get(other, GlobalTransform)!.x).toBeCloseTo(999);
  });

  it("formatHierarchy and inspect", () => {
    const w = new World();
    w.beginFrame();
    const sun = w.spawn(Name({ value: "Sun" }), Transform());
    const planet = w.spawnChild(sun, Name({ value: "Planet" }), Transform());
    w.spawnChild(planet, Name({ value: "Moon" }), Transform());
    const text = w.formatHierarchy();
    expect(text).toContain("Sun");
    expect(text).toContain("Planet");
    expect(text).toContain("Moon");
    expect(w.inspect(planet).parent).toBe(sun);
  });

  it("headless: hierarchy without Three", () => {
    const app = new App();
    const root = app.world.spawn(Transform({ x: 1 }));
    const child = app.world.spawnChild(root, Transform({ x: 2 }));
    app.update(1 / 60);
    expect(app.world.get(child, GlobalTransform)!.x).toBeCloseTo(3);
    app.dispose();
  });

  it("reparent churn keeps Parent/Children consistent", () => {
    const w = new World();
    w.beginFrame();
    const nodes: number[] = [];
    for (let i = 0; i < 200; i++) nodes.push(w.spawn(Transform()));
    for (let i = 0; i < 500; i++) {
      const child = nodes[(i * 7) % nodes.length]!;
      const parent = nodes[(i * 13) % nodes.length]!;
      if (child === parent) continue;
      try {
        w.setParent(child, parent);
      } catch {
        /* cycle */
      }
    }
    expect(w.validateHierarchy()).toEqual([]);
  });

  it("removed component tracked this tick", () => {
    const w = new World();
    w.beginFrame();
    const e = w.spawn(Name({ value: "X" }), Transform());
    w.remove(e, Name);
    const removed = w.removedThisTick(Name);
    expect(removed.some((r) => r.entity === e)).toBe(true);
  });

  it("stale parent rejected", () => {
    const w = new World();
    w.beginFrame();
    const a = w.spawn(Transform());
    const b = w.spawn(Transform());
    w.despawn(a, { hierarchy: "detach" });
    expect(() => w.setParent(b, a)).toThrow();
  });
});

void Parent;
void Children;
