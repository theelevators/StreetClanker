import type { ComponentType } from "../component.js";
import type { ResourceKey } from "../resource.js";
import type { World } from "../world.js";
import type { EventType } from "../event.js";
import type { WorkerPayload, WorkerResult, WorkerWriteSlice } from "./types.js";
import type { NormalizedAccess } from "../system.js";
export type NumericLayout = {
    type: ComponentType;
    name: string;
    fields: string[];
};
/** True if component defaults are a plain numeric record (worker-transferable). */
export declare function isWorkerSafeComponent(type: ComponentType): boolean;
export declare function getNumericLayout(type: ComponentType): NumericLayout | null;
export declare function assertWorkerAccess(access: NormalizedAccess, systemName: string): void;
export type ExtractContext = {
    /** ComponentType by layout name for commit. */
    byName: Map<string, NumericLayout>;
    /** EventType by name for merge. */
    eventsByName: Map<string, EventType>;
    /** Resource keys by name. */
    resourcesByName: Map<string, ResourceKey>;
};
export declare function extractWorkerPayload(world: World, access: NormalizedAccess, ctx: ExtractContext, delayMs?: number): WorkerPayload;
/** Extract using original AccessDeclaration resource keys. */
export declare function extractWorkerPayloadWithKeys(world: World, access: NormalizedAccess, resourceKeys: ResourceKey[], eventTypes: EventType[], delayMs?: number): {
    payload: WorkerPayload;
    ctx: ExtractContext;
};
export declare function validateWorkerResult(result: WorkerResult, allowedWriteNames: Set<string>, systemName: string): void;
export declare function commitWorkerWrites(world: World, writes: WorkerWriteSlice[], ctx: ExtractContext): void;
export declare function commitWorkerEvents(world: World, events: WorkerResult["events"], ctx: ExtractContext): void;
/** Run a worker handler on the main thread (fallback / sequential reference). */
export declare function runHandlerLocal(moduleUrl: string, exportName: string, payload: WorkerPayload): Promise<WorkerResult>;
//# sourceMappingURL=transfer.d.ts.map