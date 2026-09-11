import { type Entity, INVALID_ENTITY } from "./entity.js";
import { type ComponentBundleItem, type ComponentType, type InferComponent } from "./component.js";
import { Query } from "./query.js";
import { type ResourceKey } from "./resource.js";
import { type EventType } from "./event.js";
import { type ComponentStorage, type SharedPackedStorage, type WasmMemoryArena } from "./storage/index.js";
import { ChangeTracker } from "./change_detection.js";
import { type SetParentOptions, type DespawnOptions } from "./hierarchy.js";
import { type EntityInspect } from "./math_trs.js";
/**
 * World owns entities, component storage, resources, and events.
 * Physical storage is per-component (object / packed / shared packed).
 */
export declare class World {
    private nextIndex;
    private readonly freeIndices;
    private readonly generations;
    private readonly alive;
    private readonly reserved;
    private readonly stores;
    private readonly entityComponents;
    private readonly resources;
    private readonly eventStore;
    private wasmArena;
    readonly changes: ChangeTracker;
    /** Entities whose GlobalTransform subtree needs refresh (optional dirty set). */
    private readonly hierarchyDirty;
    spawn(...bundle: ComponentBundleItem[]): Entity;
    /** @internal */
    reserveEntity(): Entity;
    /** @internal */
    realizeReserved(entity: Entity, bundle: ComponentBundleItem[]): void;
    /** Advance change tick — call once per App frame. */
    beginFrame(): void;
    get changeTick(): number;
    despawn(entity: Entity, options?: DespawnOptions): void;
    private despawnOne;
    isAlive(entity: Entity): boolean;
    add(entity: Entity, item: ComponentBundleItem): void;
    remove(entity: Entity, type: ComponentType): boolean;
    has(entity: Entity, type: ComponentType): boolean;
    get<C extends ComponentType>(entity: Entity, type: C): InferComponent<C> | undefined;
    /**
     * Mutable component access — marks the component changed this tick.
     * Prefer this over `get` + field writes when change detection matters.
     */
    getMut<C extends ComponentType>(entity: Entity, type: C): InferComponent<C> | undefined;
    markChanged(entity: Entity, type: ComponentType): void;
    markStoreChanged(type: ComponentType): void;
    isChanged(entity: Entity, type: ComponentType): boolean;
    isAdded(entity: Entity, type: ComponentType): boolean;
    /** Coarse store dirty (worker/WASM writes). */
    isStoreDirty(type: ComponentType): boolean;
    removedThisTick(type?: ComponentType): {
        entity: Entity;
        type: ComponentType;
    }[];
    getOrThrow<C extends ComponentType>(entity: Entity, type: C): InferComponent<C>;
    query<Cs extends readonly ComponentType[]>(...types: Cs): Query<Cs>;
    insertResource<T>(key: ResourceKey<T>, value: T): this;
    resource<T>(key: ResourceKey<T>): T;
    tryResource<T>(key: ResourceKey<T>): T | undefined;
    removeResource<T>(key: ResourceKey<T>): boolean;
    hasResource<T>(key: ResourceKey<T>): boolean;
    send<T>(type: EventType<T>, value: T): void;
    events<T>(type: EventType<T>): IterableIterator<T>;
    clearEvents(): void;
    entityCount(): number;
    entities(): IterableIterator<Entity>;
    components(entity: Entity): ComponentType[];
    inspect(entity: Entity): Record<string, unknown>;
    parent(entity: Entity): Entity | null;
    children(entity: Entity): readonly Entity[];
    root(entity: Entity): Entity;
    rootEntities(): Entity[];
    spawnChild(parent: Entity, ...bundle: ComponentBundleItem[]): Entity;
    setParent(child: Entity, parent: Entity | null, options?: SetParentOptions): void;
    removeParent(child: Entity): void;
    validateHierarchy(): string[];
    formatHierarchy(): string;
    entityLabel(entity: Entity): string;
    inspectEntity(entity: Entity): EntityInspect;
    /**
     * Mark entity and all descendants dirty for transform propagation.
     * Flooding descendants keeps parent→child GlobalTransform updates correct.
     */
    markHierarchyDirty(entity: Entity): void;
    /** @internal — drain dirty set for transformPropagation */
    consumeHierarchyDirty(): Set<Entity>;
    hierarchyDirtyCount(): number;
    private wouldCreateCycle;
    private unlinkFromParent;
    private linkToParent;
    /** @internal */
    componentStoreSize(type: ComponentType): number;
    /** @internal */
    entitiesWith(type: ComponentType): IterableIterator<Entity>;
    /** Opt-in WASM-compatible shared memory arena for `backing: "wasm"` stores. */
    setWasmArena(arena: WasmMemoryArena | null): this;
    getWasmArena(): WasmMemoryArena | null;
    /** @internal — storage handle for packed/shared worker paths */
    componentStorage(type: ComponentType): ComponentStorage | undefined;
    /** Ensure storage exists (e.g. before shared worker descriptor). */
    ensureStorage(type: ComponentType): ComponentStorage;
    private allocateEntity;
    private recycleIndex;
    private assertAlive;
    private setComponent;
}
export { INVALID_ENTITY };
export type { SharedPackedStorage };
//# sourceMappingURL=world.d.ts.map