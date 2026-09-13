import { useEffect, useRef, useState } from 'react'
import type { ActivePhrase, FighterPublic, FightPhase, MatchState } from '../types'
import { MAX_STAMINA } from '../../shared/combat.ts'

type Props = {
  state: MatchState
}

export function MatchHUD({ state }: Props) {
  const [, setTick] = useState(0)
  const prevHeat = useRef(state.cardHeat ?? 0)
  const [heatSpike, setHeatSpike] = useState(false)

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 100)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const heat = state.cardHeat ?? 0
    if (heat - prevHeat.current >= 4) {
      setHeatSpike(true)
      const t = window.setTimeout(() => setHeatSpike(false), 480)
      prevHeat.current = heat
      return () => window.clearTimeout(t)
    }
    prevHeat.current = heat
  }, [state.cardHeat, state.announcerLineAt])

  const label = phaseLabel(state.phase, state)
  const remaining =
    state.phase === 'fighting' && state.roundEndsAt
      ? Math.max(0, Math.ceil((state.roundEndsAt - Date.now()) / 1000))
      : (state.phase === 'countdown' || state.phase === 'between_rounds') &&
          state.countdownEndsAt
        ? Math.max(0, Math.ceil((state.countdownEndsAt - Date.now()) / 1000))
        : null

  const announcerFresh =
    state.announcerLine &&
    state.announcerLineAt &&
    Date.now() - state.announcerLineAt < 4200

  const heat = Math.max(0, Math.min(100, state.cardHeat ?? 0))
  const phrases = state.activePhrases ?? []
  const impactFresh =
    state.lastImpact && Date.now() - state.lastImpact.at < 380
      ? state.lastImpact
      : null

  return (
    <div
      className={`hud-stack${impactFresh?.result === 'hit' ? ' hud-hit-flash' : ''}${
        heatSpike ? ' hud-heat-spike' : ''
      }`}
    >
      <div className="hud">
        <FighterMeter
          fighter={state.red}
          align="left"
          phrases={phrases}
          impact={impactFresh}
        />
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
            className={`card-heat${heat >= 70 ? ' card-heat-hot' : ''}${
              heatSpike ? ' card-heat-spike' : ''
            }`}
            style={{ ['--heat' as string]: `${heat}%` }}
            aria-label={`Card heat ${Math.round(heat)}`}
          >
            <span className="card-heat-label">HEAT</span>
            <div className="card-heat-track">
              <div className="card-heat-fill" />
            </div>
            <span className="card-heat-val">{Math.round(heat)}</span>
          </div>
        </div>
        <FighterMeter
          fighter={state.blue}
          align="right"
          phrases={phrases}
          impact={impactFresh}
        />
      </div>

      <div
        className={`announcer-slot${announcerFresh ? ' is-live' : ''}`}
        aria-live="polite"
      >
        {announcerFresh ? (
          <div className="announcer-banner" key={state.announcerLineAt}>
            <span className="announcer-tag">LIVE</span>
            <p>{state.announcerLine}</p>
          </div>
        ) : (
          <div className="announcer-banner is-idle" aria-hidden="true">
            <span className="announcer-tag">LIVE</span>
            <p>Waiting on the next call…</p>
          </div>
        )}
      </div>
    </div>
  )
}

function FighterMeter({
  fighter,
  align,
  phrases,
  impact,
}: {
  fighter: FighterPublic
  align: 'left' | 'right'
  phrases: ActivePhrase[]
  impact: MatchState['lastImpact']
}) {
  const now = Date.now()
  const phrase = phrases.find((p) => p.corner === fighter.corner)
  const windowMs =
    fighter.nextWindowAt != null ? Math.max(0, fighter.nextWindowAt - now) : null
  const windowOpen =
    !fighter.covering &&
    !phrase &&
    (windowMs == null || windowMs <= 160)

  const gotHit =
    impact &&
    impact.defender === fighter.corner &&
    impact.result === 'hit'
  const slipped =
    impact &&
    impact.defender === fighter.corner &&
    impact.result === 'dodged'

  let status = 'OPEN'
  if (fighter.knockedOut) status = 'DOWN'
  else if (fighter.covering) status = 'COVER'
  else if (phrase) status = phrase.style.toUpperCase()
  else if (windowOpen && fighter.connected) status = 'WINDOW'
  else if (fighter.connected) status = fighter.ready ? 'READY' : 'LIVE'

  return (
    <div
      className={`meter meter-${align} meter-${fighter.corner}${
        gotHit ? ' meter-hit' : ''
      }${slipped ? ' meter-slip' : ''}${fighter.covering ? ' meter-cover' : ''}`}
    >
      <div className="meter-name">
        <span>{fighter.name}</span>
        <span className={`meter-status status-${status.toLowerCase()}`}>{status}</span>
      </div>
      <Bar label="HP" value={fighter.health} max={fighter.maxHealth} tone="health" />
      <Bar label="STM" value={fighter.stamina} max={fighter.maxStamina ?? MAX_STAMINA} tone="stamina" />
      {fighter.comboCount > 1 && (
        <div className="combo-chip" aria-live="polite">
          <span className="combo-count">{fighter.comboCount} HIT</span>
          {fighter.comboLabel && <span className="combo-label">{fighter.comboLabel}</span>}
        </div>
      )}

      {phrase ? (
        <div className={`phrase-telegraph style-${phrase.style}`}>
          <span className="phrase-style">{phrase.style}</span>
          <div className="phrase-beats">
            {phrase.beats.map((beat, i) => {
              const resolved = phrase.resolved.includes(i)
              const next =
                !resolved && phrase.resolved.length === i
              const eta = Math.max(0, beat.at - now)
              return (
                <span
                  key={`${phrase.id}-${i}`}
                  className={`phrase-beat${resolved ? ' is-resolved' : ''}${
                    next ? ' is-next' : ''
                  }`}
                  style={
                    next
                      ? { ['--beat-eta' as string]: `${Math.min(1, eta / 320)}` }
                      : undefined
                  }
                >
                  {shortMove(beat.move)}
                </span>
              )
            })}
          </div>
        </div>
      ) : windowMs != null && windowMs > 0 && fighter.connected ? (
        <div className="window-countdown">
          WINDOW {Math.ceil(windowMs / 100) / 10}s
        </div>
      ) : windowOpen && fighter.connected ? (
        <div className="window-open">THROW IT</div>
      ) : null}

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
  max = 100,
  tone,
}: {
  label: string
  value: number
  max?: number
  tone: 'health' | 'stamina'
}) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100))
  return (
    <div className="bar">
      <span>
        {label}{' '}
        <em className="bar-value">
          {Math.round(value)}
          {`/${Math.round(max)}`}
        </em>
      </span>
      <div className="bar-track">
        <div className={`bar-fill bar-${tone}`} style={{ width: `${pct}%` }} />
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
      return 'COACH YOUR AGENT'
    case 'knockout':
      return 'KNOCKOUT'
    case 'decision':
      return 'JUDGES'
    case 'ended':
      return state.winner === 'draw' ? 'DRAW' : 'BOUT OVER'
  }
}
