/**
 * Opaque entity identifier packed as:
 *   generation in the high bits, index in the low INDEX_BITS.
 *
 * Stale handles fail `world.isAlive` after recycle.
 */
export type Entity = number;

export const INVALID_ENTITY: Entity = -1;

/** Index width — supports ~1M concurrent entity slots. */
export const ENTITY_INDEX_BITS = 20;
export const ENTITY_INDEX_MASK = (1 << ENTITY_INDEX_BITS) - 1;

export function entityIndex(entity: Entity): number {
  return entity & ENTITY_INDEX_MASK;
}

export function entityGeneration(entity: Entity): number {
  return entity >>> ENTITY_INDEX_BITS;
}

export function packEntity(index: number, generation: number): Entity {
  return ((generation & 0xfff) << ENTITY_INDEX_BITS) | (index & ENTITY_INDEX_MASK);
}
