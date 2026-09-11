import type { ComponentType } from "../component.js";
import type { ResourceKey, ResourceType } from "../resource.js";
import type { World } from "../world.js";
import type { EventType } from "../event.js";
import type {
  NumericSlice,
  WorkerPayload,
  WorkerResult,
  WorkerWriteSlice,
} from "./types.js";
import type { NormalizedAccess } from "../system.js";

export type NumericLayout = {
  type: ComponentType;
  name: string;
  fields: string[];
};

const layouts = new WeakMap<ComponentType, NumericLayout>();

function isNumericDefaults(defaults: unknown): defaults is Record<string, number> {
  if (defaults === null || typeof defaults !== "object" || Array.isArray(defaults)) {
    return false;
  }
  const vals = Object.values(defaults);
  return vals.length > 0 && vals.every((v) => typeof v === "number");
}

import { getPackedMeta } from "../storage/packed_component.js";

/** True if component defaults are a plain numeric record (worker-transferable). */
export function isWorkerSafeComponent(type: ComponentType): boolean {
  if (type.isTag) return true;
  if (getPackedMeta(type)) return true;
  return isNumericDefaults(type.defaults);
}

export function getNumericLayout(type: ComponentType): NumericLayout | null {
  if (type.isTag) return null;
  const cached = layouts.get(type);
  if (cached) return cached;
  const packed = getPackedMeta(type);
  if (packed) {
    const layout = {
      type,
      name: packed.name,
      fields: [...packed.fields],
    };
    layouts.set(type, layout);
    return layout;
  }
  if (!isNumericDefaults(type.defaults)) return null;
  const fields = Object.keys(type.defaults as Record<string, number>);
  const name =
    (type as { name?: string }).name &&
    (type as { name?: string }).name !== "factory"
      ? (type as { name: string }).name
      : type.id.description ?? "Component";
  const layout = { type, name, fields };
  layouts.set(type, layout);
  return layout;
}

function resourceName(key: ResourceKey | symbol): string {
  if (typeof key === "symbol") return key.description ?? "Resource";
  if (
    typeof key === "object" &&
    key !== null &&
    "name" in key &&
    typeof (key as ResourceType).name === "string"
  ) {
    return (key as ResourceType).name!;
  }
  if (typeof key === "function") return key.name || "Resource";
  return "Resource";
}

function cloneResource(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  // Prefer structuredClone when available
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // fall through
    }
  }
  return JSON.parse(JSON.stringify(value));
}

export function assertWorkerAccess(access: NormalizedAccess, systemName: string): void {
  if (access.opaque) {
    throw new Error(`workerSystem '${systemName}' cannot be opaque`);
  }
  if (access.commands) {
    throw new Error(
      `workerSystem '${systemName}' cannot use Commands (main-thread only in Phase 5)`,
    );
  }
  for (const c of access.componentRead) {
    if (!isWorkerSafeComponent(c)) {
      throw new Error(
        `workerSystem '${systemName}' reads non-transferable component '${(c as { name?: string }).name ?? "?"}'`,
      );
    }
  }
  for (const c of access.componentWrite) {
    if (c.isTag) {
      throw new Error(
        `workerSystem '${systemName}' cannot write tags (structural); use Commands on main`,
      );
    }
    if (!isWorkerSafeComponent(c)) {
      throw new Error(
        `workerSystem '${systemName}' writes non-transferable component '${(c as { name?: string }).name ?? "?"}'`,
      );
    }
  }
}

/**
 * Collect entities that have all required data components and tag filters.
 */
function collectEntities(
  world: World,
  dataTypes: ComponentType[],
  tagFilters: ComponentType[],
): number[] {
  if (dataTypes.length === 0) return [];
  // Walk smallest store
  let best: ComponentType = dataTypes[0]!;
  let bestSize = Infinity;
  for (const t of dataTypes) {
    // access via query iteration
    let n = 0;
    for (const _ of world.query(t)) n++;
    if (n < bestSize) {
      bestSize = n;
      best = t;
    }
  }
  const out: number[] = [];
  outer: for (const [entity] of world.query(best)) {
    for (const t of dataTypes) {
      if (t !== best && !world.has(entity, t)) continue outer;
    }
    for (const tag of tagFilters) {
      if (!world.has(entity, tag)) continue outer;
    }
    out.push(entity);
  }
  return out;
}

function packSlice(
  world: World,
  layout: NumericLayout,
  entities: number[],
): NumericSlice {
  const { fields, name } = layout;
  const data = new Float32Array(entities.length * fields.length);
  const ents = new Uint32Array(entities.length);
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i]!;
    ents[i] = e >>> 0;
    const comp = world.get(e, layout.type) as Record<string, number>;
    const base = i * fields.length;
    for (let f = 0; f < fields.length; f++) {
      data[base + f] = comp[fields[f]!] ?? 0;
    }
  }
  return { name, fields: [...fields], entities: ents, data };
}

export type ExtractContext = {
  /** ComponentType by layout name for commit. */
  byName: Map<string, NumericLayout>;
  /** EventType by name for merge. */
  eventsByName: Map<string, EventType>;
  /** Resource keys by name. */
  resourcesByName: Map<string, ResourceKey>;
};

