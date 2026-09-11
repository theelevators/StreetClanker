import { isComponentType, } from "./component.js";
/**
 * Live query view over world storage. Iterating does not allocate a result array.
 */
export class Query {
    world;
    required;
    withTypes = [];
    withoutTypes = [];
    changedTypes = [];
    addedTypes = [];
    constructor(world, required) {
        this.world = world;
        this.required = [...required];
    }
    with(...types) {
        this.withTypes.push(...types);
        return this;
    }
    without(...types) {
        this.withoutTypes.push(...types);
        return this;
    }
    /** Entities where any listed type changed this frame tick. */
    changed(...types) {
        this.changedTypes.push(...(types.length ? types : this.required));
        return this;
    }
    /** Entities where any listed type was added this frame tick. */
    added(...types) {
        this.addedTypes.push(...(types.length ? types : this.required));
        return this;
    }
    /** Materialize matching rows into an array (allocates). */
    collect() {
        return [...this];
    }
    /**
     * Callback iteration — avoids per-row tuple allocation from `for...of`.
     * Prefer this in hot systems when profiling shows iterator GC pressure.
     */
    forEach(fn) {
        for (const entity of this.matchingEntities()) {
            const comps = this.required.map((type) => this.world.get(entity, type));
            fn(entity, ...comps);
        }
    }
    *[Symbol.iterator]() {
        for (const entity of this.matchingEntities()) {
            const row = [entity];
            for (let i = 0; i < this.required.length; i++) {
                row.push(this.world.get(entity, this.required[i]));
            }
            yield row;
        }
    }
    *matchingEntities() {
        if (this.required.length === 0)
            return;
        let drive = this.required[0];
        let driveSize = this.world.componentStoreSize(drive);
        for (let i = 1; i < this.required.length; i++) {
            const type = this.required[i];
            const size = this.world.componentStoreSize(type);
            if (size < driveSize) {
                drive = type;
                driveSize = size;
            }
        }
        const filterTypes = [
            ...this.required.filter((t) => t !== drive),
            ...this.withTypes,
        ];
        for (const entity of this.world.entitiesWith(drive)) {
            let ok = true;
            for (const type of filterTypes) {
                if (!this.world.has(entity, type)) {
                    ok = false;
                    break;
                }
            }
            if (!ok)
                continue;
            for (const type of this.withoutTypes) {
                if (this.world.has(entity, type)) {
                    ok = false;
                    break;
                }
            }
            if (!ok)
                continue;
            if (this.changedTypes.length) {
                let any = false;
                for (const type of this.changedTypes) {
                    if (this.world.isChanged(entity, type)) {
                        any = true;
                        break;
                    }
                }
                if (!any)
                    continue;
            }
            if (this.addedTypes.length) {
                let any = false;
                for (const type of this.addedTypes) {
                    if (this.world.isAdded(entity, type)) {
                        any = true;
                        break;
                    }
                }
                if (!any)
                    continue;
            }
            yield entity;
        }
    }
}
export function assertComponentTypes(types) {
    for (const type of types) {
        if (!isComponentType(type)) {
            throw new Error("query() arguments must be component types from component()/tag()");
        }
    }
}
//# sourceMappingURL=query.js.map