import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  BookStatus,
  Corner,
  CrowdBet,
  CrowdBook,
  CrowdLedgerSnapshot,
  CrowdMod,
  CrowdModKind,
  CrowdWallet,
  FighterRecord,
} from '../shared/types.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '../data')
const DATA_FILE = path.join(DATA_DIR, 'crowd.json')

export const STARTING_CHIPS = 1_000
export const MIN_BET = 10
export const MAX_BET = 500

const MOD_COSTS: Record<CrowdModKind, number> = {
  cheer: 25,
  banner: 15,
  heat_flare: 50,
}

function emptyRecord(): FighterRecord {
  return { wins: 0, losses: 0, draws: 0, kos: 0, peakHeat: 0, bouts: 0 }
}

export function formScore(record: FighterRecord | null | undefined): number {
  const r = record ?? emptyRecord()
  return Math.max(1, r.peakHeat + r.wins * 12 + r.kos * 8 - r.losses * 6 + 20)
}

/** Fixed decimal odds from form — favorite shorter, dog juicer. */
export function moneylineOdds(
  redRecord: FighterRecord | null | undefined,
  blueRecord: FighterRecord | null | undefined,
): { red: number; blue: number } {
  const red = formScore(redRecord)
  const blue = formScore(blueRecord)
  const total = red + blue
  const juice = 0.92
  return {
    red: roundOdds(juice / Math.max(0.18, red / total)),
    blue: roundOdds(juice / Math.max(0.18, blue / total)),
  }
}

function roundOdds(n: number) {
  return Math.round(Math.min(4.5, Math.max(1.25, n)) * 100) / 100
}

type PersistShape = { wallets: CrowdWallet[] }

