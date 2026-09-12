import { randomUUID } from 'node:crypto'
import type {
  ActivePhrase,
  BoutResult,
  ChatMessage,
  CoachAdvice,
  Corner,
  FightAction,
  FighterPublic,
  ComboBeatResult,
  ComboPack,
  ImpactEvent,
  LobbyStatus,
  MatchState,
  PhraseBeat,
  PhraseBeatInput,
  PhraseMove,
  PhraseStyle,
  ThrowPhraseInput,
} from '../shared/types.ts'
import {
  COMBO_RECIPES,
  COMBO_WINDOW_MS,
  evaluateCombo,
  MAX_HEALTH,
  MAX_STAMINA,
  STAMINA_BETWEEN_ROUNDS,
  STAMINA_ON_CHAIN,
  STAMINA_ON_HIT,
  STAMINA_ON_RECIPE,
} from '../shared/combat.ts'
import { fighterStore, formatRecord } from './fighterStore.ts'
import { crowdStore } from './crowdStore.ts'

const ROUND_MS = 60_000
const COUNTDOWN_MS = 3_000
/** Corner break — long enough for a human to brief their agent. */
const BETWEEN_ROUNDS_MS = 25_000
const MAX_ROUNDS = 3
const CHAT_LIMIT = 80
const WINDOW_GRACE_MS = 160
const COVER_MS = 900
const BEAT_GAP_MS = 300
const TELEGRAPH_MS = 200
const PHRASE_RECOVERY_MS = 420
/**
 * Auto-cover used to fire ~1.2s after a missed window. That is far too tight
 * for LLM tool loops (wait → think → throw often takes several seconds), so
 * agents turtled constantly and their opponent's punches "missed" into cover.
 * Only AFK corners should turtle now.
 */
const MISS_COVER_AFTER_MS = 16_000
/** Skip auto-cover while the agent is mid tool-loop (recent throw / wake). */
const AGENT_LOOP_GRACE_MS = 12_000

const MOVE_COST: Record<PhraseMove, number> = {
  jab: 4,
  punch_left: 7,
  punch_right: 8,
  block: 3,
  dodge: 5,
  taunt: 2,
}

const MOVE_DAMAGE: Partial<Record<PhraseMove, number>> = {
  jab: 5,
  punch_left: 9,
  punch_right: 11,
}

const STYLE_DAMAGE: Record<PhraseStyle, number> = {
  aggressive: 1.12,
  counter: 1.06,
  pressure: 1.0,
  showboat: 0.9,
}

const ANNOUNCER = {
  intro: [
    'LAS VEGAS — the lights are up and the card is LIVE.',
    'Under the desert neon… two corners, one belt.',
    'The Garden is packed. Somebody’s getting famous tonight.',
  ],
  round: [
    'Round heat rising — don’t blink.',
    'They’re trading in the pocket!',
    'This is fight-night television, baby.',
  ],
  combo: [
    'WHAT A COMBINATION!',
    'STRINGING THEM TOGETHER!',
    'PHRASE COMPLETE — and it hurt!',
  ],
  cover: [
    'Auto-cover! Gloves up — the window slipped.',
    'Survival mode. Cover and reset.',
    'Missed the window — they’re turtling.',
  ],
  bomb: [
    'OH THAT’S A BOMB!',
    'HEAVY HANDS UNDER THE LIGHTS!',
    'THE CROWD IS ON ITS FEET!',
  ],
  slip: [
    'SLIPPED IT! Pure alley defense.',
    'Airball — they danced out of range.',
    'Empty leather. The dodge was filthy.',
  ],
  ko: [
    'IT’S OVER! Sleep under the neon!',
    'GOOD NIGHT — the desert just claimed one.',
    'And still… unfinished business no more.',
  ],
  between: [
    'Corners. Cutmen. Deep breath. We go again.',
    'Between rounds — rewrite the game plan.',
    'The house wants blood in the next three minutes.',
  ],
} as const

function blankFighter(corner: Corner, name: string): FighterPublic {
  return {
    id: null,
    name,
    corner,
    ready: false,
    connected: false,
    health: MAX_HEALTH,
    maxHealth: MAX_HEALTH,
    stamina: MAX_STAMINA,
    guard: 0,
    knockedOut: false,
    lastAction: null,
    lastActionAt: null,
    nextWindowAt: null,
    covering: false,
    comboCount: 0,
    comboLabel: null,
  }
}

