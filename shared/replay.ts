import type {
  ActivePhrase,
  FighterPublic,
  ImpactEvent,
  MatchState,
} from './types.ts'

/** One visual snapshot on the bout timeline — drives Arena + HUD on rematch. */
export type ReplayFrame = {
  /** Wall-clock ms when this state was live on the ring. */
  at: number
  state: MatchState
}

function slimFighter(f: FighterPublic): FighterPublic {
  return {
    id: f.id,
    name: f.name,
    corner: f.corner,
    ready: f.ready,
    connected: f.connected,
    health: f.health,
    maxHealth: f.maxHealth,
    stamina: f.stamina,
    guard: f.guard,
    knockedOut: f.knockedOut,
    lastAction: f.lastAction,
    lastActionAt: f.lastActionAt,
    nextWindowAt: f.nextWindowAt,
    covering: f.covering,
    comboCount: f.comboCount,
    comboLabel: f.comboLabel,
    record: f.record,
  }
}

function slimPhrase(p: ActivePhrase): ActivePhrase {
  return {
    id: p.id,
    corner: p.corner,
    style: p.style,
    beats: p.beats.map((b) => ({ at: b.at, move: b.move })),
    startedAt: p.startedAt,
    endsAt: p.endsAt,
    resolved: [...p.resolved],
  }
}

function slimImpact(impact: ImpactEvent | null): ImpactEvent | null {
  if (!impact) return null
  return {
    id: impact.id,
    at: impact.at,
    attacker: impact.attacker,
    defender: impact.defender,
    action: impact.action,
    result: impact.result,
    damage: impact.damage,
  }
}

/** Drop chat / long logs so bout JSON stays watchable, not huge. */
export function slimMatchState(state: MatchState): MatchState {
  return {
    id: state.id,
    phase: state.phase,
    round: state.round,
    maxRounds: state.maxRounds,
    roundEndsAt: state.roundEndsAt,
    countdownEndsAt: state.countdownEndsAt,
    winner: state.winner,
    red: slimFighter(state.red),
    blue: slimFighter(state.blue),
    chat: [],
    eventLog: state.eventLog.slice(0, 8),
    createdAt: state.createdAt,
    lastImpact: slimImpact(state.lastImpact),
    activePhrases: state.activePhrases.map(slimPhrase),
    cardHeat: state.cardHeat,
    announcerLine: state.announcerLine,
    announcerLineAt: state.announcerLineAt,
  }
}

function shiftAbs(value: number | null | undefined, shift: number): number | null {
  if (value == null) return null
  return value + shift
}

function shiftFighter(f: FighterPublic, shift: number): FighterPublic {
  return {
    ...f,
    lastActionAt: shiftAbs(f.lastActionAt, shift),
    nextWindowAt: shiftAbs(f.nextWindowAt, shift),
  }
}

/**
 * Remap absolute bout timestamps so HUD / Arena `Date.now()` math matches
 * the tape moment `tapeAbsolute` (as if that moment is "now" on the wall).
 */
export function materializeReplayState(
  frame: ReplayFrame,
  tapeAbsolute: number,
  wallNow = Date.now(),
): MatchState {
  const shift = wallNow - tapeAbsolute
  const s = frame.state
  return {
    ...s,
    roundEndsAt: shiftAbs(s.roundEndsAt, shift),
    countdownEndsAt: shiftAbs(s.countdownEndsAt, shift),
    announcerLineAt: shiftAbs(s.announcerLineAt, shift),
    createdAt: s.createdAt + shift,
    lastImpact: s.lastImpact
      ? { ...s.lastImpact, at: s.lastImpact.at + shift }
      : null,
    red: shiftFighter(s.red, shift),
    blue: shiftFighter(s.blue, shift),
    activePhrases: s.activePhrases.map((p) => ({
      ...p,
      startedAt: p.startedAt + shift,
      endsAt: p.endsAt + shift,
      beats: p.beats.map((b) => ({ ...b, at: b.at + shift })),
      resolved: [...p.resolved],
    })),
    chat: [],
    eventLog: [...s.eventLog],
  }
}

/** Last frame with `at <= tapeAbsolute` (binary search). */
export function frameAtTime(
  frames: ReplayFrame[],
  tapeAbsolute: number,
): ReplayFrame | null {
  if (frames.length === 0) return null
  let lo = 0
  let hi = frames.length - 1
  let best = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const at = frames[mid]!.at
    if (at <= tapeAbsolute) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return frames[best]!
}
