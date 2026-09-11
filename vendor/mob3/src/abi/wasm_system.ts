import type { World } from "../world.js";
import type { Commands } from "../commands.js";
import type { SystemFn } from "../schedule.js";
import type { AccessDeclaration, DeclaredSystem, SystemMeta } from "../system.js";
import { normalizeAccess, SYSTEM_META } from "../system.js";
import type { ResourceKey } from "../resource.js";
import type { EventType } from "../event.js";
import { Time } from "../time.js";
import {
  getPackedMeta,
  isPackedComponent,
} from "../storage/packed_component.js";
import { assertWorkerAccess } from "../parallel/transfer.js";
import { AbiIdRegistry } from "./ids.js";
import { buildSystemInvocation } from "./build.js";
import type { AbiSystemModule } from "./types.js";
import { ABI_VERSION } from "./types.js";
import {
  WasmAbiExecutor,
  type WasmModuleSource,
  type WasmStoreExpect,
} from "./wasm_executor.js";
import type { WasmMemoryArena } from "../storage/wasm_memory.js";
import {
  sharedWasmMemoryAvailable,
  webAssemblyAvailable,
} from "../storage/wasm_memory.js";
import { runAbiSystemLocalSync, type AbiSystemMeta } from "./abi_system.js";

export type WasmMode = "preferred" | "required";

export type WasmSystemDefinition = {
  name: string;
  module: WasmModuleSource;
  export?: string;
  access: AccessDeclaration;
  expects: readonly WasmStoreExpect[];
  mode?: WasmMode;
  fallback?: AbiSystemModule;
  /**
   * main — WASM on host thread (default; zero-copy arena Memory)
   * worker — still host-thread WASM inside parallel batches (Memory is not
   *   transferable as WebAssembly.Memory across workers; SAB columns remain
   *   visible to JS workers). Affinity marks planner eligibility only.
   */
  placement?: "main" | "worker";
};

export type WasmSystemMeta = SystemMeta & {
  affinity: "main" | "worker";
  wasm: true;
  abiVersion: number;
  moduleSource: WasmModuleSource;
  exportName: string;
  expects: readonly WasmStoreExpect[];
  mode: WasmMode;
  fallback?: AbiSystemModule;
  placement: "main" | "worker";
  resourceKeys: ResourceKey[];
  eventTypes: EventType[];
  ids: AbiIdRegistry;
  executor: WasmAbiExecutor | null;
  backend: "wasm";
};

const WASM_META = Symbol.for("mob3.wasmSystemMeta");

export type WasmDeclaredSystem = DeclaredSystem & {
  readonly [WASM_META]: WasmSystemMeta;
};

function assertWasmAccess(
  access: ReturnType<typeof normalizeAccess>,
  name: string,
) {
  assertWorkerAccess(access, name);
  for (const c of [...access.componentRead, ...access.componentWrite]) {
    if (c.isTag) continue;
    if (!isPackedComponent(c)) {
      throw new Error(
        `wasmSystem '${name}': requires packed components (got '${
          getPackedMeta(c)?.name ?? (c as { name?: string }).name ?? "?"
        }')`,
      );
    }
    const meta = getPackedMeta(c)!;
    if (!meta.shared || meta.backing !== "wasm") {
      throw new Error(
        `wasmSystem '${name}': component '${meta.name}' must use shared: true, backing: "wasm"`,
      );
    }
  }
}

function getArenaOrThrow(world: World, name: string): WasmMemoryArena {
  const arena = world.getWasmArena();
  if (!arena) {
    throw new Error(
      `wasmSystem '${name}': World has no WasmMemoryArena (App({ wasmArena: true }) or world.setWasmArena)`,
    );
  }
  return arena;
}

export function ensureWasmExecutor(
  meta: WasmSystemMeta,
  world: World,
): WasmAbiExecutor {
  if (meta.executor) return meta.executor;
  const arena = getArenaOrThrow(world, meta.name);
  meta.executor = new WasmAbiExecutor({
    module: meta.moduleSource,
    exportName: meta.exportName,
    arena,
    expects: meta.expects,
    systemName: meta.name,
  });
  return meta.executor;
}

function runFallback(world: World, meta: WasmSystemMeta): void {
  if (!meta.fallback) {
    throw new Error(
      `wasmSystem '${meta.name}': WASM unavailable and no JS fallback provided`,
    );
  }
  const fake: AbiSystemMeta = {
    id: meta.id,
    name: meta.name,
    access: meta.access,
    declared: true,
    affinity: "worker",
    abi: true,
    abiVersion: ABI_VERSION,
    moduleUrl: "",
    exportName: "",
    module: meta.fallback,
    resourceKeys: meta.resourceKeys,
    eventTypes: meta.eventTypes,
    ids: meta.ids,
  };
  runAbiSystemLocalSync(world, fake);
}

