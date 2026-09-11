export type TimeData = {
    /** Seconds since last update (clamped). */
    delta: number;
    /** Total elapsed seconds since start. */
    elapsed: number;
    /** Fixed timestep in seconds. */
    fixedDelta: number;
    /** Accumulator for fixed updates. */
    fixedAccumulator: number;
    /** Raw unclamped frame delta. */
    rawDelta: number;
};
export declare const Time: import("./resource.js").ResourceType<TimeData>;
export declare function createTime(fixedDelta?: number): TimeData;
/** Max delta clamp to avoid spiral-of-death after tab blur. */
export declare const MAX_DELTA = 0.25;
//# sourceMappingURL=time.d.ts.map