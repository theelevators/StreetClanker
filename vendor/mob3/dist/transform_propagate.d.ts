import type { World } from "./world.js";
/**
 * Deterministic hierarchy propagation — iterative, parent before child.
 * Dirty flooding marks whole subtrees; selective BFS when coverage is small.
 */
export declare const transformPropagation: import("./system.js").DeclaredSystem;
/** Recompute child local so GlobalTransform is preserved after reparent. */
export declare function recomputeLocalPreservingGlobal(world: World, child: number, newParent: number | null): void;
//# sourceMappingURL=transform_propagate.d.ts.map