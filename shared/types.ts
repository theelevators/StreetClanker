export type Corner = 'red' | 'blue'

export type FightPhase =
  | 'lobby'
  | 'countdown'
  | 'fighting'
  | 'between_rounds'
  | 'knockout'
  | 'decision'
  | 'ended'

export type FightAction =
  | 'punch_left'
  | 'punch_right'
  | 'jab'
  | 'block'
  | 'dodge'

/** Single beat inside a committed phrase (combo). */
export type PhraseMove = FightAction | 'taunt'

export type PhraseStyle = 'aggressive' | 'counter' | 'pressure' | 'showboat'

/** Client commit — `at` is ms offset from phrase start (optional; engine spaces beats). */
export interface PhraseBeatInput {
  move: PhraseMove
  at?: number
}

/** Scheduled beat on the ring clock — `at` is absolute epoch ms. */
export interface PhraseBeat {
  at: number
  move: PhraseMove
}

export interface ActivePhrase {
  id: string
  corner: Corner
  style: PhraseStyle
  beats: PhraseBeat[]
  startedAt: number
  endsAt: number
  /** beat indexes already resolved on the ring clock */
  resolved: number[]
}

export type ImpactResult = 'hit' | 'blocked' | 'dodged'

export interface ImpactEvent {
  id: string
  at: number
  attacker: Corner
  defender: Corner
  action: FightAction
  result: ImpactResult
  damage: number
}

/** Career record for a named agent — tokens buy reputation. */
export interface FighterRecord {
  wins: number
  losses: number
  draws: number
  /** Knockouts scored as the winner */
  kos: number
  peakHeat: number
  bouts: number
}

export interface FighterCard {
  id: string
  name: string
  record: FighterRecord
  updatedAt: number
}

export interface FighterPublic {
  id: string | null
  name: string
  corner: Corner
  ready: boolean
  connected: boolean
  health: number
  stamina: number
  guard: number
  knockedOut: boolean
  lastAction: FightAction | null
  lastActionAt: number | null
  /** Earliest time this corner may commit another phrase */
  nextWindowAt: number | null
  /** Auto-covering because they missed a window */
  covering: boolean
  /** Live career snapshot (from the fighter card store) */
  record?: FighterRecord
}

export interface ChatMessage {
  id: string
  at: number
  from: 'system' | 'coach' | 'agent' | 'crowd'
  corner?: Corner
  name: string
  text: string
}

export interface MatchState {
  id: string
  phase: FightPhase
  round: number
  maxRounds: number
  roundEndsAt: number | null
  countdownEndsAt: number | null
  winner: Corner | 'draw' | null
  red: FighterPublic
  blue: FighterPublic
  chat: ChatMessage[]
  eventLog: string[]
  createdAt: number
  lastImpact: ImpactEvent | null
  /** Currently committed phrases playing out on the ring clock */
  activePhrases: ActivePhrase[]
  /** Street-card energy — crowd heat 0–100 */
  cardHeat: number
  /** Live announcer call for the HUD */
  announcerLine: string | null
  announcerLineAt: number | null
}

export interface CoachAdvice {
  corner: Corner
  text: string
  at: number
}

export interface LobbyCornerStatus {
  id: string | null
  name: string
  connected: boolean
  ready: boolean
  record: FighterRecord | null
}

/** Live lobby board for StreetClanker claim → ready → ding. */
export interface LobbyStatus {
  matchId: string
  phase: FightPhase
  red: LobbyCornerStatus
  blue: LobbyCornerStatus
  bothReady: boolean
  waitingOn: Corner | 'ding' | 'fight' | null
  watchPath: string
}

export interface BoutCornerResult {
  id: string | null
  name: string
  health: number
  record: FighterRecord | null
}

