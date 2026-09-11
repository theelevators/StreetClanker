import type { Entity } from "../entity.js";
import type { ComponentStorage, StorageKind } from "./types.js";

/** Default Map-backed component storage (arbitrary JS values). */
export class ObjectStorage implements ComponentStorage {
  readonly kind: StorageKind = "object";
  private readonly map = new Map<Entity, unknown>();

  get size(): number {
    return this.map.size;
  }

  has(entity: Entity): boolean {
    return this.map.has(entity);
  }

  get(entity: Entity): unknown | undefined {
    return this.map.get(entity);
  }

  set(entity: Entity, value: unknown): void {
    this.map.set(entity, value);
  }

  remove(entity: Entity): boolean {
    return this.map.delete(entity);
  }

  clear(): void {
    this.map.clear();
  }

  *entities(): IterableIterator<Entity> {
    yield* this.map.keys();
  }
}
