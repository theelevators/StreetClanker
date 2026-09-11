export const IS_RESOURCE_TYPE = Symbol.for("mob3.isResourceType");

export interface ResourceType<T = unknown> {
  readonly [IS_RESOURCE_TYPE]: true;
  readonly id: symbol;
  readonly name?: string;
}

/** Class constructor used as a resource key. */
export type ResourceConstructor<T> = abstract new (...args: never[]) => T;

export type ResourceKey<T = unknown> =
  | ResourceType<T>
  | ResourceConstructor<T>
  | (abstract new (...args: never[]) => T);

export function resource<T>(name = "Resource"): ResourceType<T> {
  return {
    [IS_RESOURCE_TYPE]: true,
    id: Symbol(`mob3.resource.${name}`),
    name,
  };
}

export function resourceKeyId(key: ResourceKey): symbol | ResourceKey {
  if (
    typeof key === "object" &&
    key !== null &&
    IS_RESOURCE_TYPE in key &&
    (key as ResourceType)[IS_RESOURCE_TYPE]
  ) {
    return (key as ResourceType).id;
  }
  return key;
}
