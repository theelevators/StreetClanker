import type { ScheduleLabel, SystemFn } from "./schedule.js";
import {
  accessesConflict,
  describeAccessConflict,
  peekSystemMeta,
  type SystemMeta,
  type SystemId,
} from "./system.js";

export type DependencyEdge = {
  from: SystemId;
  to: SystemId;
  fromName: string;
  toName: string;
  kind: "before" | "after";
};

export type AccessConflict = {
  a: SystemId;
  b: SystemId;
  aName: string;
  bName: string;
  reasons: string[];
  /** True if an explicit order edge already serializes them. */
  ordered: boolean;
};

export type SystemTiming = {
  invocations: number;
  totalMs: number;
  lastMs: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
};

export type PlanSystem = {
  id: SystemId;
  name: string;
  declared: boolean;
  access: SystemMeta["access"];
  /** Phase 5: main vs worker-eligible. */
  affinity: "main" | "worker";
  /** Phase 8: backend label for diagnostics (does not affect planning). */
  backend?: "main" | "js-worker" | "abi-js" | "wasm";
  timing?: SystemTiming;
};

export type ExecutionPlan = {
  schedule: ScheduleLabel;
  scheduleName: string;
  systems: PlanSystem[];
  /** Execution order (sequential). */
  order: SystemId[];
  dependencies: DependencyEdge[];
  conflicts: AccessConflict[];
  /** Theoretical parallel batches (informational). */
  batches: SystemId[][];
  diagnostics: string[];
};

export type CompiledSchedule = {
  plan: ExecutionPlan;
  /** Resolved SystemFn in sequential order. */
  runOrder: SystemFn[];
};

type Entry = {
  system: SystemFn;
  meta: SystemMeta;
  before: SystemFn[];
  after: SystemFn[];
  registrationIndex: number;
};

function scheduleName(label: ScheduleLabel): string {
  return typeof label === "symbol" ? label.description ?? String(label) : label;
}

function emptyTiming(): SystemTiming {
  return {
    invocations: 0,
    totalMs: 0,
    lastMs: 0,
    minMs: Number.POSITIVE_INFINITY,
    maxMs: 0,
    avgMs: 0,
  };
}

export class TimingStore {
  private readonly timings = new Map<SystemId, SystemTiming>();

  record(id: SystemId, ms: number): void {
    let t = this.timings.get(id);
    if (!t) {
      t = emptyTiming();
      this.timings.set(id, t);
    }
    t.invocations += 1;
    t.totalMs += ms;
    t.lastMs = ms;
    t.minMs = Math.min(t.minMs, ms);
    t.maxMs = Math.max(t.maxMs, ms);
    t.avgMs = t.totalMs / t.invocations;
  }

  get(id: SystemId): SystemTiming | undefined {
    return this.timings.get(id);
  }

  clear(): void {
    this.timings.clear();
  }
}

/**
 * Compile entries into an execution plan.
 * Sequential order matches Phase 3 topo semantics (deps + registration ties).
 * Access analysis does NOT reorder systems.
 */
