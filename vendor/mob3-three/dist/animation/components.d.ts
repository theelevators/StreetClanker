import { type Entity } from "mob3";
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
export declare const AnimationPlayer: import("mob3").ComponentType<AnimationPlayerData>;
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
export declare const BoneAttachment: import("mob3").ComponentType<BoneAttachmentData>;
export type AnimationFinishedEvent = {
    entity: Entity;
    clip: string;
};
export type AnimationLoopedEvent = {
    entity: Entity;
    clip: string;
};
export declare const AnimationFinished: import("mob3").EventType<AnimationFinishedEvent>;
export declare const AnimationLooped: import("mob3").EventType<AnimationLoopedEvent>;
//# sourceMappingURL=components.d.ts.map