export class CrowdStore {
  private wallets = new Map<string, CrowdWallet>()
  private bets = new Map<string, CrowdBet>()
  private mods: CrowdMod[] = []
  private matchId: string | null = null
  private status: BookStatus = 'closed'
  private redName = 'Red'
  private blueName = 'Blue'
  private redOdds = 1.9
  private blueOdds = 1.9
  private winner: Corner | 'draw' | null = null
  private settledMatchId: string | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.load()
  }

  private load() {
    try {
      const raw = readFileSync(DATA_FILE, 'utf8')
      const parsed = JSON.parse(raw) as PersistShape
      for (const w of parsed.wallets ?? []) {
        if (!w?.id) continue
        this.wallets.set(w.id, {
          id: w.id,
          name: w.name || w.id,
          chips: Math.max(0, Math.round(w.chips ?? STARTING_CHIPS)),
          updatedAt: w.updatedAt ?? Date.now(),
        })
      }
    } catch {
      /* fresh house bank */
    }
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.save(), 250)
  }

  private save() {
    try {
      mkdirSync(DATA_DIR, { recursive: true })
      const payload: PersistShape = {
        wallets: [...this.wallets.values()].sort((a, b) => b.chips - a.chips),
      }
      writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2))
    } catch {
      /* best-effort */
    }
  }

  getWallet(id: string): CrowdWallet | null {
    return this.wallets.get(id) ?? null
  }

  getOrCreateWallet(id: string, name: string): CrowdWallet {
    const existing = this.wallets.get(id)
    if (existing) {
      const nextName = name.trim().slice(0, 24) || existing.name
      if (nextName !== existing.name) {
        existing.name = nextName
        existing.updatedAt = Date.now()
        this.scheduleSave()
      }
      return existing
    }
    const wallet: CrowdWallet = {
      id,
      name: name.trim().slice(0, 24) || id,
      chips: STARTING_CHIPS,
      updatedAt: Date.now(),
    }
    this.wallets.set(id, wallet)
    this.scheduleSave()
    return wallet
  }

  listWallets(): CrowdWallet[] {
    return [...this.wallets.values()].sort((a, b) => b.chips - a.chips)
  }

  private matchBets(matchId: string): CrowdBet[] {
    return [...this.bets.values()].filter((b) => b.matchId === matchId)
  }

  book(): CrowdBook {
    const matchId = this.matchId ?? 'none'
    const bets = this.matchId ? this.matchBets(this.matchId) : []
    return {
      matchId,
      status: this.status,
      redName: this.redName,
      blueName: this.blueName,
      redOdds: this.redOdds,
      blueOdds: this.blueOdds,
      redPool: bets.filter((b) => b.corner === 'red').reduce((s, b) => s + b.stake, 0),
      bluePool: bets.filter((b) => b.corner === 'blue').reduce((s, b) => s + b.stake, 0),
      betCount: bets.length,
      winner: this.winner,
      mods: this.mods.filter((m) => m.matchId === matchId).slice(-8).reverse(),
    }
  }

  snapshot(viewerId?: string | null): CrowdLedgerSnapshot {
    const book = this.book()
    const wallet = viewerId ? this.getWallet(viewerId) : null
    const myBets = viewerId
      ? [...this.bets.values()]
          .filter((b) => b.bettorId === viewerId)
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 12)
      : []
    const recent = [...this.bets.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10)
    return { book, wallet, myBets, recent }
  }

  openBook(input: {
    matchId: string
    redName: string
    blueName: string
    redRecord?: FighterRecord | null
    blueRecord?: FighterRecord | null
  }) {
    if (this.matchId === input.matchId && (this.status === 'locked' || this.status === 'settled')) {
      return this.book()
    }

    const odds = moneylineOdds(input.redRecord, input.blueRecord)
    this.matchId = input.matchId
    this.status = 'open'
    this.redName = input.redName
    this.blueName = input.blueName
    this.redOdds = odds.red
    this.blueOdds = odds.blue
    this.winner = null
    this.settledMatchId = null

    for (const [id, bet] of this.bets) {
      if (bet.status === 'open' && bet.matchId !== input.matchId) {
        this.refundBet(bet)
        this.bets.delete(id)
      }
    }
    return this.book()
  }

  lockBook(matchId: string) {
    if (this.matchId !== matchId) return this.book()
    if (this.status === 'open') this.status = 'locked'
    return this.book()
  }

  closeBook() {
    this.status = 'closed'
    this.matchId = null
    this.winner = null
    return this.book()
  }

  placeBet(input: {
    agentKey: string
    name: string
    corner: Corner
    stake: number
    matchId?: string
  }): { bet: CrowdBet; wallet: CrowdWallet; book: CrowdBook } {
    if (this.status !== 'open' || !this.matchId) {
      if (this.status === 'locked') {
        throw new Error('Bell rang — betting is locked for this bout')
      }
      if (this.status === 'settled') {
        throw new Error('Bout already settled — wait for the next card')
      }
      throw new Error('Book is closed — wait for both corners, bet before the bell')
    }
    if (input.matchId && input.matchId !== this.matchId) {
      throw new Error('Stale bout — refresh the crowd book')
    }
    if (input.agentKey.startsWith('demo-')) {
      throw new Error('Demo bots stay off the crowd book')
    }
    const stake = Math.round(input.stake)
    if (!Number.isFinite(stake) || stake < MIN_BET || stake > MAX_BET) {
      throw new Error(`Stake must be ${MIN_BET}–${MAX_BET} chips`)
    }
    if (input.corner !== 'red' && input.corner !== 'blue') {
      throw new Error('Pick red or blue')
    }

    const wallet = this.getOrCreateWallet(input.agentKey, input.name)
    if (wallet.chips < stake) {
      throw new Error(`Not enough chips — you have ${wallet.chips}`)
    }

    const existing = this.matchBets(this.matchId).find(
      (b) => b.bettorId === input.agentKey && b.status === 'open',
    )
    if (existing) throw new Error('You already have a ticket on this bout')

    const odds = input.corner === 'red' ? this.redOdds : this.blueOdds
    wallet.chips -= stake
    wallet.updatedAt = Date.now()
    const bet: CrowdBet = {
      id: randomUUID(),
      matchId: this.matchId,
      bettorId: input.agentKey,
      bettorName: wallet.name,
      corner: input.corner,
      stake,
      odds,
      status: 'open',
      payout: 0,
      createdAt: Date.now(),
      settledAt: null,
    }
    this.bets.set(bet.id, bet)
    this.scheduleSave()
    return { bet, wallet: { ...wallet }, book: this.book() }
  }

  private refundBet(bet: CrowdBet) {
    if (bet.status !== 'open') return
    const wallet = this.wallets.get(bet.bettorId)
    if (wallet) {
      wallet.chips += bet.stake
      wallet.updatedAt = Date.now()
    }
    bet.status = 'refunded'
    bet.payout = bet.stake
    bet.settledAt = Date.now()
  }

  settle(input: { matchId: string; winner: Corner | 'draw' | null }) {
    if (this.settledMatchId === input.matchId) return this.book()
    const matchId = input.matchId
    this.settledMatchId = matchId
    this.matchId = matchId
    this.status = 'settled'
    this.winner = input.winner

    for (const bet of this.matchBets(matchId)) {
      if (bet.status !== 'open') continue
      const wallet = this.wallets.get(bet.bettorId)
      if (input.winner === 'draw' || input.winner == null) {
        if (wallet) {
          wallet.chips += bet.stake
          wallet.updatedAt = Date.now()
        }
        bet.status = 'refunded'
        bet.payout = bet.stake
      } else if (bet.corner === input.winner) {
        const payout = Math.round(bet.stake * bet.odds)
        if (wallet) {
          wallet.chips += payout
          wallet.updatedAt = Date.now()
        }
        bet.status = 'won'
        bet.payout = payout
      } else {
        bet.status = 'lost'
        bet.payout = 0
      }
      bet.settledAt = Date.now()
    }
    this.scheduleSave()
    return this.book()
  }

  buyMod(input: {
    agentKey: string
    name: string
    kind: CrowdModKind
    matchId: string
    text?: string | null
  }): { mod: CrowdMod; wallet: CrowdWallet; heatBump: number; book: CrowdBook } {
    if (input.agentKey.startsWith('demo-')) {
      throw new Error('Demo bots cannot buy crowd mods')
    }
    const cost = MOD_COSTS[input.kind]
    if (!cost) throw new Error('Unknown mod')
    const wallet = this.getOrCreateWallet(input.agentKey, input.name)
    if (wallet.chips < cost) {
      throw new Error(`Need ${cost} chips — you have ${wallet.chips}`)
    }
    wallet.chips -= cost
    wallet.updatedAt = Date.now()
    const mod: CrowdMod = {
      id: randomUUID(),
      kind: input.kind,
      matchId: input.matchId,
      buyerId: input.agentKey,
      buyerName: wallet.name,
      text:
        input.kind === 'banner'
          ? input.text?.trim().slice(0, 60) || `${wallet.name} waves the undercard`
          : null,
      cost,
      createdAt: Date.now(),
    }
    this.mods = [...this.mods, mod].slice(-40)
    this.scheduleSave()
    const heatBump = input.kind === 'heat_flare' ? 5 : input.kind === 'cheer' ? 2 : 1
    return { mod, wallet: { ...wallet }, heatBump, book: this.book() }
  }
}

export const crowdStore = new CrowdStore()
