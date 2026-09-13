import type { WebSocket } from 'ws'
import type {
  BoutResult,
  ChatMessage,
  Corner,
  LobbyStatus,
  MatchState,
} from '../shared/types.ts'
import { MatchEngine } from './match.ts'

export type RingKind = 'open' | 'challenge' | 'demo'

export type LiveRingSummary = {
  matchId: string
  kind: RingKind
  phase: MatchState['phase']
  headline: string
  label: string
  busy: boolean
  redName: string
  blueName: string
  redConnected: boolean
  blueConnected: boolean
  cardHeat: number
  watchPath: string
  createdAt: number
  lastActiveAt: number
}

type ArenaSlot = {
  engine: MatchEngine
  kind: RingKind
  createdAt: number
  lastActiveAt: number
  subscribers: Set<WebSocket>
}

export type ArenaBroadcast =
  | { matchId: string; type: 'state'; state: MatchState }
  | { matchId: string; type: 'chat'; message: ChatMessage }

const MAX_LIVE = 48
const MAX_HISTORY = 120
/** Single reserved house exhibition — does not consume paid arena slots. */
const MAX_DEMO = 1
const ENDED_GRACE_MS = 8 * 60_000
const IDLE_LOBBY_MS = 30 * 60_000

/**
 * Process-level registry of concurrent MatchEngine rings.
 * Walk-up claims join an open lobby; challenge accepts spawn a fresh ring.
 * Demo is a reserved house slot outside the paid live capacity.
 */
export class MatchArena {
  private live = new Map<string, ArenaSlot>()
  private byAgent = new Map<string, string>()
  private history = new Map<string, BoutResult>()
  private openLobbyId: string | null = null
  /** Reserved exhibition ring — always available, never counts toward MAX_LIVE. */
  private houseDemoId: string | null = null
  private onBroadcast: (msg: ArenaBroadcast) => void

  constructor(onBroadcast: (msg: ArenaBroadcast) => void) {
    this.onBroadcast = onBroadcast
    this.ensureOpenLobby()
    this.ensureHouseDemo()
  }

  private touch(slot: ArenaSlot) {
    slot.lastActiveAt = Date.now()
  }

  private findSlotByEngine(engine: MatchEngine): ArenaSlot | null {
    for (const slot of this.live.values()) {
      if (slot.engine === engine) return slot
    }
    return null
  }

  private rekey(oldId: string, newId: string) {
    if (oldId === newId) return
    const slot = this.live.get(oldId)
    if (!slot) return
    this.live.delete(oldId)
    this.live.set(newId, slot)
    if (this.openLobbyId === oldId) this.openLobbyId = newId
    if (this.houseDemoId === oldId) this.houseDemoId = newId
    for (const [agent, mid] of this.byAgent) {
      if (mid === oldId) this.byAgent.set(agent, newId)
    }
  }

  /** Paid rings only — house demo is reserved and excluded from capacity. */
  private paidLiveCount() {
    return [...this.live.values()].filter((s) => s.kind !== 'demo').length
  }

  private isActiveFight(phase: MatchState['phase']) {
    return (
      phase === 'countdown' ||
      phase === 'fighting' ||
      phase === 'between_rounds'
    )
  }

  private syncAgentIndex(slot: ArenaSlot) {
    const matchId = slot.engine.getState().id
    for (const corner of ['red', 'blue'] as Corner[]) {
      const key = slot.engine.agentKeys[corner]
      if (key) this.byAgent.set(key, matchId)
    }
  }

  private attachEngine(kind: RingKind): MatchEngine {
    let engine!: MatchEngine
    engine = new MatchEngine(
      (state) => {
        const slot = this.findSlotByEngine(engine)
        if (!slot) return
        const registered = [...this.live.entries()].find(([, s]) => s === slot)?.[0]
        if (registered && registered !== state.id) this.rekey(registered, state.id)
        this.touch(slot)
        this.syncAgentIndex(slot)
        this.onBroadcast({ matchId: state.id, type: 'state', state })
      },
      (message) => {
        const slot = this.findSlotByEngine(engine)
        if (!slot) return
        this.touch(slot)
        this.onBroadcast({
          matchId: engine.getState().id,
          type: 'chat',
          message,
        })
      },
    )
    const matchId = engine.getState().id
    this.live.set(matchId, {
      engine,
      kind,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      subscribers: new Set(),
    })
    return engine
  }

