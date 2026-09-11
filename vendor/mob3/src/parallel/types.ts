/**
 * Shared transfer / job types for worker systems (structured-clone safe).
 */

export type NumericSlice = {
  /** Stable component display name (must match registry on main). */
  name: string;
  fields: string[];
  /** Packed entity ids (same length as row count). */
  entities: Uint32Array;
  /** Interleaved field data: entities.length * fields.length */
  data: Float32Array;
};

export type WorkerPayload = {
  /** Read + write component slices (writes are mutable copies). */
  components: Record<string, NumericSlice>;
  /** Structured-clone-safe resource snapshots by name. */
  resources: Record<string, unknown>;
  /** Optional artificial delay (tests). */
  delayMs?: number;
};

export type WorkerWriteSlice = {
  name: string;
  fields: string[];
  entities: Uint32Array;
  data: Float32Array;
};

export type WorkerEventBatch = {
  name: string;
  payloads: unknown[];
};

export type WorkerResult = {
  writes: WorkerWriteSlice[];
  events?: WorkerEventBatch[];
  execMs?: number;
};

export type WorkerJobRequest = {
  type: "job";
  id: number;
  moduleUrl: string;
  exportName: string;
  payload: WorkerPayload;
};

export type WorkerJobResponse =
  | { type: "result"; id: number; result: WorkerResult }
  | { type: "error"; id: number; error: string; systemName?: string };
