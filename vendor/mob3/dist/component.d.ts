export declare const COMPONENT_TYPE: unique symbol;
export declare const IS_COMPONENT_TYPE: unique symbol;
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
export type ComponentBundleItem = ComponentType<unknown> | {
    readonly [COMPONENT_TYPE]: ComponentType<unknown>;
};
/**
 * Define a data component with default field values.
 *
 * @example
 * const Position = component({ x: 0, y: 0, z: 0 });
 * const Health = component({ value: 100 }, "Health");
 * world.spawn(Position({ x: 1 }));
 */
export declare function component<T extends object>(defaults: T, name?: string): ComponentType<T>;
/**
 * Define a tag component (presence-only).
 *
 * @example
 * const Player = tag();
 * world.spawn(Position(), Player);
 */
export declare function tag(name?: string): ComponentType<true>;
export declare function isComponentType(value: unknown): value is ComponentType;
export declare function resolveBundleItem(item: ComponentBundleItem): {
    type: ComponentType;
    value: unknown;
};
//# sourceMappingURL=component.d.ts.map