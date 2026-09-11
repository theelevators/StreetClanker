import { entityGeneration } from "mob3";
import * as THREE from "three";
/**
 * Per-world animation runtime store (renderer-local).
 * Not a gameplay-facing ECS component.
 */
export class AnimationRuntimeStore {
    byEntity = new Map();
    pending = [];
    disposed = false;
    set(rt) {
        this.byEntity.set(rt.entity, rt);
    }
    get(entity) {
        return this.byEntity.get(entity);
    }
    has(entity) {
        return this.byEntity.has(entity);
    }
    delete(entity) {
        const rt = this.byEntity.get(entity);
        if (!rt)
            return;
        this.teardown(rt);
        this.byEntity.delete(entity);
    }
    clear() {
        for (const rt of this.byEntity.values())
            this.teardown(rt);
        this.byEntity.clear();
        this.pending.length = 0;
    }
    values() {
        return this.byEntity.values();
    }
    size() {
        return this.byEntity.size;
    }
    enqueue(ev) {
        if (this.disposed)
            return;
        this.pending.push(ev);
    }
    teardown(rt) {
        try {
            rt.mixer.stopAllAction();
            rt.mixer.uncacheRoot(rt.root);
        }
        catch {
            /* best-effort */
        }
        rt.mixer.removeEventListener("finished", onMixerFinished);
        rt.mixer.removeEventListener("loop", onMixerLoop);
        rt.actions.clear();
        for (const c of rt.derivedClips) {
            /* clips have no dispose */
            void c;
        }
        rt.derivedClips.length = 0;
    }
}
/** Weak binding for mixer callbacks → store + entity generation. */
const mixerBindings = new WeakMap();
export function bindMixerEvents(mixer, store, entity, generation) {
    mixerBindings.set(mixer, { store, entity, generation });
    mixer.addEventListener("finished", onMixerFinished);
    mixer.addEventListener("loop", onMixerLoop);
}
function onMixerFinished(e) {
    const mixer = e.target;
    const bind = mixerBindings.get(mixer);
    if (!bind || bind.store.disposed)
        return;
    const action = e.action;
    const clip = action?.getClip()?.name ?? "";
    bind.store.enqueue({
        kind: "finished",
        entity: bind.entity,
        generation: bind.generation,
        clip,
    });
}
function onMixerLoop(e) {
    const mixer = e.target;
    const bind = mixerBindings.get(mixer);
    if (!bind || bind.store.disposed)
        return;
    const action = e.action;
    const clip = action?.getClip()?.name ?? "";
    bind.store.enqueue({
        kind: "looped",
        entity: bind.entity,
        generation: bind.generation,
        clip,
    });
}
export function getEntityGeneration(_world, entity) {
    return entityGeneration(entity);
}
/**
 * Strip position tracks that target the scene root (root-motion unsupported).
 * Returns the same clip reference when nothing is stripped (share safely).
 * Never mutates the shared asset clip.
 */
export function stripRootMotion(clip, rootName) {
    const tracks = clip.tracks.filter((t) => {
        const name = t.name;
        // Common patterns: "Root.position", ".position", "Armature.position"
        if (name.endsWith(".position")) {
            const node = name.slice(0, -".position".length);
            if (node === "" ||
                node === rootName ||
                node === "Root" ||
                node === "Armature" ||
                node === "Character" ||
                node === clip.name) {
                return false;
            }
        }
        return true;
    });
    if (tracks.length === clip.tracks.length)
        return clip;
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
export function indexBones(root) {
    const map = new Map();
    root.traverse((o) => {
        if (o.name)
            map.set(o.name, o);
    });
    return map;
}
//# sourceMappingURL=runtime.js.map