import type { ComponentType } from "./component.js";
import type { ResourceKey } from "./resource.js";
import type { EventType } from "./event.js";
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
declare const META: unique symbol;
export type DeclaredSystem = SystemFn & {
    readonly [META]: SystemMeta;
};
export type SystemDefinition = {
    name: string;
    access?: AccessDeclaration;
    run: SystemFn;
};
export declare function normalizeAccess(access: AccessDeclaration | undefined, opaque: boolean): NormalizedAccess;
/**
 * Attach inspectable access metadata to a system.
 * Returns a callable SystemFn compatible with `app.addSystem`.
 */
export declare function system(def: SystemDefinition): DeclaredSystem;
export declare function getSystemMeta(fn: SystemFn): SystemMeta;
/** Peek without allocating opaque metadata (for missing-target diagnostics). */
export declare function peekSystemMeta(fn: SystemFn): SystemMeta | undefined;
export declare function isDeclaredSystem(fn: SystemFn): fn is DeclaredSystem;
/** True if two access sets conflict. */
export declare function accessesConflict(a: NormalizedAccess, b: NormalizedAccess): boolean;
export declare function describeAccessConflict(a: NormalizedAccess, b: NormalizedAccess): string[];
export { META as SYSTEM_META };
//# sourceMappingURL=system.d.ts.map