  private sweepRetired() {
    const now = Date.now()
    for (const [id, slot] of [...this.live]) {
      const state = slot.engine.getState()
      if (slot.engine.lastFinished && !this.history.has(slot.engine.lastFinished.id)) {
        this.remember(slot.engine.lastFinished)
      }

      const ended =
        state.phase === 'ended' ||
        state.phase === 'knockout' ||
        state.phase === 'decision'
      const idleLobby =
        state.phase === 'lobby' &&
        !state.red.connected &&
        !state.blue.connected &&
        id !== this.openLobbyId &&
        now - slot.lastActiveAt > IDLE_LOBBY_MS
      const staleEnded = ended && now - slot.lastActiveAt > ENDED_GRACE_MS

      if (!idleLobby && !staleEnded) continue
      if (id === this.openLobbyId) continue
      if (id === this.houseDemoId) continue

      for (const [agent, mid] of [...this.byAgent]) {
        if (mid === id) this.byAgent.delete(agent)
      }
      slot.engine.destroy()
      this.live.delete(id)
    }
  }

  private capacityCheck() {
    this.sweepRetired()
    if (this.paidLiveCount() >= MAX_LIVE) {
      throw new Error(`Arena full (${MAX_LIVE} live rings) — try again in a minute`)
    }
  }

  ensureOpenLobby(): MatchEngine {
    if (this.openLobbyId) {
      const slot = this.live.get(this.openLobbyId)
      if (slot && slot.engine.getState().phase === 'lobby') {
        const s = slot.engine.getState()
        if (!s.red.connected || !s.blue.connected) return slot.engine
      }
      this.openLobbyId = null
    }
    this.capacityCheck()
    const engine = this.attachEngine('open')
    this.openLobbyId = engine.getState().id
    return engine
  }

  createMatch(kind: RingKind = 'challenge'): MatchEngine {
    if (kind === 'demo') {
      return this.ensureHouseDemo()
    }
    this.capacityCheck()
    return this.attachEngine(kind)
  }

  /**
   * Reserved house exhibition ring. Does not consume a paid arena slot.
   * Created once and kept alive across watchers.
   */
  ensureHouseDemo(): MatchEngine {
    if (this.houseDemoId) {
      const slot = this.live.get(this.houseDemoId)
      if (slot && slot.kind === 'demo') return slot.engine
      this.houseDemoId = null
    }
    // Sweep stray demos from older builds, then attach exactly one reserved ring.
    for (const [id, slot] of [...this.live]) {
      if (slot.kind !== 'demo') continue
      for (const [agent, mid] of [...this.byAgent]) {
        if (mid === id) this.byAgent.delete(agent)
      }
      slot.engine.destroy()
      this.live.delete(id)
    }
    this.sweepRetired()
    const engine = this.attachEngine('demo')
    this.houseDemoId = engine.getState().id
    return engine
  }

  get(matchId: string | null | undefined): MatchEngine | null {
    if (!matchId) return null
    return this.live.get(matchId)?.engine ?? null
  }

  /** Default walk-up ring for legacy clients that omit matchId. */
  defaultEngine(): MatchEngine {
    return this.ensureOpenLobby()
  }

  resolveForAgent(agentKey: string): MatchEngine | null {
    const matchId = this.byAgent.get(agentKey)
    if (!matchId) return null
    const engine = this.get(matchId)
    if (!engine || engine.cornerForAgent(agentKey) == null) {
      this.byAgent.delete(agentKey)
      return null
    }
    return engine
  }

  requireForAgent(agentKey: string): MatchEngine {
    const engine = this.resolveForAgent(agentKey)
    if (!engine) throw new Error('Claim a corner first (or accept a challenge)')
    return engine
  }

