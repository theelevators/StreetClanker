import {
  resource,
  COMPONENT_TYPE,
  IS_COMPONENT_TYPE,
  Transform,
  type TransformData,
  type ComponentType,
} from "mob3";
import type { Object3D, Scene, WebGLRenderer, Camera, PerspectiveCamera } from "three";

export type ThreeObjectData = {
  object: Object3D;
};

/**
 * Component holding a real THREE.Object3D.
 * The factory is also the component type identity used in queries/storage.
 *
 * @example
 * world.spawn(Transform(), ThreeObject(mesh));
 */
function createThreeObjectType(): ComponentType<ThreeObjectData> & {
  (object: Object3D): ThreeObjectData;
  (partial?: Partial<ThreeObjectData>): ThreeObjectData;
} {
  const defaults: ThreeObjectData = {
    object: null as unknown as Object3D,
  };
  const id = Symbol("mob3.ThreeObject");

  const factory = ((arg?: Object3D | Partial<ThreeObjectData>) => {
    let data: ThreeObjectData;
    if (arg && typeof arg === "object" && "isObject3D" in arg) {
      data = { object: arg as Object3D };
    } else {
      data = { ...defaults, ...(arg as Partial<ThreeObjectData> | undefined) };
    }
    Object.defineProperty(data, COMPONENT_TYPE, {
      value: factory,
      enumerable: false,
      configurable: true,
    });
    return data;
  }) as ComponentType<ThreeObjectData> & {
    (object: Object3D): ThreeObjectData;
    (partial?: Partial<ThreeObjectData>): ThreeObjectData;
  };

  Object.defineProperty(factory, IS_COMPONENT_TYPE, { value: true });
  Object.defineProperty(factory, "id", { value: id });
  Object.defineProperty(factory, "defaults", { value: defaults });
  Object.defineProperty(factory, "isTag", { value: false });
  Object.defineProperty(factory, "name", { value: "ThreeObject" });
  factory.create = ((partial?: Partial<ThreeObjectData>) =>
    factory(partial)) as ComponentType<ThreeObjectData>["create"];

  return factory;
}

export const ThreeObject = createThreeObjectType();

export function threeObject(object: Object3D) {
  return ThreeObject(object);
}

export const ThreeScene = resource<Scene>("ThreeScene");
export const ThreeRenderer = resource<WebGLRenderer>("ThreeRenderer");
export const ThreeCamera = resource<Camera>("ThreeCamera");

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
