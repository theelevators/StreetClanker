export const f32 = "f32";
export const f64 = "f64";
export const i32 = "i32";
export const u32 = "u32";
export const PACKED_META = Symbol.for("mob3.packedMeta");
export function bytesPerField(kind) {
    switch (kind) {
        case "f32":
        case "i32":
        case "u32":
            return 4;
        case "f64":
            return 8;
    }
}
export function makeTypedArray(kind, buffer, byteOffset, length) {
    switch (kind) {
        case "f32":
            return new Float32Array(buffer, byteOffset, length);
        case "f64":
            return new Float64Array(buffer, byteOffset, length);
        case "i32":
            return new Int32Array(buffer, byteOffset, length);
        case "u32":
            return new Uint32Array(buffer, byteOffset, length);
    }
}
//# sourceMappingURL=types.js.map