  /**
   * Join a specific bout, or auto-seat into an open lobby with a free corner.
   */
  claimCorner(
    agentKey: string,
    corner: Corner,
    name: string,
    matchId?: string | null,
    opts: { cardId?: string | null } = {},
  ) {
    const existing = this.resolveForAgent(agentKey)
    if (existing) {
      if (opts.cardId) existing.setCard(opts.cardId)
      const fighter = existing.joinAgent(agentKey, corner, name)
      this.byAgent.set(agentKey, existing.getState().id)
      return {
        fighter,
        matchId: existing.getState().id,
        cardId: existing.getCardId(),
        lobby: existing.lobbyStatus(),
      }
    }

    let engine: MatchEngine
    let seatCorner = corner
    if (matchId) {
      const found = this.get(matchId)
      if (!found) throw new Error('That bout is gone — pick a live ring or omit matchId')
      if (found.getState().phase !== 'lobby') {
        throw new Error('That bout already started — join another open ring')
      }
      engine = found
    } else {
      engine = this.ensureOpenLobby()
      const state = engine.getState()
      if (state[seatCorner].connected) {
        const other: Corner = seatCorner === 'red' ? 'blue' : 'red'
        if (!state[other].connected) seatCorner = other
      }
    }

    if (opts.cardId) engine.setCard(opts.cardId)
    const fighter = engine.joinAgent(agentKey, seatCorner, name)
    const id = engine.getState().id
    this.byAgent.set(agentKey, id)

    const after = engine.getState()
    if (this.openLobbyId === id && after.red.connected && after.blue.connected) {
      this.openLobbyId = null
      this.ensureOpenLobby()
    }

    return { fighter, matchId: id, cardId: engine.getCardId(), lobby: engine.lobbyStatus() }
  }


  /** Agent leaves its current seat so it can requeue or accept another challenge. */
  leaveCorner(agentKey: string) {
    const engine = this.resolveForAgent(agentKey)
    if (!engine) {
      this.byAgent.delete(agentKey)
      return {
        ok: true as const,
        left: false as const,
        status: 'idle' as const,
        next: 'You are idle. enter_match / claim_corner, street_say, or post_challenge.',
      }
    }
    const result = engine.leaveAgent(agentKey)
    this.byAgent.delete(agentKey)
    return {
      ...result,
      status: 'idle' as const,
      openLobbyId: this.openLobbyId,
      next:
        result.left
          ? 'Left the ring. enter_match to seat again, street_say to coordinate, or post_challenge.'
          : 'Already idle. enter_match / claim_corner when ready.',
      rings: this.listLive().slice(0, 8),
    }
  }

  /**
   * Clearer seating API for agents: optionally leave the current ring first,
   * then claim a corner (open lobby or specific matchId).
   */
  enterMatch(
    agentKey: string,
    corner: Corner,
    name: string,
    opts: { matchId?: string | null; leaveCurrent?: boolean; cardId?: string | null } = {},
  ) {
    const seated = this.resolveForAgent(agentKey)
    if (seated) {
      const currentId = seated.getState().id
      if (opts.matchId && opts.matchId !== currentId) {
        if (opts.leaveCurrent === false) {
          throw new Error(
            `Already seated in match ${currentId}. Call leave_corner first, or enter_match with leaveCurrent=true.`,
          )
        }
        this.leaveCorner(agentKey)
      } else if (!opts.matchId) {
        // Already seated — refresh seat / rename
        return {
          ...this.claimCorner(agentKey, corner, name, currentId, { cardId: opts.cardId }),
          alreadySeated: true as const,
          next: 'Already in this lobby. Call lobby_say / wait_for_lobby to coordinate, then ready_bell.',
        }
      }
    }
    const claimed = this.claimCorner(agentKey, corner, name, opts.matchId, {
      cardId: opts.cardId,
    })
    return {
      ...claimed,
      alreadySeated: false as const,
      next: 'Seated. Prefer lobby_say + wait_for_lobby to coordinate, then ready_bell (hangs until THROW NOW).',
    }
  }

