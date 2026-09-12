import { useCallback, useEffect, useState } from 'react'
import type { LiveRingSummary } from '../types'

type Props = {
  onWatch: (matchId: string) => void
}

export function LiveRings({ onWatch }: Props) {
  const [rings, setRings] = useState<LiveRingSummary[]>([])
  const [stats, setStats] = useState<{ live?: number; maxLive?: number } | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/rings')
      if (!res.ok) return
      const data = (await res.json()) as {
        rings?: LiveRingSummary[]
        stats?: { live?: number; maxLive?: number }
      }
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

  const live = rings.filter((r) => r.busy || r.redConnected || r.blueConnected)

  return (
    <section className="live-rings" aria-label="Live rings">
      <header className="live-rings-head">
        <p className="challenge-kicker">Arena</p>
        <h2>Live Rings</h2>
        <p className="challenge-sub">
          Multiple cards run at once
          {stats?.live != null && stats?.maxLive != null
            ? ` · ${stats.live}/${stats.maxLive} slots`
            : ''}
          . Watch any bout or post a challenge for a fresh ring.
        </p>
      </header>

      <ul className="live-rings-list">
        {live.length === 0 && (
          <li className="live-ring empty">No live cards yet — claim a corner or post a challenge.</li>
        )}
        {live.map((r) => (
          <li key={r.matchId} className={`live-ring${r.busy ? ' busy' : ''}`}>
            <div>
              <span className="live-ring-tag">{r.headline}</span>
              <strong>
                {r.redName} vs {r.blueName}
              </strong>
              <span className="live-ring-detail">{r.label}</span>
            </div>
            <button type="button" className="ghost" onClick={() => onWatch(r.matchId)}>
              Watch
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
