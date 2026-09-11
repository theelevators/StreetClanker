import {
  type Entity,
  INVALID_ENTITY,
  ENTITY_INDEX_MASK,
  packEntity,
  entityIndex,
  entityGeneration,
} from "./entity.js";
import {
  type ComponentBundleItem,
  type ComponentType,
  type InferComponent,
  resolveBundleItem,
} from "./component.js";
import { Query, assertComponentTypes } from "./query.js";
import {
  type ResourceKey,
  resourceKeyId,
} from "./resource.js";
import { EventStore, type EventType } from "./event.js";
import {
  createStorageFor,
  type ComponentStorage,
  getPackedMeta,
  type SharedPackedStorage,
  type WasmMemoryArena,
} from "./storage/index.js";
import { ChangeTracker } from "./change_detection.js";
import {
  Parent,
  Children,
  type SetParentOptions,
  type DespawnOptions,
} from "./hierarchy.js";
import { Transform } from "./transform.js";
import { GlobalTransform } from "./global_transform.js";
import { Name } from "./name.js";
import {
  formatHierarchyTree,
  type EntityInspect,
} from "./math_trs.js";
import { recomputeLocalPreservingGlobal } from "./transform_propagate.js";

/**
 * World owns entities, component storage, resources, and events.
 * Physical storage is per-component (object / packed / shared packed).
 */
export class World {
  private nextIndex = 1;
  private readonly freeIndices: number[] = [];
  private readonly generations: number[] = [];
  private readonly alive = new Set<Entity>();
  private readonly reserved = new Set<Entity>();
  private readonly stores = new Map<ComponentType, ComponentStorage>();
  private readonly entityComponents = new Map<Entity, Set<ComponentType>>();
  private readonly resources = new Map<symbol | ResourceKey, unknown>();
  private readonly eventStore = new EventStore();
  private wasmArena: WasmMemoryArena | null = null;
  readonly changes = new ChangeTracker();
  /** Entities whose GlobalTransform subtree needs refresh (optional dirty set). */
  private readonly hierarchyDirty = new Set<Entity>();


  spawn(...bundle: ComponentBundleItem[]): Entity {
    const entity = this.allocateEntity();
    this.alive.add(entity);
    this.entityComponents.set(entity, new Set());

    for (const item of bundle) {
      const { type, value } = resolveBundleItem(item);
      this.setComponent(entity, type, value);
    }

    return entity;
  }

  /** @internal */
  reserveEntity(): Entity {
    const entity = this.allocateEntity();
    this.reserved.add(entity);
    return entity;
  }

  /** @internal */
  realizeReserved(entity: Entity, bundle: ComponentBundleItem[]): void {
    if (!this.reserved.has(entity)) return;
    this.reserved.delete(entity);
    this.alive.add(entity);
    this.entityComponents.set(entity, new Set());
    for (const item of bundle) {
      const { type, value } = resolveBundleItem(item);
      this.setComponent(entity, type, value);
    }
  }

  /** Advance change tick — call once per App frame. */
  beginFrame(): void {
    this.changes.beginFrame();
  }

  get changeTick(): number {
    return this.changes.tick;
  }

  despawn(entity: Entity, options: DespawnOptions = {}): void {
    const mode = options.hierarchy ?? "cascade";
    if (this.reserved.has(entity)) {
      this.reserved.delete(entity);
      this.recycleIndex(entity);
      return;
    }

    if (!this.alive.has(entity)) return;

    if (mode === "cascade") {
      const stack = [entity];
      const order: Entity[] = [];
      while (stack.length) {
        const e = stack.pop()!;
        if (!this.isAlive(e)) continue;
        order.push(e);
        for (const c of this.children(e)) stack.push(c);
      }
      // Despawn leaves first so Children cleanup is simpler
      for (let i = order.length - 1; i >= 0; i--) {
        this.despawnOne(order[i]!);
      }
      return;
    }

    // detach children then despawn self
    for (const c of [...this.children(entity)]) {
      this.removeParent(c);
    }
    this.despawnOne(entity);
  }

