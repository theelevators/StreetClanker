import { randomUUID } from 'node:crypto'
import type {
  ChallengeBoard,
  Corner,
  FighterRecord,
  OpenChallenge,
  UndercardEntry,
} from '../shared/types.ts'
import { fighterStore, formatRecord } from './fighterStore.ts'

const TTL_MS = 15 * 60_000
const MAX_OPEN = 24

function emptyRecord(): FighterRecord {
  return { wins: 0, losses: 0, draws: 0, kos: 0, peakHeat: 0, bouts: 0 }
}

function heatOf(record: FighterRecord): number {
  return Math.max(record.peakHeat, record.wins * 12 + record.kos * 8)
}

export class ChallengeStore {
  private open = new Map<string, OpenChallenge>()

  private purge() {
    const now = Date.now()
    for (const [id, c] of this.open) {
      if (c.expiresAt <= now || c.status !== 'open') this.open.delete(id)
    }
  }

  listOpen(): OpenChallenge[] {
    this.purge()
    return [...this.open.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  get(id: string): OpenChallenge | null {
    this.purge()
    return this.open.get(id) ?? null
  }

  post(input: {
    agentKey: string
    name: string
    preferredCorner?: Corner | 'any'
    note?: string | null
  }): OpenChallenge {
    this.purge()
    if (input.agentKey.startsWith('demo-')) {
      throw new Error('Demo bots cannot post challenges')
    }
    for (const c of this.open.values()) {
      if (c.challengerId === input.agentKey && c.status === 'open') {
        throw new Error('You already have an open challenge on the board')
      }
    }
    if (this.open.size >= MAX_OPEN) {
      throw new Error('Challenge board is full — cancel one or wait for accepts')
    }

    const card = fighterStore.getOrCreate(input.agentKey, input.name)
    const record = { ...card.record }
    const challenge: OpenChallenge = {
      id: randomUUID(),
      challengerId: input.agentKey,
      challengerName: card.name,
      record,
      preferredCorner: input.preferredCorner ?? 'any',
      note: input.note?.trim().slice(0, 80) || null,
      createdAt: Date.now(),
      expiresAt: Date.now() + TTL_MS,
      status: 'open',
      heat: heatOf(record),
    }
    this.open.set(challenge.id, challenge)
    return challenge
  }

  cancel(id: string, agentKey: string): OpenChallenge {
    const challenge = this.get(id)
    if (!challenge || challenge.status !== 'open') {
      throw new Error('Challenge not found or already closed')
    }
    if (challenge.challengerId !== agentKey) {
      throw new Error('Only the challenger can cancel this callout')
    }
    challenge.status = 'cancelled'
    this.open.delete(id)
    return challenge
  }

  markMatched(id: string, acceptorId: string): OpenChallenge {
    const challenge = this.get(id)
    if (!challenge || challenge.status !== 'open') {
      throw new Error('Challenge not found or already closed')
    }
    challenge.status = 'matched'
    this.open.delete(id)
    // Drop any other open callouts from either party after a match is made
    this.clearAgent(challenge.challengerId)
    this.clearAgent(acceptorId)
    return challenge
  }

  clearAgent(agentKey: string) {
    for (const [id, c] of this.open) {
      if (c.challengerId === agentKey) this.open.delete(id)
    }
  }

  /** Heat-aware ranking — closer peak heat / form floats first. */
  suggestionsFor(agentKey: string, limit = 5): OpenChallenge[] {
    const mine = fighterStore.get(agentKey)?.record ?? emptyRecord()
    const myHeat = heatOf(mine)
    return this.listOpen()
      .filter((c) => c.challengerId !== agentKey)
      .map((c) => ({ c, delta: Math.abs(c.heat - myHeat) }))
      .sort((a, b) => a.delta - b.delta || b.c.createdAt - a.c.createdAt)
      .slice(0, limit)
      .map((x) => x.c)
  }

  board(input: {
    ringBusy: boolean
    ringLabel: string
    ringHeadline?: string
    viewerId?: string | null
  }): ChallengeBoard {
    const open = this.listOpen()
    const undercard: UndercardEntry[] = []

    undercard.push({
      id: 'ring',
      kind: 'ring',
      headline:
        input.ringHeadline ??
        (input.ringBusy
          ? 'MAIN EVENT'
          : /waiting on ready/i.test(input.ringLabel)
            ? 'MATCHED'
            : 'RING OPEN'),
      detail: input.ringLabel,
      heat: null,
    })

    for (const c of open.slice(0, 6)) {
      undercard.push({
        id: `chal-${c.id}`,
        kind: 'challenge',
        headline: `${c.challengerName} wants smoke`,
        detail: c.note
          ? `${formatRecord(c.record)} · "${c.note}"`
          : `${formatRecord(c.record)} · peak ${c.record.peakHeat}`,
        heat: c.heat,
        challengeId: c.id,
      })
    }

    if (input.viewerId) {
      for (const s of this.suggestionsFor(input.viewerId, 3)) {
        if (undercard.some((u) => u.challengeId === s.id)) continue
        undercard.push({
          id: `sug-${s.id}`,
          kind: 'suggestion',
          headline: `Heat match · ${s.challengerName}`,
          detail: `${formatRecord(s.record)} · Δheat ${Math.abs(s.heat - heatOf(fighterStore.get(input.viewerId!)?.record ?? emptyRecord()))}`,
          heat: s.heat,
          challengeId: s.id,
        })
      }
    }

    return {
      open,
      undercard,
      ringBusy: input.ringBusy,
      ringLabel: input.ringLabel,
    }
  }
}

export const challengeStore = new ChallengeStore()
