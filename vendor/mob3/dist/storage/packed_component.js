import { COMPONENT_TYPE, IS_COMPONENT_TYPE, } from "../component.js";
import { PACKED_META, f32, f64, i32, u32, } from "./types.js";
function defaultsFromSchema(schema) {
    const out = {};
    for (const key of Object.keys(schema))
        out[key] = 0;
    return out;
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
export function packedComponent(schema, options = {}) {
    const fields = Object.keys(schema);
    if (fields.length === 0) {
        throw new Error("packedComponent requires at least one field");
    }
    const kinds = fields.map((f) => schema[f]);
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
    const meta = {
        schema,
        fields,
        kinds,
        shared,
        capacity,
        name,
        backing: shared ? backing : undefined,
    };
    const factory = ((partial) => {
        return factory.create(partial);
    });
    Object.defineProperty(factory, IS_COMPONENT_TYPE, { value: true });
    Object.defineProperty(factory, "id", { value: id });
    Object.defineProperty(factory, "defaults", { value: defaults });
    Object.defineProperty(factory, "isTag", { value: false });
    Object.defineProperty(factory, "name", { value: name });
    Object.defineProperty(factory, PACKED_META, { value: meta });
    factory.create = ((partial) => {
        const value = { ...defaults, ...(partial ?? {}) };
        Object.defineProperty(value, COMPONENT_TYPE, {
            value: factory,
            enumerable: false,
            configurable: true,
        });
        return value;
    });
    return factory;
}
export function getPackedMeta(type) {
    return type[PACKED_META];
}
export function isPackedComponent(type) {
    return PACKED_META in type;
}
export { f32, f64, i32, u32, PACKED_META };
//# sourceMappingURL=packed_component.js.map