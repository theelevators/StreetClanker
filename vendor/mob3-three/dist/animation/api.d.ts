import type { Entity, World } from "mob3";
export declare function playAnimation(world: World, entity: Entity, clip: string, opts?: {
    loop?: boolean;
    speed?: number;
    fadeDuration?: number;
}): void;
export declare function pauseAnimation(world: World, entity: Entity): void;
export declare function resumeAnimation(world: World, entity: Entity): void;
export declare function stopAnimation(world: World, entity: Entity): void;
export declare function crossfadeAnimation(world: World, entity: Entity, clip: string, duration?: number): void;
export declare function listAnimationClips(world: World, entity: Entity): string[];
export declare function inspectAnimation(world: World, entity: Entity): Record<string, unknown> | null;
//# sourceMappingURL=api.d.ts.map