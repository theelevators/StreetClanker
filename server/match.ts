import { randomUUID } from 'node:crypto'
import type {
  ChatMessage,
  CoachAdvice,
  Corner,
  FightAction,
  FighterPublic,
  MatchState,
} from '../shared/types.ts'

const ROUND_MS = 45_000
const COUNTDOWN_MS = 3_000
const BETWEEN_ROUNDS_MS = 5_000
const MAX_ROUNDS = 3
const MAX_HEALTH = 100
const MAX_STAMINA = 100
const ACTION_COOLDOWN_MS = 420
const CHAT_LIMIT = 80

const ACTION_COST: Record<FightAction, number> = {
  jab: 8,
  punch_left: 14,
  punch_right: 14,
  block: 4,
  dodge: 10,
}

const ACTION_DAMAGE: Record<FightAction, number> = {
  jab: 6,
  punch_left: 12,
  punch_right: 13,
  block: 0,
  dodge: 0,
}

function blankFighter(corner: Corner, name: string): FighterPublic {
  return {
    id: null,
    name,
    corner,
    ready: false,
    connected: false,
    health: MAX_HEALTH,
    stamina: MAX_STAMINA,
    guard: 0,
    knockedOut: false,
    lastAction: null,
    lastActionAt: null,
  }
}

