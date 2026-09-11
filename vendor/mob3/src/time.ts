import { resource } from "./resource.js";

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

export const Time = resource<TimeData>("Time");

export function createTime(fixedDelta = 1 / 60): TimeData {
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
