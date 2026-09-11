export declare const IS_RESOURCE_TYPE: unique symbol;
export interface ResourceType<T = unknown> {
    readonly [IS_RESOURCE_TYPE]: true;
    readonly id: symbol;
    readonly name?: string;
}
/** Class constructor used as a resource key. */
export type ResourceConstructor<T> = abstract new (...args: never[]) => T;
export type ResourceKey<T = unknown> = ResourceType<T> | ResourceConstructor<T> | (abstract new (...args: never[]) => T);
export declare function resource<T>(name?: string): ResourceType<T>;
export declare function resourceKeyId(key: ResourceKey): symbol | ResourceKey;
//# sourceMappingURL=resource.d.ts.map