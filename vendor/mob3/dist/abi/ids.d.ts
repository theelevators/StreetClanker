import type { ComponentType } from "../component.js";
import type { ComponentId, StoreId, SystemIdNum } from "./types.js";
/**
 * Integer IDs stable for the lifetime of one App/World execution context.
 * Not stable across process restarts or different applications.
 */
export declare class AbiIdRegistry {
    private nextComponent;
    private nextSystem;
    private readonly componentIds;
    private readonly componentById;
    private readonly systemIds;
    /** storeId === componentId for v1 (1:1 component↔store). */
    private readonly storeNames;
    componentId(type: ComponentType): ComponentId;
    storeId(type: ComponentType): StoreId;
    storeName(id: StoreId): string | undefined;
    systemId(name: string): SystemIdNum;
    componentType(id: ComponentId): ComponentType | undefined;
}
//# sourceMappingURL=ids.d.ts.map