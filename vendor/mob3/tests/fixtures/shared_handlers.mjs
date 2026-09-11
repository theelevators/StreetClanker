/**
 * Handlers that support both copy (Phase 5) and shared (Phase 6) payloads.
 */

export function force(payload) {
  if (payload.mode === "shared") {
    const pos = payload.stores.Position;
    const vel = payload.stores.Velocity;
    const work = payload.resources.SimConfig?.work ?? 200;
    const n = pos.count;
    for (let i = 0; i < n; i++) {
      let burn = 0;
      const x = pos.x[i];
      for (let k = 0; k < work; k++) burn += Math.sin(x + k * 0.01);
      vel.x[i] = -x * 0.1 + burn * 1e-16;
      vel.y[i] = -pos.y[i] * 0.1;
      vel.z[i] = 0;
    }
    return { writes: [] };
  }
  const pos = payload.components.Position;
  const vel = payload.components.Velocity;
  const work = payload.resources.SimConfig?.work ?? 200;
  const out = new Float32Array(vel.data.length);
  for (let i = 0; i < pos.entities.length; i++) {
    const b = i * 3;
    let burn = 0;
    for (let k = 0; k < work; k++) burn += Math.sin(pos.data[b] + k * 0.01);
    out[b] = -pos.data[b] * 0.1 + burn * 1e-16;
    out[b + 1] = -pos.data[b + 1] * 0.1;
    out[b + 2] = 0;
  }
  return {
    writes: [
      { name: "Velocity", fields: vel.fields, entities: vel.entities, data: out },
    ],
  };
}

export function heat(payload) {
  if (payload.mode === "shared") {
    const pos = payload.stores.Position;
    const heat = payload.stores.Heat;
    const work = payload.resources.SimConfig?.work ?? 200;
    for (let i = 0; i < heat.count; i++) {
      let v = heat.v[i];
      const x = pos.x[i];
      for (let k = 0; k < work; k++) v += Math.sin(x + k * 0.02) * 1e-5;
      heat.v[i] = v * 0.99;
    }
    return { writes: [] };
  }
  const pos = payload.components.Position;
  const heat = payload.components.Heat;
  const work = payload.resources.SimConfig?.work ?? 200;
  const out = new Float32Array(heat.data.length);
  for (let i = 0; i < heat.entities.length; i++) {
    let v = heat.data[i];
    const x = pos.data[i * 3];
    for (let k = 0; k < work; k++) v += Math.sin(x + k * 0.02) * 1e-5;
    out[i] = v * 0.99;
  }
  return {
    writes: [
      { name: "Heat", fields: heat.fields, entities: heat.entities, data: out },
    ],
  };
}

export function wobble(payload) {
  if (payload.mode === "shared") {
    const pos = payload.stores.Position;
    const wob = payload.stores.Wobble;
    const work = payload.resources.SimConfig?.work ?? 200;
    for (let i = 0; i < wob.count; i++) {
      let v = wob.v[i];
      const y = pos.y[i];
      for (let k = 0; k < work; k++) v += Math.cos(y + k * 0.03) * 1e-5;
      wob.v[i] = v * 0.99;
    }
    return { writes: [] };
  }
  const pos = payload.components.Position;
  const wob = payload.components.Wobble;
  const work = payload.resources.SimConfig?.work ?? 200;
  const out = new Float32Array(wob.data.length);
  for (let i = 0; i < wob.entities.length; i++) {
    let v = wob.data[i];
    const y = pos.data[i * 3 + 1];
    for (let k = 0; k < work; k++) v += Math.cos(y + k * 0.03) * 1e-5;
    out[i] = v * 0.99;
  }
  return {
    writes: [
      { name: "Wobble", fields: wob.fields, entities: wob.entities, data: out },
    ],
  };
}