type ComboTrail = {
  moves: PhraseMove[]
  hitCount: number
  lastAt: number
  label: string | null
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function isAttack(move: PhraseMove): move is FightAction {
  return move === 'jab' || move === 'punch_left' || move === 'punch_right'
}

function isDefense(move: PhraseMove): move is 'block' | 'dodge' {
  return move === 'block' || move === 'dodge'
}


export type AgentWakeReason =
  | 'window_open'
  | 'corner_break'
  | 'bout_over'
  | 'phase_change'
  | 'timeout'
  | 'impact'

export type AgentRingEvent = {
  type: 'window_open' | 'phase' | 'impact' | 'brief' | 'coach' | 'heartbeat'
  agentKey?: string
  corner?: Corner
  at: number
  reason?: AgentWakeReason
  brief?: Record<string, unknown>
  payload?: Record<string, unknown>
}

type WindowWaiter = {
  agentKey: string
  resolve: (value: Record<string, unknown>) => void
  timer: ReturnType<typeof setTimeout>
  want: 'window' | 'any'
}

export class MatchEngine {
  state: MatchState
  coachAdvice: Record<Corner, CoachAdvice[]> = { red: [], blue: [] }
  agentKeys: Partial<Record<Corner, string>> = {}
  /** Last finished bout — survives reset so share links still resolve. */
  lastFinished: BoutResult | null = null
  /** Prevent double-counting when knockout/decision also schedules ended. */
  private scoredMatchId: string | null = null
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private onChange: (state: MatchState) => void
  private onChat: (message: ChatMessage) => void
  /** Latch so auto-cover fires once per missed window */
  private coverLatch: Record<Corner, number> = { red: 0, blue: 0 }
  /** Last agent tool activity per corner — suppresses AFK auto-cover. */
  private lastAgentTouch: Record<Corner, number> = { red: 0, blue: 0 }
  private lastHeatTick = 0
  /** Street-fighter combo trails — resets on whiff, block, or getting hit. */
  private comboTrail: Record<Corner, ComboTrail> = {
    red: { moves: [], hitCount: 0, lastAt: 0, label: null },
    blue: { moves: [], hitCount: 0, lastAt: 0, label: null },
  }
  /** Clean attack hits already scored inside the active phrase. */
  private phraseHitCount: Record<string, number> = {}
  /** Beat outcomes buffered until the phrase fully resolves (combo packs). */
  private phrasePacks: Record<string, ComboBeatResult[]> = {}
  /** Resolvers waiting for a phrase's beats to finish. */
  private phraseWaiters: Array<{
    phraseId: string
    resolve: () => void
  }> = []
  /** Long-poll waiters parked on wait_for_window. */
  private windowWaiters: WindowWaiter[] = []
  /** SSE / push subscribers for agent wakeups. */
  private agentSubs = new Set<(event: AgentRingEvent) => void>()
  /** Last window-open latch per corner — edge-trigger wakeups. */
  private windowOpenLatch: Record<Corner, boolean> = { red: false, blue: false }

  constructor(
    onChange: (state: MatchState) => void,
    onChat: (message: ChatMessage) => void,
  ) {
    this.onChange = onChange
    this.onChat = onChat
    this.state = this.createLobby()
  }

  private createLobby(): MatchState {
    return {
      id: randomUUID(),
      phase: 'lobby',
      round: 0,
      maxRounds: MAX_ROUNDS,
      roundEndsAt: null,
      countdownEndsAt: null,
      winner: null,
      red: blankFighter('red', 'Red Rocker'),
      blue: blankFighter('blue', 'Blue Bomber'),
      chat: [],
      eventLog: ['StreetClanker lobby open. Alley-card energy — claim a corner.'],
      createdAt: Date.now(),
      lastImpact: null,
      activePhrases: [],
      cardHeat: 12,
      announcerLine: null,
      announcerLineAt: null,
    }
  }

  getState(): MatchState {
    return this.state
  }

  lobbyStatus(): LobbyStatus {
    const { red, blue, phase, id } = this.state
    const bothReady = red.connected && blue.connected && red.ready && blue.ready
    let waitingOn: LobbyStatus['waitingOn'] = null
    if (phase === 'lobby') {
      if (!red.connected) waitingOn = 'red'
      else if (!blue.connected) waitingOn = 'blue'
      else if (!red.ready) waitingOn = 'red'
      else if (!blue.ready) waitingOn = 'blue'
      else waitingOn = 'ding'
    } else if (phase !== 'ended') {
      waitingOn = 'fight'
    }
    return {
      matchId: id,
      phase,
      red: {
        id: red.id,
        name: red.name,
        connected: red.connected,
        ready: red.ready,
        record: red.record ?? fighterStore.snapshot(red.id),
      },
      blue: {
        id: blue.id,
        name: blue.name,
        connected: blue.connected,
        ready: blue.ready,
        record: blue.record ?? fighterStore.snapshot(blue.id),
      },
      bothReady,
      waitingOn,
      watchPath: `/?watch=1&bout=${id}`,
    }
  }

  getBout(id: string): BoutResult | null {
    const live = this.state
    if (live.id === id) {
      const terminal =
        live.phase === 'knockout' || live.phase === 'decision' || live.phase === 'ended'
      if (terminal) {
        return this.snapshotFromState(live, true)
      }
      return this.snapshotFromState(live, true)
    }
    if (this.lastFinished?.id === id) {
      return { ...this.lastFinished, live: false }
    }
    return null
  }

  private cornerResult(fighter: FighterPublic) {
    return {
      id: fighter.id,
      name: fighter.name,
      health: fighter.health,
      record: fighter.record ?? fighterStore.snapshot(fighter.id),
    }
  }

  private buildShareText(state: MatchState, method: BoutResult['method']): string {
    const redRec = state.red.record ?? fighterStore.snapshot(state.red.id)
    const blueRec = state.blue.record ?? fighterStore.snapshot(state.blue.id)
    const fmt = (name: string, rec: typeof redRec) =>
      rec ? `${name} (${formatRecord(rec)}, peak ${rec.peakHeat})` : name
    const red = fmt(state.red.name, redRec)
    const blue = fmt(state.blue.name, blueRec)
    if (state.winner === 'draw') {
      return `${red} vs ${blue} ends in a DRAW — watch: /?watch=1&bout=${state.id}`
    }
    if (state.winner === 'red') {
      return `${red} def. ${blue} by ${method.toUpperCase()} — watch: /?watch=1&bout=${state.id}`
    }
    if (state.winner === 'blue') {
      return `${blue} def. ${red} by ${method.toUpperCase()} — watch: /?watch=1&bout=${state.id}`
    }
    return `${red} vs ${blue} — watch: /?watch=1&bout=${state.id}`
  }

  private snapshotFromState(state: MatchState, live: boolean): BoutResult {
    const method: BoutResult['method'] =
      state.winner === 'draw'
        ? 'draw'
        : state.phase === 'knockout' || state.red.knockedOut || state.blue.knockedOut
          ? 'knockout'
          : 'decision'
    return {
      id: state.id,
      endedAt: Date.now(),
      method,
      winner: state.winner,
      red: this.cornerResult(state.red),
      blue: this.cornerResult(state.blue),
      cardHeat: Math.round(state.cardHeat),
      announcerLine: state.announcerLine,
      rounds: state.round,
      live,
      shareText: this.buildShareText(state, method),
    }
  }

  private rememberFinished() {
    if (this.scoredMatchId !== this.state.id) {
      this.scoredMatchId = this.state.id
      fighterStore.applyBout({
        redId: this.state.red.id,
        blueId: this.state.blue.id,
        redName: this.state.red.name,
        blueName: this.state.blue.name,
        winner: this.state.winner,
        method:
          this.state.winner === 'draw'
            ? 'draw'
            : this.state.phase === 'knockout' ||
                this.state.red.knockedOut ||
                this.state.blue.knockedOut
              ? 'knockout'
              : 'decision',
        cardHeat: this.state.cardHeat,
      })
      // Refresh live fighter records after scoring
      if (this.state.red.id) {
        this.state.red.record = fighterStore.snapshot(this.state.red.id) ?? undefined
      }
      if (this.state.blue.id) {
        this.state.blue.record = fighterStore.snapshot(this.state.blue.id) ?? undefined
      }
      crowdStore.settle({
        matchId: this.state.id,
        winner: this.state.winner,
      })
    }
    this.lastFinished = this.snapshotFromState(this.state, false)
  }

  /** Open the crowd book once both named corners are filled. */
  syncCrowdBook() {
    if (this.state.phase !== 'lobby') return
    if (!this.state.red.connected || !this.state.blue.connected) return
    crowdStore.openBook({
      matchId: this.state.id,
      redName: this.state.red.name,
      blueName: this.state.blue.name,
      redRecord: this.state.red.record ?? fighterStore.snapshot(this.state.red.id),
      blueRecord: this.state.blue.record ?? fighterStore.snapshot(this.state.blue.id),
    })
  }

  bumpCardHeat(amount: number) {
    this.state.cardHeat = clamp(this.state.cardHeat + amount, 0, 100)
    this.emit()
    return this.state.cardHeat
  }

  private emit() {
    this.onChange(this.state)
    this.flushAgentWakeups()
  }

  private pushEvent(text: string) {
    this.state.eventLog = [text, ...this.state.eventLog].slice(0, 40)
  }

  private announce(pool: readonly string[], heatBump = 0) {
    const line = pick(pool)
    this.state.announcerLine = line
    this.state.announcerLineAt = Date.now()
    this.state.cardHeat = clamp(this.state.cardHeat + heatBump, 0, 100)
    this.pushChat({ from: 'system', name: 'Ring Announcer', text: line })
    this.pushEvent(`🎤 ${line}`)
  }

  pushChat(partial: Omit<ChatMessage, 'id' | 'at'> & { at?: number }) {
    const message: ChatMessage = {
      id: randomUUID(),
      at: partial.at ?? Date.now(),
      from: partial.from,
      corner: partial.corner,
      name: partial.name,
      text: partial.text.slice(0, 200),
    }
    this.state.chat = [...this.state.chat, message].slice(-CHAT_LIMIT)
    this.onChat(message)
    this.emit()
    return message
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t)
      fn()
    }, ms)
    this.timers.add(t)
  }

  reset() {
    this.clearTimers()
    this.coachAdvice = { red: [], blue: [] }
    this.agentKeys = {}
    this.coverLatch = { red: 0, blue: 0 }
    this.lastAgentTouch = { red: 0, blue: 0 }
    this.resetCombos()
    this.state = this.createLobby()
    this.pushChat({
      from: 'system',
      name: 'Ring Announcer',
      text: 'Fresh canvas under the neon. Who wants smoke?',
    })
    this.emit()
  }

  /** Keep the same two fighters for another bout — reputation stays on the card. */
  rematch() {
    const redKey = this.agentKeys.red
    const blueKey = this.agentKeys.blue
    const redName = this.state.red.name
    const blueName = this.state.blue.name
    const redConnected = this.state.red.connected
    const blueConnected = this.state.blue.connected
    if (!redKey || !blueKey || !redConnected || !blueConnected) {
      throw new Error('Need both named fighters still in the corners for a rematch')
    }
    this.clearTimers()
    this.coachAdvice = { red: [], blue: [] }
    this.coverLatch = { red: 0, blue: 0 }
    this.lastAgentTouch = { red: 0, blue: 0 }
    this.resetCombos()
    this.scoredMatchId = null
    this.state = this.createLobby()
    this.agentKeys = { red: redKey, blue: blueKey }
    this.joinAgent(redKey, 'red', redName)
    this.joinAgent(blueKey, 'blue', blueName)
    this.pushChat({
      from: 'system',
      name: 'Ring Announcer',
      text: `Rematch! ${redName} vs ${blueName} — same blood, fresh canvas.`,
    })
    this.emit()
  }

  /**
   * Seat a matched challenge pair into the ring.
   * Clears an idle/ended lobby; refuses if a live bout is in progress or strangers hold corners.
   */
  seatChallengePair(input: {
    challengerId: string
    challengerName: string
    acceptorId: string
    acceptorName: string
    preferredCorner: Corner | 'any'
  }) {
    const { challengerId, challengerName, acceptorId, acceptorName, preferredCorner } = input
    if (challengerId === acceptorId) {
      throw new Error('You cannot accept your own challenge')
    }
    if (challengerId.startsWith('demo-') || acceptorId.startsWith('demo-')) {
      throw new Error('Demo bots stay off the challenge board')
    }

    const phase = this.state.phase
    if (phase !== 'lobby' && phase !== 'ended') {
      throw new Error('Ring is busy — wait for the bout to finish')
    }

    const redKey = this.agentKeys.red
    const blueKey = this.agentKeys.blue
    const occupants = [redKey, blueKey].filter(Boolean) as string[]
    const allowed = new Set([challengerId, acceptorId])
    if (occupants.some((k) => !allowed.has(k))) {
      throw new Error('Corners already claimed by other fighters')
    }

    // Fresh canvas for the matched pair
    this.clearTimers()
    this.coachAdvice = { red: [], blue: [] }
    this.coverLatch = { red: 0, blue: 0 }
    this.lastAgentTouch = { red: 0, blue: 0 }
    this.resetCombos()
    this.scoredMatchId = null
    this.agentKeys = {}
    this.state = this.createLobby()

    let challengerCorner: Corner =
      preferredCorner === 'blue' ? 'blue' : preferredCorner === 'red' ? 'red' : 'red'
    // If preferred taken somehow, flip — canvas is fresh so this is just preference
    if (preferredCorner === 'any') {
      challengerCorner = Math.random() < 0.5 ? 'red' : 'blue'
    }
    const acceptorCorner: Corner = challengerCorner === 'red' ? 'blue' : 'red'

    this.joinAgent(challengerId, challengerCorner, challengerName)
    this.joinAgent(acceptorId, acceptorCorner, acceptorName)
    this.pushChat({
      from: 'system',
      name: 'Ring Announcer',
      text: `Challenge accepted! ${challengerName} vs ${acceptorName} — gloves up when you're ready.`,
    })
    this.emit()
    return {
      lobby: this.lobbyStatus(),
      challengerCorner,
      acceptorCorner,
    }
  }

  ringLabel(): string {
    const { phase, red, blue } = this.state
    if (phase === 'lobby') {
      if (red.connected && blue.connected) return `${red.name} vs ${blue.name} — waiting on ready`
      if (red.connected) return `${red.name} holding RED — blue open`
      if (blue.connected) return `${blue.name} holding BLUE — red open`
      return 'Empty canvas · post a challenge or claim a corner'
    }
    if (phase === 'ended') return `Card closed · ${red.name} vs ${blue.name}`
    return `LIVE · ${red.name} vs ${blue.name}`
  }

  ringBusy(): boolean {
    const p = this.state.phase
    return p !== 'lobby' && p !== 'ended'
  }

  /** Undercard ticket header for the ring slot. */
  ringHeadline(): string {
    const { phase, red, blue } = this.state
    if (phase !== 'lobby' && phase !== 'ended') return 'MAIN EVENT'
    if (phase === 'ended') return 'CARD CLOSED'
    if (red.connected && blue.connected) return 'MATCHED'
    if (red.connected || blue.connected) return 'CORNER HELD'
    return 'RING OPEN'
  }

  spawnDemoBots() {
    if (this.state.phase !== 'lobby') {
      this.clearTimers()
      this.coachAdvice = { red: [], blue: [] }
      this.agentKeys = {}
      this.state = this.createLobby()
    } else {
      this.agentKeys = {}
      this.state.red = blankFighter('red', 'Red Rocker')
      this.state.blue = blankFighter('blue', 'Blue Bomber')
      this.state.winner = null
      this.state.round = 0
      this.state.lastImpact = null
      this.state.activePhrases = []
      this.state.cardHeat = 18
    }
    this.joinAgent('demo-red', 'red', 'Rusty Hook')
    this.joinAgent('demo-blue', 'blue', 'Chrome Chin')
    this.setReady('demo-red')
    this.setReady('demo-blue')
    this.pushChat({
      from: 'crowd',
      name: 'Crowd',
      text: 'Demo bots locked in — let them cook!',
    })
    if (this.state.phase === 'lobby') this.startMatch()
  }

  joinAgent(agentKey: string, corner: Corner, name: string) {
    if (this.state.phase !== 'lobby') {
      throw new Error('Match already underway')
    }
    const existing = this.agentKeys[corner]
    if (existing && existing !== agentKey) {
      throw new Error(`${corner} corner is taken`)
    }
    for (const [c, key] of Object.entries(this.agentKeys)) {
      if (key === agentKey && c !== corner) {
        throw new Error('Agent already claimed the other corner')
      }
    }
    this.agentKeys[corner] = agentKey
    const fighter = this.state[corner]
    const card = fighterStore.getOrCreate(agentKey, name)
    fighter.id = agentKey
    fighter.name = card.name
    fighter.connected = true
    fighter.ready = false
    fighter.record = { ...card.record }
    this.pushEvent(`${fighter.name} claimed the ${corner} corner`)
    this.pushChat({
      from: 'system',
      name: 'Ring Announcer',
      text: `${fighter.name} steps into the ${corner.toUpperCase()} corner!`,
      corner,
    })
    this.emit()
    this.syncCrowdBook()
    return fighter
  }

  setReady(agentKey: string) {
    const corner = this.cornerForAgent(agentKey)
    if (!corner) throw new Error('Unknown agent')
    if (this.state.phase !== 'lobby' && this.state.phase !== 'between_rounds') {
      throw new Error('Cannot ready up now')
    }
    this.state[corner].ready = true
    this.pushEvent(`${this.state[corner].name} is ready`)
    this.emit()
    if (
      this.state.phase === 'lobby' &&
      this.state.red.ready &&
      this.state.blue.ready &&
      this.state.red.connected &&
      this.state.blue.connected
    ) {
      this.startMatch()
    }
  }

  cornerForAgent(agentKey: string): Corner | null {
    if (this.agentKeys.red === agentKey) return 'red'
    if (this.agentKeys.blue === agentKey) return 'blue'
    return null
  }

  startMatch() {
    if (this.state.phase !== 'lobby') throw new Error('Match already started')
    if (!this.state.red.connected || !this.state.blue.connected) {
      throw new Error('Need both corners filled')
    }
    this.state.round = 1
    this.state.winner = null
    this.state.red.health = MAX_HEALTH
    this.state.blue.health = MAX_HEALTH
    this.state.red.stamina = MAX_STAMINA
    this.state.blue.stamina = MAX_STAMINA
    this.state.red.knockedOut = false
    this.state.blue.knockedOut = false
    this.state.red.ready = false
    this.state.blue.ready = false
    this.state.activePhrases = []
    this.state.cardHeat = clamp(this.state.cardHeat + 8, 0, 100)
    crowdStore.lockBook(this.state.id)
    this.announce(ANNOUNCER.intro, 10)
    this.beginCountdown()
  }

  private beginCountdown() {
    this.clearTimers()
    this.state.phase = 'countdown'
    this.state.countdownEndsAt = Date.now() + COUNTDOWN_MS
    this.state.roundEndsAt = null
    this.state.activePhrases = []
    for (const c of ['red', 'blue'] as Corner[]) {
      const f = this.state[c]
      f.covering = false
      f.nextWindowAt = null
      f.lastAction = null
      f.lastActionAt = null
      f.guard = 0
    }
    this.coverLatch = { red: 0, blue: 0 }
    this.lastAgentTouch = { red: 0, blue: 0 }
    this.resetCombos()
    this.pushEvent(`Round ${this.state.round} — lights, camera, leather`)
    this.emit()
    this.later(COUNTDOWN_MS, () => this.beginRound())
  }

  private beginRound() {
    this.state.phase = 'fighting'
    this.state.countdownEndsAt = null
    this.state.roundEndsAt = Date.now() + ROUND_MS
    const t = Date.now()
    this.state.red.guard = 0
    this.state.blue.guard = 0
    this.state.red.stamina = Math.min(MAX_STAMINA, this.state.red.stamina + STAMINA_BETWEEN_ROUNDS)
    this.state.blue.stamina = Math.min(MAX_STAMINA, this.state.blue.stamina + STAMINA_BETWEEN_ROUNDS)
    this.state.red.nextWindowAt = t + 250
    this.state.blue.nextWindowAt = t + 250
    this.state.activePhrases = []
    this.phraseHitCount = {}
    this.announce(ANNOUNCER.round, 6)
    this.pushEvent(`DING — Round ${this.state.round}`)
    this.emit()
    this.later(ROUND_MS, () => this.endRound())
  }

  private endRound() {
    if (this.state.phase !== 'fighting') return
    if (this.state.red.knockedOut || this.state.blue.knockedOut) return

    this.state.activePhrases = []
    this.state.red.covering = false
    this.state.blue.covering = false

    if (this.state.round >= this.state.maxRounds) {
      this.decideWinner()
      return
    }

    this.state.phase = 'between_rounds'
    this.state.roundEndsAt = null
    this.state.countdownEndsAt = Date.now() + BETWEEN_ROUNDS_MS
    this.state.red.ready = false
    this.state.blue.ready = false
    this.announce(ANNOUNCER.between, -4)
    this.pushEvent(
      `End of round ${this.state.round} — ${Math.round(BETWEEN_ROUNDS_MS / 1000)}s corner break. Talk to your agent.`,
    )
    this.emit()
    this.later(BETWEEN_ROUNDS_MS, () => {
      this.state.round += 1
      this.beginCountdown()
    })
  }

  private decideWinner() {
    this.clearTimers()
    const { red, blue } = this.state
    let winner: Corner | 'draw'
    if (red.health === blue.health) winner = 'draw'
    else winner = red.health > blue.health ? 'red' : 'blue'
    this.state.phase = 'decision'
    this.state.winner = winner
    this.state.roundEndsAt = null
    this.state.activePhrases = []
    this.flushAllPhraseWaiters()
    this.state.cardHeat = clamp(this.state.cardHeat + 12, 0, 100)
    const text =
      winner === 'draw'
        ? 'Judges call it a DRAW under the neon!'
        : `${this.state[winner].name} wins the street card by decision!`
    this.pushEvent(text)
    this.pushChat({ from: 'system', name: 'Ring Announcer', text })
    this.rememberFinished()
    this.emit()
    this.later(4_000, () => {
      this.state.phase = 'ended'
      this.rememberFinished()
      this.emit()
    })
  }

  private knockout(winner: Corner) {
    this.clearTimers()
    const loser: Corner = winner === 'red' ? 'blue' : 'red'
    this.state[loser].knockedOut = true
    this.state[loser].health = 0
    this.state.phase = 'knockout'
    this.state.winner = winner
    this.state.roundEndsAt = null
    this.state.activePhrases = []
    this.flushAllPhraseWaiters()
    this.announce(ANNOUNCER.ko, 22)
    const text = `KNOCKOUT! ${this.state[winner].name} pops ${this.state[loser].name}'s block!`
    this.pushEvent(text)
    this.rememberFinished()
    this.emit()
    this.later(5_000, () => {
      this.state.phase = 'ended'
      this.rememberFinished()
      this.emit()
    })
  }

  private hasActivePhrase(corner: Corner) {
    return this.state.activePhrases.some((p) => p.corner === corner)
  }

  private phraseCost(beats: PhraseBeatInput[], style: PhraseStyle) {
    const base = beats.reduce((s, b) => s + MOVE_COST[b.move], 0)
    const mul =
      style === 'aggressive' ? 1.1 : style === 'showboat' ? 1.15 : style === 'pressure' ? 1.05 : 1
    return Math.round(base * mul)
  }

  private scheduleBeats(inputs: PhraseBeatInput[], startedAt: number): PhraseBeat[] {
    const sliced = inputs.slice(0, 3)
    if (sliced.length === 0) return [{ move: 'jab', at: startedAt + TELEGRAPH_MS }]

    let cursor = startedAt + TELEGRAPH_MS
    return sliced.map((b, i) => {
      if (i === 0) {
        cursor = startedAt + TELEGRAPH_MS
      } else if (typeof b.at === 'number' && b.at > 0) {
        // treat provided `at` as offset from phrase start if it looks like a timeline
        const absolute = startedAt + Math.max(TELEGRAPH_MS, b.at)
        cursor = Math.max(cursor + 180, absolute)
      } else {
        cursor += BEAT_GAP_MS
      }
      return { move: b.move, at: cursor }
    })
  }

  throwPhrase(corner: Corner, input: ThrowPhraseInput) {
    if (this.state.phase !== 'fighting') {
      throw new Error('Fight is not live — wait for the bell')
    }
    const self = this.state[corner]
    const oppCorner: Corner = corner === 'red' ? 'blue' : 'red'
    const opp = this.state[oppCorner]
    const t = Date.now()

    if (self.knockedOut || opp.knockedOut) {
      throw new Error('Somebody already ate canvas')
    }
    if (this.hasActivePhrase(corner)) {
      throw new Error('Phrase already in the air — finish the combo')
    }
    // Agents can punch out of auto-cover / brief gloves-up — don't soft-lock the tool loop.
    if (self.covering) {
      self.covering = false
    }
    if (self.nextWindowAt && t + WINDOW_GRACE_MS < self.nextWindowAt) {
      throw new Error(
        `Window closed. Next open ~${Math.max(0, self.nextWindowAt - t)}ms`,
      )
    }

    const style: PhraseStyle = input.style ?? 'pressure'
    const rawBeats = input.beats?.length ? input.beats.slice(0, 3) : [{ move: 'jab' as PhraseMove }]
    const cost = this.phraseCost(rawBeats, style)
    if (self.stamina < cost) {
      throw new Error(`Gassed out — need ${cost} stamina (have ${Math.round(self.stamina)})`)
    }

    self.stamina = Math.max(0, self.stamina - cost)
    const beats = this.scheduleBeats(rawBeats, t)
    const phrase: ActivePhrase = {
      id: randomUUID().slice(0, 8),
      corner,
      style,
      beats,
      startedAt: t,
      endsAt: beats[beats.length - 1]!.at + 80,
      resolved: [],
    }

    this.state.activePhrases = [...this.state.activePhrases, phrase]
    this.phrasePacks[phrase.id] = []
    self.nextWindowAt = phrase.endsAt + PHRASE_RECOVERY_MS
    self.covering = false
    this.coverLatch[corner] = 0
    this.touchAgent(corner)
    this.state.cardHeat = clamp(this.state.cardHeat + 2 + beats.length, 0, 100)

    const telegraph = beats.map((b) => b.move).join(' → ')
    this.pushEvent(`${self.name} loads a ${style} phrase: ${telegraph}`)
    if (beats.length >= 3 || style === 'showboat') {
      this.announce(ANNOUNCER.combo, 4)
    } else {
      this.emit()
    }

    return { ok: true as const, phrase, telegraph, nextWindowAt: self.nextWindowAt }
  }

  /** Single-action shortcut → 1-beat phrase (legacy tools / coach UI). */
  applyAction(corner: Corner, action: FightAction) {
    return this.throwPhrase(corner, {
      style: action === 'block' || action === 'dodge' ? 'counter' : 'pressure',
      beats: [{ move: action }],
    })
  }

  /** 1-beat shortcut that still returns a resolved combo pack. */
  applyActionPack(corner: Corner, action: FightAction) {
    return this.throwPhrasePack(corner, {
      style: action === 'block' || action === 'dodge' ? 'counter' : 'pressure',
      beats: [{ move: action }],
    })
  }

  private defenseUp(defender: FighterPublic, corner: Corner, at: number, want: 'block' | 'dodge') {
    if (defender.covering) return true
    const phrase = this.state.activePhrases.find((p) => p.corner === corner)
    if (!phrase) return false
    return phrase.beats.some(
      (b) =>
        (b.move === want || (want === 'block' && b.move === 'dodge')) &&
        Math.abs(b.at - at) <= 280,
    )
  }

  private resolveBeat(phrase: ActivePhrase, beatIndex: number) {
    const beat = phrase.beats[beatIndex]
    if (!beat || phrase.resolved.includes(beatIndex)) return

    const attacker = this.state[phrase.corner]
    const oppCorner: Corner = phrase.corner === 'red' ? 'blue' : 'red'
    const defender = this.state[oppCorner]
    const move = beat.move

    phrase.resolved = [...phrase.resolved, beatIndex]

    if (move === 'taunt') {
      this.state.cardHeat = clamp(this.state.cardHeat + 6, 0, 100)
      attacker.lastAction = null
      attacker.lastActionAt = beat.at
      this.extendComboTrail(phrase.corner, 'taunt', beat.at, { countAsHit: false })
      this.recordPhraseBeat(phrase.id, { move: 'taunt', result: 'pose', damage: 0 })
      this.pushEvent(`${attacker.name} showboats — the strip loves it`)
      this.emit()
      return
    }

    if (isDefense(move)) {
      attacker.lastAction = move
      attacker.lastActionAt = beat.at
      attacker.guard = Math.min(100, attacker.guard + (move === 'block' ? 55 : 25))
      if (move === 'block') {
        attacker.covering = true
        this.later(400, () => {
          if (attacker.lastActionAt === beat.at) attacker.covering = false
          this.emit()
        })
      }
      this.extendComboTrail(phrase.corner, move, beat.at, { countAsHit: false })
      this.recordPhraseBeat(phrase.id, { move, result: 'guard', damage: 0 })
      this.pushEvent(
        move === 'block'
          ? `${attacker.name} gloves up`
          : `${attacker.name} slips the pocket`,
      )
      this.emit()
      return
    }

    if (!isAttack(move)) {
      this.recordPhraseBeat(phrase.id, { move, result: 'pose', damage: 0 })
      return
    }

    attacker.lastAction = move
    attacker.lastActionAt = beat.at
    attacker.guard = Math.max(0, attacker.guard - 12)

    const priorHits = this.phraseHitCount[phrase.id] ?? 0
    let damage = (MOVE_DAMAGE[move] ?? 8) * STYLE_DAMAGE[phrase.style]
    let result: ImpactEvent['result'] = 'hit'
    let comboEval = evaluateCombo({
      trail: [...this.comboTrail[phrase.corner].moves, move],
      hitCount: this.comboTrail[phrase.corner].hitCount + 1,
      priorHitsInPhrase: priorHits,
      prevLabel: this.comboTrail[phrase.corner].label,
    })

    const dodgeWindow = this.defenseUp(defender, oppCorner, beat.at, 'dodge')
    const blockWindow =
      this.defenseUp(defender, oppCorner, beat.at, 'block') || defender.guard > 55

    if (dodgeWindow && Math.random() < 0.75) {
      result = 'dodged'
      damage = 0
      this.breakCombo(phrase.corner)
      this.announce(ANNOUNCER.slip, 3)
      this.pushEvent(`${defender.name} slips ${attacker.name}'s ${move.replace('_', ' ')}`)
    } else if (blockWindow) {
      result = 'blocked'
      this.breakCombo(phrase.corner)
      const absorbed = Math.min(Math.max(defender.guard, 35), damage * 0.85)
      damage = Math.max(1, damage - absorbed * 0.55)
      defender.guard = Math.max(0, defender.guard - 35)
      defender.stamina = Math.max(0, defender.stamina - 3)
      this.pushEvent(`${defender.name} blocks — still eats ${Math.round(damage)}`)
    } else {
      result = 'hit'
      damage *= comboEval.mult
      const foePhrase = this.state.activePhrases.find((p) => p.corner === oppCorner)
      const trading = foePhrase?.beats.some(
        (b) => isAttack(b.move) && Math.abs(b.at - beat.at) <= 220,
      )
      if (trading) damage *= 1.28
      this.extendComboTrail(phrase.corner, move, beat.at, { countAsHit: true })
      this.phraseHitCount[phrase.id] = priorHits + 1
      this.breakCombo(oppCorner) // getting hit drops their chain
      comboEval = evaluateCombo({
        trail: this.comboTrail[phrase.corner].moves,
        hitCount: this.comboTrail[phrase.corner].hitCount,
        priorHitsInPhrase: priorHits,
        prevLabel: this.comboTrail[phrase.corner].label,
      })
      this.comboTrail[phrase.corner].label = comboEval.label
      attacker.comboCount = comboEval.count
      attacker.comboLabel = comboEval.label
      if (comboEval.recipeJustHit) {
        this.announce(ANNOUNCER.combo, 7)
        this.pushEvent(
          `${attacker.name} lands ${comboEval.label}! (${comboEval.mult.toFixed(2)}x)`,
        )
      } else if (comboEval.count >= 3) {
        this.announce(ANNOUNCER.combo, 5)
        this.pushEvent(
          `${attacker.name} chain ${comboEval.count} — ${move.replace('_', ' ')} for ${Math.round(damage)}`,
        )
      } else if (damage >= 14 || Math.random() < (phrase.style === 'aggressive' ? 0.16 : 0.08)) {
        this.announce(ANNOUNCER.bomb, 8)
        this.pushEvent(
          `${attacker.name} lands a ${move.replace('_', ' ')} for ${Math.round(damage)}`,
        )
      } else {
        this.pushEvent(
          `${attacker.name} lands a ${move.replace('_', ' ')} for ${Math.round(damage)}`,
        )
      }
      // Street Fighter-style meter: hits refill the tank, recipes dump a special refund.
      {
        let gain = STAMINA_ON_HIT
        if (comboEval.count > 1) gain += STAMINA_ON_CHAIN * Math.min(comboEval.count - 1, 5)
        if (comboEval.recipeJustHit) gain += STAMINA_ON_RECIPE
        const before = attacker.stamina
        attacker.stamina = Math.min(MAX_STAMINA, attacker.stamina + gain)
        if (comboEval.recipeJustHit) {
          this.pushEvent(
            `${attacker.name} meters up +${Math.round(attacker.stamina - before)} STM — special refund`,
          )
        }
      }
      this.state.cardHeat = clamp(this.state.cardHeat + 3 + Math.min(comboEval.count, 4), 0, 100)
    }

    if (result !== 'dodged') {
      defender.health = Math.max(0, defender.health - damage)
      defender.guard = Math.max(0, defender.guard - 8)
    }

    const impact: ImpactEvent = {
      id: randomUUID(),
      at: beat.at,
      attacker: phrase.corner,
      defender: oppCorner,
      action: move as FightAction,
      result,
      damage: result === 'dodged' ? 0 : damage,
    }
    this.state.lastImpact = impact
    this.recordPhraseBeat(phrase.id, {
      move,
      result,
      damage: impact.damage,
    })
    this.emit()

    if (defender.health <= 0) {
      this.knockout(phrase.corner)
    }
  }



  private resetCombos() {
    this.comboTrail = {
      red: { moves: [], hitCount: 0, lastAt: 0, label: null },
      blue: { moves: [], hitCount: 0, lastAt: 0, label: null },
    }
    this.phraseHitCount = {}
    for (const c of ['red', 'blue'] as Corner[]) {
      this.state[c].comboCount = 0
      this.state[c].comboLabel = null
    }
  }

  private breakCombo(corner: Corner) {
    this.comboTrail[corner] = { moves: [], hitCount: 0, lastAt: 0, label: null }
    this.state[corner].comboCount = 0
    this.state[corner].comboLabel = null
  }

  private extendComboTrail(
    corner: Corner,
    move: PhraseMove,
    at: number,
    opts: { countAsHit: boolean },
  ) {
    const trail = this.comboTrail[corner]
    if (trail.lastAt && at - trail.lastAt > COMBO_WINDOW_MS) {
      trail.moves = []
      trail.hitCount = 0
      trail.label = null
    }
    trail.moves = [...trail.moves, move].slice(-6)
    trail.lastAt = at
    if (opts.countAsHit) trail.hitCount += 1
    const evaluated = evaluateCombo({
      trail: trail.moves,
      hitCount: Math.max(trail.hitCount, opts.countAsHit ? trail.hitCount : trail.hitCount),
      priorHitsInPhrase: 0,
      prevLabel: trail.label,
    })
    trail.label = evaluated.label
    this.state[corner].comboCount = trail.hitCount
    this.state[corner].comboLabel = trail.label
  }

  private touchAgent(corner: Corner) {
    this.lastAgentTouch[corner] = Date.now()
  }

  private agentHasWindowWaiter(corner: Corner) {
    return this.windowWaiters.some((w) => this.cornerForAgent(w.agentKey) === corner)
  }

  private autoCover(corner: Corner, reason: string) {
    const f = this.state[corner]
    if (f.covering || this.hasActivePhrase(corner)) return
    const t = Date.now()
    f.covering = true
    f.lastAction = 'block'
    f.lastActionAt = t
    f.guard = Math.min(100, f.guard + 40)
    f.stamina = Math.max(0, f.stamina - 3)
    f.nextWindowAt = Math.max(f.nextWindowAt ?? 0, t + COVER_MS + 100)
    this.coverLatch[corner] = t
    this.pushEvent(`${f.name} auto-covers (${reason})`)
    this.announce(ANNOUNCER.cover, 2)
    this.later(COVER_MS, () => {
      f.covering = false
      this.emit()
    })
  }

  /**
   * Heartbeat (~50ms): resolve due phrase beats, AFK auto-cover,
   * soft stamina regen, card heat cool-off.
   */
  tick() {
    if (this.state.phase !== 'fighting') return
    const t = Date.now()
    let dirty = false

    // Soft stamina regen when idle
    for (const c of ['red', 'blue'] as Corner[]) {
      const f = this.state[c]
      if (!this.hasActivePhrase(c) && !f.covering) {
        const before = f.stamina
        f.stamina = Math.min(MAX_STAMINA, f.stamina + 0.32)
        if (f.stamina !== before) dirty = true
      }
    }

    // Resolve due beats
    for (const phrase of [...this.state.activePhrases]) {
      for (let i = 0; i < phrase.beats.length; i++) {
        if (phrase.resolved.includes(i)) continue
        const beat = phrase.beats[i]!
        if (beat.at > t) break
        this.resolveBeat(phrase, i)
        if (this.state.phase !== 'fighting') return
        dirty = true
      }
    }

    const beforeLen = this.state.activePhrases.length
    const stillActive: ActivePhrase[] = []
    for (const phrase of this.state.activePhrases) {
      if (phrase.resolved.length < phrase.beats.length) {
        stillActive.push(phrase)
      } else {
        this.finishPhrasePack(phrase.id)
      }
    }
    this.state.activePhrases = stillActive
    if (this.state.activePhrases.length !== beforeLen) dirty = true

    // AFK only → auto-cover. LLM tool loops routinely take several seconds
    // between wait_for_window and throw_phrase; the old ~1.2s band made every
    // live agent turtle, which also nullified the other corner's punches.
    for (const c of ['red', 'blue'] as Corner[]) {
      const key = this.agentKeys[c]
      if (!key || key.startsWith('demo-')) continue
      const f = this.state[c]
      if (!f.nextWindowAt || this.hasActivePhrase(c) || f.covering) continue
      if (this.agentHasWindowWaiter(c)) continue
      if (t - this.lastAgentTouch[c] < AGENT_LOOP_GRACE_MS) continue
      const overdue = t - f.nextWindowAt
      if (overdue > MISS_COVER_AFTER_MS && this.coverLatch[c] < f.nextWindowAt) {
        this.autoCover(c, 'AFK — missed exchange window')
        dirty = true
      }
    }

    // Card heat cools slowly
    if (t - this.lastHeatTick > 400) {
      this.lastHeatTick = t
      const prev = this.state.cardHeat
      this.state.cardHeat = clamp(this.state.cardHeat - 0.35, 0, 100)
      if (this.state.cardHeat !== prev) dirty = true
    }

    if (dirty) this.emit()
  }

  /** Demo bots commit phrases on open windows — Vegas pacing, not button mash. */
  tickDemoBots() {
    if (this.state.phase !== 'fighting') return
    const t = Date.now()
    const lead: Corner = Math.floor(t / 1600) % 2 === 0 ? 'red' : 'blue'

    for (const corner of [lead, lead === 'red' ? 'blue' : 'red'] as Corner[]) {
      const key = this.agentKeys[corner]
      if (!key?.startsWith('demo-')) continue
      const fighter = this.state[corner]
      if (fighter.knockedOut || fighter.covering) continue
      if (this.hasActivePhrase(corner)) continue
      if (fighter.nextWindowAt && t < fighter.nextWindowAt) continue

      const isLead = corner === lead
      if (isLead && Math.random() > 0.62) continue
      if (!isLead && Math.random() > 0.34) continue

      const opp = this.state[corner === 'red' ? 'blue' : 'red']
      const oppPhrase = this.state.activePhrases.find((p) => p.corner === opp.corner)
      const incoming = !!oppPhrase?.beats.some(
        (b) => isAttack(b.move) && b.at - t < 450 && b.at - t > -50,
      )

      let input: ThrowPhraseInput
      const roll = Math.random()
      if (fighter.stamina < 28) {
        input = { style: 'counter', beats: [{ move: 'block' }] }
      } else if (incoming && !isLead) {
        input =
          roll > 0.45
            ? { style: 'counter', beats: [{ move: 'dodge' }, { move: 'punch_right' }] }
            : { style: 'counter', beats: [{ move: 'block' }, { move: 'punch_left' }] }
      } else if (roll < 0.22) {
        input = {
          style: 'aggressive',
          beats: [{ move: 'jab' }, { move: 'jab' }, { move: 'punch_right' }],
        }
      } else if (roll < 0.4) {
        input = {
          style: 'aggressive',
          beats: [{ move: 'jab' }, { move: 'punch_left' }, { move: 'punch_right' }],
        }
      } else if (roll < 0.52) {
        input = { style: 'showboat', beats: [{ move: 'taunt' }, { move: 'punch_right' }] }
      } else if (roll < 0.68) {
        input = { style: 'pressure', beats: [{ move: 'jab' }, { move: 'punch_right' }] }
      } else if (roll < 0.82) {
        input = {
          style: 'pressure',
          beats: [{ move: 'punch_left' }, { move: 'punch_right' }],
        }
      } else {
        input = {
          style: 'pressure',
          beats: [{ move: pick(['jab', 'punch_left', 'punch_right'] as const) }],
        }
      }

      try {
        this.throwPhrase(corner, input)
      } catch {
        // window / stamina
      }

      if (Math.random() > 0.93) {
        const lines = [
          'Your firmware is trash!',
          'Eat canvas under the neon.',
          'I oil my joints with your tears.',
          'That all you got?',
          'Coach said knock your block off.',
          'Beep boop — KO incoming.',
          'The street loves a finisher.',
        ]
        this.trashTalk(key, lines[Math.floor(Math.random() * lines.length)]!)
      }
    }
  }

  coachAdvicePush(corner: Corner, text: string) {
    const advice: CoachAdvice = {
      corner,
      text: text.slice(0, 240),
      at: Date.now(),
    }
    this.coachAdvice[corner] = [...this.coachAdvice[corner], advice].slice(-12)
    this.pushChat({
      from: 'coach',
      corner,
      name: `${corner === 'red' ? 'Red' : 'Blue'} Coach`,
      text: advice.text,
    })
    return advice
  }

  listenCoach(agentKey: string): CoachAdvice[] {
    const corner = this.cornerForAgent(agentKey)
    if (!corner) throw new Error('Unknown agent')
    return this.coachAdvice[corner]
  }

  trashTalk(agentKey: string, text: string) {
    const corner = this.cornerForAgent(agentKey)
    if (!corner) throw new Error('Unknown agent')
    const fighter = this.state[corner]
    this.state.cardHeat = clamp(this.state.cardHeat + 3, 0, 100)
    return this.pushChat({
      from: 'agent',
      corner,
      name: fighter.name,
      text,
    })
  }

  /** Rich ring-side brief for WebMCP — telegraph, window, coach whisper. */
  ringBriefFor(agentKey: string) {
    const corner = this.cornerForAgent(agentKey)
    const state = this.state
    const t = Date.now()
    const you = corner ? state[corner] : null
    const foe = corner ? state[corner === 'red' ? 'blue' : 'red'] : null
    const yourPhrase = corner
      ? state.activePhrases.find((p) => p.corner === corner)
      : undefined
    const foePhrase = corner
      ? state.activePhrases.find((p) => p.corner === (corner === 'red' ? 'blue' : 'red'))
      : undefined
    const msToWindow = you?.nextWindowAt ? Math.max(0, you.nextWindowAt - t) : 0
    const windowOpen = !!(
      you &&
      !you.covering &&
      !yourPhrase &&
      (!you.nextWindowAt || t + WINDOW_GRACE_MS >= you.nextWindowAt)
    )

    let coachWhisper = 'Stay patient — pick a phrase, don’t spam leather.'
    if (state.phase === 'lobby') {
      coachWhisper = 'Claim a corner and ready up when both sides are filled.'
    } else if (state.phase === 'countdown') {
      coachWhisper = 'Breathe. First phrase wins the optics.'
    } else if (state.phase === 'between_rounds') {
      const breakLeft = state.countdownEndsAt
        ? Math.max(0, Math.ceil((state.countdownEndsAt - t) / 1000))
        : Math.round(BETWEEN_ROUNDS_MS / 1000)
      coachWhisper = `Corner break — ~${breakLeft}s left. Brief your agent before the next bell. Heat carries over.`
    } else if (state.phase === 'ended' || state.phase === 'decision' || state.phase === 'knockout') {
      coachWhisper = 'Card’s closed. Rematch when the house is ready.'
    } else if (you?.covering) {
      coachWhisper = 'You’re covering — ride it out, then fire.'
    } else if (!windowOpen) {
      coachWhisper = `Window opens in ~${msToWindow}ms. Load the next phrase.`
    } else if (foePhrase) {
      coachWhisper = `Foe telegraph: ${foePhrase.beats.map((b) => b.move).join('→')}. Counter or cover.`
    } else if ((you?.stamina ?? 0) < 50) {
      coachWhisper = 'Gas tank low — jab phrases only, or block and breathe.'
    } else if ((you?.comboCount ?? 0) >= 2) {
      coachWhisper = `Chain live (${you!.comboCount}${you!.comboLabel ? ` · ${you!.comboLabel}` : ''}) — finish the string, don’t drop it.`
    } else if (state.cardHeat > 70) {
      coachWhisper = 'Crowd is feral — a showboat phrase prints highlight reels.'
    } else {
      coachWhisper =
        'Build a string: jab→jab→punch_right or slip→cross. Combos hit harder the longer they live.'
    }

    return {
      matchId: state.id,
      phase: state.phase,
      round: state.round,
      cardHeat: Math.round(state.cardHeat),
      announcerLine: state.announcerLine,
      corner,
      you,
      foe,
      windowOpen,
      msToWindow,
      yourPhrase: yourPhrase
        ? {
            style: yourPhrase.style,
            remaining: yourPhrase.beats
              .filter((_, i) => !yourPhrase.resolved.includes(i))
              .map((b) => b.move),
          }
        : null,
      foeTelegraph: foePhrase
        ? {
            style: foePhrase.style,
            beats: foePhrase.beats.map((b) => b.move),
            nextBeatInMs: Math.max(
              0,
              (foePhrase.beats.find((_, i) => !foePhrase.resolved.includes(i))?.at ?? t) - t,
            ),
          }
        : null,
      lastImpact: state.lastImpact,
      coachWhisper,
      tip: 'FIGHT LOOP: wait_for_window → throw_phrase → wait_for_window. Keep looping — do not stop after one phrase. Combos refund stamina (recipes dump a special meter refund). Call get_playbook for the full agent playbook.',
      playbookHint: 'get_playbook',
      lobby: this.lobbyStatus(),
    }
  }

  /** Subscribe to agent wakeups (SSE). Returns unsubscribe. */
  subscribeAgentEvents(listener: (event: AgentRingEvent) => void) {
    this.agentSubs.add(listener)
    return () => {
      this.agentSubs.delete(listener)
    }
  }

  private publishAgentEvent(event: AgentRingEvent) {
    for (const listener of this.agentSubs) {
      try {
        listener(event)
      } catch {
        /* ignore broken subscriber */
      }
    }
  }

  /**
   * Block until this agent's exchange window opens (or bout pauses/ends).
   * Keeps ChatGPT/Codex-style clients inside the tool loop instead of exiting
   * after a single throw_phrase.
   */
  waitForWindow(
    agentKey: string,
    opts: { maxMs?: number } = {},
  ): Promise<Record<string, unknown>> {
    const corner = this.cornerForAgent(agentKey)
    if (!corner) {
      return Promise.reject(new Error('Claim a corner first'))
    }
    this.touchAgent(corner)
    const maxMs = Math.min(Math.max(opts.maxMs ?? 12_000, 250), 45_000)
    const snap = this.agentWakeSnapshot(agentKey, 'window_open')
    if (snap.shouldWake) {
      return Promise.resolve(snap.payload)
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.windowWaiters = this.windowWaiters.filter((w) => w.timer !== timer)
        this.touchAgent(corner)
        resolve(this.agentWakeSnapshot(agentKey, 'timeout').payload)
      }, maxMs)
      this.windowWaiters.push({
        agentKey,
        resolve: (value) => {
          clearTimeout(timer)
          this.touchAgent(corner)
          resolve(value)
        },
        timer,
        want: 'window',
      })
    })
  }

  private agentWakeSnapshot(agentKey: string, reason: AgentWakeReason) {
    const payload = this.slimWake(agentKey, reason)
    const wake = payload.wakeReason as AgentWakeReason
    const shouldWake =
      reason === 'timeout' ||
      wake === 'window_open' ||
      wake === 'bout_over' ||
      (wake === 'corner_break' &&
        (reason === 'corner_break' || reason === 'phase_change'))
    return { shouldWake, payload }
  }

  private flushAgentWakeups() {
    const t = Date.now()
    for (const corner of ['red', 'blue'] as Corner[]) {
      const agentKey = this.agentKeys[corner]
      const open = this.isWindowOpen(corner, t)
      const wasOpen = this.windowOpenLatch[corner]
      this.windowOpenLatch[corner] = open
      if (!agentKey) continue

      if (open && !wasOpen && this.state.phase === 'fighting') {
        const brief = this.ringBriefFor(agentKey) as Record<string, unknown>
        this.publishAgentEvent({
          type: 'window_open',
          agentKey,
          corner,
          at: t,
          reason: 'window_open',
          brief,
        })
      }
    }

    if (this.windowWaiters.length === 0) return
    const still: WindowWaiter[] = []
    for (const waiter of this.windowWaiters) {
      const snap = this.agentWakeSnapshot(waiter.agentKey, 'window_open')
      const phase = this.state.phase
      const wake =
        snap.shouldWake ||
        phase === 'ended' ||
        phase === 'knockout' ||
        phase === 'decision'
      if (wake) {
        clearTimeout(waiter.timer)
        waiter.resolve(snap.payload)
      } else {
        still.push(waiter)
      }
    }
    this.windowWaiters = still
  }


  private recordPhraseBeat(
    phraseId: string,
    beat: { move: PhraseMove; result: string; damage: number },
  ) {
    const pack = this.phrasePacks[phraseId] ?? []
    const result =
      beat.result === 'hit' ||
      beat.result === 'blocked' ||
      beat.result === 'dodged' ||
      beat.result === 'guard' ||
      beat.result === 'pose'
        ? beat.result
        : 'pose'
    pack.push({
      move: beat.move,
      result,
      damage: Math.round(beat.damage),
    })
    this.phrasePacks[phraseId] = pack
  }


  private flushAllPhraseWaiters() {
    const waiting = this.phraseWaiters
    this.phraseWaiters = []
    for (const w of waiting) w.resolve()
  }

  private finishPhrasePack(phraseId: string) {
    const waiting = this.phraseWaiters.filter((w) => w.phraseId === phraseId)
    this.phraseWaiters = this.phraseWaiters.filter((w) => w.phraseId !== phraseId)
    for (const w of waiting) w.resolve()
  }

  private waitForPhrase(phraseId: string): Promise<void> {
    const stillGoing = this.state.activePhrases.some(
      (p) => p.id === phraseId && p.resolved.length < p.beats.length,
    )
    if (!stillGoing) return Promise.resolve()
    return new Promise((resolve) => {
      this.phraseWaiters.push({ phraseId, resolve })
    })
  }

  /**
   * Commit a phrase and wait until every beat resolves, then return one compact
   * combo pack. Agents (especially ChatGPT) stay faster when they get the whole
   * exchange in a single tool result instead of drip-fed single impacts.
   */
  async throwPhrasePack(
    corner: Corner,
    input: ThrowPhraseInput,
  ): Promise<{ ok: true; pack: ComboPack; wake?: Record<string, unknown> }> {
    const beforeStamina = this.state[corner].stamina
    const committed = this.throwPhrase(corner, input)
    await this.waitForPhrase(committed.phrase.id)
    // Pack return is another tool boundary — give the agent think-time before
    // AFK auto-cover can fire on the next open window.
    this.touchAgent(corner)
    const pack = this.buildComboPack(corner, committed, beforeStamina)
    // Auto-attach a slim next-window snapshot when the window is already open
    // so GPT can sometimes skip an extra wait_for_window round-trip.
    let wake: Record<string, unknown> | undefined
    if (pack.windowOpen && this.state.phase === 'fighting') {
      const key = this.agentKeys[corner]
      if (key) wake = this.slimWake(key, 'window_open')
    }
    return { ok: true, pack, wake }
  }

  private buildComboPack(
    corner: Corner,
    committed: { phrase: ActivePhrase; telegraph: string; nextWindowAt: number },
    beforeStamina: number,
  ): ComboPack {
    const you = this.state[corner]
    const foe = this.state[corner === 'red' ? 'blue' : 'red']
    const beats = this.phrasePacks[committed.phrase.id] ?? []
    delete this.phrasePacks[committed.phrase.id]
    const hits = beats.filter((b) => b.result === 'hit').length
    const damage = beats.reduce((s, b) => s + b.damage, 0)
    const recipe = you.comboLabel
    const t = Date.now()
    const msToWindow = Math.max(0, (you.nextWindowAt ?? t) - t)
    const windowOpen = this.isWindowOpen(corner, t)
    const staminaDelta = Math.round(you.stamina - beforeStamina)
    const staminaSpent = Math.max(0, Math.round(beforeStamina) - Math.round(you.stamina))
    const headline = recipe
      ? `${recipe} — ${hits} hit${hits === 1 ? '' : 's'} · ${Math.round(damage)} dmg · STM ${Math.round(you.stamina)}`
      : `${committed.telegraph} — ${hits}/${beats.length} connected · ${Math.round(damage)} dmg · STM ${Math.round(you.stamina)}`
    return {
      headline,
      telegraph: committed.telegraph,
      style: committed.phrase.style,
      recipe,
      beats,
      hits,
      damage: Math.round(damage),
      staminaSpent,
      staminaNow: Math.round(you.stamina),
      staminaDelta,
      yourHp: Math.round(you.health),
      foeHp: Math.round(foe.health),
      msToWindow,
      windowOpen,
      next: windowOpen
        ? 'Window already open — throw_phrase again OR wait_for_window for a fresh pack.'
        : 'Call wait_for_window next (it returns a compact wake pack). Keep looping.',
    }
  }

  /** Suggested recipes an agent can fire right now given stamina. */
  private suggestedCombos(stamina: number) {
    return COMBO_RECIPES.filter((r) => r.pattern.length <= 3)
      .slice(0, 8)
      .map((r) => ({
        name: r.name,
        style: r.pattern[0] === 'taunt' ? 'showboat' : r.pattern[0] === 'dodge' || r.pattern[0] === 'block' ? 'counter' : 'aggressive',
        beats: r.pattern.map((move) => ({ move })),
        mult: r.mult,
      }))
      .filter((s) => {
        // rough cost gate
        const rough =
          s.beats.reduce((n, b) => {
            const table: Record<string, number> = {
              jab: 4,
              punch_left: 7,
              punch_right: 8,
              block: 3,
              dodge: 5,
              taunt: 2,
            }
            return n + (table[b.move] ?? 6)
          }, 0) * 1.1
        return rough <= stamina + 5
      })
      .slice(0, 3)
  }

  private slimWake(agentKey: string, reason: AgentWakeReason) {
    const brief = this.ringBriefFor(agentKey) as Record<string, unknown>
    const you = brief.you as
      | {
          name?: string
          health?: number
          stamina?: number
          comboCount?: number
          comboLabel?: string | null
        }
      | null
    const foe = brief.foe as
      | { name?: string; health?: number; stamina?: number }
      | null
    const phase = this.state.phase
    const windowOpen = Boolean(brief.windowOpen)
    let action = 'hold'
    let wakeReason: AgentWakeReason = reason
    if (phase === 'fighting' && windowOpen) {
      wakeReason = 'window_open'
      action = 'THROW NOW — fire throw_phrase (returns a full combo pack), then wait_for_window'
    } else if (phase === 'between_rounds') {
      wakeReason = 'corner_break'
      action = 'Corner break — listen_coach, then wait_for_window'
    } else if (phase === 'ended' || phase === 'knockout' || phase === 'decision') {
      wakeReason = 'bout_over'
      action = 'Bout over — stop the fight loop'
    } else if (reason === 'timeout') {
      action = 'Timeout — skim headline, then wait_for_window or throw_phrase if windowOpen'
    }

    const suggestions = this.suggestedCombos(you?.stamina ?? 0)
    const recent = this.state.eventLog.slice(0, 4)
    const headline =
      wakeReason === 'window_open'
        ? `WINDOW OPEN — THROW NOW · STM ${Math.round(you?.stamina ?? 0)} · foe ${Math.round(foe?.health ?? 0)} HP`
        : wakeReason === 'bout_over'
          ? 'BOUT OVER'
          : wakeReason === 'corner_break'
            ? 'CORNER BREAK — plan next round'
            : `Waiting (${wakeReason})`

    return {
      ok: true,
      headline,
      wakeReason,
      action,
      next: action,
      you: you
        ? {
            name: you.name,
            hp: Math.round(you.health ?? 0),
            stm: Math.round(you.stamina ?? 0),
            combo: you.comboLabel ?? (you.comboCount ? `${you.comboCount} HIT` : null),
          }
        : null,
      foe: foe
        ? {
            name: foe.name,
            hp: Math.round(foe.health ?? 0),
            stm: Math.round(foe.stamina ?? 0),
          }
        : null,
      foeTelegraph: brief.foeTelegraph ?? null,
      recent,
      suggested: suggestions,
      windowOpen,
      phase,
      tip: 'Prefer throw_phrase packs over reading every field. Loop: wait_for_window → throw_phrase → wait_for_window.',
    }
  }

  private isWindowOpen(corner: Corner, t = Date.now()) {
    const you = this.state[corner]
    if (!you || you.covering || you.knockedOut) return false
    if (this.hasActivePhrase(corner)) return false
    if (this.state.phase !== 'fighting') return false
    return !you.nextWindowAt || t + WINDOW_GRACE_MS >= you.nextWindowAt
  }

}
