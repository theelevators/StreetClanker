import type { Entity } from "../entity.js";
import type { ComponentStorage, StorageKind } from "./types.js";
/** Default Map-backed component storage (arbitrary JS values). */
export declare class ObjectStorage implements ComponentStorage {
    readonly kind: StorageKind;
    private readonly map;
    get size(): number;
    has(entity: Entity): boolean;
    get(entity: Entity): unknown | undefined;
    set(entity: Entity, value: unknown): void;
    remove(entity: Entity): boolean;
    clear(): void;
    entities(): IterableIterator<Entity>;
}
//# sourceMappingURL=object_storage.d.ts.map