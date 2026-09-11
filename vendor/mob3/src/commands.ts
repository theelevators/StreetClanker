import type { Entity } from "./entity.js";
import type {
  ComponentBundleItem,
  ComponentType,
} from "./component.js";
import type { World } from "./world.js";
import type { DespawnOptions, SetParentOptions } from "./hierarchy.js";

type SpawnOp = {
  kind: "spawn";
  entity: Entity;
  bundle: ComponentBundleItem[];
};

type DespawnOp = {
  kind: "despawn";
  entity: Entity;
  options: DespawnOptions;
};

type AddOp = {
  kind: "add";
  entity: Entity;
  item: ComponentBundleItem;
};

type RemoveOp = {
  kind: "remove";
  entity: Entity;
  type: ComponentType;
};

type SetParentOp = {
  kind: "setParent";
  child: Entity;
  parent: Entity | null;
  options: SetParentOptions;
};

type CommandOp = SpawnOp | DespawnOp | AddOp | RemoveOp | SetParentOp;

/**
 * Deferred structural mutations.
 */
export class Commands {
  private ops: CommandOp[] = [];

  constructor(private readonly world: World) {}

  spawn(...bundle: ComponentBundleItem[]): Entity {
    const entity = this.world.reserveEntity();
    this.ops.push({ kind: "spawn", entity, bundle: [...bundle] });
    return entity;
  }

  spawnChild(parent: Entity, ...bundle: ComponentBundleItem[]): Entity {
    const entity = this.spawn(...bundle);
    this.setParent(entity, parent);
    return entity;
  }

  despawn(entity: Entity, options: DespawnOptions = {}): void {
    this.ops.push({ kind: "despawn", entity, options });
  }

  add(entity: Entity, item: ComponentBundleItem): void {
    this.ops.push({ kind: "add", entity, item });
  }

  remove(entity: Entity, type: ComponentType): void {
    this.ops.push({ kind: "remove", entity, type });
  }

  setParent(
    child: Entity,
    parent: Entity | null,
    options: SetParentOptions = {},
  ): void {
    this.ops.push({ kind: "setParent", child, parent, options });
  }

  removeParent(child: Entity): void {
    this.setParent(child, null);
  }

  get pending(): number {
    return this.ops.length;
  }

  flush(): void {
    const ops = this.ops;
    this.ops = [];
    for (const op of ops) {
      switch (op.kind) {
        case "spawn":
          this.world.realizeReserved(op.entity, op.bundle);
          break;
        case "despawn":
          this.world.despawn(op.entity, op.options);
          break;
        case "add":
          if (this.world.isAlive(op.entity)) {
            this.world.add(op.entity, op.item);
          }
          break;
        case "remove":
          this.world.remove(op.entity, op.type);
          break;
        case "setParent":
          if (this.world.isAlive(op.child)) {
            if (op.parent === null || this.world.isAlive(op.parent)) {
              this.world.setParent(op.child, op.parent, op.options);
            }
          }
          break;
      }
    }
  }
}
