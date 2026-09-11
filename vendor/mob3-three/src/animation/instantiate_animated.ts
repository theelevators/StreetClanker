import {
  Name,
  Transform,
  GlobalTransform,
  type World,
  type Entity,
} from "mob3";
import type { AssetHandle } from "@mob3/assets";
import { assetsOf } from "@mob3/assets";
import * as THREE from "three";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { ThreeObject, ThreeScene } from "../components.js";
import type { GltfAssetData } from "../assets/gltf.js";
import { AssetInstanceRef, releaseGltfInstance } from "../assets/instantiate.js";
import { AnimationPlayer } from "./components.js";
import {
  bindMixerEvents,
  getEntityGeneration,
  indexBones,
  stripRootMotion,
  type AnimationRuntime,
} from "./runtime.js";
import { animationStoreOf } from "./systems.js";

function cloneAnimatedRoot(scene: THREE.Object3D): THREE.Object3D {
  let skinned = false;
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
  });
  return skinned ? (skeletonClone(scene) as THREE.Object3D) : scene.clone(true);
}

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
export function instantiateAnimatedGltf(
  world: World,
  handle: AssetHandle<GltfAssetData>,
  opts: InstantiateAnimatedOptions = {},
): Entity {
  const assets = assetsOf(world);
  const state = assets.state(handle);
  if (state.status !== "ready") {
    throw new Error(
      `Cannot instantiate animated GltfAsset "${handle.key}": asset state is ${state.status}.`,
    );
  }
  if (!state.value.clips.length) {
    throw new Error(
      `Cannot instantiate animated GltfAsset "${handle.key}": asset has no AnimationClips.`,
    );
  }

  const retain = opts.retain !== false;
  if (retain) assets.retain(handle);

  const sceneRes = world.tryResource(ThreeScene);
  const cloned = cloneAnimatedRoot(state.value.scene);
  cloned.name = opts.name ?? state.value.scene.name ?? "AnimatedRoot";
  // Zero local transform on clone — ECS Transform is authoritative for root
  cloned.position.set(0, 0, 0);
  cloned.rotation.set(0, 0, 0);
  cloned.scale.set(1, 1, 1);
  if (sceneRes) sceneRes.add(cloned);

  const entity = world.spawn(
    Name({ value: cloned.name }) as never,
    Transform() as never,
    GlobalTransform() as never,
    ThreeObject(cloned) as never,
    AnimationPlayer({
      clip: opts.clip ?? "",
      playing: !!opts.clip,
      loop: opts.loop ?? true,
      speed: 1,
      time: 0,
      fadeDuration: 0.25,
    }) as never,
    AssetInstanceRef({
      typeName: handle.typeName,
      key: handle.key,
      index: handle.index,
      generation: handle.generation,
    }) as never,
  );

  if (opts.parent != null) world.setParent(entity, opts.parent);

  const strip = opts.stripRootMotion !== false;
  const mixer = new THREE.AnimationMixer(cloned);
  const clips = new Map<string, THREE.AnimationClip>();
  const derived: THREE.AnimationClip[] = [];
  // Strip against the template root name — instance may be renamed.
  const templateRootName = state.value.scene.name || cloned.name || "Character";
  for (const c of state.value.clips) {
    const use = strip ? stripRootMotion(c, templateRootName) : c;
    if (use !== c) derived.push(use);
    clips.set(c.name, use);
  }

  const store = animationStoreOf(world);
  const generation = getEntityGeneration(world, entity);
  bindMixerEvents(mixer, store, entity, generation);

  const rt: AnimationRuntime = {
    entity,
    generation,
    mixer,
    root: cloned,
    clips,
    actions: new Map(),
    current: "",
    bones: indexBones(cloned),
    assetHandle: handle,
    derivedClips: derived,
  };
  store.set(rt);

  // Hook release to also teardown animation runtime
  const prevRelease = () => {
    store.delete(entity);
    if (retain) assets.release(handle);
  };
  // Store via despawn helper path — patch release map
  registerAnimatedRelease(entity, prevRelease);

  return entity;
}

const animatedReleases = new Map<Entity, () => void>();

function registerAnimatedRelease(entity: Entity, fn: () => void): void {
  animatedReleases.set(entity, fn);
}

export function despawnAnimatedGltf(world: World, root: Entity): void {
  const fn = animatedReleases.get(root);
  if (fn) {
    fn();
    animatedReleases.delete(root);
  } else {
    try {
      animationStoreOf(world).delete(root);
    } catch {
      /* no store */
    }
    releaseGltfInstance(world, root);
  }
  // Detach Three object
  const three = world.get(root, ThreeObject);
  three?.object.removeFromParent();
  world.despawn(root, { hierarchy: "cascade" });
}

/**
 * Procedural animated character fixture for tests (no GLTF file).
 * Hierarchy: Root → Hip → Spine → RightHand; clips Idle/Walk/Run rotate bones.
 */
export function createProceduralCharacterAsset(): GltfAssetData {
  const root = new THREE.Group();
  root.name = "Character";

  const hip = new THREE.Bone();
  hip.name = "Hip";
  const spine = new THREE.Bone();
  spine.name = "Spine";
  spine.position.y = 0.5;
  const hand = new THREE.Bone();
  hand.name = "RightHand";
  hand.position.set(0.3, 0.4, 0);
  hip.add(spine);
  spine.add(hand);
  root.add(hip);

  // Visible marker mesh (not skinned — still follows hierarchy as child)
  const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const mat = new THREE.MeshBasicMaterial({ color: 0x66aaff });
  const marker = new THREE.Mesh(geo, mat);
  marker.name = "BodyMesh";
  hand.add(marker);

  const idle = makeClip("Idle", "Hip", 0, 0.1, 2);
  const walk = makeClip("Walk", "Hip", 0.4, 0.2, 1);
  const run = makeClip("Run", "Spine", 0.8, 0.35, 0.6);
  // Root motion track (should be stripped on instance)
  const rootMotion = new THREE.VectorKeyframeTrack(
    "Character.position",
    [0, 1],
    [0, 0, 0, 5, 0, 0],
  );
  run.tracks.push(rootMotion);

  return {
    scene: root,
    geometries: new Set([geo]),
    materials: SetWith(mat),
    textures: new Set(),
    clips: [idle, walk, run],
    disposeCounts: { geometry: 0, material: 0, texture: 0 },
  };
}

function SetWith<T>(v: T): Set<T> {
  const s = new Set<T>();
  s.add(v);
  return s;
}

function makeClip(
  name: string,
  bone: string,
  amp: number,
  _duration: number,
  period: number,
): THREE.AnimationClip {
  const times = [0, period / 2, period];
  const values = [0, amp, 0];
  const track = new THREE.NumberKeyframeTrack(
    `${bone}.rotation[z]`,
    times,
    values,
  );
  return new THREE.AnimationClip(name, period, [track]);
}
