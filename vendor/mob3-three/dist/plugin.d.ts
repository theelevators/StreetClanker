import type { Plugin } from "mob3";
import { type ThreePluginOptions } from "./components.js";
/**
 * Flat scene sync: ECS GlobalTransform → Object3D.
 * Three parenting is NOT authoritative; objects stay under Scene.
 * Change-aware: only sync GlobalTransform (or Transform fallback) changed this tick.
 */
export declare const syncTransforms: import("mob3").DeclaredSystem;
export declare const renderFrame: import("mob3").DeclaredSystem;
/** Detach Object3D for entities pending despawn (public PendingDespawn tag). */
export declare const detachPendingThreeObjects: import("mob3").DeclaredSystem;
/**
 * Thin Three.js integration.
 *
 * Ownership: objects created by the plugin are disposed on `app.dispose()`.
 * Caller-supplied renderer/scene/camera are left alone.
 */
export declare function ThreePlugin(options?: ThreePluginOptions): Plugin;
//# sourceMappingURL=plugin.d.ts.map