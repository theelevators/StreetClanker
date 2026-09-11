import { component } from "./component.js";

/**
 * Local spatial transform. Simulation-authoritative.
 * Rendering plugins (e.g. @mob3/three) may sync this onto view objects.
 */
export type TransformData = {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  sz: number;
};

export const Transform = component<TransformData>(
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
  "Transform",
);