export class MatchEngine {
  state: MatchState
  coachAdvice: Record<Corner, CoachAdvice[]> = { red: [], blue: [] }
  agentKeys: Partial<Record<Corner, string>> = {}
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private onChange: (state: MatchState) => void
  private onChat: (message: ChatMessage) => void

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
      eventLog: ['BoxClub lobby open. Claim a corner and lace up.'],
      createdAt: Date.now(),
    }
  }

  getState(): MatchState {
    return this.state
  }

  private emit() {
    this.onChange(this.state)
  }

  private pushEvent(text: string) {
    this.state.eventLog = [text, ...this.state.eventLog].slice(0, 40)
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
    this.state = this.createLobby()
    this.pushChat({
      from: 'system',
      name: 'Ring Announcer',
      text: 'Fresh canvas. Who wants smoke?',
    })
    this.emit()
  }

  spawnDemoBots() {
    // Always start from a clean lobby so demos work after prior claims
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
    // setReady already auto-starts when both ready; if not, force it
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
    fighter.id = agentKey
    fighter.name = name.slice(0, 24) || (corner === 'red' ? 'Red Rocker' : 'Blue Bomber')
    fighter.connected = true
    fighter.ready = false
    this.pushEvent(`${fighter.name} claimed the ${corner} corner`)
    this.pushChat({
      from: 'system',
      name: 'Ring Announcer',
      text: `${fighter.name} steps into the ${corner.toUpperCase()} corner!`,
      corner,
    })
    this.emit()
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
    this.beginCountdown()
  }

  private beginCountdown() {
    this.clearTimers()
    this.state.phase = 'countdown'
    this.state.countdownEndsAt = Date.now() + COUNTDOWN_MS
    this.state.roundEndsAt = null
    this.pushEvent(`Round ${this.state.round} — get ready`)
    this.pushChat({
      from: 'system',
      name: 'Ring Announcer',
      text: `Round ${this.state.round}! Protect yourselves at all times.`,
    })
    this.emit()
    this.later(COUNTDOWN_MS, () => this.beginRound())
  }

  private beginRound() {
    this.state.phase = 'fighting'
    this.state.countdownEndsAt = null
    this.state.roundEndsAt = Date.now() + ROUND_MS
    this.state.red.guard = 0
    this.state.blue.guard = 0
    this.state.red.stamina = Math.min(MAX_STAMINA, this.state.red.stamina + 20)
    this.state.blue.stamina = Math.min(MAX_STAMINA, this.state.blue.stamina + 20)
    this.pushEvent(`DING — Round ${this.state.round}`)
    this.emit()
    this.later(ROUND_MS, () => this.endRound())
  }

  private endRound() {
    if (this.state.phase !== 'fighting') return
    if (this.state.red.knockedOut || this.state.blue.knockedOut) return

    if (this.state.round >= this.state.maxRounds) {
      this.decideWinner()
      return
    }

    this.state.phase = 'between_rounds'
    this.state.roundEndsAt = null
    this.state.red.ready = false
    this.state.blue.ready = false
    this.pushEvent(`End of round ${this.state.round}`)
    this.pushChat({
      from: 'system',
      name: 'Ring Announcer',
      text: `End of round ${this.state.round}. Coaches, talk to your agents.`,
    })
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
    const text =
      winner === 'draw'
        ? 'Judges call it a DRAW!'
        : `${this.state[winner].name} wins by decision!`
    this.pushEvent(text)
    this.pushChat({ from: 'system', name: 'Ring Announcer', text })
    this.emit()
    this.later(4_000, () => {
      this.state.phase = 'ended'
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
    const text = `KNOCKOUT! ${this.state[winner].name} pops ${this.state[loser].name}'s block!`
    this.pushEvent(text)
    this.pushChat({ from: 'system', name: 'Ring Announcer', text, corner: winner })
    this.emit()
    this.later(5_000, () => {
      this.state.phase = 'ended'
      this.emit()
    })
  }

  applyAction(corner: Corner, action: FightAction) {
    if (this.state.phase !== 'fighting') {
      throw new Error('Fight is not live')
    }
    const self = this.state[corner]
    const oppCorner: Corner = corner === 'red' ? 'blue' : 'red'
    const opp = this.state[oppCorner]
    const now = Date.now()

    if (self.knockedOut || opp.knockedOut) {
      throw new Error('Somebody already ate canvas')
    }
    if (self.lastActionAt && now - self.lastActionAt < ACTION_COOLDOWN_MS) {
      throw new Error('Too soon — reset your feet')
    }
    const cost = ACTION_COST[action]
    if (self.stamina < cost) {
      throw new Error('Gassed out — recover stamina')
    }

    self.stamina = Math.max(0, self.stamina - cost)
    self.lastAction = action
    self.lastActionAt = now

    if (action === 'block') {
      self.guard = Math.min(100, self.guard + 55)
      this.pushEvent(`${self.name} raises the guard`)
      this.emit()
      return { hit: false, damage: 0, blocked: false, dodged: false }
    }

    if (action === 'dodge') {
      self.guard = Math.min(100, self.guard + 25)
      this.pushEvent(`${self.name} slips the pocket`)
      this.emit()
      return { hit: false, damage: 0, blocked: false, dodged: true }
    }

    // Offensive: check opponent state
    let damage = ACTION_DAMAGE[action]
    let blocked = false
    let dodged = false

    if (opp.lastAction === 'dodge' && opp.lastActionAt && now - opp.lastActionAt < 700) {
      dodged = true
      damage = 0
      this.pushEvent(`${opp.name} slips ${self.name}'s ${action.replace('_', ' ')}`)
    } else if (opp.guard > 30) {
      blocked = true
      const absorbed = Math.min(opp.guard, damage * 0.75)
      damage = Math.max(1, damage - absorbed * 0.6)
      opp.guard = Math.max(0, opp.guard - 40)
      this.pushEvent(`${opp.name} blocks — still eats ${damage.toFixed(0)}`)
    } else {
      // Chin shot chance if opponent just punched (trading)
      if (opp.lastAction?.startsWith('punch') && opp.lastActionAt && now - opp.lastActionAt < 500) {
        damage *= 1.35
      }
      this.pushEvent(
        `${self.name} lands a ${action.replace('_', ' ')} for ${Math.round(damage)}`,
      )
    }

    if (!dodged) {
      opp.health = Math.max(0, opp.health - damage)
      opp.guard = Math.max(0, opp.guard - 10)
    }

    // Stamina regen trickle for idle opponent
    opp.stamina = Math.min(MAX_STAMINA, opp.stamina + 2)
    self.guard = Math.max(0, self.guard - 15)

    this.emit()

    if (opp.health <= 0) {
      this.knockout(corner)
    }

    return { hit: !dodged && damage > 0, damage, blocked, dodged }
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
    return this.pushChat({
      from: 'agent',
      corner,
      name: fighter.name,
      text,
    })
  }

  /** Lightweight autonomous demo tick for bot-controlled corners */
  tickDemoBots() {
    if (this.state.phase !== 'fighting') return
    for (const corner of ['red', 'blue'] as Corner[]) {
      const key = this.agentKeys[corner]
      if (!key?.startsWith('demo-')) continue
      const fighter = this.state[corner]
      if (fighter.knockedOut) continue
      if (fighter.lastActionAt && Date.now() - fighter.lastActionAt < 650) continue
      if (Math.random() > 0.55) continue

      const opp = this.state[corner === 'red' ? 'blue' : 'red']
      let action: FightAction
      if (fighter.stamina < 20) action = 'block'
      else if (opp.lastAction?.startsWith('punch') && Math.random() > 0.4) {
        action = Math.random() > 0.5 ? 'block' : 'dodge'
      } else {
        const bag: FightAction[] = ['jab', 'jab', 'punch_left', 'punch_right', 'punch_left']
        action = bag[Math.floor(Math.random() * bag.length)]!
      }
      try {
        this.applyAction(corner, action)
      } catch {
        // ignore cooldown / stamina failures
      }

      if (Math.random() > 0.92) {
        const lines = [
          'Your firmware is trash!',
          'Eat canvas, tin can.',
          'I oil my joints with your tears.',
          'That all you got?',
          'Coach said knock your block off.',
          'Beep boop — KO incoming.',
        ]
        this.trashTalk(key, lines[Math.floor(Math.random() * lines.length)]!)
      }
    }
  }
}
