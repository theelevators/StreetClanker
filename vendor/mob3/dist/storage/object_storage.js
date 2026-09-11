/** Default Map-backed component storage (arbitrary JS values). */
export class ObjectStorage {
    kind = "object";
    map = new Map();
    get size() {
        return this.map.size;
    }
    has(entity) {
        return this.map.has(entity);
    }
    get(entity) {
        return this.map.get(entity);
    }
    set(entity, value) {
        this.map.set(entity, value);
    }
    remove(entity) {
        return this.map.delete(entity);
    }
    clear() {
        this.map.clear();
    }
    *entities() {
        yield* this.map.keys();
    }
}
//# sourceMappingURL=object_storage.js.map