export function compileExecutionPlan(
  label: ScheduleLabel,
  entries: Entry[],
  timings?: TimingStore,
  options?: { strict?: boolean },
): CompiledSchedule {
  const diagnostics: string[] = [];
  const byFn = new Map<SystemFn, Entry>();
  for (const e of entries) byFn.set(e.system, e);

  // --- dependency edges ---
  const dependencies: DependencyEdge[] = [];
  const succ = new Map<SystemId, Set<SystemId>>();
  const indeg = new Map<SystemId, number>();
  const idToFn = new Map<SystemId, SystemFn>();

  for (const e of entries) {
    succ.set(e.meta.id, new Set());
    indeg.set(e.meta.id, 0);
    idToFn.set(e.meta.id, e.system);
  }

  const addDep = (
    fromFn: SystemFn,
    toFn: SystemFn,
    kind: "before" | "after",
  ) => {
    const from = byFn.get(fromFn);
    const to = byFn.get(toFn);
    if (!from || !to) {
      const present = from?.meta.name ?? to?.meta.name ?? "unknown";
      const missingFn = !to ? toFn : fromFn;
      const missing =
        peekSystemMeta(missingFn)?.name ??
        (missingFn.name || "anonymous");
      diagnostics.push(
        `Ordering constraint from '${present}' references unregistered system '${missing}'`,
      );
      return;
    }
    if (from.meta.id === to.meta.id) return;
    const set = succ.get(from.meta.id)!;
    if (set.has(to.meta.id)) return;
    set.add(to.meta.id);
    indeg.set(to.meta.id, (indeg.get(to.meta.id) ?? 0) + 1);
    dependencies.push({
      from: from.meta.id,
      to: to.meta.id,
      fromName: from.meta.name,
      toName: to.meta.name,
      kind,
    });
  };

  for (const e of entries) {
    for (const b of e.before) addDep(e.system, b, "before");
    for (const a of e.after) addDep(a, e.system, "after");
  }

  // --- topo order (registration index tie-break) ---
  const regIndex = new Map<SystemId, number>();
  for (const e of entries) regIndex.set(e.meta.id, e.registrationIndex);

  const ready: SystemId[] = [];
  for (const [id, d] of indeg) {
    if (d === 0) ready.push(id);
  }
  ready.sort((a, b) => regIndex.get(a)! - regIndex.get(b)!);

  const order: SystemId[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    const nexts = [...(succ.get(id) ?? [])].sort(
      (a, b) => regIndex.get(a)! - regIndex.get(b)!,
    );
    for (const n of nexts) {
      const d = (indeg.get(n) ?? 1) - 1;
      indeg.set(n, d);
      if (d === 0) {
        ready.push(n);
        ready.sort((a, b) => regIndex.get(a)! - regIndex.get(b)!);
      }
    }
  }

  if (order.length !== entries.length) {
    const remaining = entries
      .filter((e) => !order.includes(e.meta.id))
      .map((e) => e.meta.name);
    // Try to describe a cycle path
    const cycle = describeCycle(entries, succ, remaining);
    throw new Error(
      `Schedule ${scheduleName(label)} contains an ordering cycle:\n${cycle}`,
    );
  }

  // --- conflicts ---
  const orderedPairs = new Set<string>();
  const reaches = buildReachability(order, succ);
  for (const a of order) {
    for (const b of reaches.get(a) ?? []) {
      orderedPairs.add(pairKey(a, b));
    }
  }

  const conflicts: AccessConflict[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const A = entries[i]!;
      const B = entries[j]!;
      if (!accessesConflict(A.meta.access, B.meta.access)) continue;
      const ordered =
        orderedPairs.has(pairKey(A.meta.id, B.meta.id)) ||
        orderedPairs.has(pairKey(B.meta.id, A.meta.id));
      const reasons = describeAccessConflict(A.meta.access, B.meta.access);
      conflicts.push({
        a: A.meta.id,
        b: B.meta.id,
        aName: A.meta.name,
        bName: B.meta.name,
        reasons,
        ordered,
      });
      if (!ordered && !A.meta.access.opaque && !B.meta.access.opaque) {
        diagnostics.push(
          `Potential write/access conflict: '${A.meta.name}' and '${B.meta.name}' (${reasons.join(", ")}) without explicit ordering. Sequential registration order is used.`,
        );
      }
      if (A.meta.access.opaque || B.meta.access.opaque) {
        const opaqueName = A.meta.access.opaque ? A.meta.name : B.meta.name;
        diagnostics.push(
          `system '${opaqueName}' has undeclared access; execution independence cannot be determined`,
        );
      }
    }
  }

  // Deduplicate opaque diagnostics
  const uniqueDiagnostics = [...new Set(diagnostics)];

  if (options?.strict) {
    const fatal = uniqueDiagnostics.filter(
      (d) =>
        d.includes("references unregistered system") ||
        d.includes("without explicit ordering"),
    );
    if (fatal.length) {
      throw new Error(
        `Schedule ${scheduleName(label)} strict validation failed:\n` +
          fatal.map((d) => `  - ${d}`).join("\n"),
      );
    }
  }

  // --- batches (conservative) ---
  const batches = buildBatches(order, entries, succ, conflicts);

  const systems: PlanSystem[] = order.map((id) => {
    const e = entries.find((x) => x.meta.id === id)!;
    const timing = timings?.get(id);
    const m = e.meta as SystemMeta & {
      wasm?: boolean;
      abi?: boolean;
      backend?: PlanSystem["backend"];
    };
    const backend: PlanSystem["backend"] =
      m.backend ??
      (m.wasm ? "wasm" : m.abi ? "abi-js" : m.affinity === "worker" ? "js-worker" : "main");
    return {
      id,
      name: e.meta.name,
      declared: e.meta.declared,
      access: e.meta.access,
      affinity: e.meta.affinity ?? "main",
      backend,
      ...(timing
        ? {
            timing: {
              ...timing,
              minMs: Number.isFinite(timing.minMs) ? timing.minMs : 0,
            },
          }
        : {}),
    };
  });

  const plan: ExecutionPlan = {
    schedule: label,
    scheduleName: scheduleName(label),
    systems,
    order,
    dependencies,
    conflicts,
    batches,
    diagnostics: uniqueDiagnostics,
  };

  const runOrder = order.map((id) => idToFn.get(id)!);

  return { plan, runOrder };
}