function wasmAvailable(world: World): boolean {
  return (
    webAssemblyAvailable() &&
    sharedWasmMemoryAvailable() &&
    !!world.getWasmArena()?.shared
  );
}

/** Warm compile/instantiate before sync ticks. */
export async function warmWasmSystem(
  world: World,
  meta: WasmSystemMeta,
): Promise<void> {
  if (!wasmAvailable(world)) return;
  const ex = ensureWasmExecutor(meta, world);
  await ex.ensureReady();
}

export async function runWasmSystem(
  world: World,
  meta: WasmSystemMeta,
): Promise<void> {
  if (!wasmAvailable(world)) {
    if (meta.mode === "required") {
      throw new Error(
        `wasmSystem '${meta.name}': WASM shared memory required but unavailable`,
      );
    }
    runFallback(world, meta);
    return;
  }

  const executor = ensureWasmExecutor(meta, world);
  await executor.ensureReady();
  runWasmSystemSync(world, meta);
}

export function runWasmSystemSync(world: World, meta: WasmSystemMeta): void {
  if (!wasmAvailable(world)) {
    if (meta.mode === "required") {
      throw new Error(
        `wasmSystem '${meta.name}': WASM shared memory required but unavailable`,
      );
    }
    runFallback(world, meta);
    return;
  }

  const executor = ensureWasmExecutor(meta, world);
  if (!executor.ready) {
    if (meta.fallback && meta.mode === "preferred") {
      runFallback(world, meta);
      return;
    }
    throw new Error(
      `wasmSystem '${meta.name}': module not ready — await warmWasmSystem() or updateAsync first`,
    );
  }

  const time = world.hasResource(Time) ? world.resource(Time) : null;
  const delta = time?.delta ?? 0;
  const tick = time
    ? Math.floor(time.elapsed / (time.fixedDelta || 1 / 60))
    : 0;

  // Share ID registry with parallel executor when attached later
  const invocation = buildSystemInvocation({
    world,
    systemName: meta.name,
    access: meta.access,
    resourceKeys: meta.resourceKeys,
    tick,
    delta,
    scheduleName: "local",
    preferShared: true,
    ids: meta.ids,
  });

  const result = executor.executeSync(invocation);
  if (result.status === "error") {
    throw new Error(result.error ?? `WASM system '${meta.name}' failed`);
  }
  // Shared WASM memory writes bypass per-row ticks
  for (const type of meta.access.componentWrite) {
    world.markStoreChanged(type);
  }
}

/**
 * Opt-in WASM ABI system. Planner uses access/affinity — not language.
 */
export function wasmSystem(def: WasmSystemDefinition): WasmDeclaredSystem {
  if (def.access.commands) {
    throw new Error(
      `wasmSystem '${def.name}': commands are outside ABI v1 (host-side only)`,
    );
  }

  const access = normalizeAccess(def.access, false);
  assertWasmAccess(access, def.name);

  const mode = def.mode ?? "preferred";
  const placement = def.placement ?? "main";
  const resourceKeys = [
    ...(def.access.resources?.read ?? []),
    ...(def.access.resources?.write ?? []),
  ];
  const eventTypes = [
    ...(def.access.events?.read ?? []),
    ...(def.access.events?.write ?? []),
  ];

  const id = Symbol(`mob3.wasm.${def.name}`);
  const meta: WasmSystemMeta = {
    id,
    name: def.name,
    access,
    declared: true,
    affinity: placement === "worker" ? "worker" : "main",
    wasm: true,
    abiVersion: ABI_VERSION,
    moduleSource: def.module,
    exportName: def.export ?? "run",
    expects: def.expects,
    mode,
    fallback: def.fallback,
    placement,
    resourceKeys,
    eventTypes,
    ids: new AbiIdRegistry(),
    executor: null,
    backend: "wasm",
  };

  const fn = ((world: World, _commands: Commands) => {
    runWasmSystemSync(world, meta);
  }) as WasmDeclaredSystem;

  Object.defineProperty(fn, SYSTEM_META, { value: meta });
  Object.defineProperty(fn, WASM_META, { value: meta });
  Object.defineProperty(fn, "name", { value: def.name });
  return fn;
}

export function getWasmMeta(fn: SystemFn): WasmSystemMeta | undefined {
  return (fn as WasmDeclaredSystem)[WASM_META];
}

export function isWasmSystem(fn: SystemFn): fn is WasmDeclaredSystem {
  return WASM_META in (fn as object);
}

export { WASM_META };
