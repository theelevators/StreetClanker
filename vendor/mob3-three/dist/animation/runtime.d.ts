import type { Entity, World } from "mob3";
import * as THREE from "three";
import type { AssetHandle } from "@mob3/assets";
import type { GltfAssetData } from "../assets/gltf.js";
export type PendingAnimEvent = {
    kind: "finished" | "looped";
    entity: Entity;
    generation: number;
    clip: string;
};
export type AnimationRuntime = {
    entity: Entity;
    generation: number;
    mixer: THREE.AnimationMixer;
    root: THREE.Object3D;
    /** Shared clip defs from asset (not owned). */
    clips: Map<string, THREE.AnimationClip>;
    /** Instance-local actions. */
    actions: Map<string, THREE.AnimationAction>;
    /** Current action name. */
    current: string;
    /** Bone name → Object3D (cached). */
    bones: Map<string, THREE.Object3D>;
    assetHandle: AssetHandle<GltfAssetData>;
    /** Root-track-stripped clips (instance-owned, disposed with runtime). */
    derivedClips: THREE.AnimationClip[];
};
/**
 * Per-world animation runtime store (renderer-local).
 * Not a gameplay-facing ECS component.
 */
export declare class AnimationRuntimeStore {
    private byEntity;
    pending: PendingAnimEvent[];
    disposed: boolean;
    set(rt: AnimationRuntime): void;
    get(entity: Entity): AnimationRuntime | undefined;
    has(entity: Entity): boolean;
    delete(entity: Entity): void;
    clear(): void;
    values(): IterableIterator<AnimationRuntime>;
    size(): number;
    enqueue(ev: PendingAnimEvent): void;
    private teardown;
}
export declare function bindMixerEvents(mixer: THREE.AnimationMixer, store: AnimationRuntimeStore, entity: Entity, generation: number): void;
export declare function getEntityGeneration(_world: World, entity: Entity): number;
/**
 * Strip position tracks that target the scene root (root-motion unsupported).
 * Returns the same clip reference when nothing is stripped (share safely).
 * Never mutates the shared asset clip.
 */
export declare function stripRootMotion(clip: THREE.AnimationClip, rootName: string): THREE.AnimationClip;
export declare function indexBones(root: THREE.Object3D): Map<string, THREE.Object3D>;
//# sourceMappingURL=runtime.d.ts.map