/** Shareable end-of-bout card (kept after reset so watch links still resolve). */
export interface BoutResult {
  id: string
  endedAt: number
  method: 'knockout' | 'decision' | 'draw'
  winner: Corner | 'draw' | null
  red: BoutCornerResult
  blue: BoutCornerResult
  cardHeat: number
  announcerLine: string | null
  rounds: number
  live: boolean
  shareText: string
}

export type ThrowPhraseInput = {
  style?: PhraseStyle
  beats: PhraseBeatInput[]
}

/** Open callout on the challenge board — tokens buy smoke. */
export type ChallengeStatus = 'open' | 'matched' | 'cancelled' | 'expired'

export interface OpenChallenge {
  id: string
  challengerId: string
  challengerName: string
  record: FighterRecord
  preferredCorner: Corner | 'any'
  note: string | null
  createdAt: number
  expiresAt: number
  status: ChallengeStatus
  /** Heat used for pairing suggestions */
  heat: number
}

export interface UndercardEntry {
  id: string
  kind: 'ring' | 'challenge' | 'suggestion'
  headline: string
  detail: string
  heat: number | null
  challengeId?: string
}

/** Live challenge board + street undercard strip. */
export interface ChallengeBoard {
  open: OpenChallenge[]
  undercard: UndercardEntry[]
  ringBusy: boolean
  ringLabel: string
}

/** House chip stack — crowd bankroll for bets + cheap mods. */
export interface CrowdWallet {
  id: string
  name: string
  chips: number
  updatedAt: number
}

export type BetStatus = 'open' | 'won' | 'lost' | 'refunded' | 'void'

/** Moneyline wager on a corner before the bell locks. */
export interface CrowdBet {
  id: string
  matchId: string
  bettorId: string
  bettorName: string
  corner: Corner
  stake: number
  /** Decimal payout multiplier locked at placement (e.g. 1.85) */
  odds: number
  status: BetStatus
  payout: number
  createdAt: number
  settledAt: number | null
}

export type CrowdModKind = 'cheer' | 'banner' | 'heat_flare'

export interface CrowdMod {
  id: string
  kind: CrowdModKind
  matchId: string
  buyerId: string
  buyerName: string
  text: string | null
  cost: number
  createdAt: number
}

export type BookStatus = 'closed' | 'open' | 'locked' | 'settled'

/** Live crowd book for the current (or last) bout. */
export interface CrowdBook {
  matchId: string
  status: BookStatus
  redName: string
  blueName: string
  redOdds: number
  blueOdds: number
  redPool: number
  bluePool: number
  betCount: number
  winner: Corner | 'draw' | null
  mods: CrowdMod[]
}

export interface CrowdLedgerSnapshot {
  book: CrowdBook
  wallet: CrowdWallet | null
  myBets: CrowdBet[]
  recent: CrowdBet[]
}

export type ClientMessage =
  | { type: 'hello'; role: 'spectator' | 'coach'; corner?: Corner; name?: string }
  | { type: 'coach_advice'; text: string }
  | { type: 'coach_command'; action: FightAction }
  | { type: 'start_match' }
  | { type: 'reset_match' }
  | { type: 'rematch' }
  | { type: 'spawn_demo_bots' }
  | {
      type: 'agent_command'
      agentKey: string
      action: FightAction
    }
  | {
      type: 'agent_throw_phrase'
      agentKey: string
      style?: PhraseStyle
      beats: PhraseBeatInput[]
    }
  | {
      type: 'agent_join'
      agentKey: string
      corner: Corner
      name: string
    }
  | {
      type: 'agent_ready'
      agentKey: string
    }
  | {
      type: 'agent_trash_talk'
      agentKey: string
      text: string
    }
  | {
      type: 'agent_listen_coach'
      agentKey: string
    }

export type ServerMessage =
  | { type: 'state'; state: MatchState }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'coach_inbox'; advice: CoachAdvice[] }
  | { type: 'error'; message: string }
  | { type: 'agent_session'; agentKey: string; corner: Corner }
