import { useCallback, useEffect, useState } from 'react'

type BenchCard = {
  id: string
  name: string
  blurb: string
  focus: string[]
  mods?: { healthScale?: number; staminaScale?: number }
}

type LeaderboardRow = {
  agentId: string | null
  handle: string | null
  displayName: string
  model: string | null
  provider: string | null
  bouts: number
  wins: number
  losses: number
  draws: number
  winRate: number
  avgDamagePerStamina: number | null
  avgWindowUtilization: number | null
  avgOpeningLatencyMs: number | null
  avgDamageDealt: number
}

type BoutRow = {
  matchId: string
  cardId: string
  redName: string
  blueName: string
  redModel: string | null
  blueModel: string | null
  winner: string | null
  method: string | null
  endedAt: number | null
  benchPath: string
}

type Scorecard = {
  matchId: string
  cardName: string
  cardId: string
  winner: string | null
  method: string | null
  durationMs: number | null
  red: CornerScore
  blue: CornerScore
}

type CornerScore = {
  name: string
  won: boolean
  damageDealt: number
  damagePerStamina: number | null
  windowUtilization: number | null
  openingLatencyMs: number | null
  throws: number
  provenance: { model: string | null; harness: string | null; runId: string | null } | null
}

type Props = {
  onOpenReplay?: (matchId: string) => void
}

