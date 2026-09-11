/**
 * JS ABI fallback for integrate — uses Math.fround to match WASM f32 storage rounding.
 */
export const integrateJs = {
  abiVersion: 1,
  name: "integrate",
  execute(ctx) {
    const vel = ctx.readByName("Velocity");
    const transform = ctx.writeByName("Transform");
    const n = transform.count;
    const dt = Math.fround(ctx.delta || 1 / 60);
    for (let i = 0; i < n; i++) {
      transform.x[i] = Math.fround(
        Math.fround(transform.x[i]) + Math.fround(Math.fround(vel.x[i]) * dt),
      );
      transform.y[i] = Math.fround(
        Math.fround(transform.y[i]) + Math.fround(Math.fround(vel.y[i]) * dt),
      );
      transform.z[i] = Math.fround(
        Math.fround(transform.z[i]) + Math.fround(Math.fround(vel.z[i]) * dt),
      );
    }
  },
};