  private despawnOne(entity: Entity): void {
    if (!this.alive.has(entity)) return;

    // Detach from parent index
    const parent = this.get(entity, Parent);
    if (parent) {
      this.unlinkFromParent(entity, parent.entity);
    }
    // Detach children records on this entity
    if (this.has(entity, Children)) {
      const kids = [...(this.get(entity, Children)?.list ?? [])];
      for (const c of kids) {
        if (this.has(c, Parent)) {
          this.stores.get(Parent)?.remove(c);
          this.entityComponents.get(c)?.delete(Parent);
          this.changes.markRemoved(c, Parent);
        }
      }
    }

    const types = this.entityComponents.get(entity);
    if (types) {
      for (const type of types) {
        this.changes.markRemoved(entity, type);
        this.stores.get(type)?.remove(entity);
      }
    }
    this.entityComponents.delete(entity);
    this.alive.delete(entity);
    this.changes.clearEntity(entity);
    this.hierarchyDirty.delete(entity);
    this.recycleIndex(entity);
  }

  isAlive(entity: Entity): boolean {
    if (!this.alive.has(entity)) return false;
    const index = entityIndex(entity);
    return this.generations[index] === entityGeneration(entity);
  }

  add(entity: Entity, item: ComponentBundleItem): void {
    this.assertAlive(entity);
    const { type, value } = resolveBundleItem(item);
    this.setComponent(entity, type, value);
  }

  remove(entity: Entity, type: ComponentType): boolean {
    if (!this.isAlive(entity)) return false;
    if (type === Parent) {
      this.removeParent(entity);
      return true;
    }
    const store = this.stores.get(type);
    if (!store?.has(entity)) return false;
    store.remove(entity);
    this.entityComponents.get(entity)?.delete(type);
    this.changes.markRemoved(entity, type);
    return true;
  }

  has(entity: Entity, type: ComponentType): boolean {
    if (!this.isAlive(entity)) return false;
    return this.stores.get(type)?.has(entity) ?? false;
  }

  get<C extends ComponentType>(
    entity: Entity,
    type: C,
  ): InferComponent<C> | undefined {
    if (!this.isAlive(entity)) return undefined;
    return this.stores.get(type)?.get(entity) as InferComponent<C> | undefined;
  }

  /**
   * Mutable component access — marks the component changed this tick.
   * Prefer this over `get` + field writes when change detection matters.
   */
  getMut<C extends ComponentType>(
    entity: Entity,
    type: C,
  ): InferComponent<C> | undefined {
    const value = this.get(entity, type);
    if (value === undefined) return undefined;
    this.markChanged(entity, type);
    return value;
  }

  markChanged(entity: Entity, type: ComponentType): void {
    if (!this.isAlive(entity)) return;
    this.changes.markChanged(entity, type);
    if (type === Transform || type === Parent) {
      this.markHierarchyDirty(entity);
    }
  }

  markStoreChanged(type: ComponentType): void {
    this.changes.markStoreChanged(type);
    if (type === Transform) {
      for (const [e] of this.query(Transform)) this.markHierarchyDirty(e);
    }
  }

  isChanged(entity: Entity, type: ComponentType): boolean {
    return this.changes.isChanged(entity, type);
  }

  isAdded(entity: Entity, type: ComponentType): boolean {
    return this.changes.isAdded(entity, type);
  }

  /** Coarse store dirty (worker/WASM writes). */
  isStoreDirty(type: ComponentType): boolean {
    return this.changes.isStoreDirty(type);
  }

  removedThisTick(type?: ComponentType) {
    return this.changes.removedThisTick(type);
  }

  getOrThrow<C extends ComponentType>(
    entity: Entity,
    type: C,
  ): InferComponent<C> {
    const value = this.get(entity, type);
    if (value === undefined) {
      throw new Error(`Entity ${entity} missing component`);
    }
    return value;
  }

  query<Cs extends readonly ComponentType[]>(
    ...types: Cs
  ): Query<Cs> {
    assertComponentTypes(types as unknown as unknown[]);
    return new Query(this, types);
  }

  insertResource<T>(key: ResourceKey<T>, value: T): this {
    this.resources.set(resourceKeyId(key as ResourceKey), value);
    return this;
  }

