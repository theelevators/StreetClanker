/**
 * Phase 7 ABI system modules — plain objects (no World, no closures).
 */

export const integrate = {
  abiVersion: 1,
  name: "integrate",
  bind(_schema) {
    /* validated by expects on host if using defineAbiSystem */
  },
  execute(ctx) {
    const vel = ctx.readByName("Velocity");
    const transform = ctx.writeByName("Transform");
    const n = transform.count;
    const dt = ctx.delta || 1 / 60;
    for (let i = 0; i < n; i++) {
      transform.x[i] += vel.x[i] * dt;
      transform.y[i] += vel.y[i] * dt;
      transform.z[i] += vel.z[i] * dt;
    }
  },
};

export const force = {
  abiVersion: 1,
  name: "force",
  execute(ctx) {
    const pos = ctx.readByName("Position");
    const vel = ctx.writeByName("Velocity");
    const cfg = ctx.resource("SimConfig") ?? { work: 200 };
    const work = cfg.work ?? 200;
    const n = pos.count;
    for (let i = 0; i < n; i++) {
      let burn = 0;
      const x = pos.x[i];
      for (let k = 0; k < work; k++) burn += Math.sin(x + k * 0.01);
      vel.x[i] = -x * 0.1 + burn * 1e-16;
      vel.y[i] = -pos.y[i] * 0.1;
      vel.z[i] = 0;
    }
  },
};

/** Deliberately tries undeclared write — for capability tests. */
export const badWrite = {
  abiVersion: 1,
  name: "badWrite",
  execute(ctx) {
    ctx.writeByName("Velocity");
  },
};
