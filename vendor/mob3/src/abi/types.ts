/** mob3 Execution ABI generation. Bump only on breaking contract changes. */
export const ABI_VERSION = 1 as const;

export type AbiVersion = typeof ABI_VERSION;

export type AbiScalarType = "f32" | "f64" | "i32" | "u32";

export type StoreId = number;
export type FieldId = number;
export type SystemIdNum = number;
export type ComponentId = number;

export type MemoryKind = "shared" | "local";

export type FieldSchemaDescriptor = {
  fieldId: FieldId;
  name: string;
  type: AbiScalarType;
};

export type FieldMemoryDescriptor = {
  fieldId: FieldId;
  name: string;
  type: AbiScalarType;
  /** SharedArrayBuffer or ArrayBuffer */
  buffer: ArrayBufferLike;
  byteOffset: number;
  length: number;
};

export type StoreInvocation = {
  storeId: StoreId;
  componentId: ComponentId;
  name: string;
  /** Layout generation — invalidate worker bindings when changed. */
  generation: number;
  count: number;
  capacity: number;
  memoryKind: MemoryKind;
  fields: FieldMemoryDescriptor[];
  /**
   * Dense live entity ids for slots `[0, count)`.
   * Invariant: packed/shared uses swap-remove — no dead holes in `[0, count)`.
   */
  entities: Uint32Array;
};

export type AccessDescriptor = {
  reads: StoreId[];
  writes: StoreId[];
};

export type ScalarResourceDescriptor = {
  name: string;
  value: unknown;
};

export type SystemInvocation = {
  abiVersion: AbiVersion;
  system: {
    id: SystemIdNum;
    name: string;
  };
  execution: {
    tick: number;
    delta: number;
    scheduleName: string;
  };
  access: AccessDescriptor;
  stores: StoreInvocation[];
  resources: ScalarResourceDescriptor[];
  /** Test/demo only. */
  delayMs?: number;
};

export type ExecutionStatus = "ok" | "error";

export type ExecutionResult = {
  abiVersion: AbiVersion;
  systemId: SystemIdNum;
  status: ExecutionStatus;
  error?: string;
  /** Optional event payloads — host merges in plan order if present. */
  events?: Array<{ name: string; payloads: unknown[] }>;
  /**
   * Local/copy path: mutated write stores returned for host commit.
   * Shared path: omit (memory already updated).
   */
  localWrites?: StoreInvocation[];
  execMs?: number;
};

export type SchemaStoreBinding = {
  id: StoreId;
  name: string;
  generation: number;
  fields: FieldSchemaDescriptor[];
};

export type SchemaBinding = {
  stores: SchemaStoreBinding[];
};

export type AbiSystemModule = {
  abiVersion: number;
  name: string;
  bind?(schema: SchemaBinding): void;
  execute(ctx: import("./context.js").AbiContext): void | ExecutionResult;
};

export type AbiErrorCode =
  | "unsupported_version"
  | "missing_store"
  | "missing_field"
  | "schema_mismatch"
  | "type_mismatch"
  | "undeclared_access"
  | "executor_failure";

export class AbiError extends Error {
  readonly code: AbiErrorCode;
  readonly systemName?: string;

  constructor(code: AbiErrorCode, message: string, systemName?: string) {
    super(message);
    this.name = "AbiError";
    this.code = code;
    this.systemName = systemName;
  }
}

/** Generic ABI executor boundary — ParallelExecutor dispatches here. */
export interface AbiExecutor {
  execute(invocation: SystemInvocation): Promise<ExecutionResult>;
  dispose(): Promise<void> | void;
}
