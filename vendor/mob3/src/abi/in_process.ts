import type { AbiExecutor, AbiSystemModule, ExecutionResult, SystemInvocation } from "./types.js";
import { ABI_VERSION, AbiError } from "./types.js";
import { AbiContext, schemaBindingFromInvocation } from "./context.js";
import { snapshotLocalWrites } from "./build.js";

export type InProcessAbiExecutorOptions = {
  /** Resolve system module by name / export key. */
  resolve: (invocation: SystemInvocation) => AbiSystemModule;
  validateAccess?: boolean;
};

/**
 * Executes ABI invocations in-process. Receives NO World — only descriptors.
 */
export class InProcessAbiExecutor implements AbiExecutor {
  private readonly resolve: InProcessAbiExecutorOptions["resolve"];
  private readonly validateAccess: boolean;
  private readonly bindCache = new Map<
    string,
    { genKey: string; bound: boolean }
  >();

  constructor(options: InProcessAbiExecutorOptions) {
    this.resolve = options.resolve;
    this.validateAccess = options.validateAccess ?? true;
  }

  async execute(invocation: SystemInvocation): Promise<ExecutionResult> {
    const t0 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      if (invocation.abiVersion !== ABI_VERSION) {
        throw new AbiError(
          "unsupported_version",
          `Unsupported mob3 Execution ABI version ${invocation.abiVersion}. Executor supports version ${ABI_VERSION}.`,
          invocation.system.name,
        );
      }
      const mod = this.resolve(invocation);
      if (mod.abiVersion !== ABI_VERSION && mod.abiVersion !== undefined) {
        // allow modules that declare abiVersion matching
        if (mod.abiVersion !== invocation.abiVersion) {
          throw new AbiError(
            "unsupported_version",
            `System "${mod.name}" abiVersion ${mod.abiVersion} incompatible with invocation ${invocation.abiVersion}`,
            invocation.system.name,
          );
        }
      }

      const schema = schemaBindingFromInvocation(invocation);
      const genKey = schema.stores
        .map((s) => `${s.id}:${s.generation}`)
        .join(",");
      const cacheKey = `${invocation.system.id}:${mod.name}`;
      const cached = this.bindCache.get(cacheKey);
      if (!cached || cached.genKey !== genKey) {
        mod.bind?.(schema);
        this.bindCache.set(cacheKey, { genKey, bound: true });
      }

      if (invocation.delayMs && invocation.delayMs > 0) {
        const end = Date.now() + invocation.delayMs;
        while (Date.now() < end) {
          /* sync busy-wait for tests */
        }
      }

      const ctx = new AbiContext(invocation, {
        validateAccess: this.validateAccess,
      });
      const maybe = mod.execute(ctx);
      const execMs =
        (typeof performance !== "undefined" ? performance.now() : Date.now()) -
        t0;

      if (maybe && typeof maybe === "object" && "status" in maybe) {
        return { ...maybe, execMs: maybe.execMs ?? execMs };
      }

      const hasLocal = invocation.stores.some((s) => s.memoryKind === "local");
      return {
        abiVersion: ABI_VERSION,
        systemId: invocation.system.id,
        status: "ok",
        localWrites: hasLocal ? snapshotLocalWrites(invocation) : undefined,
        execMs,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        abiVersion: ABI_VERSION,
        systemId: invocation.system.id,
        status: "error",
        error: message,
        execMs:
          (typeof performance !== "undefined" ? performance.now() : Date.now()) -
          t0,
      };
    }
  }

  dispose(): void {
    this.bindCache.clear();
  }
}
