export function makeHandle(type, index, generation, key) {
    return {
        typeId: type.id,
        index,
        generation,
        key,
        typeName: type.name,
    };
}
export function handlesEqual(a, b) {
    return (a.typeId === b.typeId &&
        a.index === b.index &&
        a.generation === b.generation);
}
//# sourceMappingURL=handle.js.map