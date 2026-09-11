import type { Entity } from "./entity.js";
import type { ComponentBundleItem, ComponentType } from "./component.js";
import type { World } from "./world.js";
import type { DespawnOptions, SetParentOptions } from "./hierarchy.js";
/**
 * Deferred structural mutations.
 */
export declare class Commands {
    private readonly world;
    private ops;
    constructor(world: World);
    spawn(...bundle: ComponentBundleItem[]): Entity;
    spawnChild(parent: Entity, ...bundle: ComponentBundleItem[]): Entity;
    despawn(entity: Entity, options?: DespawnOptions): void;
    add(entity: Entity, item: ComponentBundleItem): void;
    remove(entity: Entity, type: ComponentType): void;
    setParent(child: Entity, parent: Entity | null, options?: SetParentOptions): void;
    removeParent(child: Entity): void;
    get pending(): number;
    flush(): void;
}
//# sourceMappingURL=commands.d.ts.map