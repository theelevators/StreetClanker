import type { TransformData } from "./transform.js";
/**
 * Derived world-space transform. Overwritten by transformPropagation.
 * Same TRS field shape as Transform for DX; do not treat as authoritative local state.
 */
export type GlobalTransformData = TransformData;
export declare const GlobalTransform: import("./component.js").ComponentType<TransformData>;
//# sourceMappingURL=global_transform.d.ts.map