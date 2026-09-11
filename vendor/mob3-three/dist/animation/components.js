import { component, event } from "mob3";
export const AnimationPlayer = component({
    clip: "",
    playing: false,
    speed: 1,
    loop: true,
    time: 0,
    fadeDuration: 0.25,
}, "AnimationPlayer");
export const BoneAttachment = component({
    source: 0,
    bone: "",
    ox: 0,
    oy: 0,
    oz: 0,
    orx: 0,
    ory: 0,
    orz: 0,
}, "BoneAttachment");
export const AnimationFinished = event("AnimationFinished");
export const AnimationLooped = event("AnimationLooped");
//# sourceMappingURL=components.js.map