export function extractWorkerPayload(
  world: World,
  access: NormalizedAccess,
  ctx: ExtractContext,
  delayMs?: number,
): WorkerPayload {
  const tagFilters: ComponentType[] = [];
  const dataTypes: ComponentType[] = [];
  for (const c of [...access.componentRead, ...access.componentWrite]) {
    if (c.isTag) tagFilters.push(c);
    else dataTypes.push(c);
  }
  // Unique data types
  const uniqueData = [...new Set(dataTypes)];
  const entities = collectEntities(world, uniqueData, tagFilters);

  const components: Record<string, NumericSlice> = {};
  for (const t of uniqueData) {
    const layout = getNumericLayout(t);
    if (!layout) continue;
    ctx.byName.set(layout.name, layout);
    components[layout.name] = packSlice(world, layout, entities);
  }

  const resources: Record<string, unknown> = {};
  for (const key of access.resourceRead) {
    // key may be symbol id from normalizeAccess — resolve from world
    // We need original ResourceKey. Store from access declaration instead.
  }
  void resources;

  return {
    components,
    resources: {},
    delayMs,
  };
}

/** Extract using original AccessDeclaration resource keys. */
export function extractWorkerPayloadWithKeys(
  world: World,
  access: NormalizedAccess,
  resourceKeys: ResourceKey[],
  eventTypes: EventType[],
  delayMs?: number,
): { payload: WorkerPayload; ctx: ExtractContext } {
  const ctx: ExtractContext = {
    byName: new Map(),
    eventsByName: new Map(),
    resourcesByName: new Map(),
  };
  for (const e of eventTypes) ctx.eventsByName.set(e.name ?? "Event", e);

  const tagFilters: ComponentType[] = [];
  const dataTypes: ComponentType[] = [];
  for (const c of [...access.componentRead, ...access.componentWrite]) {
    if (c.isTag) tagFilters.push(c);
    else dataTypes.push(c);
  }
  const uniqueData = [...new Set(dataTypes)];
  const entities = collectEntities(world, uniqueData, tagFilters);

  const components: Record<string, NumericSlice> = {};
  for (const t of uniqueData) {
    const layout = getNumericLayout(t);
    if (!layout) continue;
    ctx.byName.set(layout.name, layout);
    components[layout.name] = packSlice(world, layout, entities);
  }

  const resources: Record<string, unknown> = {};
  for (const key of resourceKeys) {
    const name = resourceName(key);
    ctx.resourcesByName.set(name, key);
    if (world.hasResource(key)) {
      resources[name] = cloneResource(world.resource(key));
    }
  }

  return {
    payload: { components, resources, delayMs },
    ctx,
  };
}

export function validateWorkerResult(
  result: WorkerResult,
  allowedWriteNames: Set<string>,
  systemName: string,
): void {
  for (const w of result.writes) {
    if (!allowedWriteNames.has(w.name)) {
      throw new Error(
        `Worker system "${systemName}" attempted undeclared write to ${w.name}`,
      );
    }
  }
}

export function commitWorkerWrites(
  world: World,
  writes: WorkerWriteSlice[],
  ctx: ExtractContext,
): void {
  for (const slice of writes) {
    const layout = ctx.byName.get(slice.name);
    if (!layout) {
      throw new Error(`Unknown write component '${slice.name}' at commit`);
    }
    const { fields } = layout;
    const n = slice.entities.length;
    for (let i = 0; i < n; i++) {
      const entity = slice.entities[i]!;
      if (!world.isAlive(entity)) continue;
      const comp = world.get(entity, layout.type) as Record<string, number> | undefined;
      if (!comp) continue;
      const base = i * fields.length;
      for (let f = 0; f < fields.length; f++) {
        comp[fields[f]!] = slice.data[base + f]!;
      }
    }
  }
}

export function commitWorkerEvents(
  world: World,
  events: WorkerResult["events"],
  ctx: ExtractContext,
): void {
  if (!events) return;
  for (const batch of events) {
    const type = ctx.eventsByName.get(batch.name);
    if (!type) {
      throw new Error(`Worker returned unknown event '${batch.name}'`);
    }
    for (const payload of batch.payloads) {
      world.send(type, payload as never);
    }
  }
}

/** Run a worker handler on the main thread (fallback / sequential reference). */
export async function runHandlerLocal(
  moduleUrl: string,
  exportName: string,
  payload: WorkerPayload,
): Promise<WorkerResult> {
  if (payload.delayMs && payload.delayMs > 0) {
    await new Promise((r) => setTimeout(r, payload.delayMs));
  }
  const mod = await import(/* @vite-ignore */ moduleUrl);
  const fn = mod[exportName];
  if (typeof fn !== "function") {
    throw new Error(`Export '${exportName}' not found in ${moduleUrl}`);
  }
  const t0 = nowMs();
  const result = fn(payload) as WorkerResult;
  const execMs = nowMs() - t0;
  return { ...result, execMs: result.execMs ?? execMs };
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
