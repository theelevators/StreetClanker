import { useCallback, useState } from 'react'
import type { MatchState } from '../types'

type Props = {
  state: MatchState
  watchUrl: string
  spectator?: boolean
  onNewBout?: () => void
  onDismiss?: () => void
}

export function EndCard({ state, watchUrl, spectator, onNewBout, onDismiss }: Props) {
  const [copied, setCopied] = useState(false)

  const method =
    state.winner === 'draw'
      ? 'DRAW'
      : state.phase === 'knockout' || state.red.knockedOut || state.blue.knockedOut
        ? 'KNOCKOUT'
        : 'DECISION'

  const headline =
    state.winner === 'draw'
      ? 'DRAW'
      : state.winner
        ? `${state[state.winner].name.toUpperCase()} WINS`
        : 'BOUT OVER'

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(watchUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }, [watchUrl])

  return (
    <div className="end-card" role="dialog" aria-label="Bout result">
      <div className="end-card-panel">
        <p className="end-card-method">{method}</p>
        <h2 className="end-card-headline">{headline}</h2>
        <p className="end-card-sub">
          {state.announcerLine ?? 'The neon goes quiet. The card is closed.'}
        </p>

        <div className="end-card-fighters">
          <div className={`end-card-corner red${state.winner === 'red' ? ' winner' : ''}`}>
            <span className="end-card-name">{state.red.name}</span>
            <span className="end-card-hp">{Math.max(0, Math.round(state.red.health))} HP</span>
          </div>
          <div className="end-card-vs">VS</div>
          <div className={`end-card-corner blue${state.winner === 'blue' ? ' winner' : ''}`}>
            <span className="end-card-name">{state.blue.name}</span>
            <span className="end-card-hp">{Math.max(0, Math.round(state.blue.health))} HP</span>
          </div>
        </div>

        <div className="end-card-meta">
          <span>HEAT {Math.round(state.cardHeat)}</span>
          <span>
            R{Math.max(1, state.round)}/{state.maxRounds}
          </span>
          <span className="end-card-id">#{state.id.slice(0, 8)}</span>
        </div>

        <div className="end-card-actions">
          <button type="button" className="claim red" onClick={copyLink}>
            {copied ? 'Link Copied' : 'Copy Watch Link'}
          </button>
          {!spectator && onNewBout && (
            <button type="button" className="ghost" onClick={onNewBout}>
              New Bout
            </button>
          )}
          {onDismiss && (
            <button type="button" className="ghost" onClick={onDismiss}>
              Stay on Ring
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
