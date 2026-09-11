import { resource, COMPONENT_TYPE, IS_COMPONENT_TYPE, Transform, } from "mob3";
/**
 * Component holding a real THREE.Object3D.
 * The factory is also the component type identity used in queries/storage.
 *
 * @example
 * world.spawn(Transform(), ThreeObject(mesh));
 */
function createThreeObjectType() {
    const defaults = {
        object: null,
    };
    const id = Symbol("mob3.ThreeObject");
    const factory = ((arg) => {
        let data;
        if (arg && typeof arg === "object" && "isObject3D" in arg) {
            data = { object: arg };
        }
        else {
            data = { ...defaults, ...arg };
        }
        Object.defineProperty(data, COMPONENT_TYPE, {
            value: factory,
            enumerable: false,
            configurable: true,
        });
        return data;
    });
    Object.defineProperty(factory, IS_COMPONENT_TYPE, { value: true });
    Object.defineProperty(factory, "id", { value: id });
    Object.defineProperty(factory, "defaults", { value: defaults });
    Object.defineProperty(factory, "isTag", { value: false });
    Object.defineProperty(factory, "name", { value: "ThreeObject" });
    factory.create = ((partial) => factory(partial));
    return factory;
}
export const ThreeObject = createThreeObjectType();
export function threeObject(object) {
    return ThreeObject(object);
}
export const ThreeScene = resource("ThreeScene");
export const ThreeRenderer = resource("ThreeRenderer");
export const ThreeCamera = resource("ThreeCamera");
export { Transform };
//# sourceMappingURL=components.js.map