import type { Entity } from "./entity.js";
/** Child → parent link. Canonical hierarchy edge. */
export type ParentData = {
    entity: Entity;
};
export declare const Parent: import("./component.js").ComponentType<ParentData>;
/**
 * Parent → children list (secondary index, World-maintained).
 * Do not mutate `list` directly — use setParent / removeParent.
 */
export type ChildrenData = {
    list: Entity[];
};
export declare const Children: import("./component.js").ComponentType<ChildrenData>;
export type HierarchyPreserve = "local" | "global";
export type HierarchyDespawn = "cascade" | "detach";
export type SetParentOptions = {
    /**
     * local (default) — keep child's Transform; world pose may change
     * global — recompute local so GlobalTransform is preserved
     */
    preserve?: HierarchyPreserve;
};
export type DespawnOptions = {
    /**
     * cascade (default) — despawn entire subtree
     * detach — children become roots
     */
    hierarchy?: HierarchyDespawn;
};
//# sourceMappingURL=hierarchy.d.ts.map