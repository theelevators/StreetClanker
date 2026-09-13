import { useCallback, useState } from 'react'
import { finiteStat } from '../../shared/combat.ts'
import type { FighterRecord, MatchState } from '../types'

type Props = {
  state: MatchState
  watchUrl: string
  spectator?: boolean
  onRematch?: () => void
  onNewBout?: () => void
  onReplay?: () => void
  onDismiss?: () => void
}

function formatRecord(record: FighterRecord | undefined | null): string {
  if (!record) return '0-0-0'
  return `${record.wins}-${record.losses}-${record.draws}`
}

function formatCardLine(name: string, record: FighterRecord | undefined | null): string {
  if (!record) return name
  return `${name} (${formatRecord(record)}, ${record.kos} KO, peak ${record.peakHeat})`
}

export function EndCard({
  state,
  watchUrl,
  spectator,
  onRematch,
  onNewBout,
  onReplay,
  onDismiss,
}: Props) {
  const [copied, setCopied] = useState<'link' | 'card' | null>(null)

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

  const shareCard = useCallback(() => {
    const red = formatCardLine(state.red.name, state.red.record)
    const blue = formatCardLine(state.blue.name, state.blue.record)
    let line: string
    if (state.winner === 'draw') {
      line = `${red} vs ${blue} ends in a DRAW`
    } else if (state.winner === 'red') {
      line = `${red} def. ${blue} by ${method}`
    } else if (state.winner === 'blue') {
      line = `${blue} def. ${red} by ${method}`
    } else {
      line = `${red} vs ${blue}`
    }
    return `${line} — watch: ${watchUrl}`
  }, [state, method, watchUrl])

  const copy = useCallback(
    async (mode: 'link' | 'card') => {
      try {
        await navigator.clipboard.writeText(mode === 'link' ? watchUrl : shareCard())
        setCopied(mode)
        window.setTimeout(() => setCopied(null), 1800)
      } catch {
        setCopied(null)
      }
    },
    [watchUrl, shareCard],
  )

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
            <span className="end-card-record">
              {formatRecord(state.red.record)}
              {state.red.record ? ` · ${state.red.record.kos} KO` : ''}
            </span>
            <span className="end-card-hp">{Math.max(0, Math.round(finiteStat(state.red.health, 0)))} HP</span>
          </div>
          <div className="end-card-vs">VS</div>
          <div className={`end-card-corner blue${state.winner === 'blue' ? ' winner' : ''}`}>
            <span className="end-card-name">{state.blue.name}</span>
            <span className="end-card-record">
              {formatRecord(state.blue.record)}
              {state.blue.record ? ` · ${state.blue.record.kos} KO` : ''}
            </span>
            <span className="end-card-hp">{Math.max(0, Math.round(finiteStat(state.blue.health, 0)))} HP</span>
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
          <button type="button" className="claim red" onClick={() => copy('card')}>
            {copied === 'card' ? 'Card Copied' : 'Copy Fighter Card'}
          </button>
          <button type="button" className="ghost" onClick={() => copy('link')}>
            {copied === 'link' ? 'Link Copied' : 'Copy Watch Link'}
          </button>
          {!spectator && onRematch && (
            <button type="button" className="ghost" onClick={onRematch}>
              Rematch
            </button>
          )}
          {!spectator && onNewBout && (
            <button type="button" className="ghost" onClick={onNewBout}>
              New Bout
            </button>
          )}
          {onReplay && (
            <button type="button" className="claim red" onClick={onReplay}>
              Watch Replay
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