  resource<T>(key: ResourceKey<T>): T {
    const value = this.resources.get(resourceKeyId(key as ResourceKey));
    if (value === undefined) {
      throw new Error(
        `Resource not found: ${typeof key === "function" ? key.name : (key as { name?: string }).name ?? "anonymous"}`,
      );
    }
    return value as T;
  }

  tryResource<T>(key: ResourceKey<T>): T | undefined {
    return this.resources.get(resourceKeyId(key as ResourceKey)) as T | undefined;
  }

  removeResource<T>(key: ResourceKey<T>): boolean {
    return this.resources.delete(resourceKeyId(key as ResourceKey));
  }

  hasResource<T>(key: ResourceKey<T>): boolean {
    return this.resources.has(resourceKeyId(key as ResourceKey));
  }

  send<T>(type: EventType<T>, value: T): void {
    this.eventStore.send(type, value);
  }

  events<T>(type: EventType<T>): IterableIterator<T> {
    return this.eventStore.read(type);
  }

  clearEvents(): void {
    this.eventStore.clear();
  }

  entityCount(): number {
    return this.alive.size;
  }

  *entities(): IterableIterator<Entity> {
    yield* this.alive;
  }

  components(entity: Entity): ComponentType[] {
    if (!this.isAlive(entity)) return [];
    return [...(this.entityComponents.get(entity) ?? [])];
  }

  inspect(entity: Entity): Record<string, unknown> {
    const out: Record<string, unknown> = {
      entity,
      index: entityIndex(entity),
      generation: entityGeneration(entity),
      alive: this.isAlive(entity),
      parent: this.parent(entity),
      children: [...this.children(entity)],
      root: this.root(entity),
    };
    for (const type of this.components(entity)) {
      const key = type.isTag
        ? (type as { name?: string }).name ?? String(type.id)
        : (type as { name?: string }).name ?? String(type.id);
      const val = this.get(entity, type);
      if (val && typeof val === "object" && "_slot" in (val as object)) {
        const snap: Record<string, number> = {};
        const meta = getPackedMeta(type);
        if (meta) {
          for (const f of meta.fields) {
            snap[f] = (val as Record<string, number>)[f]!;
          }
          out[key] = snap;
        } else {
          out[key] = val;
        }
      } else if (type === Children && val) {
        out[key] = { list: [...(val as { list: Entity[] }).list] };
      } else {
        out[key] = val;
      }
      out[`${key}__changed`] = this.isChanged(entity, type);
      out[`${key}__added`] = this.isAdded(entity, type);
    }
    return out;
  }

  // --- Hierarchy -----------------------------------------------------------

  parent(entity: Entity): Entity | null {
    if (!this.isAlive(entity)) return null;
    const p = this.get(entity, Parent);
    if (!p || !this.isAlive(p.entity)) return null;
    return p.entity;
  }

  children(entity: Entity): readonly Entity[] {
    if (!this.isAlive(entity)) return [];
    const c = this.get(entity, Children);
    return c?.list ?? [];
  }

  root(entity: Entity): Entity {
    let e = entity;
    const seen = new Set<Entity>();
    while (true) {
      if (seen.has(e)) break;
      seen.add(e);
      const p = this.parent(e);
      if (p === null) return e;
      e = p;
    }
    return entity;
  }

  rootEntities(): Entity[] {
    const roots: Entity[] = [];
    for (const e of this.alive) {
      if (!this.has(e, Parent)) roots.push(e);
    }
    return roots;
  }

  spawnChild(parent: Entity, ...bundle: ComponentBundleItem[]): Entity {
    const child = this.spawn(...bundle);
    this.setParent(child, parent);
    return child;
  }

