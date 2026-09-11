import type { AbiScalarType, SchemaBinding, StoreId, StoreInvocation, SystemInvocation } from "./types.js";
export type AbiColumn = Float32Array | Float64Array | Int32Array | Uint32Array;
export type AbiStoreView = {
    storeId: StoreId;
    name: string;
    count: number;
    capacity: number;
    entities: Uint32Array;
    fields: Record<string, AbiColumn>;
    writable: boolean;
    /** Field columns also exposed as `view.x`, `view.y`, … */
    [field: string]: unknown;
};
/**
 * Capability-narrowed execution context. No World / App / Commands.
 */
export declare class AbiContext {
    readonly tick: number;
    readonly delta: number;
    readonly scheduleName: string;
    readonly systemName: string;
    private readonly byId;
    private readonly byName;
    private readonly readIds;
    private readonly writeIds;
    private readonly resources;
    private readonly validateAccess;
    constructor(invocation: SystemInvocation, options?: {
        validateAccess?: boolean;
    });
    resource<T = unknown>(name: string): T;
    readByName(name: string): AbiStoreView;
    writeByName(name: string): AbiStoreView;
    read(storeId: StoreId): AbiStoreView;
    write(storeId: StoreId): AbiStoreView;
    /** Debug: store names exposed to this invocation. */
    storeNames(): string[];
}
export declare function materializeStore(store: StoreInvocation, writable: boolean): AbiStoreView;
export declare function schemaBindingFromInvocation(invocation: SystemInvocation): SchemaBinding;
export declare function validateStoreSchema(store: StoreInvocation, expected: Array<{
    name: string;
    type: AbiScalarType;
}>, systemName: string): void;
//# sourceMappingURL=context.d.ts.map