import { type World, type Entity } from "mob3";
import type { AssetHandle } from "@mob3/assets";
import * as THREE from "three";
import type { GltfAssetData } from "./gltf.js";
export type InstantiateGltfOptions = {
    /** Retain asset for this instance (+1). Default true. */
    retain?: boolean;
    /** Parent entity for the root (optional). */
    parent?: Entity | null;
    /** Root name override. */
    name?: string;
};
/** Optional marker: entity created from an asset instance. */
export type AssetInstanceRefData = {
    typeName: string;
    key: string;
    index: number;
    generation: number;
};
export declare const AssetInstanceRef: import("mob3").ComponentType<AssetInstanceRefData>;
/**
 * Instantiate a ready static GLTF into an ECS hierarchy.
 * Object3Ds are cloned per-instance; geometries/materials/textures are shared.
 * Flat Three scene attachment — ECS Parent/Children + GlobalTransform remain authoritative.
 */
export declare function instantiateGltf(world: World, handle: AssetHandle<GltfAssetData>, opts?: InstantiateGltfOptions): Entity;
/** Release instantiate retain when an instance root is destroyed. */
export declare function releaseGltfInstance(_world: World, root: Entity): void;
/**
 * Despawn GLTF instance root (cascade) and release asset retain if instantiate retained.
 */
export declare function despawnGltfInstance(world: World, root: Entity): void;
/** Build a ready GltfAssetData from a hand-built Object3D tree (tests / generated). */
export declare function gltfDataFromObject3D(root: THREE.Object3D): GltfAssetData;
/** Build GltfAssetData including shared AnimationClips. */
export declare function gltfDataFromObject3DWithClips(root: THREE.Object3D, clips: THREE.AnimationClip[]): GltfAssetData;
//# sourceMappingURL=instantiate.d.ts.map