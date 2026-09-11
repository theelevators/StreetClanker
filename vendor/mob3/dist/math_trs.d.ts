import type { Entity } from "./entity.js";
import type { TransformData } from "./transform.js";
/** Row-major 4x4 */
export type Mat4 = Float64Array;
export declare function mat4Identity(): Mat4;
/** Local TRS (Euler XYZ) → matrix. */
export declare function trsToMat4(t: TransformData, out?: Mat4): Mat4;
export declare function mat4Multiply(a: Mat4, b: Mat4, out?: Mat4): Mat4;
export declare function mat4Invert(m: Mat4, out?: Mat4): Mat4 | null;
/** Extract TRS (Euler XYZ) from matrix — sufficient for hierarchy reparent. */
export declare function mat4ToTrs(m: Mat4, out: TransformData): TransformData;
export declare function copyTrs(from: TransformData, to: TransformData): void;
export type HierarchyNameFn = (entity: Entity) => string | undefined;
/**
 * Format a forest of roots as a text tree.
 */
export declare function formatHierarchyTree(roots: Entity[], childrenOf: (e: Entity) => readonly Entity[], label: (e: Entity) => string): string;
export type EntityInspect = {
    entity: Entity;
    parent: Entity | null;
    children: Entity[];
    root: Entity;
    components: string[];
};
//# sourceMappingURL=math_trs.d.ts.map