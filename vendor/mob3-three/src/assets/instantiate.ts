import {
  Name,
  Transform,
  GlobalTransform,
  component,
  type World,
  type Entity,
} from "mob3";
import type { AssetHandle } from "@mob3/assets";
import { assetsOf } from "@mob3/assets";
import * as THREE from "three";
import { ThreeObject, ThreeScene } from "../components.js";
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

export const AssetInstanceRef = component<AssetInstanceRefData>(
  {
    typeName: "",
    key: "",
    index: -1,
    generation: 0,
  },
  "AssetInstanceRef",
);

const instanceReleases = new Map<Entity, () => void>();

/**
 * Instantiate a ready static GLTF into an ECS hierarchy.
 * Object3Ds are cloned per-instance; geometries/materials/textures are shared.
 * Flat Three scene attachment — ECS Parent/Children + GlobalTransform remain authoritative.
 */
export function instantiateGltf(
  world: World,
  handle: AssetHandle<GltfAssetData>,
  opts: InstantiateGltfOptions = {},
): Entity {
  const assets = assetsOf(world);
  const state = assets.state(handle);
  if (state.status === "loading") {
    throw new Error(
      `Cannot instantiate GltfAsset "${handle.key}": asset state is Loading.`,
    );
  }
  if (state.status === "failed") {
    throw new Error(
      `Cannot instantiate GltfAsset "${handle.key}": asset state is Failed (${state.error.message}).`,
    );
  }
  if (state.status !== "ready") {
    throw new Error(
      `Cannot instantiate GltfAsset "${handle.key}": asset state is ${state.status}.`,
    );
  }

  const retain = opts.retain !== false;
  if (retain) assets.retain(handle);

  const sceneRes = world.tryResource(ThreeScene);
  const template = state.value.scene;

  const root = spawnNode(world, template, null, sceneRes, handle, opts.name);
  if (opts.parent != null) {
    world.setParent(root, opts.parent);
  }

  const stack: Array<{ template: THREE.Object3D; parent: Entity }> = [];
  for (const child of template.children) {
    stack.push({ template: child, parent: root });
  }
  while (stack.length) {
    const { template: tNode, parent } = stack.pop()!;
    const entity = spawnNode(world, tNode, parent, sceneRes, handle);
    for (const c of tNode.children) {
      stack.push({ template: c, parent: entity });
    }
  }

  instanceReleases.set(root, () => {
    if (retain) assets.release(handle);
    instanceReleases.delete(root);
  });

  return root;
}

/** Release instantiate retain when an instance root is destroyed. */
export function releaseGltfInstance(_world: World, root: Entity): void {
  const fn = instanceReleases.get(root);
  if (fn) fn();
}

/**
 * Despawn GLTF instance root (cascade) and release asset retain if instantiate retained.
 */
export function despawnGltfInstance(world: World, root: Entity): void {
  releaseGltfInstance(world, root);
  world.despawn(root, { hierarchy: "cascade" });
}

function spawnNode(
  world: World,
  template: THREE.Object3D,
  parent: Entity | null,
  scene: THREE.Scene | undefined,
  handle: AssetHandle<GltfAssetData>,
  nameOverride?: string,
): Entity {
  const obj = template.clone(false);
  if (scene) scene.add(obj);

  const name = nameOverride ?? (template.name || "Node");
  const entity = world.spawn(
    Name({ value: name }) as never,
    Transform({
      x: template.position.x,
      y: template.position.y,
      z: template.position.z,
      rx: template.rotation.x,
      ry: template.rotation.y,
      rz: template.rotation.z,
      sx: template.scale.x,
      sy: template.scale.y,
      sz: template.scale.z,
    }) as never,
    GlobalTransform() as never,
    ThreeObject(obj) as never,
    AssetInstanceRef({
      typeName: handle.typeName,
      key: handle.key,
      index: handle.index,
      generation: handle.generation,
    }) as never,
  );

  if (parent !== null) world.setParent(entity, parent);
  return entity;
}

/** Build a ready GltfAssetData from a hand-built Object3D tree (tests / generated). */
export function gltfDataFromObject3D(root: THREE.Object3D): GltfAssetData {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m) continue;
      materials.add(m);
      for (const v of Object.values(m)) {
        if (v && typeof v === "object" && (v as THREE.Texture).isTexture) {
          textures.add(v as THREE.Texture);
        }
      }
    }
  });
  const group =
    root instanceof THREE.Group ? root : new THREE.Group().add(root);
  if (!(root instanceof THREE.Group)) {
    group.name = root.name || "Root";
  }
  return {
    scene: group,
    geometries,
    materials,
    textures,
    clips: [],
    disposeCounts: { geometry: 0, material: 0, texture: 0 },
  };
}

/** Build GltfAssetData including shared AnimationClips. */
export function gltfDataFromObject3DWithClips(
  root: THREE.Object3D,
  clips: THREE.AnimationClip[],
): GltfAssetData {
  const data = gltfDataFromObject3D(root);
  data.clips = clips;
  return data;
}
