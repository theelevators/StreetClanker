import type { WorkerPool } from "../parallel/pool.js";
import type {
  AbiExecutor,
  ExecutionResult,
  SystemInvocation,
} from "./types.js";
import { ABI_VERSION } from "./types.js";
import { collectTransferables } from "./build.js";

export type JsWorkerAbiExecutorOptions = {
  pool: WorkerPool;
  moduleUrl: string;
  exportName: string;
};

/**
 * Dispatches ABI invocations to a JS worker via the shared pool.
 * Worker receives SystemInvocation — never World.
 */
export class JsWorkerAbiExecutor implements AbiExecutor {
  private readonly pool: WorkerPool;
  private readonly moduleUrl: string;
  private readonly exportName: string;

  constructor(options: JsWorkerAbiExecutorOptions) {
    this.pool = options.pool;
    this.moduleUrl = options.moduleUrl;
    this.exportName = options.exportName;
  }

  async execute(invocation: SystemInvocation): Promise<ExecutionResult> {
    if (!this.pool.available) {
      throw new Error(
        `JsWorkerAbiExecutor: worker pool unavailable for '${invocation.system.name}'`,
      );
    }

    const transfer = collectTransferables(invocation);
    const result = (await this.pool.runJob(
      this.moduleUrl,
      this.exportName,
      invocation as unknown as Record<string, unknown>,
      invocation.system.name,
      transfer.length ? transfer : undefined,
    )) as unknown as ExecutionResult & { events?: ExecutionResult["events"]; execMs?: number };

    if (result && "abiVersion" in result && result.abiVersion != null) {
      return result;
    }

    return {
      abiVersion: ABI_VERSION,
      systemId: invocation.system.id,
      status: "ok",
      events: result.events,
      localWrites: result.localWrites,
      execMs: result.execMs,
    };
  }

  dispose(): void {
    /* pool owned by ParallelExecutor */
  }
}
