import type { Entity } from "./entity.js";
import {
  type ComponentType,
  type InferComponent,
  isComponentType,
} from "./component.js";
import type { World } from "./world.js";

export type QueryTuple<Cs extends readonly ComponentType[]> = {
  [I in keyof Cs]: InferComponent<Cs[I]>;
};

export type QueryRow<Cs extends readonly ComponentType[]> = [
  Entity,
  ...QueryTuple<Cs>,
];

/**
 * Live query view over world storage. Iterating does not allocate a result array.
 */
export class Query<Cs extends readonly ComponentType[] = ComponentType[]>
  implements Iterable<QueryRow<Cs>>
{
  private readonly required: ComponentType[];
  private readonly withTypes: ComponentType[] = [];
  private readonly withoutTypes: ComponentType[] = [];
  private changedTypes: ComponentType[] = [];
  private addedTypes: ComponentType[] = [];

  constructor(
    private readonly world: World,
    required: readonly ComponentType[],
  ) {
    this.required = [...required];
  }

  with(...types: ComponentType[]): this {
    this.withTypes.push(...types);
    return this;
  }

  without(...types: ComponentType[]): this {
    this.withoutTypes.push(...types);
    return this;
  }

  /** Entities where any listed type changed this frame tick. */
  changed(...types: ComponentType[]): this {
    this.changedTypes.push(...(types.length ? types : this.required));
    return this;
  }

  /** Entities where any listed type was added this frame tick. */
  added(...types: ComponentType[]): this {
    this.addedTypes.push(...(types.length ? types : this.required));
    return this;
  }

  /** Materialize matching rows into an array (allocates). */
  collect(): QueryRow<Cs>[] {
    return [...this];
  }

  /**
   * Callback iteration — avoids per-row tuple allocation from `for...of`.
   * Prefer this in hot systems when profiling shows iterator GC pressure.
   */
  forEach(
    fn: (entity: Entity, ...components: QueryTuple<Cs>) => void,
  ): void {
    for (const entity of this.matchingEntities()) {
      const comps = this.required.map((type) =>
        this.world.get(entity, type),
      ) as QueryTuple<Cs>;
      fn(entity, ...comps);
    }
  }

  *[Symbol.iterator](): Iterator<QueryRow<Cs>> {
    for (const entity of this.matchingEntities()) {
      const row = [entity] as unknown as QueryRow<Cs>;
      for (let i = 0; i < this.required.length; i++) {
        row.push(this.world.get(entity, this.required[i]!) as never);
      }
      yield row;
    }
  }

  private *matchingEntities(): IterableIterator<Entity> {
    if (this.required.length === 0) return;

    let drive = this.required[0]!;
    let driveSize = this.world.componentStoreSize(drive);
    for (let i = 1; i < this.required.length; i++) {
      const type = this.required[i]!;
      const size = this.world.componentStoreSize(type);
      if (size < driveSize) {
        drive = type;
        driveSize = size;
      }
    }

    const filterTypes = [
      ...this.required.filter((t) => t !== drive),
      ...this.withTypes,
    ];

    for (const entity of this.world.entitiesWith(drive)) {
      let ok = true;
      for (const type of filterTypes) {
        if (!this.world.has(entity, type)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      for (const type of this.withoutTypes) {
        if (this.world.has(entity, type)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      if (this.changedTypes.length) {
        let any = false;
        for (const type of this.changedTypes) {
          if (this.world.isChanged(entity, type)) {
            any = true;
            break;
          }
        }
        if (!any) continue;
      }

      if (this.addedTypes.length) {
        let any = false;
        for (const type of this.addedTypes) {
          if (this.world.isAdded(entity, type)) {
            any = true;
            break;
          }
        }
        if (!any) continue;
      }

      yield entity;
    }
  }
}

export function assertComponentTypes(types: unknown[]): asserts types is ComponentType[] {
  for (const type of types) {
    if (!isComponentType(type)) {
      throw new Error("query() arguments must be component types from component()/tag()");
    }
  }
}
