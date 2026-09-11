import { Commands } from "./commands.js";
import { getSystemMeta } from "./system.js";
import { compileExecutionPlan, TimingStore, } from "./execution_plan.js";
/** Built-in schedule labels. */
export const Startup = Symbol.for("mob3.schedule.Startup");
export const PreUpdate = Symbol.for("mob3.schedule.PreUpdate");
export const FixedUpdate = Symbol.for("mob3.schedule.FixedUpdate");
export const Update = Symbol.for("mob3.schedule.Update");
export const PostUpdate = Symbol.for("mob3.schedule.PostUpdate");
export const PreRender = Symbol.for("mob3.schedule.PreRender");
export const Render = Symbol.for("mob3.schedule.Render");
export const PostRender = Symbol.for("mob3.schedule.PostRender");
export const DEFAULT_SCHEDULE_ORDER = [
    PreUpdate,
    FixedUpdate,
    Update,
    PostUpdate,
    PreRender,
    Render,
    PostRender,
];
function asArray(v) {
    if (!v)
        return [];
    return Array.isArray(v) ? v : [v];
}
/**
 * Schedule of systems for a label, with compiled execution plans.
 */
export class Schedule {
    entries = new Map();
    compiled = new Map();
    dirty = new Set();
    nextIndex = 0;
    timingsEnabled = false;
    strict = false;
    timingStore = new TimingStore();
    /** Optional Phase 5 parallel executor. */
    parallel = null;
    enableTimings(enabled = true) {
        this.timingsEnabled = enabled;
    }
    enableStrict(enabled = true) {
        this.strict = enabled;
        for (const label of this.entries.keys()) {
            this.dirty.add(label);
            this.compiled.delete(label);
        }
    }
    setParallelExecutor(executor) {
        this.parallel = executor;
    }
    addSystem(label, system, constraints) {
        let list = this.entries.get(label);
        if (!list) {
            list = [];
            this.entries.set(label, list);
        }
        const existing = list.find((e) => e.system === system);
        if (existing) {
            existing.before.push(...asArray(constraints?.before));
            existing.after.push(...asArray(constraints?.after));
        }
        else {
            list.push({
                system,
                before: asArray(constraints?.before),
                after: asArray(constraints?.after),
                registrationIndex: this.nextIndex++,
            });
        }
        this.dirty.add(label);
        this.compiled.delete(label);
        return this;
    }
    order(label, system, constraints) {
        return this.addSystem(label, system, constraints);
    }
    /** Sequential reference executor (Phase 4). */
    run(label, world) {
        const compiled = this.compile(label);
        if (compiled.runOrder.length === 0)
            return;
        const commands = new Commands(world);
        for (const system of compiled.runOrder) {
            if (this.timingsEnabled) {
                const meta = getSystemMeta(system);
                const t0 = nowMs();
                system(world, commands);
                commands.flush();
                this.timingStore.record(meta.id, nowMs() - t0);
            }
            else {
                system(world, commands);
                commands.flush();
            }
        }
    }
    /**
     * Parallel-aware async run. Uses ParallelExecutor when set; otherwise
     * behaves like sequential `run`.
     */
    async runAsync(label, world) {
        const compiled = this.compile(label);
        if (compiled.runOrder.length === 0)
            return;
        if (this.parallel) {
            await this.parallel.run(compiled, world, this.timingsEnabled ? this.timingStore : undefined);
            return;
        }
        this.run(label, world);
    }
    systems(label) {
        return this.compile(label).runOrder;
    }
    plan(label) {
        const compiled = this.compile(label);
        if (this.timingsEnabled) {
            for (const s of compiled.plan.systems) {
                const t = this.timingStore.get(s.id);
                if (t) {
                    s.timing = {
                        ...t,
                        minMs: Number.isFinite(t.minMs) ? t.minMs : 0,
                    };
                }
            }
        }
        return compiled.plan;
    }
    inspect() {
        const out = {};
        for (const [label] of this.entries) {
            const name = typeof label === "symbol" ? label.description ?? String(label) : label;
            out[name] = this.compile(label).runOrder.length;
        }
        return out;
    }
    compile(label) {
        if (!this.dirty.has(label) && this.compiled.has(label)) {
            return this.compiled.get(label);
        }
        const list = this.entries.get(label) ?? [];
        const entries = list.map((e) => ({
            system: e.system,
            meta: getSystemMeta(e.system),
            before: e.before,
            after: e.after,
            registrationIndex: e.registrationIndex,
        }));
        const compiled = compileExecutionPlan(label, entries, this.timingsEnabled ? this.timingStore : undefined, { strict: this.strict });
        this.compiled.set(label, compiled);
        this.dirty.delete(label);
        return compiled;
    }
}
function nowMs() {
    if (typeof performance !== "undefined" && performance.now) {
        return performance.now();
    }
    return Date.now();
}
//# sourceMappingURL=schedule.js.map