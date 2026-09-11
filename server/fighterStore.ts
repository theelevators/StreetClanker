import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Corner, FighterCard, FighterRecord } from '../shared/types.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '../data')
const DATA_FILE = path.join(DATA_DIR, 'fighters.json')

function emptyRecord(): FighterRecord {
  return { wins: 0, losses: 0, draws: 0, kos: 0, peakHeat: 0, bouts: 0 }
}

function isDemoKey(id: string) {
  return id.startsWith('demo-')
}

export function formatRecord(record: FighterRecord): string {
  return `${record.wins}-${record.losses}-${record.draws} (${record.kos} KO)`
}

export class FighterCardStore {
  private cards = new Map<string, FighterCard>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.load()
  }

  private load() {
    try {
      const raw = readFileSync(DATA_FILE, 'utf8')
      const parsed = JSON.parse(raw) as FighterCard[]
      for (const card of parsed) {
        if (!card?.id) continue
        this.cards.set(card.id, {
          id: card.id,
          name: card.name || card.id,
          record: { ...emptyRecord(), ...card.record },
          updatedAt: card.updatedAt ?? Date.now(),
        })
      }
    } catch {
      /* fresh card — no ladder yet */
    }
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.save(), 250)
  }

  private save() {
    try {
      mkdirSync(DATA_DIR, { recursive: true })
      writeFileSync(DATA_FILE, JSON.stringify(this.list(), null, 2))
    } catch {
      /* best-effort persistence */
    }
  }

  get(id: string): FighterCard | null {
    return this.cards.get(id) ?? null
  }

  list(): FighterCard[] {
    return [...this.cards.values()].sort((a, b) => {
      if (b.record.wins !== a.record.wins) return b.record.wins - a.record.wins
      if (b.record.kos !== a.record.kos) return b.record.kos - a.record.kos
      return b.record.peakHeat - a.record.peakHeat
    })
  }

  getOrCreate(id: string, name: string): FighterCard {
    const existing = this.cards.get(id)
    if (existing) {
      const nextName = name.slice(0, 24) || existing.name
      if (nextName !== existing.name) {
        existing.name = nextName
        existing.updatedAt = Date.now()
        this.scheduleSave()
      }
      return existing
    }
    const card: FighterCard = {
      id,
      name: name.slice(0, 24) || id,
      record: emptyRecord(),
      updatedAt: Date.now(),
    }
    this.cards.set(id, card)
    this.scheduleSave()
    return card
  }

  snapshot(id: string | null | undefined): FighterRecord | null {
    if (!id) return null
    return this.cards.get(id)?.record ?? null
  }

  applyBout(input: {
    redId: string | null
    blueId: string | null
    redName: string
    blueName: string
    winner: Corner | 'draw' | null
    method: 'knockout' | 'decision' | 'draw'
    cardHeat: number
  }) {
    const heat = Math.max(0, Math.min(100, Math.round(input.cardHeat)))
    const touch = (id: string | null, name: string, role: 'win' | 'loss' | 'draw' | 'none') => {
      if (!id || isDemoKey(id)) return null
      const card = this.getOrCreate(id, name)
      card.record.bouts += 1
      card.record.peakHeat = Math.max(card.record.peakHeat, heat)
      if (role === 'win') {
        card.record.wins += 1
        if (input.method === 'knockout') card.record.kos += 1
      } else if (role === 'loss') {
        card.record.losses += 1
      } else if (role === 'draw') {
        card.record.draws += 1
      }
      card.updatedAt = Date.now()
      return card
    }

    if (input.winner === 'draw') {
      touch(input.redId, input.redName, 'draw')
      touch(input.blueId, input.blueName, 'draw')
    } else if (input.winner === 'red') {
      touch(input.redId, input.redName, 'win')
      touch(input.blueId, input.blueName, 'loss')
    } else if (input.winner === 'blue') {
      touch(input.blueId, input.blueName, 'win')
      touch(input.redId, input.redName, 'loss')
    } else {
      touch(input.redId, input.redName, 'none')
      touch(input.blueId, input.blueName, 'none')
    }
    this.scheduleSave()
  }
}

export const fighterStore = new FighterCardStore()
