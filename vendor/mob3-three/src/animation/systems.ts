import {
  Update,
  PostUpdate,
  Time,
  Transform,
  GlobalTransform,
  PendingDespawn,
  Parent,
  transformPropagation,
  system,
  resource,
  type App,
  type Plugin,
  type World,
  type Entity,
} from "mob3";
import * as THREE from "three";
import {
  AnimationPlayer,
  AnimationFinished,
  AnimationLooped,
  BoneAttachment,
} from "./components.js";
import {
  AnimationRuntimeStore,
  getEntityGeneration,
  type AnimationRuntime,
} from "./runtime.js";
import { ThreeObject } from "../components.js";

export const AnimationRuntimes = resource<AnimationRuntimeStore>("AnimationRuntimes");

export function animationStoreOf(world: World): AnimationRuntimeStore {
  const s = world.tryResource(AnimationRuntimes);
  if (!s) {
    throw new Error("AnimationRuntimes missing — add AnimationPlugin()");
  }
  return s;
}

/** Sync AnimationPlayer intent → mixer actions. */
export const animationIntent = system({
  name: "animationIntent",
  access: {
    write: [AnimationPlayer],
    resources: { write: [AnimationRuntimes] },
  },
  run(world) {
    const store = world.tryResource(AnimationRuntimes);
    if (!store || store.disposed) return;
    for (const [entity, player] of world.query(AnimationPlayer)) {
      const rt = store.get(entity);
      if (!rt) continue;
      applyIntent(world, entity, player, rt);
    }
  },
});

