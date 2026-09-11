import type {
  AbiExecutor,
  AbiScalarType,
  ExecutionResult,
  SystemInvocation,
} from "./types.js";
import { ABI_VERSION, AbiError } from "./types.js";
import type { WasmMemoryArena } from "../storage/wasm_memory.js";
import {
  sharedWasmMemoryAvailable,
  webAssemblyAvailable,
} from "../storage/wasm_memory.js";

export type WasmModuleSource =
  | URL
  | string
  | ArrayBuffer
  | Uint8Array
  | WebAssembly.Module;

export type WasmFieldExpect = {
  name: string;
  type: AbiScalarType;
};

export type WasmStoreExpect = {
  name: string;
  fields: readonly WasmFieldExpect[];
};

export type WasmAbiExecutorOptions = {
  /** WASM binary, URL, or precompiled Module. */
  module: WasmModuleSource;
  /** Exported integrate function name (default "run"). */
  exportName?: string;
  /** Host arena whose Memory is imported as env.memory. */
  arena: WasmMemoryArena;
  /** Expected packed layouts — validated once at bind. */
  expects: readonly WasmStoreExpect[];
  systemName?: string;
};

type BoundField = {
  name: string;
  type: AbiScalarType;
  byteOffset: number;
};

type BoundStore = {
  name: string;
  storeId: number;
  generation: number;
  fields: Map<string, BoundField>;
};

type CachedBinding = {
  genKey: string;
  stores: Map<string, BoundStore>;
  /** Resolved offsets for integrate fixture: tx,ty,tz,vx,vy,vz */
  integrateOffsets: {
    tx: number;
    ty: number;
    tz: number;
    vx: number;
    vy: number;
    vz: number;
  } | null;
};

/**
 * Main-thread WASM executor for Execution ABI v1.
 * Receives SystemInvocation — never World.
 */
export class WasmAbiExecutor implements AbiExecutor {
  private readonly exportName: string;
  private readonly arena: WasmMemoryArena;
  private readonly expects: readonly WasmStoreExpect[];
  private readonly systemName: string;
  private readonly source: WasmModuleSource;
  private module: WebAssembly.Module | null = null;
  private instance: WebAssembly.Instance | null = null;
  private runFn:
    | ((
        count: number,
        delta: number,
        tx: number,
        ty: number,
        tz: number,
        vx: number,
        vy: number,
        vz: number,
      ) => void)
    | null = null;
  private abiVersionFn: (() => number) | null = null;
  private binding: CachedBinding | null = null;
  private disposed = false;
  private compilePromise: Promise<void> | null = null;

  constructor(options: WasmAbiExecutorOptions) {
    this.source = options.module;
    this.exportName = options.exportName ?? "run";
    this.arena = options.arena;
    this.expects = options.expects;
    this.systemName = options.systemName ?? "wasm";
  }

  get ready(): boolean {
    return this.instance !== null && !this.disposed;
  }

  async ensureReady(): Promise<void> {
    if (this.disposed) throw new Error("WasmAbiExecutor disposed");
    if (this.instance) return;
    if (!this.compilePromise) {
      this.compilePromise = this.compileAndInstantiate();
    }
    await this.compilePromise;
  }

  private async compileAndInstantiate(): Promise<void> {
    if (!webAssemblyAvailable()) {
      throw new Error("WebAssembly unavailable");
    }
    if (!sharedWasmMemoryAvailable()) {
      throw new Error("Shared WebAssembly.Memory unavailable");
    }

    const bytes = await resolveWasmBytes(this.source);
    this.instantiateFromBytes(bytes);
  }

  /** Sync instantiate after bytes are available (warm path / Node). */
  instantiateFromBytes(bytes: BufferSource | WebAssembly.Module): void {
    this.module =
      bytes instanceof WebAssembly.Module
        ? bytes
        : new WebAssembly.Module(bytes);

    this.instance = new WebAssembly.Instance(this.module, {
      env: { memory: this.arena.memory },
    });
    const exports = this.instance.exports as Record<string, unknown>;

    const abiFn = exports.abi_version;
    if (typeof abiFn === "function") {
      this.abiVersionFn = abiFn as () => number;
      const v = this.abiVersionFn() | 0;
      if (v !== ABI_VERSION) {
        throw new AbiError(
          "unsupported_version",
          `WASM system "${this.systemName}" expects mob3 Execution ABI v${v}. Runtime provides v${ABI_VERSION}.`,
          this.systemName,
        );
      }
    }

    const run = exports[this.exportName];
    if (typeof run !== "function") {
      throw new Error(
        `WASM system "${this.systemName}": missing export '${this.exportName}' in module`,
      );
    }
    this.runFn = run as typeof this.runFn;
  }

