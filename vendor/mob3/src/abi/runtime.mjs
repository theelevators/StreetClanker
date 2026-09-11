/**
 * Worker-side ABI runtime (plain JS — imported by worker_entry_*.mjs).
 * Materializes SystemInvocation → context and runs defineAbiSystem modules.
 */

export const ABI_VERSION = 1;

function makeTypedArray(kind, buffer, byteOffset, length) {
  switch (kind) {
    case "f32":
      return new Float32Array(buffer, byteOffset, length);
    case "f64":
      return new Float64Array(buffer, byteOffset, length);
    case "i32":
      return new Int32Array(buffer, byteOffset, length);
    case "u32":
      return new Uint32Array(buffer, byteOffset, length);
    default:
      throw new Error(`Unsupported ABI field type: ${kind}`);
  }
}

function materializeStore(store, writable) {
  const fields = {};
  for (const f of store.fields) {
    fields[f.name] = makeTypedArray(
      f.type,
      f.buffer,
      f.byteOffset,
      f.length,
    );
  }
  const view = {
    storeId: store.storeId,
    name: store.name,
    count: store.count,
    capacity: store.capacity,
    entities: store.entities,
    fields,
    writable,
  };
  for (const [name, col] of Object.entries(fields)) {
    view[name] = col;
  }
  return view;
}

export function createAbiContext(invocation, options = {}) {
  if (invocation.abiVersion !== ABI_VERSION) {
    throw new Error(
      `Unsupported mob3 Execution ABI version ${invocation.abiVersion}. Executor supports version ${ABI_VERSION}.`,
    );
  }
  const validateAccess = options.validateAccess !== false;
  const readIds = new Set(invocation.access.reads);
  const writeIds = new Set(invocation.access.writes);
  const byId = new Map();
  const byName = new Map();
  const resources = new Map(
    (invocation.resources ?? []).map((r) => [r.name, r.value]),
  );
  const systemName = invocation.system.name;

  for (const store of invocation.stores) {
    const view = materializeStore(store, writeIds.has(store.storeId));
    byId.set(store.storeId, view);
    byName.set(store.name, view);
  }

  return {
    tick: invocation.execution.tick,
    delta: invocation.execution.delta,
    scheduleName: invocation.execution.scheduleName,
    systemName,
    resource(name) {
      if (!resources.has(name)) {
        throw new Error(
          `System "${systemName}" requested resource '${name}' not present in invocation`,
        );
      }
      return resources.get(name);
    },
    readByName(name) {
      const view = byName.get(name);
      if (!view) {
        throw new Error(
          `System "${systemName}" requires store '${name}', but invocation did not provide it`,
        );
      }
      if (
        validateAccess &&
        !readIds.has(view.storeId) &&
        !writeIds.has(view.storeId)
      ) {
        throw new Error(
          `System "${systemName}" read undeclared store '${name}'`,
        );
      }
      return view;
    },
    writeByName(name) {
      const view = byName.get(name);
      if (!view) {
        throw new Error(
          `System "${systemName}" requires writable store '${name}', but invocation did not provide it`,
        );
      }
      if (validateAccess && !writeIds.has(view.storeId)) {
        throw new Error(
          `System "${systemName}" requires writable store ${name} (id=${view.storeId}), but invocation provided it as read-only`,
        );
      }
      if (!view.writable) {
        throw new Error(
          `System "${systemName}" requires writable store ${name} (id=${view.storeId}), but invocation provided it as read-only`,
        );
      }
      return view;
    },
    read(storeId) {
      const view = byId.get(storeId);
      if (!view) {
        throw new Error(
          `System "${systemName}" missing store id=${storeId}`,
        );
      }
      return this.readByName(view.name);
    },
    write(storeId) {
      const view = byId.get(storeId);
      if (!view) {
        throw new Error(
          `System "${systemName}" missing store id=${storeId}`,
        );
      }
      return this.writeByName(view.name);
    },
    storeNames() {
      return [...byName.keys()];
    },
  };
}

export function schemaFromInvocation(invocation) {
  return {
    stores: invocation.stores.map((s) => ({
      id: s.storeId,
      name: s.name,
      generation: s.generation,
      fields: s.fields.map((f) => ({
        fieldId: f.fieldId,
        name: f.name,
        type: f.type,
      })),
    })),
  };
}

const bindCache = new Map();

/**
 * Run an ABI system export against an invocation.
 * @returns ExecutionResult-like object
 */
export function runAbiExport(modExport, invocation) {
  const t0 = performance.now();
  if (invocation.delayMs > 0) {
    // async delay handled by caller
  }

  let system = modExport;
  // Support defineAbiSystem object OR raw { execute } OR legacy function (reject)
  if (typeof modExport === "function") {
    throw new Error(
      `ABI export must be an AbiSystemModule object (got function). Migrate to defineAbiSystem.`,
    );
  }
  if (!system || typeof system.execute !== "function") {
    throw new Error(`ABI export missing execute()`);
  }

  const schema = schemaFromInvocation(invocation);
  const genKey = schema.stores.map((s) => `${s.id}:${s.generation}`).join(",");
  const cacheKey = `${invocation.system.id}:${system.name ?? "anon"}`;
  const cached = bindCache.get(cacheKey);
  if (!cached || cached !== genKey) {
    system.bind?.(schema);
    bindCache.set(cacheKey, genKey);
  }

  const ctx = createAbiContext(invocation);
  const maybe = system.execute(ctx);
  const execMs = performance.now() - t0;

  if (maybe && typeof maybe === "object" && maybe.status) {
    return { ...maybe, execMs: maybe.execMs ?? execMs };
  }

  const writeIds = new Set(invocation.access.writes);
  const localWrites = invocation.stores.filter(
    (s) => s.memoryKind === "local" && writeIds.has(s.storeId),
  );

  return {
    abiVersion: ABI_VERSION,
    systemId: invocation.system.id,
    status: "ok",
    localWrites: localWrites.length ? localWrites : undefined,
    execMs,
  };
}

export function isAbiInvocation(payload) {
  return (
    payload &&
    typeof payload === "object" &&
    typeof payload.abiVersion === "number" &&
    payload.system &&
    Array.isArray(payload.stores)
  );
}
