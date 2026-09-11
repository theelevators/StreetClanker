import type { ComponentType } from "../component.js";
import type { ComponentId, StoreId, SystemIdNum } from "./types.js";

/**
 * Integer IDs stable for the lifetime of one App/World execution context.
 * Not stable across process restarts or different applications.
 */
export class AbiIdRegistry {
  private nextComponent = 1;
  private nextSystem = 1;
  private readonly componentIds = new WeakMap<ComponentType, ComponentId>();
  private readonly componentById = new Map<ComponentId, ComponentType>();
  private readonly systemIds = new Map<string, SystemIdNum>();
  /** storeId === componentId for v1 (1:1 component↔store). */
  private readonly storeNames = new Map<StoreId, string>();

  componentId(type: ComponentType): ComponentId {
    let id = this.componentIds.get(type);
    if (id === undefined) {
      id = this.nextComponent++;
      this.componentIds.set(type, id);
      this.componentById.set(id, type);
      const name =
        (type as { name?: string }).name &&
        (type as { name?: string }).name !== "factory"
          ? (type as { name: string }).name
          : type.id.description ?? `comp${id}`;
      this.storeNames.set(id, name);
    }
    return id;
  }

  storeId(type: ComponentType): StoreId {
    return this.componentId(type);
  }

  storeName(id: StoreId): string | undefined {
    return this.storeNames.get(id);
  }

  systemId(name: string): SystemIdNum {
    let id = this.systemIds.get(name);
    if (id === undefined) {
      id = this.nextSystem++;
      this.systemIds.set(name, id);
    }
    return id;
  }

  componentType(id: ComponentId): ComponentType | undefined {
    return this.componentById.get(id);
  }
}
