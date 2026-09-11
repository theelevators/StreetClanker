import type { Entity } from "./entity.js";
import type { ComponentType } from "./component.js";
/**
 * Frame-scoped change tracking.
 * Advance `tick` once per App frame (`world.beginFrame()`).
 * Marks use the current tick. Query `.changed()` / `.added()` match this tick.
 */
export declare class ChangeTracker {
    /** Current world change tick (starts at 0; beginFrame advances before work). */
    tick: number;
    private readonly changedAt;
    private readonly addedAt;
    private removed;
    /** Coarse store-level dirty ticks (worker/WASM conservative). */
    private readonly storeDirty;
    beginFrame(): void;
    markChanged(entity: Entity, type: ComponentType): void;
    markAdded(entity: Entity, type: ComponentType): void;
    markRemoved(entity: Entity, type: ComponentType): void;
    /** Conservative: entire component type dirty this tick (off-main writes). */
    markStoreChanged(type: ComponentType): void;
    isStoreDirty(type: ComponentType): boolean;
    changedTick(entity: Entity, type: ComponentType): number;
    addedTick(entity: Entity, type: ComponentType): number;
    isChanged(entity: Entity, type: ComponentType): boolean;
    isAdded(entity: Entity, type: ComponentType): boolean;
    removedThisTick(type?: ComponentType): Array<{
        entity: Entity;
        type: ComponentType;
    }>;
    clearEntity(entity: Entity): void;
}
//# sourceMappingURL=change_detection.d.ts.map