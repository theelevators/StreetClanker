import type { ComponentType } from "./component.js";
import type { ResourceKey } from "./resource.js";
import type { EventType } from "./event.js";
import type { World } from "./world.js";
import type { Commands } from "./commands.js";
import type { SystemFn } from "./schedule.js";

export type SystemId = symbol;

export type AccessDeclaration = {
  /** Components read (no intended mutation). */
  read?: ComponentType[];
  /** Components written (including get-then-mutate). */
  write?: ComponentType[];
  resources?: {
    read?: ResourceKey[];
    write?: ResourceKey[];
  };
  events?: {
    read?: EventType[];
    write?: EventType[];
  };
  /** System issues deferred Commands (structural mutation). */
  commands?: boolean;
};

export type NormalizedAccess = {
  componentRead: Set<ComponentType>;
  componentWrite: Set<ComponentType>;
  resourceRead: Set<ResourceKey | symbol>;
  resourceWrite: Set<ResourceKey | symbol>;
  eventRead: Set<EventType>;
  eventWrite: Set<EventType>;
  commands: boolean;
  opaque: boolean;
};

export type SystemMeta = {
  id: SystemId;
  name: string;
  access: NormalizedAccess;
  declared: boolean;
  /** Phase 5 execution affinity. Default main. */
  affinity?: "main" | "worker";
};

const META = Symbol.for("mob3.systemMeta");

export type DeclaredSystem = SystemFn & {
  readonly [META]: SystemMeta;
};

export type SystemDefinition = {
  name: string;
  access?: AccessDeclaration;
  run: SystemFn;
};

let systemSeq = 0;

function resourceKeyId(key: ResourceKey): ResourceKey | symbol {
  if (
    typeof key === "object" &&
    key !== null &&
    "id" in key &&
    typeof (key as { id: unknown }).id === "symbol"
  ) {
    return (key as { id: symbol }).id;
  }
  return key;
}

export function normalizeAccess(
  access: AccessDeclaration | undefined,
  opaque: boolean,
): NormalizedAccess {
  const out: NormalizedAccess = {
    componentRead: new Set(),
    componentWrite: new Set(),
    resourceRead: new Set(),
    resourceWrite: new Set(),
    eventRead: new Set(),
    eventWrite: new Set(),
    commands: false,
    opaque,
  };
  if (opaque || !access) {
    out.opaque = true;
    return out;
  }
  for (const c of access.read ?? []) out.componentRead.add(c);
  for (const c of access.write ?? []) out.componentWrite.add(c);
  for (const r of access.resources?.read ?? []) {
    out.resourceRead.add(resourceKeyId(r));
  }
  for (const r of access.resources?.write ?? []) {
    out.resourceWrite.add(resourceKeyId(r));
  }
  for (const e of access.events?.read ?? []) out.eventRead.add(e);
  for (const e of access.events?.write ?? []) out.eventWrite.add(e);
  out.commands = !!access.commands;
  return out;
}

/**
 * Attach inspectable access metadata to a system.
 * Returns a callable SystemFn compatible with `app.addSystem`.
 */
export function system(def: SystemDefinition): DeclaredSystem {
  const id = Symbol(`mob3.system.${def.name}:${systemSeq++}`);
  const meta: SystemMeta = {
    id,
    name: def.name,
    access: normalizeAccess(def.access, false),
    declared: true,
  };

  const fn = ((world: World, commands: Commands) => {
    def.run(world, commands);
  }) as DeclaredSystem;

  Object.defineProperty(fn, META, { value: meta });
  Object.defineProperty(fn, "name", { value: def.name });
  return fn;
}

const opaqueMeta = new WeakMap<SystemFn, SystemMeta>();

export function getSystemMeta(fn: SystemFn): SystemMeta {
  const declared = (fn as DeclaredSystem)[META];
  if (declared) return declared;

  let meta = opaqueMeta.get(fn);
  if (!meta) {
    const name = fn.name && fn.name.length > 0 ? fn.name : "anonymous";
    meta = {
      id: Symbol(`mob3.opaque.${name}`),
      name,
      access: normalizeAccess(undefined, true),
      declared: false,
    };
    opaqueMeta.set(fn, meta);
  }
  return meta;
}

/** Peek without allocating opaque metadata (for missing-target diagnostics). */
export function peekSystemMeta(fn: SystemFn): SystemMeta | undefined {
  const declared = (fn as DeclaredSystem)[META];
  if (declared) return declared;
  return opaqueMeta.get(fn);
}

export function isDeclaredSystem(fn: SystemFn): fn is DeclaredSystem {
  return META in (fn as object);
}

/** True if two access sets conflict. */
export function accessesConflict(a: NormalizedAccess, b: NormalizedAccess): boolean {
  if (a.opaque || b.opaque) return true;
  if (a.commands && b.commands) return true;

  for (const c of a.componentWrite) {
    if (b.componentWrite.has(c) || b.componentRead.has(c)) return true;
  }
  for (const c of a.componentRead) {
    if (b.componentWrite.has(c)) return true;
  }
  for (const r of a.resourceWrite) {
    if (b.resourceWrite.has(r) || b.resourceRead.has(r)) return true;
  }
  for (const r of a.resourceRead) {
    if (b.resourceWrite.has(r)) return true;
  }
  for (const e of a.eventWrite) {
    if (b.eventWrite.has(e) || b.eventRead.has(e)) return true;
  }
  for (const e of a.eventRead) {
    if (b.eventWrite.has(e)) return true;
  }
  return false;
}

export function describeAccessConflict(
  a: NormalizedAccess,
  b: NormalizedAccess,
): string[] {
  const reasons: string[] = [];
  if (a.opaque || b.opaque) {
    reasons.push("opaque/undeclared access");
    return reasons;
  }
  if (a.commands && b.commands) reasons.push("both issue Commands");

  const pushOverlap = (
    label: string,
    aw: Set<unknown>,
    ar: Set<unknown>,
    bw: Set<unknown>,
    br: Set<unknown>,
  ) => {
    for (const x of aw) {
      if (bw.has(x)) reasons.push(`${label} write/write`);
      else if (br.has(x)) reasons.push(`${label} write/read`);
    }
    for (const x of ar) {
      if (bw.has(x)) reasons.push(`${label} read/write`);
    }
  };

  pushOverlap(
    "component",
    a.componentWrite as Set<unknown>,
    a.componentRead as Set<unknown>,
    b.componentWrite as Set<unknown>,
    b.componentRead as Set<unknown>,
  );
  pushOverlap(
    "resource",
    a.resourceWrite as Set<unknown>,
    a.resourceRead as Set<unknown>,
    b.resourceWrite as Set<unknown>,
    b.resourceRead as Set<unknown>,
  );
  pushOverlap(
    "event",
    a.eventWrite as Set<unknown>,
    a.eventRead as Set<unknown>,
    b.eventWrite as Set<unknown>,
    b.eventRead as Set<unknown>,
  );
  return [...new Set(reasons)];
}

export { META as SYSTEM_META };
