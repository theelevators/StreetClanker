import { useCallback, useEffect, useMemo, useState } from 'react'

export type BoutTapeCard = {
  matchId: string
  startedAt: number
  endedAt: number | null
  redName: string
  blueName: string
  winner: 'red' | 'blue' | 'draw' | null
  method: 'knockout' | 'decision' | 'draw' | null
  eventCount: number
  live: boolean
  replayPath: string
}

type TapeEvent = {
  at: number
  kind: string
  agentId?: string
  corner?: 'red' | 'blue'
  tool?: string
  text?: string
  detail?: Record<string, unknown>
}

type FullTape = {
  matchId: string
  startedAt: number
  endedAt: number | null
  red: { id: string | null; name: string } | null
  blue: { id: string | null; name: string } | null
  events: TapeEvent[]
  result: {
    winner: 'red' | 'blue' | 'draw' | null
    method: string
    shareText?: string
  } | null
}

type Props = {
  /** Open a specific bout on mount (from EndCard / URL). */
  initialMatchId?: string | null
  onWatchLive?: (matchId: string) => void
}

function formatWhen(ts: number | null) {
  if (!ts) return 'live'
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

function eventLine(e: TapeEvent) {
  if (e.text) return e.text
  if (e.tool) return `${e.kind}: ${e.tool}`
  if (e.kind === 'impact' && e.detail) {
    const dmg = e.detail.damage ?? e.detail.dmg
    const move = e.detail.move ?? e.detail.action
    return `impact ${move ?? ''} ${dmg != null ? `· ${dmg}` : ''}`.trim()
  }
  return e.kind
}

/**
 * Shelf of recorded bouts + a scrubber that plays the match tape so humans
 * (and agents) can watch what happened after the bell.
 */
export function ReplayShelf({ initialMatchId = null, onWatchLive }: Props) {
  const [bouts, setBouts] = useState<BoutTapeCard[]>([])
  const [activeId, setActiveId] = useState<string | null>(initialMatchId)
  const [tape, setTape] = useState<FullTape | null>(null)
  const [cursor, setCursor] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/bouts?limit=20')
      if (!res.ok) return
      const data = (await res.json()) as { bouts?: BoutTapeCard[] }
      setBouts(data.bouts ?? [])
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), 5000)
    return () => window.clearInterval(t)
  }, [refresh])

  useEffect(() => {
    if (initialMatchId) setActiveId(initialMatchId)
  }, [initialMatchId])

  const loadTape = useCallback(async (matchId: string) => {
    setError(null)
    setPlaying(false)
    setCursor(0)
    try {
      const res = await fetch(`/api/bout/${encodeURIComponent(matchId)}/tape/full`)
      const data = (await res.json()) as { error?: string; tape?: FullTape }
      if (!res.ok || !data.tape) throw new Error(data.error ?? 'Tape not found')
      setTape(data.tape)
      setActiveId(matchId)
      setCursor(Math.max(0, data.tape.events.length - 1))
    } catch (err) {
      setTape(null)
      setError(err instanceof Error ? err.message : 'Failed to load tape')
    }
  }, [])

  useEffect(() => {
    if (activeId) void loadTape(activeId)
  }, [activeId, loadTape])

  useEffect(() => {
    if (!playing || !tape || tape.events.length === 0) return
    const id = window.setInterval(() => {
      setCursor((c) => {
        if (c >= tape.events.length - 1) {
          setPlaying(false)
          return c
        }
        return c + 1
      })
    }, 420)
    return () => window.clearInterval(id)
  }, [playing, tape])

  const visible = useMemo(() => {
    if (!tape) return []
    return tape.events.slice(0, cursor + 1)
  }, [tape, cursor])

  const headline = useMemo(() => {
    if (!tape) return null
    const red = tape.red?.name ?? 'RED'
    const blue = tape.blue?.name ?? 'BLUE'
    if (!tape.result) return `${red} vs ${blue} · LIVE TAPE`
    if (tape.result.winner === 'draw') return `${red} vs ${blue} · DRAW`
    if (tape.result.winner === 'red') return `${red} def. ${blue}`
    if (tape.result.winner === 'blue') return `${blue} def. ${red}`
    return `${red} vs ${blue}`
  }, [tape])

  return (
    <section className="replay-shelf" aria-label="Bout replays">
      <header className="replay-shelf-head">
        <p className="challenge-kicker">Replays</p>
        <h2>Watch the Tape</h2>
        <p className="challenge-sub">
          Finished cards land here. Scrub the tool tape — claims, lobby talk,
          throws, impacts — like a fight film room.
        </p>
      </header>

      <ul className="replay-list">
        {bouts.length === 0 && (
          <li className="replay-empty">No tapes yet — finish a bout to record one.</li>
        )}
        {bouts.map((b) => (
          <li
            key={b.matchId}
            className={`replay-row${activeId === b.matchId ? ' active' : ''}${b.live ? ' live' : ''}`}
          >
            <button type="button" className="replay-pick" onClick={() => setActiveId(b.matchId)}>
              <span className="replay-tag">
                {b.live ? 'LIVE' : (b.method ?? 'BOUT').toUpperCase()}
              </span>
              <strong>
                {b.redName} vs {b.blueName}
              </strong>
              <span className="replay-meta">
                {formatWhen(b.endedAt ?? b.startedAt)} · {b.eventCount} events
              </span>
            </button>
            {b.live && onWatchLive && (
              <button type="button" className="ghost" onClick={() => onWatchLive(b.matchId)}>
                Live
              </button>
            )}
          </li>
        ))}
      </ul>

      {error && <p className="replay-error">{error}</p>}

      {tape && (
        <div className="replay-viewer" aria-live="polite">
          <div className="replay-viewer-head">
            <h3>{headline}</h3>
            <span className="replay-id">#{tape.matchId.slice(0, 8)}</span>
          </div>

          <div className="replay-controls">
            <button
              type="button"
              className="ghost"
              onClick={() => setCursor((c) => Math.max(0, c - 1))}
              disabled={cursor <= 0}
            >
              Prev
            </button>
            <button
              type="button"
              className="claim red"
              onClick={() => setPlaying((p) => !p)}
              disabled={tape.events.length === 0}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() =>
                setCursor((c) => Math.min(tape.events.length - 1, c + 1))
              }
              disabled={cursor >= tape.events.length - 1}
            >
              Next
            </button>
            <label className="replay-scrub">
              <span>
                {tape.events.length === 0
                  ? '0/0'
                  : `${cursor + 1}/${tape.events.length}`}
              </span>
              <input
                type="range"
                min={0}
                max={Math.max(0, tape.events.length - 1)}
                value={cursor}
                onChange={(e) => {
                  setPlaying(false)
                  setCursor(Number(e.target.value))
                }}
              />
            </label>
          </div>

          <ol className="replay-events">
            {visible.length === 0 && <li className="replay-empty">Empty tape.</li>}
            {visible.map((e, i) => (
              <li
                key={`${e.at}-${i}`}
                className={`replay-event ${e.kind}${i === visible.length - 1 ? ' current' : ''}${e.corner ? ` ${e.corner}` : ''}`}
              >
                <span className="replay-event-kind">{e.kind}</span>
                <span className="replay-event-text">{eventLine(e)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}
