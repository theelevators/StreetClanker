import { AnimationPlayer } from "./components.js";
import { animationStoreOf } from "./systems.js";
function requirePlayer(world, entity) {
    if (!world.isAlive(entity)) {
        throw new Error(`Animation target entity ${entity} is not alive`);
    }
    const store = animationStoreOf(world);
    if (!store.has(entity)) {
        throw new Error(`Entity ${entity} has no animated instance (missing AnimationRuntime)`);
    }
    let player = world.getMut(entity, AnimationPlayer);
    if (!player) {
        world.add(entity, AnimationPlayer());
        player = world.getMut(entity, AnimationPlayer);
    }
    return player;
}
export function playAnimation(world, entity, clip, opts = {}) {
    const player = requirePlayer(world, entity);
    const rt = animationStoreOf(world).get(entity);
    if (!rt.clips.has(clip)) {
        const available = [...rt.clips.keys()].join(", ") || "(none)";
        throw new Error(`Animation clip "${clip}" not found on asset ${rt.assetHandle.key}. Available: ${available}.`);
    }
    player.clip = clip;
    player.playing = true;
    if (opts.loop !== undefined)
        player.loop = opts.loop;
    if (opts.speed !== undefined)
        player.speed = opts.speed;
    if (opts.fadeDuration !== undefined)
        player.fadeDuration = opts.fadeDuration;
}
export function pauseAnimation(world, entity) {
    const player = requirePlayer(world, entity);
    player.playing = false;
}
export function resumeAnimation(world, entity) {
    const player = requirePlayer(world, entity);
    if (!player.clip) {
        throw new Error(`Cannot resume entity ${entity}: no clip set`);
    }
    player.playing = true;
}
export function stopAnimation(world, entity) {
    const player = requirePlayer(world, entity);
    player.playing = false;
    player.time = 0;
    const rt = animationStoreOf(world).get(entity);
    if (rt) {
        rt.mixer.stopAllAction();
        for (const a of rt.actions.values())
            a.time = 0;
        rt.current = "";
    }
    player.clip = "";
}
export function crossfadeAnimation(world, entity, clip, duration = 0.25) {
    playAnimation(world, entity, clip, { fadeDuration: duration });
}
export function listAnimationClips(world, entity) {
    const rt = animationStoreOf(world).get(entity);
    if (!rt)
        return [];
    return [...rt.clips.keys()];
}
export function inspectAnimation(world, entity) {
    const player = world.get(entity, AnimationPlayer);
    const rt = animationStoreOf(world).get(entity);
    if (!player && !rt)
        return null;
    return {
        clip: player?.clip ?? "",
        playing: player?.playing ?? false,
        speed: player?.speed ?? 1,
        time: player?.time ?? 0,
        loop: player?.loop ?? true,
        transition: rt && rt.current !== (player?.clip ?? "") ? "pending" : "none",
        available: rt ? [...rt.clips.keys()] : [],
    };
}
//# sourceMappingURL=api.js.map