function pairKey(a: SystemId, b: SystemId): string {
  return `${String(a)}|${String(b)}`;
}

function buildReachability(
  order: SystemId[],
  succ: Map<SystemId, Set<SystemId>>,
): Map<SystemId, Set<SystemId>> {
  const reaches = new Map<SystemId, Set<SystemId>>();
  // reverse order DP
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]!;
    const set = new Set<SystemId>();
    for (const n of succ.get(id) ?? []) {
      set.add(n);
      for (const x of reaches.get(n) ?? []) set.add(x);
    }
    reaches.set(id, set);
  }
  return reaches;
}

function buildBatches(
  order: SystemId[],
  entries: Entry[],
  succ: Map<SystemId, Set<SystemId>>,
  conflicts: AccessConflict[],
): SystemId[][] {
  const meta = new Map(entries.map((e) => [e.meta.id, e.meta] as const));
  const conflictSet = new Set<string>();
  for (const c of conflicts) {
    conflictSet.add(pairKey(c.a, c.b));
    conflictSet.add(pairKey(c.b, c.a));
  }

  // Must respect: if A → B dependency, B cannot be in same or earlier batch
  const batchOf = new Map<SystemId, number>();
  const batches: SystemId[][] = [];

  for (const id of order) {
    const m = meta.get(id)!;
    let minBatch = 0;
    // after all predecessors
    for (const [pred, set] of succ) {
      if (set.has(id) && batchOf.has(pred)) {
        minBatch = Math.max(minBatch, batchOf.get(pred)! + 1);
      }
    }
    // find earliest batch >= minBatch with no conflicts
    let placed = -1;
    for (let b = minBatch; b < batches.length; b++) {
      const batch = batches[b]!;
      let ok = true;
      for (const other of batch) {
        if (conflictSet.has(pairKey(id, other))) {
          ok = false;
          break;
        }
        // opaque never shares
        if (m.access.opaque || meta.get(other)!.access.opaque) {
          ok = false;
          break;
        }
      }
      if (ok) {
        placed = b;
        break;
      }
    }
    if (placed < 0) {
      placed = Math.max(minBatch, batches.length);
      while (batches.length <= placed) batches.push([]);
    }
    // If minBatch forces a new slot beyond conflict search
    if (placed < minBatch) {
      placed = minBatch;
      while (batches.length <= placed) batches.push([]);
      // ensure no conflict in that batch — if conflict, push further
      while (true) {
        const batch = batches[placed]!;
        let ok = true;
        for (const other of batch) {
          if (
            conflictSet.has(pairKey(id, other)) ||
            m.access.opaque ||
            meta.get(other)!.access.opaque
          ) {
            ok = false;
            break;
          }
        }
        if (ok) break;
        placed++;
        while (batches.length <= placed) batches.push([]);
      }
    }
    batches[placed]!.push(id);
    batchOf.set(id, placed);
  }

  return batches.filter((b) => b.length > 0);
}

function describeCycle(
  entries: Entry[],
  succ: Map<SystemId, Set<SystemId>>,
  remainingNames: string[],
): string {
  const nameOf = new Map(entries.map((e) => [e.meta.id, e.meta.name] as const));
  const remaining = new Set(
    entries.filter((e) => remainingNames.includes(e.meta.name)).map((e) => e.meta.id),
  );
  const path: SystemId[] = [];
  const onPath = new Set<SystemId>();
  let cycle: SystemId[] | undefined;

  const dfs = (id: SystemId): boolean => {
    path.push(id);
    onPath.add(id);
    for (const n of succ.get(id) ?? []) {
      if (onPath.has(n)) {
        const idx = path.indexOf(n);
        cycle = [...path.slice(idx), n];
        return true;
      }
      if (remaining.has(n) && dfs(n)) return true;
    }
    path.pop();
    onPath.delete(id);
    return false;
  };

  for (const id of remaining) {
    if (dfs(id)) break;
  }

  if (cycle) {
    return cycle.map((id) => nameOf.get(id) ?? "?").join(" → ");
  }
  return remainingNames.join(" → ") + " (cycle among systems)";
}

