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
import {
  buildSystemInvocation,
  commitAbiLocalStores,
  snapshotLocalWrites,
  storeCommitMapFromAccess,
} from "./build.js";
import { AbiContext, schemaBindingFromInvocation } from "./context.js";
import type { AbiSystemModule } from "./types.js";
import { ABI_VERSION } from "./types.js";

export type AbiSystemDefinition = {
  name: string;
  /**
   * Absolute module URL the worker will `import()`
   * (e.g. `new URL("./integrate.js", import.meta.url)`).
   */
  module: URL | string;
  /** Named export — must be an AbiSystemModule (defineAbiSystem result). */
  export: string;
  /**
   * Local module instance for sequential / in-process execution.
   * Same object workers import — no closure shipping.
   */
  system: AbiSystemModule;
  access: AccessDeclaration;
  /** Test/demo only. */
  delayMs?: number | (() => number);
};

export type AbiSystemMeta = SystemMeta & {
  affinity: "worker";
  abi: true;
  abiVersion: number;
  moduleUrl: string;
  exportName: string;
  module: AbiSystemModule;
  resourceKeys: ResourceKey[];
  eventTypes: EventType[];
  delayMs?: number | (() => number);
  ids: AbiIdRegistry;
};

const ABI_META = Symbol.for("mob3.abiSystemMeta");

export type AbiDeclaredSystem = DeclaredSystem & {
  readonly [ABI_META]: AbiSystemMeta;
};

function toModuleUrl(module: URL | string): string {
  return typeof module === "string" ? module : module.href;
}

function resolveDelay(meta: AbiSystemMeta): number | undefined {
  const d = meta.delayMs;
  if (d === undefined) return undefined;
  return typeof d === "function" ? d() : d;
}

function assertAbiAccess(
  access: ReturnType<typeof normalizeAccess>,
  name: string,
) {
  assertWorkerAccess(access, name);
  for (const c of [...access.componentRead, ...access.componentWrite]) {
    if (c.isTag) continue;
    if (!isPackedComponent(c)) {
      throw new Error(
        `abiSystem '${name}': ABI v1 requires packed components (got '${
          getPackedMeta(c)?.name ?? (c as { name?: string }).name ?? "?"
        }')`,
      );
    }
  }
}

/** Synchronous in-process ABI run (SystemFn sequential path). */
export function runAbiSystemLocalSync(world: World, meta: AbiSystemMeta): void {
  const time = world.hasResource(Time) ? world.resource(Time) : null;
  const delta = time?.delta ?? 0;
  const tick = time
    ? Math.floor(time.elapsed / (time.fixedDelta || 1 / 60))
    : 0;

  const preferShared = [
    ...meta.access.componentRead,
    ...meta.access.componentWrite,
  ]
    .filter((c) => !c.isTag)
    .every((c) => !!getPackedMeta(c)?.shared);

  const invocation = buildSystemInvocation({
    world,
    systemName: meta.name,
    access: meta.access,
    resourceKeys: meta.resourceKeys,
    tick,
    delta,
    scheduleName: "local",
    preferShared,
    ids: meta.ids,
    delayMs: resolveDelay(meta),
  });

  const schema = schemaBindingFromInvocation(invocation);
  meta.module.bind?.(schema);
  if (invocation.delayMs && invocation.delayMs > 0) {
    const end = Date.now() + invocation.delayMs;
    while (Date.now() < end) {
      /* busy wait — tests only */
    }
  }
  const ctx = new AbiContext(invocation);
  meta.module.execute(ctx);

  if (invocation.stores.some((s) => s.memoryKind === "local")) {
    commitAbiLocalStores(
      world,
      storeCommitMapFromAccess(meta.access, meta.ids),
      snapshotLocalWrites(invocation),
    );
  }
}

/**
 * Opt-in ABI-eligible worker system. Module-addressable — no World, no closures.
 */
export function abiSystem(def: AbiSystemDefinition): AbiDeclaredSystem {
  if (def.access.commands) {
    throw new Error(
      `abiSystem '${def.name}': commands are outside ABI v1 (host-side only)`,
    );
  }
  if (
    def.system.abiVersion !== undefined &&
    def.system.abiVersion !== ABI_VERSION
  ) {
    throw new Error(
      `abiSystem '${def.name}': unsupported module abiVersion ${def.system.abiVersion} (need ${ABI_VERSION})`,
    );
  }

  const access = normalizeAccess(def.access, false);
  assertAbiAccess(access, def.name);

  const moduleUrl = toModuleUrl(def.module);
  const resourceKeys = [
    ...(def.access.resources?.read ?? []),
    ...(def.access.resources?.write ?? []),
  ];
  const eventTypes = [
    ...(def.access.events?.read ?? []),
    ...(def.access.events?.write ?? []),
  ];

  const id = Symbol(`mob3.abi.${def.name}`);
  const meta: AbiSystemMeta = {
    id,
    name: def.name,
    access,
    declared: true,
    affinity: "worker",
    abi: true,
    abiVersion: ABI_VERSION,
    moduleUrl,
    exportName: def.export,
    module: def.system,
    resourceKeys,
    eventTypes,
    delayMs: def.delayMs,
    ids: new AbiIdRegistry(),
  };

  const fn = ((world: World, _commands: Commands) => {
    runAbiSystemLocalSync(world, meta);
  }) as AbiDeclaredSystem;

  Object.defineProperty(fn, SYSTEM_META, { value: meta });
  Object.defineProperty(fn, ABI_META, { value: meta });
  Object.defineProperty(fn, "name", { value: def.name });
  return fn;
}

export function getAbiMeta(fn: SystemFn): AbiSystemMeta | undefined {
  return (fn as AbiDeclaredSystem)[ABI_META];
}

export function isAbiSystem(fn: SystemFn): fn is AbiDeclaredSystem {
  return ABI_META in (fn as object);
}

export { ABI_META };
