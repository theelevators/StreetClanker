import type { Entity } from "./entity.js";
import type { ComponentType } from "./component.js";

/**
 * Frame-scoped change tracking.
 * Advance `tick` once per App frame (`world.beginFrame()`).
 * Marks use the current tick. Query `.changed()` / `.added()` match this tick.
 */
export class ChangeTracker {
  /** Current world change tick (starts at 0; beginFrame advances before work). */
  tick = 0;
  private readonly changedAt = new Map<symbol, Map<Entity, number>>();
  private readonly addedAt = new Map<symbol, Map<Entity, number>>();
  private removed: Array<{ entity: Entity; type: ComponentType; tick: number }> =
    [];
  /** Coarse store-level dirty ticks (worker/WASM conservative). */
  private readonly storeDirty = new Map<symbol, number>();

  beginFrame(): void {
    this.tick++;
    // Drop removed records older than 2 ticks
    const min = this.tick - 2;
    this.removed = this.removed.filter((r) => r.tick >= min);
  }

  markChanged(entity: Entity, type: ComponentType): void {
    let m = this.changedAt.get(type.id);
    if (!m) {
      m = new Map();
      this.changedAt.set(type.id, m);
    }
    m.set(entity, this.tick);
  }

  markAdded(entity: Entity, type: ComponentType): void {
    let m = this.addedAt.get(type.id);
    if (!m) {
      m = new Map();
      this.addedAt.set(type.id, m);
    }
    m.set(entity, this.tick);
    this.markChanged(entity, type);
  }

  markRemoved(entity: Entity, type: ComponentType): void {
    this.removed.push({ entity, type, tick: this.tick });
    this.changedAt.get(type.id)?.delete(entity);
    this.addedAt.get(type.id)?.delete(entity);
  }

  /** Conservative: entire component type dirty this tick (off-main writes). */
  markStoreChanged(type: ComponentType): void {
    this.storeDirty.set(type.id, this.tick);
  }

  isStoreDirty(type: ComponentType): boolean {
    return this.storeDirty.get(type.id) === this.tick;
  }

  changedTick(entity: Entity, type: ComponentType): number {
    return this.changedAt.get(type.id)?.get(entity) ?? 0;
  }

  addedTick(entity: Entity, type: ComponentType): number {
    return this.addedAt.get(type.id)?.get(entity) ?? 0;
  }

  isChanged(entity: Entity, type: ComponentType): boolean {
    if (this.isStoreDirty(type)) return true;
    return this.changedTick(entity, type) === this.tick;
  }

  isAdded(entity: Entity, type: ComponentType): boolean {
    return this.addedTick(entity, type) === this.tick;
  }

  removedThisTick(type?: ComponentType): Array<{ entity: Entity; type: ComponentType }> {
    return this.removed
      .filter((r) => r.tick === this.tick && (!type || r.type === type))
      .map((r) => ({ entity: r.entity, type: r.type }));
  }

  clearEntity(entity: Entity): void {
    for (const m of this.changedAt.values()) m.delete(entity);
    for (const m of this.addedAt.values()) m.delete(entity);
  }
}
