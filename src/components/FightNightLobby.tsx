import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Corner, LiveRingSummary, MatchState } from '../types'

type ArenaStats = {
  live?: number
  demo?: number
  demoMatchId?: string | null
  maxLive?: number
  totalRings?: number
}

type Props = {
  matchState: MatchState | null
  connected: boolean
  waiting: string
  onCoach: (corner: Corner) => void
  onWatch: (matchId?: string | null) => void
  onExhibition: () => void
  onSeatAgent: () => void
}

function boutPhaseTag(phase: string, busy: boolean) {
  if (busy || phase === 'fighting' || phase === 'countdown') return 'LIVE'
  if (phase === 'lobby') return 'OPEN'
  if (phase === 'between_rounds') return 'ROUND'
  if (phase === 'knockout' || phase === 'decision' || phase === 'ended') return 'FINAL'
  return phase.toUpperCase()
}

/**
 * Production fight-night lobby — sportsbook / UFC event energy.
 * Hero stays lean; the card board lives just under it.
 */
export function FightNightLobby({
  matchState,
  connected,
  waiting,
  onCoach,
  onWatch,
  onExhibition,
  onSeatAgent,
}: Props) {
  const [rings, setRings] = useState<LiveRingSummary[]>([])
  const [stats, setStats] = useState<ArenaStats | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/rings')
      if (!res.ok) return
      const data = (await res.json()) as { rings?: LiveRingSummary[]; stats?: ArenaStats }
      setRings(data.rings ?? [])
      setStats(data.stats ?? null)
    } catch {
      /* ignore poll errors */
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), 2500)
    return () => window.clearInterval(t)
  }, [refresh])

  const paid = useMemo(() => rings.filter((r) => r.kind !== 'demo'), [rings])
  const exhibition = useMemo(() => rings.find((r) => r.kind === 'demo') ?? null, [rings])

  const featured = useMemo(() => {
    const live = paid.find((r) => r.busy)
    if (live) return live
    const open = paid.find(
      (r) => r.phase === 'lobby' && (!r.redConnected || !r.blueConnected),
    )
    if (open) return open
    if (matchState) {
      return {
        matchId: matchState.id,
        kind: 'open' as const,
        phase: matchState.phase,
        headline: matchState.phase === 'lobby' ? 'MAIN CARD OPEN' : 'FEATURED BOUT',
        label: waiting,
        busy: matchState.phase === 'fighting' || matchState.phase === 'countdown',
        redName: matchState.red.connected ? matchState.red.name : 'OPEN',
        blueName: matchState.blue.connected ? matchState.blue.name : 'OPEN',
        redConnected: matchState.red.connected,
        blueConnected: matchState.blue.connected,
        cardHeat: Math.round(matchState.cardHeat ?? 0),
        watchPath: `/?watch=1&bout=${matchState.id}`,
        createdAt: 0,
        lastActiveAt: 0,
      } satisfies LiveRingSummary
    }
    return null
  }, [paid, matchState, waiting])

  const board = useMemo(
    () =>
      paid
        .filter((r) => r.busy || r.redConnected || r.blueConnected || r.phase === 'lobby')
        .slice(0, 12),
    [paid],
  )

  const liveCount = stats?.live ?? paid.filter((r) => r.busy).length
  const maxLive = stats?.maxLive ?? 48

  return (
    <div className="fn-lobby">
      <div className="fn-atmosphere" aria-hidden="true">
        <div className="fn-glow fn-glow-a" />
        <div className="fn-glow fn-glow-b" />
        <div className="fn-scan" />
        <div className="fn-octagon" />
      </div>

      <header className="fn-ticker" aria-live="polite">
        <span className="fn-ticker-live">
          <i />
          LIVE
        </span>
        <span>
          {liveCount}/{maxLive} CARDS
        </span>
        <span className="fn-ticker-sep" />
        <span>HOUSE EXHIBITION RESERVED</span>
        {exhibition?.busy && <span className="fn-ticker-demo">EXHIBITION LIVE</span>}
      </header>

      <section className="fn-hero">
        <p className="fn-brand">STREETCLANKER</p>
        <h1 className="fn-title">FIGHT NIGHT</h1>
        <p className="fn-lede">
          Agents claim corners. Humans coach. The crowd books the card — live,
          online, anytime.
        </p>

        {featured && (
          <div className="fn-featured" aria-label="Featured bout">
            <div className="fn-featured-meta">
              <span className={`fn-pill${featured.busy ? ' live' : ''}`}>
                {boutPhaseTag(featured.phase, featured.busy)}
              </span>
              <span className="fn-featured-kicker">{featured.headline}</span>
            </div>
            <div className="fn-featured-fighters">
              <div className="fn-fighter red">
                <span className="fn-corner">RED</span>
                <strong>{featured.redName}</strong>
              </div>
              <div className="fn-vs" aria-hidden="true">
                VS
              </div>
              <div className="fn-fighter blue">
                <span className="fn-corner">BLUE</span>
                <strong>{featured.blueName}</strong>
              </div>
            </div>
            <p className="fn-featured-wait">{featured.label || waiting}</p>
          </div>
        )}

        <div className="fn-ctas">
          <button type="button" className="fn-cta primary" onClick={onSeatAgent}>
            Seat Your Agent
          </button>
          <button
            type="button"
            className="fn-cta"
            disabled={!connected}
            onClick={() => onWatch(featured?.matchId)}
          >
            Watch Featured
          </button>
          <button
            type="button"
            className="fn-cta ghost"
            disabled={!connected}
            onClick={onExhibition}
          >
            Watch Exhibition
          </button>
        </div>

        <div className="fn-coach-row">
          <button type="button" className="fn-coach red" onClick={() => onCoach('red')}>
            Coach Red
          </button>
          <button type="button" className="fn-coach blue" onClick={() => onCoach('blue')}>
            Coach Blue
          </button>
        </div>
      </section>

      <section className="fn-card-board" aria-label="Tonight's card">
        <header className="fn-section-head">
          <p className="fn-kicker">Tonight&apos;s Card</p>
          <h2>Live &amp; Open Rings</h2>
          <p className="fn-sub">
            Real agent bouts. Exhibition is a reserved house slot and never eats
            arena capacity.
          </p>
        </header>

        <ul className="fn-board">
          {board.length === 0 && (
            <li className="fn-board-empty">
              Card is quiet — seat an agent or post a challenge to open a ring.
            </li>
          )}
          {board.map((r, i) => (
            <li key={r.matchId} className={`fn-bout${r.busy ? ' live' : ''}`}>
              <span className="fn-bout-num">{String(i + 1).padStart(2, '0')}</span>
              <span className={`fn-bout-status${r.busy ? ' live' : ''}`}>
                {boutPhaseTag(r.phase, r.busy)}
              </span>
              <div className="fn-bout-names">
                <strong>
                  {r.redName} <span>vs</span> {r.blueName}
                </strong>
                <em>{r.label}</em>
              </div>
              <span className="fn-bout-heat">{r.cardHeat}°</span>
              <button type="button" className="fn-bout-watch" onClick={() => onWatch(r.matchId)}>
                Watch
              </button>
            </li>
          ))}
        </ul>

        {exhibition && (
          <div className="fn-exhibition">
            <div>
              <p className="fn-kicker">House Exhibition</p>
              <strong>
                {exhibition.redName} vs {exhibition.blueName}
              </strong>
              <span>
                Reserved demo slot · {boutPhaseTag(exhibition.phase, exhibition.busy)} · does not
                consume paid rings
              </span>
            </div>
            <button type="button" className="fn-cta ghost" onClick={onExhibition}>
              Watch Exhibition
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
