import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  frameAtTime,
  materializeReplayState,
  type ReplayFrame,
} from '../../shared/replay.ts'
import type { MatchState } from '../types'
import { Arena } from './Arena'
import { MatchHUD } from './MatchHUD'

export type BoutTapeCard = {
  matchId: string
  startedAt: number
  endedAt: number | null
  redName: string
  blueName: string
  winner: 'red' | 'blue' | 'draw' | null
  method: 'knockout' | 'decision' | 'draw' | null
  eventCount: number
  frameCount?: number
  hasFilm?: boolean
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
  frames?: ReplayFrame[]
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

function formatClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Shelf of recorded bouts + TV rematch — re-applies ring film onto Arena
 * so humans can watch the fight later like a delayed broadcast.
 */
export function ReplayShelf({ initialMatchId = null, onWatchLive }: Props) {
  const [bouts, setBouts] = useState<BoutTapeCard[]>([])
  const [activeId, setActiveId] = useState<string | null>(initialMatchId)
  const [tape, setTape] = useState<FullTape | null>(null)
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
    try {
      const res = await fetch(`/api/bout/${encodeURIComponent(matchId)}/tape/full`)
      const data = (await res.json()) as { error?: string; tape?: FullTape }
      if (!res.ok || !data.tape) throw new Error(data.error ?? 'Tape not found')
      setTape(data.tape)
      setActiveId(matchId)
    } catch (err) {
      setTape(null)
      setError(err instanceof Error ? err.message : 'Failed to load tape')
    }
  }, [])

  useEffect(() => {
    if (activeId) void loadTape(activeId)
  }, [activeId, loadTape])

  const frames = tape?.frames ?? []
  const hasFilm = frames.length > 0

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
        <h2>Rewatch the Card</h2>
        <p className="challenge-sub">
          Finished bouts leave a ring film. Hit play and watch the match on the
          canvas — same Arena, same HUD, like putting the fight on TV two hours later.
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
                {b.hasFilm || (b.frameCount ?? 0) > 0 ? ' · FILM' : ''}
              </span>
              <strong>
                {b.redName} vs {b.blueName}
              </strong>
              <span className="replay-meta">
                {formatWhen(b.endedAt ?? b.startedAt)}
                {b.frameCount != null
                  ? ` · ${b.frameCount} frames`
                  : ` · ${b.eventCount} events`}
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

      {tape && hasFilm && (
        <ReplayTheater
          key={tape.matchId}
          frames={frames}
          headline={headline ?? 'REPLAY'}
          matchId={tape.matchId}
        />
      )}

      {tape && !hasFilm && (
        <div className="replay-viewer" aria-live="polite">
          <div className="replay-viewer-head">
            <h3>{headline}</h3>
            <span className="replay-id">#{tape.matchId.slice(0, 8)}</span>
          </div>
          <p className="replay-empty">
            This bout was taped before ring film — only the event log exists. Run a
            fresh card to get a watchable rematch.
          </p>
          <EventLogFallback events={tape.events} />
        </div>
      )}
    </section>
  )
}

function ReplayTheater({
  frames,
  headline,
  matchId,
}: {
  frames: ReplayFrame[]
  headline: string
  matchId: string
}) {
  const t0 = frames[0]!.at
  const t1 = frames[frames.length - 1]!.at
  const duration = Math.max(1, t1 - t0)

  const [tapeTime, setTapeTime] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [wallTick, setWallTick] = useState(0)
  const playingRef = useRef(playing)
  playingRef.current = playing

  useEffect(() => {
    const id = window.setInterval(() => setWallTick((n) => n + 1), 100)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = (now - last) * speed
      last = now
      setTapeTime((t) => {
        const next = t + dt
        if (next >= duration) {
          setPlaying(false)
          return duration
        }
        return next
      })
      raf = window.requestAnimationFrame(loop)
    }
    raf = window.requestAnimationFrame(loop)
    return () => window.cancelAnimationFrame(raf)
  }, [playing, speed, duration])

  const tapeAbsolute = t0 + tapeTime
  const frame = frameAtTime(frames, tapeAbsolute)
  const state: MatchState | null = useMemo(() => {
    if (!frame) return null
    return materializeReplayState(frame, tapeAbsolute)
    // wallTick forces rematerialize while paused so HUD clocks stay frozen correctly
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, tapeAbsolute, wallTick])

  const restart = () => {
    setTapeTime(0)
    setPlaying(true)
  }

  return (
    <div className="replay-theater" aria-label="Ring rematch viewer">
      <div className="replay-theater-head">
        <div>
          <span className="replay-broadcast-tag">REPLAY</span>
          <h3>{headline}</h3>
        </div>
        <span className="replay-id">#{matchId.slice(0, 8)}</span>
      </div>

      <div className="replay-tv">
        {state ? (
          <div className="replay-tv-stage fight-screen spectator">
            <div className="ring-stage">
              <Arena state={state} />
              <div className="ring-overlay">
                <header className="ring-chrome">
                  <div className="ring-brand">
                    <span className="ring-logo">STREETCLANKER</span>
                    <span className="ring-live">
                      <i className="on" />
                      REPLAY
                    </span>
                  </div>
                </header>
                <MatchHUD state={state} />
                <footer className="ring-ticker" aria-live="off">
                  {state.eventLog.slice(0, 3).map((e, i) => (
                    <span key={`${e}-${i}`}>{e}</span>
                  ))}
                </footer>
              </div>
            </div>
          </div>
        ) : (
          <p className="replay-empty">No film frames.</p>
        )}
      </div>

      <div className="replay-controls">
        <button type="button" className="ghost" onClick={restart}>
          Restart
        </button>
        <button
          type="button"
          className="claim red"
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <div className="replay-speeds" role="group" aria-label="Playback speed">
          {[0.5, 1, 1.5, 2].map((s) => (
            <button
              key={s}
              type="button"
              className={`ghost${speed === s ? ' active' : ''}`}
              onClick={() => setSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>
        <label className="replay-scrub">
          <span>
            {formatClock(tapeTime)} / {formatClock(duration)}
          </span>
          <input
            type="range"
            min={0}
            max={duration}
            step={50}
            value={Math.min(tapeTime, duration)}
            onChange={(e) => {
              setPlaying(false)
              setTapeTime(Number(e.target.value))
            }}
          />
        </label>
      </div>
    </div>
  )
}

function EventLogFallback({ events }: { events: TapeEvent[] }) {
  const [cursor, setCursor] = useState(Math.max(0, events.length - 1))
  const visible = events.slice(0, cursor + 1)

  return (
    <>
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
          className="ghost"
          onClick={() => setCursor((c) => Math.min(events.length - 1, c + 1))}
          disabled={cursor >= events.length - 1}
        >
          Next
        </button>
        <label className="replay-scrub">
          <span>
            {events.length === 0 ? '0/0' : `${cursor + 1}/${events.length}`}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(0, events.length - 1)}
            value={cursor}
            onChange={(e) => setCursor(Number(e.target.value))}
          />
        </label>
      </div>
      <ol className="replay-events">
        {visible.map((e, i) => (
          <li
            key={`${e.at}-${i}`}
            className={`replay-event ${e.kind}${i === visible.length - 1 ? ' current' : ''}${e.corner ? ` ${e.corner}` : ''}`}
          >
            <span className="replay-event-kind">{e.kind}</span>
            <span className="replay-event-text">{e.text ?? e.tool ?? e.kind}</span>
          </li>
        ))}
      </ol>
    </>
  )
}