function applyIntent(
  world: World,
  entity: Entity,
  player: {
    clip: string;
    playing: boolean;
    speed: number;
    loop: boolean;
    time: number;
    fadeDuration: number;
  },
  rt: AnimationRuntime,
): void {
  void world;
  void entity;
  if (!player.clip) {
    if (rt.current) {
      rt.mixer.stopAllAction();
      rt.current = "";
    }
    return;
  }

  let action = rt.actions.get(player.clip);
  if (!action) {
    const clip = rt.clips.get(player.clip);
    if (!clip) {
      const available = [...rt.clips.keys()].join(", ") || "(none)";
      throw new Error(
        `Animation clip "${player.clip}" not found on asset ${rt.assetHandle.key}. Available: ${available}.`,
      );
    }
    action = rt.mixer.clipAction(clip);
    rt.actions.set(player.clip, action);
  }

  action.setLoop(player.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  action.clampWhenFinished = !player.loop;
  action.timeScale = player.speed;

  if (player.playing) {
    if (rt.current !== player.clip) {
      const prev = rt.current ? rt.actions.get(rt.current) : undefined;
      const fade = Math.max(0, player.fadeDuration);
      if (prev && fade > 0) {
        prev.fadeOut(fade);
        action.reset().fadeIn(fade).play();
      } else {
        rt.mixer.stopAllAction();
        action.reset().play();
      }
      rt.current = player.clip;
    } else if (!action.isRunning()) {
      action.paused = false;
      action.play();
    } else {
      action.paused = false;
    }
  } else {
    action.paused = true;
  }

  if (Math.abs(action.time - player.time) > 1e-3 && !player.playing) {
    action.time = player.time;
  }
}

/** Advance mixers using Update delta. */
export const animationMixerUpdate = system({
  name: "animationMixerUpdate",
  access: {
    write: [AnimationPlayer],
    resources: { read: [Time], write: [AnimationRuntimes] },
  },
  run(world) {
    const store = world.tryResource(AnimationRuntimes);
    if (!store || store.disposed) return;
    const dt = world.resource(Time).delta;
    for (const rt of store.values()) {
      if (!world.isAlive(rt.entity)) continue;
      const player = world.get(rt.entity, AnimationPlayer);
      if (player?.playing) {
        rt.mixer.update(dt);
        const action = rt.current ? rt.actions.get(rt.current) : undefined;
        if (action && player) {
          player.time = action.time;
        }
      }
    }
  },
});

/** Flush queued mixer events into mob3 events (after mixer update). */
export const animationEventFlush = system({
  name: "animationEventFlush",
  access: {
    resources: { write: [AnimationRuntimes] },
    events: { write: [AnimationFinished, AnimationLooped] },
  },
  run(world) {
    const store = world.tryResource(AnimationRuntimes);
    if (!store || store.disposed) return;
    const batch = store.pending.splice(0, store.pending.length);
    for (const ev of batch) {
      if (!world.isAlive(ev.entity)) continue;
      const gen = getEntityGeneration(world, ev.entity);
      if (gen !== ev.generation) continue;
      if (ev.kind === "finished") {
        world.send(AnimationFinished, { entity: ev.entity, clip: ev.clip });
        const player = world.getMut(ev.entity, AnimationPlayer);
        if (player && player.clip === ev.clip) {
          player.playing = false;
        }
      } else {
        world.send(AnimationLooped, { entity: ev.entity, clip: ev.clip });
      }
    }
  },
});

const _rootMat = new THREE.Matrix4();
const _result = new THREE.Matrix4();
const _offset = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _euler = new THREE.Euler();
const _qOffset = new THREE.Quaternion();

/**
 * Sample bones → Transform/GlobalTransform.
 * Runs in PostUpdate after transformPropagation so character GlobalTransform is current
 * and attachment writes are not overwritten the same frame.
 */
export const boneAttachmentSample = system({
  name: "boneAttachmentSample",
  access: {
    read: [BoneAttachment, ThreeObject, Parent],
    write: [Transform, GlobalTransform],
    resources: { read: [AnimationRuntimes] },
  },
  run(world) {
    const store = world.tryResource(AnimationRuntimes);
    if (!store || store.disposed) return;

    for (const [entity, att] of world.query(BoneAttachment)) {
      if (!world.isAlive(att.source)) {
        world.remove(entity, BoneAttachment);
        continue;
      }
      const rt = store.get(att.source);
      if (!rt) {
        world.remove(entity, BoneAttachment);
        continue;
      }
      const bone = rt.bones.get(att.bone);
      if (!bone) {
        throw new Error(
          `Bone "${att.bone}" not found on animated entity ${att.source}. ` +
            `Available: ${[...rt.bones.keys()].slice(0, 20).join(", ")}`,
        );
      }

      // Root Three object stays at identity; ECS GlobalTransform is world pose.
      // bone.matrixWorld is therefore character-local.
      rt.root.updateMatrixWorld(true);
      const rootG =
        world.get(att.source, GlobalTransform) ??
        world.get(att.source, Transform);
      if (!rootG) continue;

      _pos.set(rootG.x, rootG.y, rootG.z);
      _euler.set(rootG.rx, rootG.ry, rootG.rz, "XYZ");
      _quat.setFromEuler(_euler);
      _scl.set(rootG.sx, rootG.sy, rootG.sz);
      _rootMat.compose(_pos, _quat, _scl);

      _result.multiplyMatrices(_rootMat, bone.matrixWorld);

      _pos.set(att.ox, att.oy, att.oz);
      _euler.set(att.orx, att.ory, att.orz, "XYZ");
      _qOffset.setFromEuler(_euler);
      _scl.set(1, 1, 1);
      _offset.compose(_pos, _qOffset, _scl);
      _result.multiply(_offset);

      _result.decompose(_pos, _quat, _scl);
      _euler.setFromQuaternion(_quat, "XYZ");

      const pose = {
        x: _pos.x,
        y: _pos.y,
        z: _pos.z,
        rx: _euler.x,
        ry: _euler.y,
        rz: _euler.z,
        sx: _scl.x,
        sy: _scl.y,
        sz: _scl.z,
      };

      // BoneAttachment is the transform source — prefer free roots (no Parent).
      // Always write GlobalTransform after propagation so it wins for PreRender.
      if (!world.has(entity, Parent)) {
        const local = world.getMut(entity, Transform);
        if (local) {
          local.x = pose.x;
          local.y = pose.y;
          local.z = pose.z;
          local.rx = pose.rx;
          local.ry = pose.ry;
          local.rz = pose.rz;
          local.sx = pose.sx;
          local.sy = pose.sy;
          local.sz = pose.sz;
        } else {
          world.add(entity, Transform(pose) as never);
        }
      }

      const global = world.getMut(entity, GlobalTransform);
      if (global) {
        global.x = pose.x;
        global.y = pose.y;
        global.z = pose.z;
        global.rx = pose.rx;
        global.ry = pose.ry;
        global.rz = pose.rz;
        global.sx = pose.sx;
        global.sy = pose.sy;
        global.sz = pose.sz;
      } else {
        world.add(entity, GlobalTransform(pose) as never);
      }
    }
  },
});

/** Teardown animation runtime on PendingDespawn. */
export const animationDespawnCleanup = system({
  name: "animationDespawnCleanup",
  access: {
    read: [PendingDespawn, AnimationPlayer],
    resources: { write: [AnimationRuntimes] },
  },
  run(world) {
    const store = world.tryResource(AnimationRuntimes);
    if (!store) return;
    for (const [entity] of world.query(AnimationPlayer).with(PendingDespawn)) {
      store.delete(entity);
    }
  },
});

export type AnimationPluginOptions = Record<string, never>;

export function AnimationPlugin(_opts: AnimationPluginOptions = {}): Plugin {
  return {
    build(app: App) {
      const store = new AnimationRuntimeStore();
      app.insertResource(AnimationRuntimes, store);
      app.addSystem(Update, animationIntent);
      app.addSystem(Update, animationMixerUpdate, { after: animationIntent });
      app.addSystem(Update, animationEventFlush, {
        after: animationMixerUpdate,
      });
      app.addSystem(Update, animationDespawnCleanup);
      app.addSystem(PostUpdate, boneAttachmentSample, {
        after: transformPropagation,
      });
      app.onDispose(() => {
        store.disposed = true;
        store.clear();
      });
    },
  };
}
