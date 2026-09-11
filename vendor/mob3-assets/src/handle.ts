import type { AssetType } from "./types.js";

/**
 * Cheap typed handle. Generation invalidates after slot reuse / unload.
 */
export type AssetHandle<T> = {
  readonly typeId: symbol;
  readonly index: number;
  readonly generation: number;
  readonly key: string;
  readonly typeName: string;
  /** Phantom — never present at runtime. */
  readonly __type?: T;
};

export function makeHandle<T>(
  type: AssetType<T>,
  index: number,
  generation: number,
  key: string,
): AssetHandle<T> {
  return {
    typeId: type.id,
    index,
    generation,
    key,
    typeName: type.name,
  };
}

export function handlesEqual(
  a: AssetHandle<unknown>,
  b: AssetHandle<unknown>,
): boolean {
  return (
    a.typeId === b.typeId &&
    a.index === b.index &&
    a.generation === b.generation
  );
}
