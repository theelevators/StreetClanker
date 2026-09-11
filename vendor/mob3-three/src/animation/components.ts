import { component, event, type Entity } from "mob3";

/** ECS animation intent — no Three.AnimationAction. */
export type AnimationPlayerData = {
  /** Clip name on the source GltfAsset (empty = none). */
  clip: string;
  playing: boolean;
  speed: number;
  /** true → LoopRepeat; false → LoopOnce + Finished event. */
  loop: boolean;
  /** Current playback time (seconds); updated by animation system. */
  time: number;
  /** Duration used for the next play/crossfade (seconds). */
  fadeDuration: number;
};

export const AnimationPlayer = component<AnimationPlayerData>(
  {
    clip: "",
    playing: false,
    speed: 1,
    loop: true,
    time: 0,
    fadeDuration: 0.25,
  },
  "AnimationPlayer",
);

/** Attach this entity's GlobalTransform to a bone on `source`. */
export type BoneAttachmentData = {
  source: Entity;
  bone: string;
  ox: number;
  oy: number;
  oz: number;
  orx: number;
  ory: number;
  orz: number;
};

export const BoneAttachment = component<BoneAttachmentData>(
  {
    source: 0 as Entity,
    bone: "",
    ox: 0,
    oy: 0,
    oz: 0,
    orx: 0,
    ory: 0,
    orz: 0,
  },
  "BoneAttachment",
);

export type AnimationFinishedEvent = {
  entity: Entity;
  clip: string;
};

export type AnimationLoopedEvent = {
  entity: Entity;
  clip: string;
};

export const AnimationFinished = event<AnimationFinishedEvent>("AnimationFinished");
export const AnimationLooped = event<AnimationLoopedEvent>("AnimationLooped");