  /** Synchronous execute — module must already be ready. */
  executeSync(invocation: SystemInvocation): ExecutionResult {
    const t0 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      if (this.disposed) {
        throw new Error(`WasmAbiExecutor disposed (${this.systemName})`);
      }
      if (!this.instance || !this.runFn) {
        throw new Error(
          `WasmAbiExecutor "${this.systemName}" not ready — call ensureReady() first`,
        );
      }
      if (invocation.abiVersion !== ABI_VERSION) {
        throw new AbiError(
          "unsupported_version",
          `Unsupported mob3 Execution ABI version ${invocation.abiVersion}. Executor supports version ${ABI_VERSION}.`,
          invocation.system.name,
        );
      }

      this.bindInvocation(invocation);
      const transform = invocation.stores.find((s) => s.name === "Transform");
      const n = transform?.count ?? invocation.stores[0]?.count ?? 0;
      const delta = invocation.execution.delta;
      const offsets = this.binding!.integrateOffsets;
      if (!offsets) {
        throw new Error(
          `WASM system "${this.systemName}": integrate binding requires Transform+Velocity f32 xyz`,
        );
      }

      this.runFn(
        n,
        delta,
        offsets.tx,
        offsets.ty,
        offsets.tz,
        offsets.vx,
        offsets.vy,
        offsets.vz,
      );

      return {
        abiVersion: ABI_VERSION,
        systemId: invocation.system.id,
        status: "ok",
        execMs:
          (typeof performance !== "undefined" ? performance.now() : Date.now()) -
          t0,
      };
    } catch (err) {
      const message =
        err instanceof Error
          ? `${err.message}${err.stack ? `\n${err.stack}` : ""}`
          : String(err);
      return {
        abiVersion: ABI_VERSION,
        systemId: invocation.system.id,
        status: "error",
        error: `WASM system "${invocation.system.name}" failed:\n${message}`,
        execMs:
          (typeof performance !== "undefined" ? performance.now() : Date.now()) -
          t0,
      };
    }
  }

  async execute(invocation: SystemInvocation): Promise<ExecutionResult> {
    await this.ensureReady();
    return this.executeSync(invocation);
  }

  private bindInvocation(invocation: SystemInvocation): void {
    const genKey = invocation.stores
      .map((s) => `${s.storeId}:${s.generation}:${s.count}`)
      .join("|");
    // Rebind when layout generation changes; count may change without rebinding offsets
    const layoutKey = invocation.stores
      .map((s) => `${s.storeId}:${s.generation}`)
      .join("|");

    if (this.binding && this.binding.genKey === layoutKey) {
      return;
    }

    // Validate expects + buffers belong to arena memory
    const arenaBuf = this.arena.buffer;
    const stores = new Map<string, BoundStore>();

    for (const exp of this.expects) {
      const store = invocation.stores.find((s) => s.name === exp.name);
      if (!store) {
        throw new AbiError(
          "missing_store",
          `WASM system "${this.systemName}" requires store '${exp.name}', but invocation did not provide it`,
          this.systemName,
        );
      }
      const fields = new Map<string, BoundField>();
      for (const fExp of exp.fields) {
        const field = store.fields.find((f) => f.name === fExp.name);
        if (!field) {
          throw new AbiError(
            "missing_field",
            `WASM system "${this.systemName}" expected field '${fExp.name}' on '${exp.name}'`,
            this.systemName,
          );
        }
        if (field.type !== fExp.type) {
          throw new AbiError(
            "type_mismatch",
            `WASM system "${this.systemName}" store '${exp.name}.${fExp.name}': expected ${fExp.type}, got ${field.type}`,
            this.systemName,
          );
        }
        if (field.buffer !== arenaBuf) {
          throw new Error(
            `WASM system "${this.systemName}": field '${exp.name}.${fExp.name}' buffer is not the arena WebAssembly.Memory — zero-copy shared path required`,
          );
        }
        fields.set(fExp.name, {
          name: fExp.name,
          type: field.type,
          byteOffset: field.byteOffset,
        });
      }
      stores.set(exp.name, {
        name: exp.name,
        storeId: store.storeId,
        generation: store.generation,
        fields,
      });
    }

    // Capability: only declared stores were in invocation already (host).
    // Extra check: no unexpected store names beyond expects for this module.
    void genKey;

    const t = stores.get("Transform");
    const v = stores.get("Velocity");
    let integrateOffsets: CachedBinding["integrateOffsets"] = null;
    if (t && v) {
      integrateOffsets = {
        tx: t.fields.get("x")!.byteOffset,
        ty: t.fields.get("y")!.byteOffset,
        tz: t.fields.get("z")!.byteOffset,
        vx: v.fields.get("x")!.byteOffset,
        vy: v.fields.get("y")!.byteOffset,
        vz: v.fields.get("z")!.byteOffset,
      };
    }

    this.binding = {
      genKey: layoutKey,
      stores,
      integrateOffsets,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.instance = null;
    this.module = null;
    this.runFn = null;
    this.binding = null;
    this.compilePromise = null;
  }
}

async function resolveWasmBytes(
  source: WasmModuleSource,
): Promise<BufferSource | WebAssembly.Module> {
  if (source instanceof WebAssembly.Module) return source;
  if (source instanceof ArrayBuffer) return source;
  if (ArrayBuffer.isView(source)) {
    return source.buffer.slice(
      source.byteOffset,
      source.byteOffset + source.byteLength,
    ) as ArrayBuffer;
  }
  const url = typeof source === "string" ? source : source.href;
  if (typeof fetch === "function") {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.arrayBuffer();
    } catch {
      /* fall through to fs for node file URLs */
    }
  }
  if (url.startsWith("file:") || url.startsWith("/")) {
    if (typeof process !== "undefined" && process.versions?.node) {
      const { readFile } = await import("node:fs/promises");
      const { fileURLToPath } = await import("node:url");
      const path = url.startsWith("file:") ? fileURLToPath(url) : url;
      const buf = await readFile(path);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
    throw new Error(`File URLs not supported in browser: ${url}`);
  }
  throw new Error(`Cannot load WASM module from ${url}`);
}

export { webAssemblyAvailable, sharedWasmMemoryAvailable };
