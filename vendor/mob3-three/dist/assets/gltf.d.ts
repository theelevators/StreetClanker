import { type AssetLoader } from "@mob3/assets";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
export type GltfAssetData = {
    /** Template scene — not attached to the world Scene. */
    scene: THREE.Group;
    geometries: Set<THREE.BufferGeometry>;
    materials: Set<THREE.Material>;
    textures: Set<THREE.Texture>;
    /** Shared AnimationClip definitions (immutable for instances). */
    clips: THREE.AnimationClip[];
    /** Instrumentation for disposal tests. */
    disposeCounts: {
        geometry: number;
        material: number;
        texture: number;
    };
};
export declare const GltfAsset: import("@mob3/assets").AssetType<GltfAssetData>;
export type GltfLoaderOptions = {
    /** Override loader construction (DRACO later). */
    createLoader?: () => GLTFLoader;
    /**
     * Resolve key → ArrayBuffer / string for parse (tests / fixtures).
     * If omitted, uses fetch(key) in browser-like environments.
     */
    resolve?: (key: string, signal: AbortSignal) => Promise<ArrayBuffer | string>;
};
/**
 * GLTF loader via three.js GLTFLoader.parse.
 * Populates `clips` for Phase 11 animation; static scenes keep clips=[].
 */
export declare function createGltfLoader(opts?: GltfLoaderOptions): AssetLoader<GltfAssetData>;
/** Minimal static box glTF JSON for tests/fixtures (no external buffers). */
export declare function minimalBoxGltfJson(): string;
//# sourceMappingURL=gltf.d.ts.map