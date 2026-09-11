import type { AbiExecutor, AbiSystemModule, ExecutionResult, SystemInvocation } from "./types.js";
export type InProcessAbiExecutorOptions = {
    /** Resolve system module by name / export key. */
    resolve: (invocation: SystemInvocation) => AbiSystemModule;
    validateAccess?: boolean;
};
/**
 * Executes ABI invocations in-process. Receives NO World — only descriptors.
 */
export declare class InProcessAbiExecutor implements AbiExecutor {
    private readonly resolve;
    private readonly validateAccess;
    private readonly bindCache;
    constructor(options: InProcessAbiExecutorOptions);
    execute(invocation: SystemInvocation): Promise<ExecutionResult>;
    dispose(): void;
}
//# sourceMappingURL=in_process.d.ts.map