  /** Snapshot so an agent always knows where it is and what to call next. */
  sessionForAgent(agentKey: string) {
    const engine = this.resolveForAgent(agentKey)
    if (!engine) {
      return {
        ok: true as const,
        agentId: agentKey,
        matchId: null,
        corner: null,
        phase: null,
        status: 'idle' as const,
        openLobbyId: this.openLobbyId,
        rings: this.listLive().slice(0, 8),
        next: 'idle — enter_match / claim_corner, street_say, or post_challenge / list_challenges',
      }
    }
    const state = engine.getState()
    const corner = engine.cornerForAgent(agentKey)
    const phase = state.phase
    let status: 'idle' | 'lobby' | 'in_bout' | 'bout_over' = 'lobby'
    let next = 'lobby_say / wait_for_lobby, then ready_bell'
    if (phase === 'lobby' || phase === 'between_rounds') {
      status = 'lobby'
      next = state[corner!]?.ready
        ? 'Waiting on foe — wait_for_lobby or ready_bell'
        : 'ready_bell (preferred) or lobby_say to coordinate'
    } else if (phase === 'countdown' || phase === 'fighting') {
      status = 'in_bout'
      next = 'wait_for_window → throw_phrase loop'
    } else if (phase === 'ended' || phase === 'knockout' || phase === 'decision') {
      status = 'bout_over'
      next = 'rematch (same foe) or leave_corner then enter_match / street_say'
    }
    return {
      ok: true as const,
      agentId: agentKey,
      matchId: state.id,
      corner,
      phase,
      status,
      ready: corner ? state[corner].ready : false,
      foeName: corner ? state[corner === 'red' ? 'blue' : 'red'].name : null,
      lobby: engine.lobbyStatus(),
      openLobbyId: this.openLobbyId,
      next,
    }
  }

  acceptChallenge(input: {
    challengerId: string
    challengerName: string
    acceptorId: string
    acceptorName: string
    preferredCorner: Corner | 'any'
  }) {
    if (this.resolveForAgent(input.challengerId) || this.resolveForAgent(input.acceptorId)) {
      throw new Error('One of you is already seated in another ring — finish or leave first')
    }
    const engine = this.createMatch('challenge')
    const seated = engine.seatChallengePair({
      challengerId: input.challengerId,
      challengerName: input.challengerName,
      acceptorId: input.acceptorId,
      acceptorName: input.acceptorName,
      preferredCorner: input.preferredCorner,
    })
    const matchId = engine.getState().id
    this.byAgent.set(input.challengerId, matchId)
    this.byAgent.set(input.acceptorId, matchId)
    return { ...seated, matchId, state: engine.getState() }
  }

  /**
   * Join the reserved house exhibition.
   * Mid-fight watchers attach without restarting; idle/ended cards get a fresh bot bout.
   */
  spawnDemo(): MatchEngine {
    const engine = this.ensureHouseDemo()
    const phase = engine.getState().phase
    if (!this.isActiveFight(phase)) {
      engine.spawnDemoBots()
    }
    const id = engine.getState().id
    this.houseDemoId = id
    for (const key of Object.values(engine.agentKeys)) {
      if (key) this.byAgent.set(key, id)
    }
    return engine
  }

  houseDemoMatchId() {
    return this.houseDemoId
  }

  rematch(matchId: string) {
    const engine = this.get(matchId)
    if (!engine) throw new Error('Bout not found')
    engine.rematch()
    const slot = this.live.get(engine.getState().id)
    if (slot) this.syncAgentIndex(slot)
    return engine
  }

  reset(matchId: string) {
    const slot = this.live.get(matchId)
    if (!slot) throw new Error('Bout not found')
    for (const [agent, mid] of [...this.byAgent]) {
      if (mid === matchId) this.byAgent.delete(agent)
    }
    if (slot.engine.lastFinished) this.remember(slot.engine.lastFinished)
    slot.engine.reset()
    const newId = slot.engine.getState().id
    if (newId !== matchId) this.rekey(matchId, newId)
    if (slot.kind === 'open') this.openLobbyId = newId
    return slot.engine
  }

  getBout(id: string): BoutResult | null {
    for (const slot of this.live.values()) {
      const bout = slot.engine.getBout(id)
      if (bout) return bout
    }
    const hist = this.history.get(id)
    return hist ? { ...hist, live: false } : null
  }

  listHistory(limit = 24) {
    return [...this.history.values()]
      .sort((a, b) => b.endedAt - a.endedAt)
      .slice(0, Math.max(1, Math.min(limit, 60)))
  }

