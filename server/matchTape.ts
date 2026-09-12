import {
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BoutResult, Corner, MatchState } from '../shared/types.ts'
import { slimMatchState, type ReplayFrame } from '../shared/replay.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '../data/bouts')

export type MatchTapeKind =
  | 'phase'
  | 'claim'
  | 'leave'
  | 'ready'
  | 'tool'
  | 'phrase'
  | 'impact'
  | 'chat'
  | 'lobby'
  | 'street'
  | 'bout_end'

export type MatchTapeEvent = {
  at: number
  kind: MatchTapeKind
  agentId?: string
  corner?: Corner
  tool?: string
  text?: string
  detail?: Record<string, unknown>
}

export type MatchTape = {
  matchId: string
  startedAt: number
  endedAt: number | null
  red: { id: string | null; name: string } | null
  blue: { id: string | null; name: string } | null
  events: MatchTapeEvent[]
  /** Visual ring film — MatchState snapshots for TV rematch. */
  frames: ReplayFrame[]
  result: BoutResult | null
}

const MAX_EVENTS = 800
const MAX_FRAMES = 1800
const MAX_DISK_BOUTS = 80

/**
 * Per-ring event tape + visual frame film for replay.
 * Live rings keep an in-memory tape; finished bouts flush to data/bouts/.
 */
export class MatchTapeStore {
  private live = new Map<string, MatchTape>()

  start(matchId: string) {
    const existing = this.live.get(matchId)
    if (existing) return existing
    const tape: MatchTape = {
      matchId,
      startedAt: Date.now(),
      endedAt: null,
      red: null,
      blue: null,
      events: [],
      frames: [],
      result: null,
    }
    this.live.set(matchId, tape)
    return tape
  }

  /**
   * Drop a live tape after it was persisted (e.g. rematch on a fresh canvas).
   * Disk copy stays so the finished bout remains on the shelf.
   */
  releaseLive(matchId: string) {
    this.live.delete(matchId)
  }

  /** Re-key when rematch allocates a new match id — prefer releaseLive + start for rematch. */
  rekey(oldId: string, newId: string) {
    if (oldId === newId) return
    const tape = this.live.get(oldId)
    if (!tape) return
    this.live.delete(oldId)
    tape.matchId = newId
    this.live.set(newId, tape)
    this.append(newId, {
      kind: 'phase',
      detail: { note: 'rematch_rekey', from: oldId },
    })
  }

  append(matchId: string, partial: Omit<MatchTapeEvent, 'at'> & { at?: number }) {
    const tape = this.live.get(matchId) ?? this.start(matchId)
    tape.events.push({
      at: partial.at ?? Date.now(),
      kind: partial.kind,
      agentId: partial.agentId,
      corner: partial.corner,
      tool: partial.tool,
      text: partial.text,
      detail: partial.detail,
    })
    if (tape.events.length > MAX_EVENTS) {
      tape.events = tape.events.slice(-MAX_EVENTS)
    }
    return tape
  }

  /** Snapshot the ring for TV rematch — throttled by the engine. */
  captureFrame(matchId: string, state: MatchState, at = Date.now()) {
    const tape = this.live.get(matchId) ?? this.start(matchId)
    tape.frames.push({
      at,
      state: slimMatchState(state),
    })
    if (tape.frames.length > MAX_FRAMES) {
      // Keep ends + drop early lobby padding first
      const drop = tape.frames.length - MAX_FRAMES
      tape.frames = tape.frames.slice(drop)
    }
    return tape
  }

  setCorner(
    matchId: string,
    corner: Corner,
    fighter: { id: string | null; name: string } | null,
  ) {
    const tape = this.live.get(matchId) ?? this.start(matchId)
    if (corner === 'red') tape.red = fighter
    else tape.blue = fighter
  }

  finish(matchId: string, result: BoutResult) {
    const tape = this.live.get(matchId) ?? this.start(matchId)
    tape.endedAt = Date.now()
    tape.result = { ...result, live: false }
    tape.red = { id: result.red.id, name: result.red.name }
    tape.blue = { id: result.blue.id, name: result.blue.name }
    this.append(matchId, {
      kind: 'bout_end',
      detail: {
        winner: result.winner,
        method: result.method,
        cardHeat: result.cardHeat,
        frameCount: tape.frames.length,
      },
    })
    this.persist(tape)
    return tape
  }

