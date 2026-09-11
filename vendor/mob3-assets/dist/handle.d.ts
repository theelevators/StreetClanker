import type { AssetType } from "./types.js";
/**
 * Cheap typed handle. Generation invalidates after slot reuse / unload.
 */
export type AssetHandle<T> = {
    readonly typeId: symbol;
    readonly index: number;
    readonly generation: number;
    readonly key: string;
    readonly typeName: string;
    /** Phantom — never present at runtime. */
    readonly __type?: T;
};
export declare function makeHandle<T>(type: AssetType<T>, index: number, generation: number, key: string): AssetHandle<T>;
export declare function handlesEqual(a: AssetHandle<unknown>, b: AssetHandle<unknown>): boolean;
//# sourceMappingURL=handle.d.ts.map