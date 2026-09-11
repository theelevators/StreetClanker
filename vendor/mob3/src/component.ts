export const COMPONENT_TYPE = Symbol.for("mob3.componentType");
export const IS_COMPONENT_TYPE = Symbol.for("mob3.isComponentType");

export type ComponentData = object | boolean | number | string | symbol;

export interface ComponentType<T = unknown> {
  readonly [IS_COMPONENT_TYPE]: true;
  readonly id: symbol;
  readonly defaults: T;
  readonly isTag: boolean;
  /** Create a component instance (tags ignore partial and return the tag sentinel). */
  (partial?: T extends object ? Partial<T> : never): T;
  create(partial?: T extends object ? Partial<T> : never): T;
}

export type InferComponent<C> = C extends ComponentType<infer T> ? T : never;

export type ComponentBundleItem =
  | ComponentType<unknown>
  | { readonly [COMPONENT_TYPE]: ComponentType<unknown> };

let componentSeq = 0;

function createComponentType<T>(defaults: T, isTag: boolean): ComponentType<T> {
  const id = Symbol(`mob3.component.${componentSeq++}`);

  const factory = ((partial?: Partial<T & object>) => {
    return factory.create(partial as never);
  }) as ComponentType<T>;

  Object.defineProperty(factory, IS_COMPONENT_TYPE, { value: true });
  Object.defineProperty(factory, "id", { value: id });
  Object.defineProperty(factory, "defaults", { value: defaults });
  Object.defineProperty(factory, "isTag", { value: isTag });

  factory.create = ((partial?: Partial<T & object>) => {
    let value: T;
    if (isTag) {
      value = defaults;
    } else if (
      defaults !== null &&
      typeof defaults === "object" &&
      !Array.isArray(defaults)
    ) {
      value = { ...(defaults as object), ...(partial ?? {}) } as T;
    } else {
      value = (partial as T | undefined) ?? defaults;
    }

    if (value !== null && typeof value === "object") {
      Object.defineProperty(value, COMPONENT_TYPE, {
        value: factory,
        enumerable: false,
        configurable: true,
      });
    }

    return value;
  }) as ComponentType<T>["create"];

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
export function component<T extends object>(
  defaults: T,
  name?: string,
): ComponentType<T> {
  const t = createComponentType(defaults, false);
  if (name) Object.defineProperty(t, "name", { value: name });
  return t;
}

/**
 * Define a tag component (presence-only).
 *
 * @example
 * const Player = tag();
 * world.spawn(Position(), Player);
 */
export function tag(name = "Tag"): ComponentType<true> {
  const t = createComponentType(true as const, true);
  Object.defineProperty(t, "name", { value: name });
  return t;
}

export function isComponentType(value: unknown): value is ComponentType {
  return (
    typeof value === "function" &&
    (value as ComponentType)[IS_COMPONENT_TYPE] === true
  );
}

export function resolveBundleItem(
  item: ComponentBundleItem,
): { type: ComponentType; value: unknown } {
  if (isComponentType(item)) {
    return { type: item, value: item.isTag ? item.defaults : item.create() };
  }

  const typed = item as { readonly [COMPONENT_TYPE]?: ComponentType };
  const type = typed[COMPONENT_TYPE];
  if (!type) {
    throw new Error(
      "spawn/add expected a component instance or tag. Did you forget to call Component({ ... })?",
    );
  }
  return { type, value: item };
}
