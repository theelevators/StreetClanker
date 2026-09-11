/**
 * Marks an entity for structural removal after view/physics cleanup systems run.
 * Integrations (@mob3/three, @mob3/rapier, debug canvas) should release external
 * objects when they see this tag; apps then run a despawn system.
 */
export declare const PendingDespawn: import("./component.js").ComponentType<true>;
//# sourceMappingURL=pending_despawn.d.ts.map