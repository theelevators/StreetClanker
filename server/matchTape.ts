import {
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BoutResult, Corner } from '../shared/types.ts'

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
  result: BoutResult | null
}

const MAX_EVENTS = 800
const MAX_DISK_BOUTS = 80

/**
 * Per-ring event tape for replay — tool calls, claims, impacts, lobby A2A.
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
      result: null,
    }
    this.live.set(matchId, tape)
    return tape
  }

  /** Re-key when rematch allocates a new match id. */
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
      },
    })
    this.persist(tape)
    return tape
  }

  get(matchId: string): MatchTape | null {
    return this.live.get(matchId) ?? this.loadDisk(matchId)
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
      return JSON.parse(raw) as MatchTape
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
