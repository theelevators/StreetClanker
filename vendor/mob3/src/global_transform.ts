import { component } from "./component.js";
import type { TransformData } from "./transform.js";

/**
 * Derived world-space transform. Overwritten by transformPropagation.
 * Same TRS field shape as Transform for DX; do not treat as authoritative local state.
 */
export type GlobalTransformData = TransformData;

export const GlobalTransform = component<GlobalTransformData>(
  {
    x: 0,
    y: 0,
    z: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    sx: 1,
    sy: 1,
    sz: 1,
  },
  "GlobalTransform",
);
