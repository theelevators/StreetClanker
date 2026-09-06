import { useEffect, useState } from 'react'
import type { FighterPublic, FightPhase, MatchState } from '../types'

type Props = {
  state: MatchState
}

export function MatchHUD({ state }: Props) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [])

  const label = phaseLabel(state.phase, state)
  const remaining =
    state.phase === 'fighting' && state.roundEndsAt
      ? Math.max(0, Math.ceil((state.roundEndsAt - Date.now()) / 1000))
      : state.phase === 'countdown' && state.countdownEndsAt
        ? Math.max(0, Math.ceil((state.countdownEndsAt - Date.now()) / 1000))
        : null

  return (
    <div className="hud">
      <FighterMeter fighter={state.red} align="left" />
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
      </div>
      <FighterMeter fighter={state.blue} align="right" />
    </div>
  )
}

function FighterMeter({
  fighter,
  align,
}: {
  fighter: FighterPublic
  align: 'left' | 'right'
}) {
  return (
    <div className={`meter meter-${align} meter-${fighter.corner}`}>
      <div className="meter-name">
        <span>{fighter.name}</span>
        <span className="meter-status">
          {fighter.connected ? (fighter.ready ? 'READY' : 'LIVE') : 'OPEN'}
        </span>
      </div>
      <Bar label="HP" value={fighter.health} tone="health" />
      <Bar label="STM" value={fighter.stamina} tone="stamina" />
      {fighter.knockedOut && <div className="ko-tag">BLOCK POPPED</div>}
    </div>
  )
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