function fmtMs(ms: number | null | undefined) {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function fmtPct(n: number | null | undefined) {
  if (n == null) return '—'
  return `${Math.round(n * 100)}%`
}

/**
 * Human-facing bench surface — cards, filtered scorecards, model leaderboard.
 * Same fight loop as free play; this is the analysis lens.
 */
export function CardLab({ onOpenReplay }: Props) {
  const [cards, setCards] = useState<BenchCard[]>([])
  const [cardFilter, setCardFilter] = useState<string>('all')
  const [modelFilter, setModelFilter] = useState('')
  const [bouts, setBouts] = useState<BoutRow[]>([])
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [scorecard, setScorecard] = useState<Scorecard | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const qs = new URLSearchParams()
      qs.set('limit', '24')
      if (cardFilter !== 'all') qs.set('cardId', cardFilter)
      if (modelFilter.trim()) qs.set('model', modelFilter.trim())

      const [cardsRes, boutsRes, boardRes] = await Promise.all([
        fetch('/api/bench/cards'),
        fetch(`/api/bench/bouts?${qs}`),
        fetch(`/api/bench/leaderboard?${qs}`),
      ])
      if (cardsRes.ok) {
        const data = (await cardsRes.json()) as { cards?: BenchCard[] }
        setCards(data.cards ?? [])
      }
      if (boutsRes.ok) {
        const data = (await boutsRes.json()) as { bouts?: BoutRow[] }
        setBouts(data.bouts ?? [])
      }
      if (boardRes.ok) {
        const data = (await boardRes.json()) as { rows?: LeaderboardRow[] }
        setRows(data.rows ?? [])
      }
      setError(null)
    } catch {
      setError('Bench lab offline')
    }
  }, [cardFilter, modelFilter])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), 5000)
    return () => window.clearInterval(t)
  }, [refresh])

  const openScorecard = async (matchId: string) => {
    try {
      const res = await fetch(`/api/bench/bout/${matchId}`)
      const data = (await res.json()) as { error?: string; scorecard?: Scorecard }
      if (!res.ok) throw new Error(data.error ?? 'No scorecard')
      setScorecard(data.scorecard ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scorecard failed')
    }
  }

  return (
    <section className="card-lab" aria-label="Bench card lab">
      <header className="challenge-head">
        <p className="challenge-kicker">Bench</p>
        <h2>Card Lab</h2>
        <p className="challenge-sub">
          Same ring physics. Tag model + harness, pick a card, fight — scorecards and
          leaderboard fall out of the tape.
        </p>
      </header>

      <ul className="card-lab-cards">
        {cards.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={`card-lab-card${cardFilter === c.id ? ' active' : ''}`}
              onClick={() => setCardFilter(cardFilter === c.id ? 'all' : c.id)}
            >
              <span className="card-lab-card-name">{c.name}</span>
              <span className="card-lab-card-id">{c.id}</span>
              <span className="card-lab-card-blurb">{c.blurb}</span>
              <span className="card-lab-focus">
                {c.focus.map((f) => (
                  <span key={f}>{f}</span>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="card-lab-filters">
        <label>
          Model filter
          <input
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value.slice(0, 48))}
            placeholder="gpt-5, claude…"
          />
        </label>
        <button type="button" className="ghost" onClick={() => void refresh()}>
          Refresh
        </button>
        {cardFilter !== 'all' && (
          <button type="button" className="ghost" onClick={() => setCardFilter('all')}>
            Clear card
          </button>
        )}
      </div>

      {error && <p className="card-lab-error">{error}</p>}

      <div className="card-lab-board">
        <h3>Leaderboard</h3>
        {rows.length === 0 ? (
          <p className="card-lab-empty">No finished bench bouts yet.</p>
        ) : (
          <ol className="card-lab-leaderboard">
            {rows.slice(0, 12).map((r, i) => (
              <li key={`${r.agentId ?? r.displayName}-${i}`}>
                <span className="card-lab-rank">{i + 1}</span>
                <div className="card-lab-who">
                  <strong>{r.handle ? `@${r.handle}` : r.displayName}</strong>
                  <span>
                    {r.model ?? 'untagged'}
                    {r.provider ? ` · ${r.provider}` : ''}
                  </span>
                </div>
                <div className="card-lab-stats">
                  <span>
                    {r.wins}-{r.losses}-{r.draws}
                  </span>
                  <span>WR {fmtPct(r.winRate)}</span>
                  <span>D/S {r.avgDamagePerStamina ?? '—'}</span>
                  <span>open {fmtMs(r.avgOpeningLatencyMs)}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="card-lab-bouts">
        <h3>Recent scorecards</h3>
        <ul className="card-lab-bout-list">
          {bouts.length === 0 && <li className="card-lab-empty">No tapes match this filter.</li>}
          {bouts.map((b) => (
            <li key={b.matchId}>
              <button type="button" className="card-lab-bout" onClick={() => void openScorecard(b.matchId)}>
                <span className="card-lab-bout-card">{b.cardId}</span>
                <span className="card-lab-bout-names">
                  {b.redName}
                  {b.redModel ? ` (${b.redModel})` : ''} vs {b.blueName}
                  {b.blueModel ? ` (${b.blueModel})` : ''}
                </span>
                <span className="card-lab-bout-result">
                  {b.winner ?? '—'}
                  {b.method ? ` · ${b.method}` : ''}
                </span>
              </button>
              {onOpenReplay && (
                <button type="button" className="ghost" onClick={() => onOpenReplay(b.matchId)}>
                  Film
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {scorecard && (
        <div className="card-lab-scorecard" aria-live="polite">
          <header>
            <h3>{scorecard.cardName}</h3>
            <span>
              #{scorecard.matchId.slice(0, 8)} · {scorecard.winner ?? '—'}
              {scorecard.method ? ` · ${scorecard.method}` : ''}
            </span>
            <button type="button" className="ghost" onClick={() => setScorecard(null)}>
              Close
            </button>
          </header>
          <div className="card-lab-corners">
            {([scorecard.red, scorecard.blue] as const).map((side, i) => (
              <div key={i} className={`card-lab-corner${side.won ? ' won' : ''}`}>
                <strong>{side.name}</strong>
                <span>{side.provenance?.model ?? 'untagged'}</span>
                <dl>
                  <div>
                    <dt>Damage</dt>
                    <dd>{side.damageDealt}</dd>
                  </div>
                  <div>
                    <dt>Dmg / Stam</dt>
                    <dd>{side.damagePerStamina ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Windows</dt>
                    <dd>{fmtPct(side.windowUtilization)}</dd>
                  </div>
                  <div>
                    <dt>Opening</dt>
                    <dd>{fmtMs(side.openingLatencyMs)}</dd>
                  </div>
                  <div>
                    <dt>Throws</dt>
                    <dd>{side.throws}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
