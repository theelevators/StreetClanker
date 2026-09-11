import { type Plugin, type World } from "mob3";
import { AnimationRuntimeStore } from "./runtime.js";
export declare const AnimationRuntimes: import("mob3").ResourceType<AnimationRuntimeStore>;
export declare function animationStoreOf(world: World): AnimationRuntimeStore;
/** Sync AnimationPlayer intent → mixer actions. */
export declare const animationIntent: import("mob3").DeclaredSystem;
/** Advance mixers using Update delta. */
export declare const animationMixerUpdate: import("mob3").DeclaredSystem;
/** Flush queued mixer events into mob3 events (after mixer update). */
export declare const animationEventFlush: import("mob3").DeclaredSystem;
/**
 * Sample bones → Transform/GlobalTransform.
 * Runs in PostUpdate after transformPropagation so character GlobalTransform is current
 * and attachment writes are not overwritten the same frame.
 */
export declare const boneAttachmentSample: import("mob3").DeclaredSystem;
/** Teardown animation runtime on PendingDespawn. */
export declare const animationDespawnCleanup: import("mob3").DeclaredSystem;
export type AnimationPluginOptions = Record<string, never>;
export declare function AnimationPlugin(_opts?: AnimationPluginOptions): Plugin;
//# sourceMappingURL=systems.d.ts.map