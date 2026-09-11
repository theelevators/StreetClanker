export const IS_RESOURCE_TYPE = Symbol.for("mob3.isResourceType");
export function resource(name = "Resource") {
    return {
        [IS_RESOURCE_TYPE]: true,
        id: Symbol(`mob3.resource.${name}`),
        name,
    };
}
export function resourceKeyId(key) {
    if (typeof key === "object" &&
        key !== null &&
        IS_RESOURCE_TYPE in key &&
        key[IS_RESOURCE_TYPE]) {
        return key.id;
    }
    return key;
}
//# sourceMappingURL=resource.js.map