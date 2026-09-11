import { ABI_VERSION, AbiError } from "./types.js";
import { makeTypedArray } from "../storage/types.js";
/**
 * Capability-narrowed execution context. No World / App / Commands.
 */
export class AbiContext {
    tick;
    delta;
    scheduleName;
    systemName;
    byId = new Map();
    byName = new Map();
    readIds;
    writeIds;
    resources;
    validateAccess;
    constructor(invocation, options = {}) {
        if (invocation.abiVersion !== ABI_VERSION) {
            throw new AbiError("unsupported_version", `Unsupported mob3 Execution ABI version ${invocation.abiVersion}. Executor supports version ${ABI_VERSION}.`, invocation.system.name);
        }
        this.tick = invocation.execution.tick;
        this.delta = invocation.execution.delta;
        this.scheduleName = invocation.execution.scheduleName;
        this.systemName = invocation.system.name;
        this.readIds = new Set(invocation.access.reads);
        this.writeIds = new Set(invocation.access.writes);
        this.validateAccess = options.validateAccess ?? true;
        this.resources = new Map(invocation.resources.map((r) => [r.name, r.value]));
        for (const store of invocation.stores) {
            const view = materializeStore(store, this.writeIds.has(store.storeId));
            this.byId.set(store.storeId, view);
            this.byName.set(store.name, view);
        }
    }
    resource(name) {
        if (!this.resources.has(name)) {
            throw new AbiError("missing_store", `System "${this.systemName}" requested resource '${name}' not present in invocation`, this.systemName);
        }
        return this.resources.get(name);
    }
    readByName(name) {
        const view = this.byName.get(name);
        if (!view) {
            throw new AbiError("missing_store", `System "${this.systemName}" requires store '${name}', but invocation did not provide it`, this.systemName);
        }
        if (this.validateAccess &&
            !this.readIds.has(view.storeId) &&
            !this.writeIds.has(view.storeId)) {
            throw new AbiError("undeclared_access", `System "${this.systemName}" read undeclared store '${name}'`, this.systemName);
        }
        return view;
    }
    writeByName(name) {
        const view = this.byName.get(name);
        if (!view) {
            throw new AbiError("missing_store", `System "${this.systemName}" requires writable store '${name}', but invocation did not provide it`, this.systemName);
        }
        if (this.validateAccess && !this.writeIds.has(view.storeId)) {
            throw new AbiError("undeclared_access", `System "${this.systemName}" requires writable store ${name} (id=${view.storeId}), but invocation provided it as read-only`, this.systemName);
        }
        if (!view.writable) {
            throw new AbiError("undeclared_access", `System "${this.systemName}" requires writable store ${name} (id=${view.storeId}), but invocation provided it as read-only`, this.systemName);
        }
        return view;
    }
    read(storeId) {
        const view = this.byId.get(storeId);
        if (!view) {
            throw new AbiError("missing_store", `System "${this.systemName}" missing store id=${storeId}`, this.systemName);
        }
        return this.readByName(view.name);
    }
    write(storeId) {
        const view = this.byId.get(storeId);
        if (!view) {
            throw new AbiError("missing_store", `System "${this.systemName}" missing store id=${storeId}`, this.systemName);
        }
        return this.writeByName(view.name);
    }
    /** Debug: store names exposed to this invocation. */
    storeNames() {
        return [...this.byName.keys()];
    }
}
export function materializeStore(store, writable) {
    const fields = {};
    for (const f of store.fields) {
        fields[f.name] = columnFromField(f);
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
function columnFromField(f) {
    return makeTypedArray(f.type, f.buffer, f.byteOffset, f.length);
}
export function schemaBindingFromInvocation(invocation) {
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
export function validateStoreSchema(store, expected, systemName) {
    for (const exp of expected) {
        const got = store.fields.find((f) => f.name === exp.name);
        if (!got) {
            throw new AbiError("missing_field", `System "${systemName}" expected field '${exp.name}' on store '${store.name}'`, systemName);
        }
        if (got.type !== exp.type) {
            throw new AbiError("type_mismatch", `System "${systemName}" store '${store.name}.${exp.name}': expected ${exp.type}, got ${got.type}`, systemName);
        }
    }
}
//# sourceMappingURL=context.js.map