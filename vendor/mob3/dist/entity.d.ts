/**
 * Opaque entity identifier packed as:
 *   generation in the high bits, index in the low INDEX_BITS.
 *
 * Stale handles fail `world.isAlive` after recycle.
 */
export type Entity = number;
export declare const INVALID_ENTITY: Entity;
/** Index width — supports ~1M concurrent entity slots. */
export declare const ENTITY_INDEX_BITS = 20;
export declare const ENTITY_INDEX_MASK: number;
export declare function entityIndex(entity: Entity): number;
export declare function entityGeneration(entity: Entity): number;
export declare function packEntity(index: number, generation: number): Entity;
//# sourceMappingURL=entity.d.ts.map