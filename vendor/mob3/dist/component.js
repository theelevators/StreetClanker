export const COMPONENT_TYPE = Symbol.for("mob3.componentType");
export const IS_COMPONENT_TYPE = Symbol.for("mob3.isComponentType");
let componentSeq = 0;
function createComponentType(defaults, isTag) {
    const id = Symbol(`mob3.component.${componentSeq++}`);
    const factory = ((partial) => {
        return factory.create(partial);
    });
    Object.defineProperty(factory, IS_COMPONENT_TYPE, { value: true });
    Object.defineProperty(factory, "id", { value: id });
    Object.defineProperty(factory, "defaults", { value: defaults });
    Object.defineProperty(factory, "isTag", { value: isTag });
    factory.create = ((partial) => {
        let value;
        if (isTag) {
            value = defaults;
        }
        else if (defaults !== null &&
            typeof defaults === "object" &&
            !Array.isArray(defaults)) {
            value = { ...defaults, ...(partial ?? {}) };
        }
        else {
            value = partial ?? defaults;
        }
        if (value !== null && typeof value === "object") {
            Object.defineProperty(value, COMPONENT_TYPE, {
                value: factory,
                enumerable: false,
                configurable: true,
            });
        }
        return value;
    });
    return factory;
}
/**
 * Define a data component with default field values.
 *
 * @example
 * const Position = component({ x: 0, y: 0, z: 0 });
 * const Health = component({ value: 100 }, "Health");
 * world.spawn(Position({ x: 1 }));
 */
export function component(defaults, name) {
    const t = createComponentType(defaults, false);
    if (name)
        Object.defineProperty(t, "name", { value: name });
    return t;
}
/**
 * Define a tag component (presence-only).
 *
 * @example
 * const Player = tag();
 * world.spawn(Position(), Player);
 */
export function tag(name = "Tag") {
    const t = createComponentType(true, true);
    Object.defineProperty(t, "name", { value: name });
    return t;
}
export function isComponentType(value) {
    return (typeof value === "function" &&
        value[IS_COMPONENT_TYPE] === true);
}
export function resolveBundleItem(item) {
    if (isComponentType(item)) {
        return { type: item, value: item.isTag ? item.defaults : item.create() };
    }
    const typed = item;
    const type = typed[COMPONENT_TYPE];
    if (!type) {
        throw new Error("spawn/add expected a component instance or tag. Did you forget to call Component({ ... })?");
    }
    return { type, value: item };
}
//# sourceMappingURL=component.js.map