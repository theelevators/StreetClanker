import { type World, type Entity } from "mob3";
import type { AssetHandle } from "@mob3/assets";
import type { GltfAssetData } from "../assets/gltf.js";
export type InstantiateAnimatedOptions = {
    retain?: boolean;
    parent?: Entity | null;
    name?: string;
    /** Initial clip to play (optional). */
    clip?: string;
    loop?: boolean;
    /**
     * Strip root position tracks (default true — root motion unsupported).
     */
    stripRootMotion?: boolean;
};
/**
 * Instantiate an animated GLTF: SkeletonUtils.clone for independent skeleton,
 * shared clips from asset, per-instance AnimationMixer.
 * Single root ThreeObject (full clone tree) — bones stay renderer-local.
 */
export declare function instantiateAnimatedGltf(world: World, handle: AssetHandle<GltfAssetData>, opts?: InstantiateAnimatedOptions): Entity;
export declare function despawnAnimatedGltf(world: World, root: Entity): void;
/**
 * Procedural animated character fixture for tests (no GLTF file).
 * Hierarchy: Root → Hip → Spine → RightHand; clips Idle/Walk/Run rotate bones.
 */
export declare function createProceduralCharacterAsset(): GltfAssetData;
//# sourceMappingURL=instantiate_animated.d.ts.map