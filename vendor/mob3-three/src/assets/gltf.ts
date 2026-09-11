import { defineAssetType, type AssetLoader } from "@mob3/assets";
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

export const GltfAsset = defineAssetType<GltfAssetData>("GltfAsset");

export type GltfLoaderOptions = {
  /** Override loader construction (DRACO later). */
  createLoader?: () => GLTFLoader;
  /**
   * Resolve key → ArrayBuffer / string for parse (tests / fixtures).
   * If omitted, uses fetch(key) in browser-like environments.
   */
  resolve?: (key: string, signal: AbortSignal) => Promise<ArrayBuffer | string>;
};

function collectResources(
  root: THREE.Object3D,
  out: {
    geometries: Set<THREE.BufferGeometry>;
    materials: Set<THREE.Material>;
    textures: Set<THREE.Texture>;
  },
): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      if (mesh.geometry) out.geometries.add(mesh.geometry);
      const mats = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const m of mats) {
        if (!m) continue;
        out.materials.add(m);
        for (const v of Object.values(m)) {
          if (v && typeof v === "object" && (v as THREE.Texture).isTexture) {
            out.textures.add(v as THREE.Texture);
          }
        }
      }
    }
  });
}

/**
 * GLTF loader via three.js GLTFLoader.parse.
 * Populates `clips` for Phase 11 animation; static scenes keep clips=[].
 */
export function createGltfLoader(
  opts: GltfLoaderOptions = {},
): AssetLoader<GltfAssetData> {
  return {
    async load(request, ctx) {
      const loader = opts.createLoader?.() ?? new GLTFLoader();
      let data: ArrayBuffer | string;
      if (opts.resolve) {
        data = await opts.resolve(request.key, ctx.signal);
      } else if (typeof fetch === "function") {
        const res = await fetch(request.key, { signal: ctx.signal });
        if (!res.ok) {
          throw new Error(
            `Failed to load GltfAsset "${request.key}": HTTP ${res.status}`,
          );
        }
        data = await res.arrayBuffer();
      } else {
        throw new Error(
          `GltfAsset "${request.key}": no resolve() and fetch unavailable`,
        );
      }
      if (ctx.signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const gltf = await new Promise<Awaited<ReturnType<GLTFLoader["parseAsync"]>>>(
        (resolve, reject) => {
          try {
            if (typeof loader.parseAsync === "function") {
              loader
                .parseAsync(data as ArrayBuffer, "")
                .then(resolve)
                .catch(reject);
              return;
            }
            loader.parse(
              data as ArrayBuffer,
              "",
              (g) => resolve(g as never),
              (e) =>
                reject(
                  e instanceof Error
                    ? e
                    : new Error(`GLTF parse failed for "${request.key}"`),
                ),
            );
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        },
      );

      const scene = gltf.scene ?? new THREE.Group();
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      collectResources(scene, { geometries, materials, textures });
      const clips = [...(gltf.animations ?? [])];

      return {
        scene,
        geometries,
        materials,
        textures,
        clips,
        disposeCounts: { geometry: 0, material: 0, texture: 0 },
      };
    },
    dispose(value) {
      for (const g of value.geometries) {
        g.dispose();
        value.disposeCounts.geometry++;
      }
      for (const m of value.materials) {
        m.dispose();
        value.disposeCounts.material++;
      }
      for (const t of value.textures) {
        t.dispose();
        value.disposeCounts.texture++;
      }
      value.geometries.clear();
      value.materials.clear();
      value.textures.clear();
      value.clips.length = 0;
    },
  };
}

/** Minimal static box glTF JSON for tests/fixtures (no external buffers). */
export function minimalBoxGltfJson(): string {
  // Embedded triangle-free box via accessor-free mesh using EXT? 
  // Use a tiny glTF with interleaved... Simplest: empty scene with one node.
  // For mesh tests we build programmatically via insert() instead.
  return JSON.stringify({
    asset: { version: "2.0", generator: "mob3-phase-10" },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [{ name: "Root", children: [1, 2] }, { name: "Body" }, { name: "Turret" }],
  });
}
