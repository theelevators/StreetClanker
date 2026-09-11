/** mob3 Execution ABI generation. Bump only on breaking contract changes. */
export const ABI_VERSION = 1;
export class AbiError extends Error {
    code;
    systemName;
    constructor(code, message, systemName) {
        super(message);
        this.name = "AbiError";
        this.code = code;
        this.systemName = systemName;
    }
}
//# sourceMappingURL=types.js.map