  listLive(): LiveRingSummary[] {
    this.gc()
    return [...this.live.values()]
      .map((slot) => this.summarize(slot))
      .sort((a, b) => {
        if (a.busy !== b.busy) return a.busy ? -1 : 1
        return b.lastActiveAt - a.lastActiveAt
      })
  }

  private summarize(slot: ArenaSlot): LiveRingSummary {
    const s = slot.engine.getState()
    return {
      matchId: s.id,
      kind: slot.kind,
      phase: s.phase,
      headline: slot.engine.ringHeadline(),
      label: slot.engine.ringLabel(),
      busy: slot.engine.ringBusy(),
      redName: s.red.connected ? s.red.name : 'OPEN',
      blueName: s.blue.connected ? s.blue.name : 'OPEN',
      redConnected: s.red.connected,
      blueConnected: s.blue.connected,
      cardHeat: Math.round(s.cardHeat),
      watchPath: `/?watch=1&bout=${s.id}`,
      createdAt: slot.createdAt,
      lastActiveAt: slot.lastActiveAt,
    }
  }

  arenaBusy(): boolean {
    return this.paidLiveCount() >= MAX_LIVE
  }

  arenaLabel(): string {
    const live = this.listLive().filter((r) => r.kind !== 'demo')
    const fighting = live.filter((r) => r.busy).length
    const open = live.filter((r) => r.phase === 'lobby').length
    const paid = this.paidLiveCount()
    if (fighting === 0 && open <= 1) return live[0]?.label ?? 'Rings open'
    return `${fighting} live · ${open} open lobby${open === 1 ? '' : 's'} · ${paid}/${MAX_LIVE} rings`
  }

  arenaHeadline(): string {
    const fighting = this.listLive().filter((r) => r.busy).length
    if (fighting >= 3) return `${fighting} LIVE CARDS`
    if (fighting > 0) return 'LIVE CARDS'
    return 'RINGS OPEN'
  }

  subscribe(ws: WebSocket, matchId: string) {
    for (const slot of this.live.values()) slot.subscribers.delete(ws)
    const slot = this.live.get(matchId)
    if (!slot) return false
    slot.subscribers.add(ws)
    return true
  }

  unsubscribe(ws: WebSocket) {
    for (const slot of this.live.values()) slot.subscribers.delete(ws)
  }

  subscribersFor(matchId: string): Set<WebSocket> {
    return this.live.get(matchId)?.subscribers ?? new Set()
  }

  tickAll() {
    for (const slot of this.live.values()) {
      const phase = slot.engine.getState().phase
      if (phase === 'ended' || phase === 'knockout' || phase === 'decision') {
        continue
      }
      slot.engine.tick()
      if (phase !== 'lobby') this.touch(slot)
    }
    this.gc()
  }

  tickDemoAll() {
    for (const slot of this.live.values()) {
      if (slot.kind !== 'demo') continue
      const phase = slot.engine.getState().phase
      if (phase === 'lobby' || slot.engine.ringBusy()) {
        slot.engine.tickDemoBots()
      }
    }
  }

  private remember(bout: BoutResult) {
    this.history.set(bout.id, { ...bout, live: false })
    while (this.history.size > MAX_HISTORY) {
      const oldest = this.history.keys().next().value
      if (oldest == null) break
      this.history.delete(oldest)
    }
  }

  /** Retire ended / abandoned rings so viral nights don't leak memory. */
  gc() {
    this.sweepRetired()
    this.ensureOpenLobby()
  }

  stats() {
    const demos = [...this.live.values()].filter((s) => s.kind === 'demo').length
    return {
      live: this.paidLiveCount(),
      demo: Math.min(demos, MAX_DEMO),
      demoMatchId: this.houseDemoId,
      history: this.history.size,
      agents: this.byAgent.size,
      maxLive: MAX_LIVE,
      totalRings: this.live.size,
    }
  }

  lobbyStatus(matchId?: string | null): LobbyStatus {
    const engine = matchId ? this.get(matchId) : this.defaultEngine()
    if (!engine) throw new Error('Bout not found')
    return engine.lobbyStatus()
  }
}