  setParent(
    child: Entity,
    parent: Entity | null,
    options: SetParentOptions = {},
  ): void {
    this.assertAlive(child);
    const preserve = options.preserve ?? "local";

    if (parent === null) {
      if (preserve === "global") {
        recomputeLocalPreservingGlobal(this, child, null);
      }
      this.removeParent(child);
      return;
    }

    this.assertAlive(parent);
    if (child === parent) {
      throw new Error(
        `Cannot parent entity ${this.entityLabel(child)} to itself`,
      );
    }
    if (this.wouldCreateCycle(child, parent)) {
      throw new Error(
        `Cannot parent "${this.entityLabel(child)}" to "${this.entityLabel(parent)}": hierarchy cycle would be created.`,
      );
    }

    if (preserve === "global") {
      // Ensure globals exist for math
      if (!this.has(child, GlobalTransform) && this.has(child, Transform)) {
        const t = this.get(child, Transform)!;
        this.add(child, GlobalTransform({ ...t }) as never);
      }
      if (!this.has(parent, GlobalTransform) && this.has(parent, Transform)) {
        const t = this.get(parent, Transform)!;
        this.add(parent, GlobalTransform({ ...t }) as never);
      }
      recomputeLocalPreservingGlobal(this, child, parent);
    }

    const prev = this.get(child, Parent);
    if (prev) {
      if (prev.entity === parent) return;
      this.unlinkFromParent(child, prev.entity);
    }

    this.setComponent(child, Parent, Parent({ entity: parent }));
    this.linkToParent(child, parent);
    this.markHierarchyDirty(child);
  }

  removeParent(child: Entity): void {
    if (!this.isAlive(child)) return;
    const prev = this.get(child, Parent);
    if (!prev) return;
    this.unlinkFromParent(child, prev.entity);
    this.stores.get(Parent)?.remove(child);
    this.entityComponents.get(child)?.delete(Parent);
    this.changes.markRemoved(child, Parent);
    this.markHierarchyDirty(child);
  }

  validateHierarchy(): string[] {
    const errors: string[] = [];
    for (const [e, p] of this.query(Parent)) {
      if (!this.isAlive(p.entity)) {
        errors.push(`Parent of ${e} is not alive (${p.entity})`);
        continue;
      }
      const kids = this.get(p.entity, Children)?.list ?? [];
      if (!kids.includes(e)) {
        errors.push(
          `Children of ${p.entity} missing child ${e} (Parent/Children disagree)`,
        );
      }
      if (this.wouldCreateCycle(e, p.entity)) {
        errors.push(`Cycle involving ${e}`);
      }
    }
    for (const [e, c] of this.query(Children)) {
      for (const child of c.list) {
        if (!this.isAlive(child)) {
          errors.push(`Children of ${e} lists dead ${child}`);
          continue;
        }
        const p = this.get(child, Parent);
        if (!p || p.entity !== e) {
          errors.push(
            `Child ${child} does not point Parent to ${e}`,
          );
        }
        const dup = c.list.filter((x) => x === child).length;
        if (dup > 1) errors.push(`Duplicate child ${child} under ${e}`);
      }
    }
    return errors;
  }

  formatHierarchy(): string {
    return formatHierarchyTree(
      this.rootEntities(),
      (e) => this.children(e),
      (e) => this.entityLabel(e),
    );
  }

  entityLabel(entity: Entity): string {
    const n = this.get(entity, Name);
    const id = `${entityIndex(entity)}:${entityGeneration(entity)}`;
    return n?.value ? `${n.value} [${id}]` : `Entity [${id}]`;
  }

  inspectEntity(entity: Entity): EntityInspect {
    return {
      entity,
      parent: this.parent(entity),
      children: [...this.children(entity)],
      root: this.root(entity),
      components: this.components(entity).map(
        (t) => (t as { name?: string }).name ?? String(t.id),
      ),
    };
  }

  /**
   * Mark entity and all descendants dirty for transform propagation.
   * Flooding descendants keeps parent→child GlobalTransform updates correct.
   */
  markHierarchyDirty(entity: Entity): void {
    const stack: Entity[] = [entity];
    while (stack.length) {
      const e = stack.pop()!;
      if (this.hierarchyDirty.has(e)) continue;
      this.hierarchyDirty.add(e);
      for (const c of this.children(e)) stack.push(c);
    }
  }

  /** @internal — drain dirty set for transformPropagation */
  consumeHierarchyDirty(): Set<Entity> {
    if (this.hierarchyDirty.size === 0) return this.hierarchyDirty;
    const out = new Set(this.hierarchyDirty);
    this.hierarchyDirty.clear();
    return out;
  }

