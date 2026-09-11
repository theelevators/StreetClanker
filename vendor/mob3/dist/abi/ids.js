/**
 * Integer IDs stable for the lifetime of one App/World execution context.
 * Not stable across process restarts or different applications.
 */
export class AbiIdRegistry {
    nextComponent = 1;
    nextSystem = 1;
    componentIds = new WeakMap();
    componentById = new Map();
    systemIds = new Map();
    /** storeId === componentId for v1 (1:1 component↔store). */
    storeNames = new Map();
    componentId(type) {
        let id = this.componentIds.get(type);
        if (id === undefined) {
            id = this.nextComponent++;
            this.componentIds.set(type, id);
            this.componentById.set(id, type);
            const name = type.name &&
                type.name !== "factory"
                ? type.name
                : type.id.description ?? `comp${id}`;
            this.storeNames.set(id, name);
        }
        return id;
    }
    storeId(type) {
        return this.componentId(type);
    }
    storeName(id) {
        return this.storeNames.get(id);
    }
    systemId(name) {
        let id = this.systemIds.get(name);
        if (id === undefined) {
            id = this.nextSystem++;
            this.systemIds.set(name, id);
        }
        return id;
    }
    componentType(id) {
        return this.componentById.get(id);
    }
}
//# sourceMappingURL=ids.js.map