import { defineAssetType } from "@mob3/assets";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
export const GltfAsset = defineAssetType("GltfAsset");
function collectResources(root, out) {
    root.traverse((obj) => {
        const mesh = obj;
        if (mesh.isMesh) {
            if (mesh.geometry)
                out.geometries.add(mesh.geometry);
            const mats = Array.isArray(mesh.material)
                ? mesh.material
                : [mesh.material];
            for (const m of mats) {
                if (!m)
                    continue;
                out.materials.add(m);
                for (const v of Object.values(m)) {
                    if (v && typeof v === "object" && v.isTexture) {
                        out.textures.add(v);
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
export function createGltfLoader(opts = {}) {
    return {
        async load(request, ctx) {
            const loader = opts.createLoader?.() ?? new GLTFLoader();
            let data;
            if (opts.resolve) {
                data = await opts.resolve(request.key, ctx.signal);
            }
            else if (typeof fetch === "function") {
                const res = await fetch(request.key, { signal: ctx.signal });
                if (!res.ok) {
                    throw new Error(`Failed to load GltfAsset "${request.key}": HTTP ${res.status}`);
                }
                data = await res.arrayBuffer();
            }
            else {
                throw new Error(`GltfAsset "${request.key}": no resolve() and fetch unavailable`);
            }
            if (ctx.signal.aborted) {
                throw new DOMException("Aborted", "AbortError");
            }
            const gltf = await new Promise((resolve, reject) => {
                try {
                    if (typeof loader.parseAsync === "function") {
                        loader
                            .parseAsync(data, "")
                            .then(resolve)
                            .catch(reject);
                        return;
                    }
                    loader.parse(data, "", (g) => resolve(g), (e) => reject(e instanceof Error
                        ? e
                        : new Error(`GLTF parse failed for "${request.key}"`)));
                }
                catch (e) {
                    reject(e instanceof Error ? e : new Error(String(e)));
                }
            });
            const scene = gltf.scene ?? new THREE.Group();
            const geometries = new Set();
            const materials = new Set();
            const textures = new Set();
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
export function minimalBoxGltfJson() {
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
//# sourceMappingURL=gltf.js.map