  get(matchId: string): MatchTape | null {
    const live = this.live.get(matchId)
    if (live) return this.normalize(live)
    return this.loadDisk(matchId)
  }

  /** Compact agent-facing summary — not the full raw dump. */
  summary(matchId: string, limit = 40) {
    const tape = this.get(matchId)
    if (!tape) return null
    const events = tape.events.slice(-Math.max(5, Math.min(limit, 200)))
    return {
      ok: true as const,
      matchId: tape.matchId,
      startedAt: tape.startedAt,
      endedAt: tape.endedAt,
      red: tape.red,
      blue: tape.blue,
      eventCount: tape.events.length,
      frameCount: tape.frames.length,
      hasFilm: tape.frames.length > 0,
      recent: events.map((e) => ({
        at: e.at,
        kind: e.kind,
        agentId: e.agentId,
        corner: e.corner,
        tool: e.tool,
        text: e.text,
        detail: e.detail,
      })),
      result: tape.result,
      replayPath: `/api/bout/${tape.matchId}/tape`,
    }
  }

  /** Newest finished (and live) tapes for the replay shelf. */
  listRecent(limit = 24) {
    const cards: Array<{
      matchId: string
      startedAt: number
      endedAt: number | null
      redName: string
      blueName: string
      winner: BoutResult['winner'] | null
      method: BoutResult['method'] | null
      eventCount: number
      frameCount: number
      hasFilm: boolean
      live: boolean
      replayPath: string
    }> = []

    for (const tape of this.live.values()) {
      const frames = tape.frames?.length ?? 0
      cards.push({
        matchId: tape.matchId,
        startedAt: tape.startedAt,
        endedAt: tape.endedAt,
        redName: tape.red?.name ?? 'RED',
        blueName: tape.blue?.name ?? 'BLUE',
        winner: tape.result?.winner ?? null,
        method: tape.result?.method ?? null,
        eventCount: tape.events.length,
        frameCount: frames,
        hasFilm: frames > 0,
        live: !tape.endedAt,
        replayPath: `/api/bout/${tape.matchId}/tape`,
      })
    }

    try {
      mkdirSync(DATA_DIR, { recursive: true })
      for (const file of readdirSync(DATA_DIR)) {
        if (!file.endsWith('.json')) continue
        const id = file.replace(/\.json$/, '')
        if (this.live.has(id)) continue
        const tape = this.loadDisk(id)
        if (!tape) continue
        const frames = tape.frames?.length ?? 0
        cards.push({
          matchId: tape.matchId,
          startedAt: tape.startedAt,
          endedAt: tape.endedAt,
          redName: tape.red?.name ?? 'RED',
          blueName: tape.blue?.name ?? 'BLUE',
          winner: tape.result?.winner ?? null,
          method: tape.result?.method ?? null,
          eventCount: tape.events.length,
          frameCount: frames,
          hasFilm: frames > 0,
          live: false,
          replayPath: `/api/bout/${tape.matchId}/tape`,
        })
      }
    } catch {
      /* ignore disk issues */
    }

    return cards
      .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))
      .slice(0, Math.max(1, Math.min(limit, 60)))
  }

  private normalize(tape: MatchTape): MatchTape {
    if (!Array.isArray(tape.frames)) tape.frames = []
    return tape
  }

  private persist(tape: MatchTape) {
    try {
      mkdirSync(DATA_DIR, { recursive: true })
      writeFileSync(path.join(DATA_DIR, `${tape.matchId}.json`), JSON.stringify(tape))
      this.gcDisk()
    } catch {
      /* best-effort */
    }
  }

  private loadDisk(matchId: string): MatchTape | null {
    try {
      const raw = readFileSync(path.join(DATA_DIR, `${matchId}.json`), 'utf8')
      const tape = JSON.parse(raw) as MatchTape
      return this.normalize(tape)
    } catch {
      return null
    }
  }

  private gcDisk() {
    try {
      const files = readdirSync(DATA_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => path.join(DATA_DIR, f))
        .sort()
      while (files.length > MAX_DISK_BOUTS) {
        const victim = files.shift()
        if (victim) unlinkSync(victim)
      }
    } catch {
      /* ignore */
    }
  }
}

export const matchTape = new MatchTapeStore()
