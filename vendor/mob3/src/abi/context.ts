import type {
  AbiScalarType,
  FieldMemoryDescriptor,
  SchemaBinding,
  StoreId,
  StoreInvocation,
  SystemInvocation,
} from "./types.js";
import { ABI_VERSION, AbiError } from "./types.js";
import { makeTypedArray } from "../storage/types.js";

export type AbiColumn = Float32Array | Float64Array | Int32Array | Uint32Array;

export type AbiStoreView = {
  storeId: StoreId;
  name: string;
  count: number;
  capacity: number;
  entities: Uint32Array;
  fields: Record<string, AbiColumn>;
  writable: boolean;
  /** Field columns also exposed as `view.x`, `view.y`, … */
  [field: string]: unknown;
};

/**
 * Capability-narrowed execution context. No World / App / Commands.
 */
export class AbiContext {
  readonly tick: number;
  readonly delta: number;
  readonly scheduleName: string;
  readonly systemName: string;
  private readonly byId = new Map<StoreId, AbiStoreView>();
  private readonly byName = new Map<string, AbiStoreView>();
  private readonly readIds: Set<StoreId>;
  private readonly writeIds: Set<StoreId>;
  private readonly resources: Map<string, unknown>;
  private readonly validateAccess: boolean;

  constructor(
    invocation: SystemInvocation,
    options: { validateAccess?: boolean } = {},
  ) {
    if (invocation.abiVersion !== ABI_VERSION) {
      throw new AbiError(
        "unsupported_version",
        `Unsupported mob3 Execution ABI version ${invocation.abiVersion}. Executor supports version ${ABI_VERSION}.`,
        invocation.system.name,
      );
    }
    this.tick = invocation.execution.tick;
    this.delta = invocation.execution.delta;
    this.scheduleName = invocation.execution.scheduleName;
    this.systemName = invocation.system.name;
    this.readIds = new Set(invocation.access.reads);
    this.writeIds = new Set(invocation.access.writes);
    this.validateAccess = options.validateAccess ?? true;
    this.resources = new Map(
      invocation.resources.map((r) => [r.name, r.value]),
    );

    for (const store of invocation.stores) {
      const view = materializeStore(store, this.writeIds.has(store.storeId));
      this.byId.set(store.storeId, view);
      this.byName.set(store.name, view);
    }
  }

  resource<T = unknown>(name: string): T {
    if (!this.resources.has(name)) {
      throw new AbiError(
        "missing_store",
        `System "${this.systemName}" requested resource '${name}' not present in invocation`,
        this.systemName,
      );
    }
    return this.resources.get(name) as T;
  }

  readByName(name: string): AbiStoreView {
    const view = this.byName.get(name);
    if (!view) {
      throw new AbiError(
        "missing_store",
        `System "${this.systemName}" requires store '${name}', but invocation did not provide it`,
        this.systemName,
      );
    }
    if (
      this.validateAccess &&
      !this.readIds.has(view.storeId) &&
      !this.writeIds.has(view.storeId)
    ) {
      throw new AbiError(
        "undeclared_access",
        `System "${this.systemName}" read undeclared store '${name}'`,
        this.systemName,
      );
    }
    return view;
  }

  writeByName(name: string): AbiStoreView {
    const view = this.byName.get(name);
    if (!view) {
      throw new AbiError(
        "missing_store",
        `System "${this.systemName}" requires writable store '${name}', but invocation did not provide it`,
        this.systemName,
      );
    }
    if (this.validateAccess && !this.writeIds.has(view.storeId)) {
      throw new AbiError(
        "undeclared_access",
        `System "${this.systemName}" requires writable store ${name} (id=${view.storeId}), but invocation provided it as read-only`,
        this.systemName,
      );
    }
    if (!view.writable) {
      throw new AbiError(
        "undeclared_access",
        `System "${this.systemName}" requires writable store ${name} (id=${view.storeId}), but invocation provided it as read-only`,
        this.systemName,
      );
    }
    return view;
  }

  read(storeId: StoreId): AbiStoreView {
    const view = this.byId.get(storeId);
    if (!view) {
      throw new AbiError(
        "missing_store",
        `System "${this.systemName}" missing store id=${storeId}`,
        this.systemName,
      );
    }
    return this.readByName(view.name);
  }

  write(storeId: StoreId): AbiStoreView {
    const view = this.byId.get(storeId);
    if (!view) {
      throw new AbiError(
        "missing_store",
        `System "${this.systemName}" missing store id=${storeId}`,
        this.systemName,
      );
    }
    return this.writeByName(view.name);
  }

  /** Debug: store names exposed to this invocation. */
  storeNames(): string[] {
    return [...this.byName.keys()];
  }
}

export function materializeStore(
  store: StoreInvocation,
  writable: boolean,
): AbiStoreView {
  const fields: Record<string, AbiColumn> = {};
  for (const f of store.fields) {
    fields[f.name] = columnFromField(f);
  }
  const view: AbiStoreView = {
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

function columnFromField(f: FieldMemoryDescriptor): AbiColumn {
  return makeTypedArray(
    f.type,
    f.buffer,
    f.byteOffset,
    f.length,
  ) as AbiColumn;
}

export function schemaBindingFromInvocation(
  invocation: SystemInvocation,
): SchemaBinding {
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

export function validateStoreSchema(
  store: StoreInvocation,
  expected: Array<{ name: string; type: AbiScalarType }>,
  systemName: string,
): void {
  for (const exp of expected) {
    const got = store.fields.find((f) => f.name === exp.name);
    if (!got) {
      throw new AbiError(
        "missing_field",
        `System "${systemName}" expected field '${exp.name}' on store '${store.name}'`,
        systemName,
      );
    }
    if (got.type !== exp.type) {
      throw new AbiError(
        "type_mismatch",
        `System "${systemName}" store '${store.name}.${exp.name}': expected ${exp.type}, got ${got.type}`,
        systemName,
      );
    }
  }
}
