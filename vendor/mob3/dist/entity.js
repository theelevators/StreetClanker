export const INVALID_ENTITY = -1;
/** Index width — supports ~1M concurrent entity slots. */
export const ENTITY_INDEX_BITS = 20;
export const ENTITY_INDEX_MASK = (1 << ENTITY_INDEX_BITS) - 1;
export function entityIndex(entity) {
    return entity & ENTITY_INDEX_MASK;
}
export function entityGeneration(entity) {
    return entity >>> ENTITY_INDEX_BITS;
}
export function packEntity(index, generation) {
    return ((generation & 0xfff) << ENTITY_INDEX_BITS) | (index & ENTITY_INDEX_MASK);
}
//# sourceMappingURL=entity.js.map