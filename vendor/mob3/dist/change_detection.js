/**
 * Frame-scoped change tracking.
 * Advance `tick` once per App frame (`world.beginFrame()`).
 * Marks use the current tick. Query `.changed()` / `.added()` match this tick.
 */
export class ChangeTracker {
    /** Current world change tick (starts at 0; beginFrame advances before work). */
    tick = 0;
    changedAt = new Map();
    addedAt = new Map();
    removed = [];
    /** Coarse store-level dirty ticks (worker/WASM conservative). */
    storeDirty = new Map();
    beginFrame() {
        this.tick++;
        // Drop removed records older than 2 ticks
        const min = this.tick - 2;
        this.removed = this.removed.filter((r) => r.tick >= min);
    }
    markChanged(entity, type) {
        let m = this.changedAt.get(type.id);
        if (!m) {
            m = new Map();
            this.changedAt.set(type.id, m);
        }
        m.set(entity, this.tick);
    }
    markAdded(entity, type) {
        let m = this.addedAt.get(type.id);
        if (!m) {
            m = new Map();
            this.addedAt.set(type.id, m);
        }
        m.set(entity, this.tick);
        this.markChanged(entity, type);
    }
    markRemoved(entity, type) {
        this.removed.push({ entity, type, tick: this.tick });
        this.changedAt.get(type.id)?.delete(entity);
        this.addedAt.get(type.id)?.delete(entity);
    }
    /** Conservative: entire component type dirty this tick (off-main writes). */
    markStoreChanged(type) {
        this.storeDirty.set(type.id, this.tick);
    }
    isStoreDirty(type) {
        return this.storeDirty.get(type.id) === this.tick;
    }
    changedTick(entity, type) {
        return this.changedAt.get(type.id)?.get(entity) ?? 0;
    }
    addedTick(entity, type) {
        return this.addedAt.get(type.id)?.get(entity) ?? 0;
    }
    isChanged(entity, type) {
        if (this.isStoreDirty(type))
            return true;
        return this.changedTick(entity, type) === this.tick;
    }
    isAdded(entity, type) {
        return this.addedTick(entity, type) === this.tick;
    }
    removedThisTick(type) {
        return this.removed
            .filter((r) => r.tick === this.tick && (!type || r.type === type))
            .map((r) => ({ entity: r.entity, type: r.type }));
    }
    clearEntity(entity) {
        for (const m of this.changedAt.values())
            m.delete(entity);
        for (const m of this.addedAt.values())
            m.delete(entity);
    }
}
//# sourceMappingURL=change_detection.js.map