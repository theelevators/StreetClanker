import {
  COMPONENT_TYPE,
  IS_COMPONENT_TYPE,
  type ComponentType,
} from "../component.js";
import {
  PACKED_META,
  type FieldKind,
  type FieldSchema,
  type InferSchema,
  type PackedComponentMeta,
  f32,
  f64,
  i32,
  u32,
} from "./types.js";

export type PackedComponentOptions = {
  name?: string;
  /** Use SharedArrayBuffer-backed storage (fixed capacity). */
  shared?: boolean;
  /** Required when shared; used as initial capacity for local packed too. */
  capacity?: number;
  /**
   * When shared: "sab" (default) or "wasm" (World WasmMemoryArena slice).
   * WASM-backed storage is opt-in — not all shared components become WASM memory.
   */
  backing?: "sab" | "wasm";
};

export type PackedComponentType<S extends FieldSchema> = ComponentType<
  InferSchema<S>
> & {
  readonly [PACKED_META]: PackedComponentMeta;
};

function defaultsFromSchema<S extends FieldSchema>(schema: S): InferSchema<S> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(schema)) out[key] = 0;
  return out as InferSchema<S>;
}

/**
 * Opt-in packed numeric component (SoA). Object `component()` remains default.
 *
 * @example
 * const Transform = packedComponent({ x: f32, y: f32, z: f32 }, { name: "Transform" });
 * const SharedPos = packedComponent({ x: f32, y: f32, z: f32 }, {
 *   name: "SharedPos",
 *   shared: true,
 *   capacity: 100_000,
 * });
 */
export function packedComponent<S extends FieldSchema>(
  schema: S,
  options: PackedComponentOptions = {},
): PackedComponentType<S> {
  const fields = Object.keys(schema);
  if (fields.length === 0) {
    throw new Error("packedComponent requires at least one field");
  }
  const kinds = fields.map((f) => schema[f]!) as FieldKind[];
  for (const k of kinds) {
    if (k !== "f32" && k !== "f64" && k !== "i32" && k !== "u32") {
      throw new Error(`Unsupported packed field kind: ${k}`);
    }
  }

  const shared = !!options.shared;
  const capacity = options.capacity ?? (shared ? 10_000 : 16);
  if (shared && options.capacity === undefined) {
    // still ok with default 10k — document
  }
  const name = options.name ?? "PackedComponent";
  const backing = options.backing ?? "sab";
  if (backing === "wasm" && !shared) {
    throw new Error(`packedComponent '${name}': backing "wasm" requires shared: true`);
  }
  const defaults = defaultsFromSchema(schema);
  const id = Symbol(`mob3.packed.${name}`);

  const meta: PackedComponentMeta = {
    schema,
    fields,
    kinds,
    shared,
    capacity,
    name,
    backing: shared ? backing : undefined,
  };

  const factory = ((partial?: Partial<InferSchema<S>>) => {
    return factory.create(partial as never);
  }) as PackedComponentType<S>;

  Object.defineProperty(factory, IS_COMPONENT_TYPE, { value: true });
  Object.defineProperty(factory, "id", { value: id });
  Object.defineProperty(factory, "defaults", { value: defaults });
  Object.defineProperty(factory, "isTag", { value: false });
  Object.defineProperty(factory, "name", { value: name });
  Object.defineProperty(factory, PACKED_META, { value: meta });

  factory.create = ((partial?: Partial<InferSchema<S>>) => {
    const value = { ...defaults, ...(partial ?? {}) } as InferSchema<S>;
    Object.defineProperty(value, COMPONENT_TYPE, {
      value: factory,
      enumerable: false,
      configurable: true,
    });
    return value;
  }) as ComponentType<InferSchema<S>>["create"];

  return factory;
}

export function getPackedMeta(
  type: ComponentType,
): PackedComponentMeta | undefined {
  return (type as PackedComponentType<FieldSchema>)[PACKED_META];
}

export function isPackedComponent(type: ComponentType): boolean {
  return PACKED_META in (type as object);
}

export { f32, f64, i32, u32, PACKED_META };
