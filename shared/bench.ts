import type { Corner } from './types.ts'

/** Minimal event row — mirrors MatchTapeEvent without importing server types. */
export type BenchTapeEvent = {
  at: number
  kind: string
  agentId?: string
  corner?: Corner
  tool?: string
  text?: string
  detail?: Record<string, unknown>
}

/**
 * Named cards — same ring physics, different experiment lens.
 * Free play = `open_brawl`. Bench runs pick a card when seating.
 */
export type BenchCardId =
  | 'open_brawl'
  | 'stamina_economy'
  | 'counter_window'
  | 'opening_latency'

export type BenchFocus =
  | 'win'
  | 'efficiency'
  | 'windows'
  | 'opening'
  | 'defense'
  | 'cost'

export type BenchCard = {
  id: BenchCardId
  name: string
  blurb: string
  focus: BenchFocus[]
  /** Soft modifiers — keep the same combat code paths. */
  mods?: {
    /** Multiplier on starting / max HP (1 = default). */
    healthScale?: number
    /** Multiplier on starting / max stamina. */
    staminaScale?: number
  }
}

export const BENCH_CARDS: Record<BenchCardId, BenchCard> = {
  open_brawl: {
    id: 'open_brawl',
    name: 'Open Brawl',
    blurb: 'Default street card. Win the bout — no special constraints.',
    focus: ['win'],
  },
  stamina_economy: {
    id: 'stamina_economy',
    name: 'Stamina Economy',
    blurb: 'Tighter gas tank. Damage per stamina and idle waste matter.',
    focus: ['efficiency', 'win'],
    mods: { staminaScale: 0.7 },
  },
  counter_window: {
    id: 'counter_window',
    name: 'Counter Window',
    blurb: 'Read telegraphs. Blocks/dodges under pressure score.',
    focus: ['defense', 'windows', 'win'],
  },
  opening_latency: {
    id: 'opening_latency',
    name: 'Opening Latency',
    blurb: 'Bell → first throw speed. Harness + model responsiveness.',
    focus: ['opening', 'windows', 'win'],
  },
}

export function isBenchCardId(value: unknown): value is BenchCardId {
  return typeof value === 'string' && value in BENCH_CARDS
}

export function listBenchCards(): BenchCard[] {
  return Object.values(BENCH_CARDS)
}

/** Provenance stamped on a corner when the bout is filmed. */
export type AgentProvenance = {
  agentId: string | null
  handle: string | null
  displayName: string
  model: string | null
  provider: string | null
  harness: string | null
  runId: string | null
  tags: string[]
}

export type CornerScorecard = {
  corner: Corner
  agentId: string | null
  name: string
  provenance: AgentProvenance | null
  won: boolean
  draw: boolean
  method: string | null
  finalHp: number | null
  damageDealt: number
  damageTaken: number
  hitsLanded: number
  throws: number
  windowsTaken: number
  windowsMissed: number
  /** throws / (throws + missed), 0–1 */
  windowUtilization: number | null
  /** damage / staminaSpent, null if no spend logged */
  damagePerStamina: number | null
  staminaSpent: number
  blocks: number
  dodges: number
  /** ms from bout fighting-start (or first bell) to first throw_phrase */
  openingLatencyMs: number | null
  avgThrowLatencyMs: number | null
  toolErrors: number
  toolCalls: number
}

export type BoutScorecard = {
  matchId: string
  cardId: BenchCardId
  cardName: string
  startedAt: number
  endedAt: number | null
  durationMs: number | null
  winner: Corner | 'draw' | null
  method: string | null
  red: CornerScorecard
  blue: CornerScorecard
  focus: BenchFocus[]
}

/** Minimal tape shape scorecards need — avoids circular imports with server. */
export type ScoreableTape = {
  matchId: string
  startedAt: number
  endedAt: number | null
  cardId?: BenchCardId | null
  red: { id: string | null; name: string } | null
  blue: { id: string | null; name: string } | null
  redProvenance?: AgentProvenance | null
  blueProvenance?: AgentProvenance | null
  events: BenchTapeEvent[]
  result: {
    winner: Corner | 'draw' | null
    method: string
    red?: { health?: number }
    blue?: { health?: number }
  } | null
}