  hierarchyDirtyCount(): number {
    return this.hierarchyDirty.size;
  }

  private wouldCreateCycle(child: Entity, parent: Entity): boolean {
    let e: Entity | null = parent;
    const seen = new Set<Entity>();
    while (e !== null) {
      if (e === child) return true;
      if (seen.has(e)) return true;
      seen.add(e);
      e = this.parent(e);
    }
    return false;
  }

  private unlinkFromParent(child: Entity, parent: Entity): void {
    if (!this.isAlive(parent)) return;
    const kids = this.get(parent, Children);
    if (!kids) return;
    const idx = kids.list.indexOf(child);
    if (idx >= 0) kids.list.splice(idx, 1);
    this.changes.markChanged(parent, Children);
    if (kids.list.length === 0) {
      this.stores.get(Children)?.remove(parent);
      this.entityComponents.get(parent)?.delete(Children);
      this.changes.markRemoved(parent, Children);
    }
  }

  private linkToParent(child: Entity, parent: Entity): void {
    if (!this.has(parent, Children)) {
      this.setComponent(parent, Children, Children({ list: [child] }));
    } else {
      const kids = this.getMut(parent, Children)!;
      if (!kids.list.includes(child)) kids.list.push(child);
    }
  }

  /** @internal */
  componentStoreSize(type: ComponentType): number {
    return this.stores.get(type)?.size ?? 0;
  }

  /** @internal */
  *entitiesWith(type: ComponentType): IterableIterator<Entity> {
    const store = this.stores.get(type);
    if (!store) return;
    for (const entity of store.entities()) {
      if (this.isAlive(entity)) yield entity;
    }
  }

  /** Opt-in WASM-compatible shared memory arena for `backing: "wasm"` stores. */
  setWasmArena(arena: WasmMemoryArena | null): this {
    this.wasmArena = arena;
    return this;
  }

  getWasmArena(): WasmMemoryArena | null {
    return this.wasmArena;
  }

  /** @internal — storage handle for packed/shared worker paths */
  componentStorage(type: ComponentType): ComponentStorage | undefined {
    return this.stores.get(type);
  }

  /** Ensure storage exists (e.g. before shared worker descriptor). */
  ensureStorage(type: ComponentType): ComponentStorage {
    let store = this.stores.get(type);
    if (!store) {
      store = createStorageFor(type, { wasmArena: this.wasmArena });
      this.stores.set(type, store);
    }
    return store;
  }

  private allocateEntity(): Entity {
    let index: number;
    if (this.freeIndices.length > 0) {
      index = this.freeIndices.pop()!;
    } else {
      index = this.nextIndex++;
      if (index > ENTITY_INDEX_MASK) {
        throw new Error("Entity index space exhausted");
      }
      this.generations[index] = 0;
    }
    const generation = this.generations[index] ?? 0;
    return packEntity(index, generation);
  }

  private recycleIndex(entity: Entity): void {
    const index = entityIndex(entity);
    const gen = this.generations[index] ?? 0;
    this.generations[index] = (gen + 1) & 0xfff;
    this.freeIndices.push(index);
  }

  private assertAlive(entity: Entity): void {
    if (!this.isAlive(entity)) {
      throw new Error(`Entity ${entity} is not alive`);
    }
  }

  private setComponent(
    entity: Entity,
    type: ComponentType,
    value: unknown,
  ): void {
    let store = this.stores.get(type);
    if (!store) {
      store = createStorageFor(type, { wasmArena: this.wasmArena });
      this.stores.set(type, store);
    }
    const isNew = !store.has(entity);
    // Children list must be a fresh array copy
    let toStore = value;
    if (type === Children && value && typeof value === "object") {
      const list = [...((value as { list: Entity[] }).list ?? [])];
      toStore = Children({ list });
    }
    store.set(entity, toStore);
    this.entityComponents.get(entity)!.add(type);
    if (isNew) this.changes.markAdded(entity, type);
    else this.changes.markChanged(entity, type);
    if (type === Transform || type === Parent) {
      this.markHierarchyDirty(entity);
    }
  }
}

export { INVALID_ENTITY };
export type { SharedPackedStorage };
