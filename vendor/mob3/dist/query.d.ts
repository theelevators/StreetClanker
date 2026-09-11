import type { Entity } from "./entity.js";
import { type ComponentType, type InferComponent } from "./component.js";
import type { World } from "./world.js";
export type QueryTuple<Cs extends readonly ComponentType[]> = {
    [I in keyof Cs]: InferComponent<Cs[I]>;
};
export type QueryRow<Cs extends readonly ComponentType[]> = [
    Entity,
    ...QueryTuple<Cs>
];
/**
 * Live query view over world storage. Iterating does not allocate a result array.
 */
export declare class Query<Cs extends readonly ComponentType[] = ComponentType[]> implements Iterable<QueryRow<Cs>> {
    private readonly world;
    private readonly required;
    private readonly withTypes;
    private readonly withoutTypes;
    private changedTypes;
    private addedTypes;
    constructor(world: World, required: readonly ComponentType[]);
    with(...types: ComponentType[]): this;
    without(...types: ComponentType[]): this;
    /** Entities where any listed type changed this frame tick. */
    changed(...types: ComponentType[]): this;
    /** Entities where any listed type was added this frame tick. */
    added(...types: ComponentType[]): this;
    /** Materialize matching rows into an array (allocates). */
    collect(): QueryRow<Cs>[];
    /**
     * Callback iteration — avoids per-row tuple allocation from `for...of`.
     * Prefer this in hot systems when profiling shows iterator GC pressure.
     */
    forEach(fn: (entity: Entity, ...components: QueryTuple<Cs>) => void): void;
    [Symbol.iterator](): Iterator<QueryRow<Cs>>;
    private matchingEntities;
}
export declare function assertComponentTypes(types: unknown[]): asserts types is ComponentType[];
//# sourceMappingURL=query.d.ts.map