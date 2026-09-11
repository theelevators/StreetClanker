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
export declare const Transform: import("./component.js").ComponentType<TransformData>;
//# sourceMappingURL=transform.d.ts.map