export function formatExecutionPlan(plan: ExecutionPlan): string {
  const lines: string[] = [];
  lines.push(plan.scheduleName);
  lines.push("─".repeat(Math.max(16, plan.scheduleName.length)));
  lines.push("");

  const batchOf = new Map<SystemId, number>();
  plan.batches.forEach((batch, i) => {
    for (const id of batch) batchOf.set(id, i);
  });

  for (const s of plan.systems) {
    const bi = batchOf.get(s.id) ?? 0;
    lines.push(
      `[${bi}] ${s.name}${s.declared ? "" : " (opaque)"}  backend: ${s.backend ?? s.affinity}`,
    );
    const readLabels = accessLabels(s, "read");
    const writeLabels = accessLabels(s, "write");
    if (readLabels.length) lines.push(`    reads:  ${readLabels.join(", ")}`);
    if (writeLabels.length) lines.push(`    writes: ${writeLabels.join(", ")}`);
    if (s.access.commands) lines.push(`    commands: true`);
    if (s.timing) {
      lines.push(`    avg:    ${s.timing.avgMs.toFixed(3)}ms`);
    }
    lines.push("");
  }

  if (plan.dependencies.length) {
    lines.push("Dependencies:");
    for (const d of plan.dependencies) {
      lines.push(`  ${d.fromName} → ${d.toName}`);
    }
    lines.push("");
  }

  if (plan.conflicts.length) {
    lines.push("Conflicts:");
    for (const c of plan.conflicts) {
      lines.push(
        `  ${c.aName} ↔ ${c.bName}: ${c.reasons.join(", ")}${c.ordered ? " (ordered)" : " (unordered)"}`,
      );
    }
    lines.push("");
  }

  lines.push("Potential parallel batches:");
  plan.batches.forEach((batch, i) => {
    const names = batch.map(
      (id) => plan.systems.find((s) => s.id === id)?.name ?? "?",
    );
    lines.push(`  ${i}: ${names.join(", ")}`);
  });

  if (plan.diagnostics.length) {
    lines.push("");
    lines.push("Diagnostics:");
    for (const d of plan.diagnostics) lines.push(`  - ${d}`);
  }

  return lines.join("\n");
}

function accessLabels(s: PlanSystem, mode: "read" | "write"): string[] {
  const labels: string[] = [];
  const comps = mode === "read" ? s.access.componentRead : s.access.componentWrite;
  for (const c of comps) {
    labels.push(componentLabel(c));
  }
  const res = mode === "read" ? s.access.resourceRead : s.access.resourceWrite;
  for (const r of res) {
    if (typeof r === "symbol") {
      labels.push(
        r.description?.replace(/^mob3\.resource\./, "") ?? "Resource",
      );
    } else if (typeof r === "function") labels.push(r.name || "Resource");
    else labels.push("Resource");
  }
  const ev = mode === "read" ? s.access.eventRead : s.access.eventWrite;
  for (const e of ev) {
    labels.push(e.name ?? "Event");
  }
  return labels;
}

function componentLabel(c: { id?: symbol; name?: string; isTag?: boolean }): string {
  const named = c.name;
  if (named && named !== "factory" && named !== "") return named;
  const desc = c.id?.description;
  if (desc) return desc.replace(/^mob3\.component\./, "Component#");
  return "Component";
}

/** JSON-serializable snapshot of an execution plan (symbols → strings). */
export function planToJson(plan: ExecutionPlan): Record<string, unknown> {
  const idStr = (id: SystemId) => String(id);
  return {
    schedule: plan.scheduleName,
    systems: plan.systems.map((s) => ({
      id: idStr(s.id),
      name: s.name,
      declared: s.declared,
      affinity: s.affinity,
      reads: accessLabels(s, "read"),
      writes: accessLabels(s, "write"),
      commands: s.access.commands,
      opaque: s.access.opaque,
      timing: s.timing
        ? {
            invocations: s.timing.invocations,
            avgMs: s.timing.avgMs,
            lastMs: s.timing.lastMs,
            totalMs: s.timing.totalMs,
            minMs: Number.isFinite(s.timing.minMs) ? s.timing.minMs : 0,
            maxMs: s.timing.maxMs,
          }
        : undefined,
    })),
    order: plan.order.map(idStr),
    dependencies: plan.dependencies.map((d) => ({
      from: d.fromName,
      to: d.toName,
      kind: d.kind,
    })),
    conflicts: plan.conflicts.map((c) => ({
      a: c.aName,
      b: c.bName,
      reasons: c.reasons,
      ordered: c.ordered,
    })),
    batches: plan.batches.map((batch) =>
      batch.map(
        (id) => plan.systems.find((s) => s.id === id)?.name ?? idStr(id),
      ),
    ),
    diagnostics: plan.diagnostics,
  };
}
