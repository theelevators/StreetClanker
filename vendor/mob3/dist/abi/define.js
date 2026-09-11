import { ABI_VERSION } from "./types.js";
/**
 * Declares an ABI-executable system module.
 * Must be importable from a worker URL — no closures.
 */
export function defineAbiSystem(def) {
    const expects = def.expects ?? [];
    return {
        abiVersion: def.abiVersion ?? ABI_VERSION,
        name: def.name,
        bind(schema) {
            for (const exp of expects) {
                const store = schema.stores.find((s) => s.name === exp.name);
                if (!store) {
                    throw new Error(`ABI system "${def.name}" expects store "${exp.name}" but schema has no such store.`);
                }
                for (const f of exp.fields) {
                    const field = store.fields.find((x) => x.name === f.name);
                    if (!field) {
                        throw new Error(`ABI system "${def.name}" expects ${exp.name}.${f.name} but field is missing.`);
                    }
                    if (field.type !== f.type) {
                        throw new Error(`ABI system "${def.name}" expects ${exp.name}.${f.name} as ${f.type}, got ${field.type}.`);
                    }
                }
            }
            def.bind?.(schema);
        },
        execute: def.execute,
    };
}
//# sourceMappingURL=define.js.map