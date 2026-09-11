/**
 * Shared numeric handlers for Phase 5 tests (loaded by workers via file URL).
 */

/** @param {{ components: Record<string, { name: string, fields: string[], entities: Uint32Array, data: Float32Array }>, resources: Record<string, unknown>, delayMs?: number }} payload */
export function writeY(payload) {
  const x = payload.components.CompX;
  const y = payload.components.CompY;
  if (!x || !y) throw new Error("writeY: missing CompX/CompY");
  const out = new Float32Array(y.data.length);
  for (let i = 0; i < y.entities.length; i++) {
    out[i] = x.data[i] * 2 + 1;
  }
  return {
    writes: [
      {
        name: "CompY",
        fields: y.fields,
        entities: y.entities,
        data: out,
      },
    ],
  };
}

export function writeZ(payload) {
  const x = payload.components.CompX;
  const z = payload.components.CompZ;
  if (!x || !z) throw new Error("writeZ: missing CompX/CompZ");
  const out = new Float32Array(z.data.length);
  for (let i = 0; i < z.entities.length; i++) {
    out[i] = x.data[i] * 3 + 7;
  }
  return {
    writes: [
      {
        name: "CompZ",
        fields: z.fields,
        entities: z.entities,
        data: out,
      },
    ],
  };
}

export function readYZ(payload) {
  const y = payload.components.CompY;
  const z = payload.components.CompZ;
  const outC = payload.components.CompC;
  if (!y || !z || !outC) throw new Error("readYZ: missing slices");
  const out = new Float32Array(outC.data.length);
  for (let i = 0; i < outC.entities.length; i++) {
    out[i] = y.data[i] + z.data[i];
  }
  return {
    writes: [
      {
        name: "CompC",
        fields: outC.fields,
        entities: outC.entities,
        data: out,
      },
    ],
  };
}

/** Expensive deterministic numeric work. */
export function heavyIntegrate(payload) {
  const vel = payload.components.Velocity;
  const pos = payload.components.Position;
  const dt = payload.resources.Time?.delta ?? 1 / 60;
  if (!vel || !pos) throw new Error("heavyIntegrate: missing Position/Velocity");
  const fields = pos.fields.length;
  const out = new Float32Array(pos.data.length);
  for (let i = 0; i < pos.entities.length; i++) {
    const base = i * fields;
    // Burn CPU deliberately
    let acc = 0;
    for (let k = 0; k < 200; k++) {
      acc += Math.sin(pos.data[base] + k * 0.001) * Math.cos(vel.data[base] + k);
    }
    out[base] = pos.data[base] + vel.data[base] * dt + acc * 1e-12;
    out[base + 1] = pos.data[base + 1] + vel.data[base + 1] * dt;
    out[base + 2] = pos.data[base + 2] + vel.data[base + 2] * dt;
  }
  return {
    writes: [
      {
        name: "Position",
        fields: pos.fields,
        entities: pos.entities,
        data: out,
      },
    ],
  };
}

export function scaleVelocity(payload) {
  const vel = payload.components.Velocity;
  if (!vel) throw new Error("scaleVelocity: missing Velocity");
  const out = new Float32Array(vel.data.length);
  for (let i = 0; i < vel.data.length; i++) {
    out[i] = vel.data[i] * 0.99;
  }
  return {
    writes: [
      {
        name: "Velocity",
        fields: vel.fields,
        entities: vel.entities,
        data: out,
      },
    ],
  };
}

/** Lies about writing Position while declaring only Velocity — for rejection tests. */
export function lieAboutWrites(payload) {
  const pos = payload.components.Position;
  const vel = payload.components.Velocity;
  return {
    writes: [
      {
        name: "Position",
        fields: pos.fields,
        entities: pos.entities,
        data: new Float32Array(pos.data),
      },
      {
        name: "Velocity",
        fields: vel.fields,
        entities: vel.entities,
        data: new Float32Array(vel.data),
      },
    ],
  };
}

export function delayA(payload) {
  const a = payload.components.SlotA;
  const out = new Float32Array(a.data.length);
  for (let i = 0; i < a.data.length; i++) out[i] = a.data[i] + 1;
  return {
    writes: [{ name: "SlotA", fields: a.fields, entities: a.entities, data: out }],
    events: [{ name: "TickEvent", payloads: [{ from: "A" }] }],
  };
}

export function delayB(payload) {
  const b = payload.components.SlotB;
  const out = new Float32Array(b.data.length);
  for (let i = 0; i < b.data.length; i++) out[i] = b.data[i] + 10;
  return {
    writes: [{ name: "SlotB", fields: b.fields, entities: b.entities, data: out }],
    events: [{ name: "TickEvent", payloads: [{ from: "B" }] }],
  };
}

export function delayC(payload) {
  const c = payload.components.SlotC;
  const out = new Float32Array(c.data.length);
  for (let i = 0; i < c.data.length; i++) out[i] = c.data[i] + 100;
  return {
    writes: [{ name: "SlotC", fields: c.fields, entities: c.entities, data: out }],
    events: [{ name: "TickEvent", payloads: [{ from: "C" }] }],
  };
}
