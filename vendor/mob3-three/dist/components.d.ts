import { Transform, type TransformData, type ComponentType } from "mob3";
import type { Object3D, Scene, WebGLRenderer, Camera, PerspectiveCamera } from "three";
export type ThreeObjectData = {
    object: Object3D;
};
export declare const ThreeObject: ComponentType<ThreeObjectData> & {
    (object: Object3D): ThreeObjectData;
    (partial?: Partial<ThreeObjectData>): ThreeObjectData;
};
export declare function threeObject(object: Object3D): ThreeObjectData;
export declare const ThreeScene: import("mob3").ResourceType<Scene>;
export declare const ThreeRenderer: import("mob3").ResourceType<WebGLRenderer>;
export declare const ThreeCamera: import("mob3").ResourceType<Camera>;
export type ThreePluginOptions = {
    canvas?: HTMLCanvasElement;
    antialias?: boolean;
    renderer?: WebGLRenderer;
    scene?: Scene;
    camera?: Camera;
    createDefaultCamera?: boolean;
    clearColor?: number;
    autoResize?: boolean;
};
export { Transform, type TransformData };
export type { Object3D, Scene, WebGLRenderer, Camera, PerspectiveCamera };
//# sourceMappingURL=components.d.ts.map