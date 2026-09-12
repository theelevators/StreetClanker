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

type BookState = {
  matchId: string
  status: BookStatus
  redName: string
  blueName: string
  redOdds: number
  blueOdds: number
  winner: Corner | 'draw' | null
}

export class CrowdStore {
  private wallets = new Map<string, CrowdWallet>()
  private bets = new Map<string, CrowdBet>()
  private mods: CrowdMod[] = []
  /** Per-bout books — concurrent rings keep independent money lines. */
  private books = new Map<string, BookState>()
  /** Last book touched — used when snapshot() omits matchId. */
  private focusMatchId: string | null = null
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

  private resolveBook(matchId?: string | null): BookState | null {
    if (matchId && this.books.has(matchId)) return this.books.get(matchId)!
    if (this.focusMatchId && this.books.has(this.focusMatchId)) {
      return this.books.get(this.focusMatchId)!
    }
    // Prefer an open book, else any book
    for (const book of this.books.values()) {
      if (book.status === 'open') return book
    }
    return [...this.books.values()].at(-1) ?? null
  }

  book(matchId?: string | null): CrowdBook {
    const state = this.resolveBook(matchId)
    if (!state) {
      return {
        matchId: matchId ?? 'none',
        status: 'closed',
        redName: 'Red',
        blueName: 'Blue',
        redOdds: 1.9,
        blueOdds: 1.9,
        redPool: 0,
        bluePool: 0,
        betCount: 0,
        winner: null,
        mods: [],
      }
    }
    const bets = this.matchBets(state.matchId)
    return {
      matchId: state.matchId,
      status: state.status,
      redName: state.redName,
      blueName: state.blueName,
      redOdds: state.redOdds,
      blueOdds: state.blueOdds,
      redPool: bets.filter((b) => b.corner === 'red').reduce((s, b) => s + b.stake, 0),
      bluePool: bets.filter((b) => b.corner === 'blue').reduce((s, b) => s + b.stake, 0),
      betCount: bets.length,
      winner: state.winner,
      mods: this.mods.filter((m) => m.matchId === state.matchId).slice(-8).reverse(),
    }
  }

  snapshot(viewerId?: string | null, matchId?: string | null): CrowdLedgerSnapshot {
    const book = this.book(matchId)
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
    const existing = this.books.get(input.matchId)
    if (existing && (existing.status === 'locked' || existing.status === 'settled')) {
      this.focusMatchId = input.matchId
      return this.book(input.matchId)
    }

    const odds = moneylineOdds(input.redRecord, input.blueRecord)
    this.books.set(input.matchId, {
      matchId: input.matchId,
      status: 'open',
      redName: input.redName,
      blueName: input.blueName,
      redOdds: odds.red,
      blueOdds: odds.blue,
      winner: null,
    })
    this.focusMatchId = input.matchId
    // Do NOT refund other matches — concurrent rings keep their books.
    return this.book(input.matchId)
  }

  lockBook(matchId: string) {
    const state = this.books.get(matchId)
    if (!state) return this.book(matchId)
    if (state.status === 'open') state.status = 'locked'
    this.focusMatchId = matchId
    return this.book(matchId)
  }

  closeBook(matchId?: string | null) {
    if (matchId) {
      const state = this.books.get(matchId)
      if (state) {
        state.status = 'closed'
        state.winner = null
      }
      return this.book(matchId)
    }
    for (const state of this.books.values()) {
      if (state.status === 'open' || state.status === 'locked') {
        state.status = 'closed'
        state.winner = null
      }
    }
    return this.book()
  }

  placeBet(input: {
    agentKey: string
    name: string
    corner: Corner
    stake: number
    matchId?: string
  }): { bet: CrowdBet; wallet: CrowdWallet; book: CrowdBook } {
    const state = this.resolveBook(input.matchId)
    if (!state || state.status !== 'open') {
      if (state?.status === 'locked') {
        throw new Error('Bell rang — betting is locked for this bout')
      }
      if (state?.status === 'settled') {
        throw new Error('Bout already settled — wait for the next card')
      }
      throw new Error('Book is closed — wait for both corners, bet before the bell')
    }
    if (input.matchId && input.matchId !== state.matchId) {
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

    const existing = this.matchBets(state.matchId).find(
      (b) => b.bettorId === input.agentKey && b.status === 'open',
    )
    if (existing) throw new Error('You already have a ticket on this bout')

    const odds = input.corner === 'red' ? state.redOdds : state.blueOdds
    wallet.chips -= stake
    wallet.updatedAt = Date.now()
    const bet: CrowdBet = {
      id: randomUUID(),
      matchId: state.matchId,
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
    this.focusMatchId = state.matchId
    this.scheduleSave()
    return { bet, wallet: { ...wallet }, book: this.book(state.matchId) }
  }

  settle(input: { matchId: string; winner: Corner | 'draw' | null }) {
    const matchId = input.matchId
    let state = this.books.get(matchId)
    if (!state) {
      state = {
        matchId,
        status: 'settled',
        redName: 'Red',
        blueName: 'Blue',
        redOdds: 1.9,
        blueOdds: 1.9,
        winner: input.winner,
      }
      this.books.set(matchId, state)
    }
    if (state.status === 'settled' && state.winner != null) {
      return this.book(matchId)
    }
    state.status = 'settled'
    state.winner = input.winner
    this.focusMatchId = matchId

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
    return this.book(matchId)
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
    this.focusMatchId = input.matchId
    const heatBump = input.kind === 'heat_flare' ? 5 : input.kind === 'cheer' ? 2 : 1
    return { mod, wallet: { ...wallet }, heatBump, book: this.book(input.matchId) }
  }
}

export const crowdStore = new CrowdStore()