function num(v: unknown, fallback = 0) {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function blankCorner(
  corner: Corner,
  name: string,
  agentId: string | null,
  provenance: AgentProvenance | null,
  result: ScoreableTape['result'],
): CornerScorecard {
  const won = result?.winner === corner
  const draw = result?.winner === 'draw'
  const finalHp =
    corner === 'red'
      ? (result?.red?.health ?? null)
      : (result?.blue?.health ?? null)
  return {
    corner,
    agentId,
    name,
    provenance,
    won,
    draw,
    method: result?.method ?? null,
    finalHp: finalHp != null ? Math.round(finalHp) : null,
    damageDealt: 0,
    damageTaken: 0,
    hitsLanded: 0,
    throws: 0,
    windowsTaken: 0,
    windowsMissed: 0,
    windowUtilization: null,
    damagePerStamina: null,
    staminaSpent: 0,
    blocks: 0,
    dodges: 0,
    openingLatencyMs: null,
    avgThrowLatencyMs: null,
    toolErrors: 0,
    toolCalls: 0,
  }
}

/**
 * Derive a research scorecard from a bout tape.
 * Prefers structured tool-outcome details; falls back to impact/phrase rows.
 */
export function scoreTape(tape: ScoreableTape): BoutScorecard {
  const cardId: BenchCardId = isBenchCardId(tape.cardId) ? tape.cardId : 'open_brawl'
  const card = BENCH_CARDS[cardId]
  const red = blankCorner(
    'red',
    tape.red?.name ?? 'RED',
    tape.red?.id ?? null,
    tape.redProvenance ?? null,
    tape.result,
  )
  const blue = blankCorner(
    'blue',
    tape.blue?.name ?? 'BLUE',
    tape.blue?.id ?? null,
    tape.blueProvenance ?? null,
    tape.result,
  )

  const byCorner = { red, blue }
  const throwLatencies: Record<Corner, number[]> = { red: [], blue: [] }
  let fightStartedAt: number | null = null
  const firstThrowAt: Record<Corner, number | null> = { red: null, blue: null }
  let lastWindowWake: Record<Corner, number | null> = { red: null, blue: null }

  for (const e of tape.events) {
    const corner = e.corner === 'red' || e.corner === 'blue' ? e.corner : null
    const detail = (e.detail ?? {}) as Record<string, unknown>
    const tool = e.tool ?? (typeof detail.tool === 'string' ? detail.tool : null)

    if (e.kind === 'phase') {
      const note = String(detail.note ?? detail.phase ?? '')
      if (
        fightStartedAt == null &&
        (note.includes('fighting') ||
          note.includes('ding') ||
          note === 'round_start' ||
          detail.phase === 'fighting')
      ) {
        fightStartedAt = e.at
      }
    }

    if (corner && (e.kind === 'tool' || e.kind === 'phrase' || e.kind === 'impact')) {
      const side = byCorner[corner]
      if (e.kind === 'tool') side.toolCalls += 1
      if (detail.ok === false || detail.error) side.toolErrors += 1
    }

    // Structured wait_for_window wake
    if (corner && tool === 'wait_for_window') {
      const side = byCorner[corner]
      const wake = String(detail.wakeReason ?? detail.reason ?? '')
      if (wake === 'window_open' || detail.windowOpen === true) {
        side.windowsTaken += 1
        lastWindowWake[corner] = e.at
      } else if (wake === 'timeout') {
        side.windowsMissed += 1
      }
    }

    // Structured throw_phrase / combo pack outcome
    if (corner && (tool === 'throw_phrase' || e.kind === 'phrase')) {
      const side = byCorner[corner]
      side.throws += 1
      side.hitsLanded += num(detail.hits)
      side.damageDealt += num(detail.damage)
      side.staminaSpent += num(detail.staminaSpent)
      const beats = Array.isArray(detail.beats) ? detail.beats : []
      for (const b of beats) {
        const row = b as Record<string, unknown>
        if (row.result === 'blocked' || row.result === 'block') side.blocks += 1
        // blocks counted on thrower side as "foe blocked me" — also track defense via impacts
      }
      if (firstThrowAt[corner] == null) firstThrowAt[corner] = e.at
      const wakeAt = lastWindowWake[corner]
      if (wakeAt != null && e.at >= wakeAt) {
        throwLatencies[corner].push(e.at - wakeAt)
        lastWindowWake[corner] = null
      }
    }

    // Impacts — attribute damage taken / defense to defender
    if (e.kind === 'impact' && corner) {
      // corner on impact events is usually attacker; detail has defender
      const attacker = corner
      const defender =
        detail.defender === 'red' || detail.defender === 'blue'
          ? detail.defender
          : attacker === 'red'
            ? 'blue'
            : 'red'
      const dmg = num(detail.damage)
      const result = String(detail.result ?? '')
      byCorner[attacker].damageDealt += dmg
      byCorner[defender].damageTaken += dmg
      if (result === 'hit') byCorner[attacker].hitsLanded += 1
      if (result === 'blocked') byCorner[defender].blocks += 1
      if (result === 'dodged') byCorner[defender].dodges += 1
    }
  }

  const openAt = fightStartedAt ?? tape.startedAt
  for (const c of ['red', 'blue'] as Corner[]) {
    const side = byCorner[c]
    const first = firstThrowAt[c]
    if (first != null) side.openingLatencyMs = Math.max(0, first - openAt)
    const lats = throwLatencies[c]
    if (lats.length > 0) {
      side.avgThrowLatencyMs = Math.round(lats.reduce((a, b) => a + b, 0) / lats.length)
    }
    const denom = side.windowsTaken + side.windowsMissed
    if (denom > 0) side.windowUtilization = side.windowsTaken / denom
    if (side.staminaSpent > 0) {
      side.damagePerStamina = side.damageDealt / side.staminaSpent
    }
    // Round noisy floats
    side.damageDealt = Math.round(side.damageDealt)
    side.damageTaken = Math.round(side.damageTaken)
    side.staminaSpent = Math.round(side.staminaSpent)
    if (side.damagePerStamina != null) {
      side.damagePerStamina = Math.round(side.damagePerStamina * 1000) / 1000
    }
    if (side.windowUtilization != null) {
      side.windowUtilization = Math.round(side.windowUtilization * 1000) / 1000
    }
  }

  return {
    matchId: tape.matchId,
    cardId,
    cardName: card.name,
    startedAt: tape.startedAt,
    endedAt: tape.endedAt,
    durationMs:
      tape.endedAt != null ? Math.max(0, tape.endedAt - tape.startedAt) : null,
    winner: tape.result?.winner ?? null,
    method: tape.result?.method ?? null,
    red,
    blue,
    focus: card.focus,
  }
}

export type LeaderboardRow = {
  agentId: string | null
  handle: string | null
  displayName: string
  model: string | null
  provider: string | null
  bouts: number
  wins: number
  losses: number
  draws: number
  winRate: number
  avgDamagePerStamina: number | null
  avgWindowUtilization: number | null
  avgOpeningLatencyMs: number | null
  avgDamageDealt: number
}

export function aggregateLeaderboard(
  cards: BoutScorecard[],
  side: 'both' | Corner = 'both',
): LeaderboardRow[] {
  type Acc = LeaderboardRow & {
    dpsSum: number
    dpsN: number
    winUtilSum: number
    winUtilN: number
    openSum: number
    openN: number
    dmgSum: number
  }
  const map = new Map<string, Acc>()

  const bump = (c: CornerScorecard, won: boolean, draw: boolean) => {
    const key =
      c.agentId ??
      c.provenance?.runId ??
      `${c.provenance?.model ?? 'unknown'}:${c.name}`
    let row = map.get(key)
    if (!row) {
      row = {
        agentId: c.agentId,
        handle: c.provenance?.handle ?? null,
        displayName: c.provenance?.displayName ?? c.name,
        model: c.provenance?.model ?? null,
        provider: c.provenance?.provider ?? null,
        bouts: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        winRate: 0,
        avgDamagePerStamina: null,
        avgWindowUtilization: null,
        avgOpeningLatencyMs: null,
        avgDamageDealt: 0,
        dpsSum: 0,
        dpsN: 0,
        winUtilSum: 0,
        winUtilN: 0,
        openSum: 0,
        openN: 0,
        dmgSum: 0,
      }
      map.set(key, row)
    }
    row.bouts += 1
    if (draw) row.draws += 1
    else if (won) row.wins += 1
    else row.losses += 1
    row.dmgSum += c.damageDealt
    if (c.damagePerStamina != null) {
      row.dpsSum += c.damagePerStamina
      row.dpsN += 1
    }
    if (c.windowUtilization != null) {
      row.winUtilSum += c.windowUtilization
      row.winUtilN += 1
    }
    if (c.openingLatencyMs != null) {
      row.openSum += c.openingLatencyMs
      row.openN += 1
    }
  }

  for (const bout of cards) {
    if (side === 'both' || side === 'red') {
      bump(bout.red, bout.red.won, bout.red.draw)
    }
    if (side === 'both' || side === 'blue') {
      bump(bout.blue, bout.blue.won, bout.blue.draw)
    }
  }

  return [...map.values()]
    .map((r) => ({
      agentId: r.agentId,
      handle: r.handle,
      displayName: r.displayName,
      model: r.model,
      provider: r.provider,
      bouts: r.bouts,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
      winRate: r.bouts ? Math.round((r.wins / r.bouts) * 1000) / 1000 : 0,
      avgDamagePerStamina:
        r.dpsN > 0 ? Math.round((r.dpsSum / r.dpsN) * 1000) / 1000 : null,
      avgWindowUtilization:
        r.winUtilN > 0 ? Math.round((r.winUtilSum / r.winUtilN) * 1000) / 1000 : null,
      avgOpeningLatencyMs:
        r.openN > 0 ? Math.round(r.openSum / r.openN) : null,
      avgDamageDealt: r.bouts ? Math.round(r.dmgSum / r.bouts) : 0,
    }))
    .sort((a, b) => b.winRate - a.winRate || b.wins - a.wins || b.bouts - a.bouts)
}
