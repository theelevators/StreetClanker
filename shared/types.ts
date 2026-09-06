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
}

export interface CoachAdvice {
  corner: Corner
  text: string
  at: number
}

export type ClientMessage =
  | { type: 'hello'; role: 'spectator' | 'coach'; corner?: Corner; name?: string }
  | { type: 'coach_advice'; text: string }
  | { type: 'coach_command'; action: FightAction }
  | { type: 'start_match' }
  | { type: 'reset_match' }
  | { type: 'spawn_demo_bots' }
  | {
      type: 'agent_command'
      agentKey: string
      action: FightAction
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
