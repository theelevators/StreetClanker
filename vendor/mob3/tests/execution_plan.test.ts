import { describe, expect, it } from "vitest";
import {
  App,
  FixedUpdate,
  Update,
  component,
  resource,
  event,
  system,
  accessesConflict,
  normalizeAccess,
  formatExecutionPlan,
  planToJson,
  getSystemMeta,
} from "../src/index.js";

const A = component({ v: 0 });
const B = component({ v: 0 });
const C = component({ v: 0 });
const ResX = resource<{ n: number }>("ResX");
const ResY = resource<{ n: number }>("ResY");
const Ev = event<{ id: number }>("Ev");

describe("access conflicts", () => {
  it("read/read is compatible", () => {
    const a = normalizeAccess({ read: [A] }, false);
    const b = normalizeAccess({ read: [A] }, false);
    expect(accessesConflict(a, b)).toBe(false);
  });

  it("read/write conflicts", () => {
    const a = normalizeAccess({ read: [A] }, false);
    const b = normalizeAccess({ write: [A] }, false);
    expect(accessesConflict(a, b)).toBe(true);
  });

  it("write/write conflicts", () => {
    const a = normalizeAccess({ write: [A] }, false);
    const b = normalizeAccess({ write: [A] }, false);
    expect(accessesConflict(a, b)).toBe(true);
  });

  it("different components do not conflict", () => {
    const a = normalizeAccess({ write: [A] }, false);
    const b = normalizeAccess({ write: [B] }, false);
    expect(accessesConflict(a, b)).toBe(false);
  });

  it("resources follow same rules", () => {
    const a = normalizeAccess({ resources: { write: [ResX] } }, false);
    const b = normalizeAccess({ resources: { read: [ResX] } }, false);
    expect(accessesConflict(a, b)).toBe(true);
    const c = normalizeAccess({ resources: { read: [ResY] } }, false);
    expect(accessesConflict(a, c)).toBe(false);
  });

  it("events follow same rules", () => {
    const a = normalizeAccess({ events: { write: [Ev] } }, false);
    const b = normalizeAccess({ events: { read: [Ev] } }, false);
    expect(accessesConflict(a, b)).toBe(true);
  });

  it("commands/commands conflicts", () => {
    const a = normalizeAccess({ commands: true }, false);
    const b = normalizeAccess({ commands: true }, false);
    expect(accessesConflict(a, b)).toBe(true);
  });

  it("opaque conflicts with everything", () => {
    const a = normalizeAccess({ read: [A] }, false);
    const b = normalizeAccess(undefined, true);
    expect(accessesConflict(a, b)).toBe(true);
  });
});

