import type { AbiScalarType, AbiSystemModule, SchemaBinding } from "./types.js";
export type AbiFieldExpectation = {
    name: string;
    type: AbiScalarType;
};
export type AbiStoreExpectation = {
    name: string;
    fields: readonly AbiFieldExpectation[];
};
/**
 * Declares an ABI-executable system module.
 * Must be importable from a worker URL — no closures.
 */
export declare function defineAbiSystem(def: {
    name: string;
    abiVersion?: number;
    /** Expected stores for bind-time validation. */
    expects?: readonly AbiStoreExpectation[];
    bind?: (schema: SchemaBinding) => void;
    execute: AbiSystemModule["execute"];
}): AbiSystemModule;
//# sourceMappingURL=define.d.ts.map