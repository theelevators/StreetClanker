import { resource } from "./resource.js";
export const Time = resource("Time");
export function createTime(fixedDelta = 1 / 60) {
    return {
        delta: 0,
        elapsed: 0,
        fixedDelta,
        fixedAccumulator: 0,
        rawDelta: 0,
    };
}
/** Max delta clamp to avoid spiral-of-death after tab blur. */
export const MAX_DELTA = 0.25;
//# sourceMappingURL=time.js.map