describe("execution plan", () => {
  it("preserves explicit before/after order", () => {
    const order: string[] = [];
    const first = system({
      name: "first",
      access: { write: [A] },
      run() {
        order.push("first");
      },
    });
    const second = system({
      name: "second",
      access: { write: [B] },
      run() {
        order.push("second");
      },
    });
    const app = new App()
      .addSystem(Update, second)
      .addSystem(Update, first, { before: second });

    app.update(1 / 60);
    expect(order).toEqual(["first", "second"]);

    const plan = app.inspectSchedule(Update);
    expect(plan.systems.map((s) => s.name)).toEqual(["first", "second"]);
    expect(plan.dependencies).toHaveLength(1);
    expect(plan.dependencies[0]!.fromName).toBe("first");
  });

  it("does not invent order from access conflicts", () => {
    const writerA = system({
      name: "writerA",
      access: { write: [A] },
      run() {},
    });
    const writerB = system({
      name: "writerB",
      access: { write: [A] },
      run() {},
    });
    // Registration order: writerA then writerB — conflict but no edge
    const app = new App()
      .addSystem(Update, writerA)
      .addSystem(Update, writerB);

    const plan = app.inspectSchedule(Update);
    expect(plan.systems.map((s) => s.name)).toEqual(["writerA", "writerB"]);
    expect(plan.dependencies).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]!.ordered).toBe(false);
    expect(plan.diagnostics.some((d) => d.includes("without explicit ordering"))).toBe(
      true,
    );
  });

  it("detects ordering cycles with named path", () => {
    const a = system({ name: "A", access: { read: [A] }, run() {} });
    const b = system({ name: "B", access: { read: [B] }, run() {} });
    const c = system({ name: "C", access: { read: [C] }, run() {} });
    const app = new App()
      .addSystem(Update, a, { before: b })
      .addSystem(Update, b, { before: c })
      .addSystem(Update, c, { before: a });

    expect(() => app.inspectSchedule(Update)).toThrow(/A → B → C → A/);
  });

  it("reports missing ordering targets", () => {
    const present = system({ name: "present", access: { read: [A] }, run() {} });
    const missing = system({ name: "missing", access: { read: [B] }, run() {} });
    const app = new App().addSystem(Update, present, { before: missing });
    const plan = app.inspectSchedule(Update);
    expect(
      plan.diagnostics.some((d) => d.includes("unregistered system 'missing'")),
    ).toBe(true);
  });

  it("builds conservative batches", () => {
    const input = system({
      name: "Input",
      access: { write: [A] },
      run() {},
    });
    const lifetime = system({
      name: "Lifetime",
      access: { write: [B] },
      run() {},
    });
    const enemyAi = system({
      name: "EnemyAI",
      access: { read: [C], write: [A] },
      run() {},
    });
    const movement = system({
      name: "Movement",
      access: { read: [A], write: [C] },
      run() {},
    });
    const physics = system({
      name: "Physics",
      access: { write: [C] },
      run() {},
    });

    const app = new App()
      .addSystem(FixedUpdate, input)
      .addSystem(FixedUpdate, lifetime)
      .addSystem(FixedUpdate, enemyAi, { before: movement })
      .addSystem(FixedUpdate, movement, { before: physics })
      .addSystem(FixedUpdate, physics);

    const plan = app.inspectSchedule(FixedUpdate);
    // Input and Lifetime share no conflicts with each other; EnemyAI conflicts with Input (A)
    const batchNames = plan.batches.map((batch) =>
      batch.map((id) => plan.systems.find((s) => s.id === id)!.name),
    );
    expect(batchNames[0]).toEqual(expect.arrayContaining(["Input", "Lifetime"]));
    expect(batchNames.some((b) => b.includes("Movement"))).toBe(true);
    expect(batchNames.some((b) => b.includes("Physics"))).toBe(true);
    // Movement cannot share with Physics (both write C) or EnemyAI (path)
    for (const batch of batchNames) {
      if (batch.includes("Movement")) {
        expect(batch).not.toContain("Physics");
        expect(batch).not.toContain("EnemyAI");
      }
    }
  });

  it("opaque systems cannot share batches", () => {
    const declared = system({
      name: "declared",
      access: { write: [A] },
      run() {},
    });
    function opaque() {}
    const app = new App()
      .addSystem(Update, declared)
      .addSystem(Update, opaque);

    const plan = app.inspectSchedule(Update);
    expect(plan.batches).toHaveLength(2);
    expect(getSystemMeta(opaque).declared).toBe(false);
  });

  it("compiles once until registration changes", () => {
    const s = system({ name: "s", access: { read: [A] }, run() {} });
    const app = new App().addSystem(Update, s);
    const p1 = app.inspectSchedule(Update);
    const p2 = app.inspectSchedule(Update);
    expect(p1).toBe(p2);

    app.addSystem(Update, system({ name: "t", access: { read: [B] }, run() {} }));
    const p3 = app.inspectSchedule(Update);
    expect(p3).not.toBe(p1);
    expect(p3.systems).toHaveLength(2);
  });

  it("records timings when diagnostics enabled", () => {
    const s = system({
      name: "timed",
      access: { read: [A] },
      run() {
        // burn a tiny bit of time
        let x = 0;
        for (let i = 0; i < 1000; i++) x += i;
        void x;
      },
    });
    const app = new App().enableDiagnostics().addSystem(Update, s);
    app.update(1 / 60);
    app.update(1 / 60);
    const plan = app.inspectSchedule(Update);
    expect(plan.systems[0]!.timing?.invocations).toBe(2);
    expect(plan.systems[0]!.timing!.avgMs).toBeGreaterThanOrEqual(0);
  });

  it("formatExecutionPlan and planToJson are inspectable", () => {
    const s = system({
      name: "movement",
      access: { read: [A], write: [B], commands: true },
      run() {},
    });
    const app = new App().addSystem(Update, s);
    const plan = app.inspectSchedule(Update);
    const text = formatExecutionPlan(plan);
    expect(text).toContain("movement");
    expect(text).toContain("Potential parallel batches");
    const json = planToJson(plan);
    expect(json.schedule).toBeTruthy();
    expect((json.systems as unknown[])[0]).toMatchObject({ name: "movement" });
  });

  it("strict mode throws on unordered conflicts", () => {
    const a = system({ name: "a", access: { write: [A] }, run() {} });
    const b = system({ name: "b", access: { write: [A] }, run() {} });
    const app = new App()
      .enableDiagnostics({ strict: true, timings: false })
      .addSystem(Update, a)
      .addSystem(Update, b);
    expect(() => app.inspectSchedule(Update)).toThrow(/strict validation failed/);
  });

  it("plain systems still run without metadata", () => {
    let ran = false;
    const app = new App().addSystem(Update, () => {
      ran = true;
    });
    app.update(1 / 60);
    expect(ran).toBe(true);
  });
});
