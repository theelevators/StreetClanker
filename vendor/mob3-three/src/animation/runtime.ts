import type { Entity, World } from "mob3";
import { entityGeneration } from "mob3";
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
export class AnimationRuntimeStore {
  private byEntity = new Map<Entity, AnimationRuntime>();
  pending: PendingAnimEvent[] = [];
  disposed = false;

  set(rt: AnimationRuntime): void {
    this.byEntity.set(rt.entity, rt);
  }

  get(entity: Entity): AnimationRuntime | undefined {
    return this.byEntity.get(entity);
  }

  has(entity: Entity): boolean {
    return this.byEntity.has(entity);
  }

  delete(entity: Entity): void {
    const rt = this.byEntity.get(entity);
    if (!rt) return;
    this.teardown(rt);
    this.byEntity.delete(entity);
  }

  clear(): void {
    for (const rt of this.byEntity.values()) this.teardown(rt);
    this.byEntity.clear();
    this.pending.length = 0;
  }

  values(): IterableIterator<AnimationRuntime> {
    return this.byEntity.values();
  }

  size(): number {
    return this.byEntity.size;
  }

  enqueue(ev: PendingAnimEvent): void {
    if (this.disposed) return;
    this.pending.push(ev);
  }

  private teardown(rt: AnimationRuntime): void {
    try {
      rt.mixer.stopAllAction();
      rt.mixer.uncacheRoot(rt.root);
    } catch {
      /* best-effort */
    }
    rt.mixer.removeEventListener("finished", onMixerFinished as never);
    rt.mixer.removeEventListener("loop", onMixerLoop as never);
    rt.actions.clear();
    for (const c of rt.derivedClips) {
      /* clips have no dispose */
      void c;
    }
    rt.derivedClips.length = 0;
  }
}

/** Weak binding for mixer callbacks → store + entity generation. */
const mixerBindings = new WeakMap<
  THREE.AnimationMixer,
  { store: AnimationRuntimeStore; entity: Entity; generation: number }
>();

export function bindMixerEvents(
  mixer: THREE.AnimationMixer,
  store: AnimationRuntimeStore,
  entity: Entity,
  generation: number,
): void {
  mixerBindings.set(mixer, { store, entity, generation });
  mixer.addEventListener("finished", onMixerFinished);
  mixer.addEventListener("loop", onMixerLoop);
}

function onMixerFinished(e: THREE.Event): void {
  const mixer = e.target as THREE.AnimationMixer;
  const bind = mixerBindings.get(mixer);
  if (!bind || bind.store.disposed) return;
  const action = (e as { action?: THREE.AnimationAction }).action;
  const clip = action?.getClip()?.name ?? "";
  bind.store.enqueue({
    kind: "finished",
    entity: bind.entity,
    generation: bind.generation,
    clip,
  });
}

function onMixerLoop(e: THREE.Event): void {
  const mixer = e.target as THREE.AnimationMixer;
  const bind = mixerBindings.get(mixer);
  if (!bind || bind.store.disposed) return;
  const action = (e as { action?: THREE.AnimationAction }).action;
  const clip = action?.getClip()?.name ?? "";
  bind.store.enqueue({
    kind: "looped",
    entity: bind.entity,
    generation: bind.generation,
    clip,
  });
}

export function getEntityGeneration(_world: World, entity: Entity): number {
  return entityGeneration(entity);
}

/**
 * Strip position tracks that target the scene root (root-motion unsupported).
 * Returns the same clip reference when nothing is stripped (share safely).
 * Never mutates the shared asset clip.
 */
export function stripRootMotion(
  clip: THREE.AnimationClip,
  rootName: string,
): THREE.AnimationClip {
  const tracks = clip.tracks.filter((t) => {
    const name = t.name;
    // Common patterns: "Root.position", ".position", "Armature.position"
    if (name.endsWith(".position")) {
      const node = name.slice(0, -".position".length);
      if (
        node === "" ||
        node === rootName ||
        node === "Root" ||
        node === "Armature" ||
        node === "Character" ||
        node === clip.name
      ) {
        return false;
      }
    }
    return true;
  });
  if (tracks.length === clip.tracks.length) return clip;
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

export function indexBones(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const map = new Map<string, THREE.Object3D>();
  root.traverse((o) => {
    if (o.name) map.set(o.name, o);
  });
  return map;
}
