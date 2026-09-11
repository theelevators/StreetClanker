import { useEffect, useState } from 'react'
import type { FighterPublic, FightPhase, MatchState } from '../types'

type Props = {
  state: MatchState
}

export function MatchHUD({ state }: Props) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 200)
    return () => clearInterval(id)
  }, [])

  const label = phaseLabel(state.phase, state)
  const remaining =
    state.phase === 'fighting' && state.roundEndsAt
      ? Math.max(0, Math.ceil((state.roundEndsAt - Date.now()) / 1000))
      : state.phase === 'countdown' && state.countdownEndsAt
        ? Math.max(0, Math.ceil((state.countdownEndsAt - Date.now()) / 1000))
        : null

  const announcerFresh =
    state.announcerLine &&
    state.announcerLineAt &&
    Date.now() - state.announcerLineAt < 4200

  const heat = Math.max(0, Math.min(100, state.cardHeat ?? 0))
  const phrases = state.activePhrases ?? []

  return (
    <div className="hud-stack">
      <div className="hud">
        <FighterMeter fighter={state.red} align="left" phrases={phrases} />
        <div className="hud-center">
          <div className="hud-round">
            {state.phase === 'lobby'
              ? 'WAITING'
              : `ROUND ${Math.max(1, state.round)} / ${state.maxRounds}`}
          </div>
          <div className={`hud-phase phase-${state.phase}`}>{label}</div>
          {remaining !== null && <div className="hud-clock">{remaining}s</div>}
          {state.winner && (
            <div className="hud-winner">
              {state.winner === 'draw'
                ? 'DRAW'
                : `${state[state.winner].name.toUpperCase()} WINS`}
            </div>
          )}
          <div
            className="card-heat"
            style={{ ['--heat' as string]: `${heat}%` }}
            aria-label={`Card heat ${Math.round(heat)}`}
          >
            <span className="card-heat-label">CARD HEAT</span>
            <div className="card-heat-track">
              <div className="card-heat-fill" />
            </div>
            <span className="card-heat-val">{Math.round(heat)}</span>
          </div>
        </div>
        <FighterMeter fighter={state.blue} align="right" phrases={phrases} />
      </div>

      {announcerFresh && (
        <div className="announcer-banner" key={state.announcerLineAt}>
          <span className="announcer-tag">LIVE</span>
          <p>{state.announcerLine}</p>
        </div>
      )}
    </div>
  )
}

function FighterMeter({
  fighter,
  align,
  phrases,
}: {
  fighter: FighterPublic
  align: 'left' | 'right'
  phrases: MatchState['activePhrases']
}) {
  const phrase = phrases.find((p) => p.corner === fighter.corner)
  const telegraph = phrase
    ? phrase.beats
        .filter((_, i) => !phrase.resolved.includes(i))
        .map((b) => shortMove(b.move))
        .join(' · ')
    : null

  return (
    <div className={`meter meter-${align} meter-${fighter.corner}`}>
      <div className="meter-name">
        <span>{fighter.name}</span>
        <span className="meter-status">
          {fighter.covering
            ? 'COVER'
            : fighter.connected
              ? fighter.ready
                ? 'READY'
                : 'LIVE'
              : 'OPEN'}
        </span>
      </div>
      <Bar label="HP" value={fighter.health} tone="health" />
      <Bar label="STM" value={fighter.stamina} tone="stamina" />
      {telegraph && <div className="phrase-telegraph">{telegraph}</div>}
      {fighter.knockedOut && <div className="ko-tag">BLOCK POPPED</div>}
    </div>
  )
}

function shortMove(move: string) {
  switch (move) {
    case 'punch_left':
      return 'L'
    case 'punch_right':
      return 'R'
    case 'jab':
      return 'J'
    case 'block':
      return 'BLK'
    case 'dodge':
      return 'SLIP'
    case 'taunt':
      return 'SHOW'
    default:
      return move
  }
}

function Bar({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'health' | 'stamina'
}) {
  return (
    <div className="bar">
      <span>{label}</span>
      <div className="bar-track">
        <div
          className={`bar-fill bar-${tone}`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  )
}

function phaseLabel(phase: FightPhase, state: MatchState) {
  switch (phase) {
    case 'lobby':
      return 'CLAIM A CORNER'
    case 'countdown':
      return 'FIGHT'
    case 'fighting':
      return 'DING DING'
    case 'between_rounds':
      return 'CORNER BREAK'
    case 'knockout':
      return 'KNOCKOUT'
    case 'decision':
      return 'JUDGES'
    case 'ended':
      return state.winner === 'draw' ? 'DRAW' : 'BOUT OVER'
  }
}
