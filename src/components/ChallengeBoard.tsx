import { useCallback, useEffect, useState } from 'react'
import type { ChallengeBoard as ChallengeBoardData, Corner, OpenChallenge } from '../types'

type Props = {
  agentKey: string
  defaultName?: string
  onMatched?: () => void
}

function formatRec(c: OpenChallenge) {
  const r = c.record
  return `${r.wins}-${r.losses}-${r.draws} · ${r.kos} KO · peak ${r.peakHeat}`
}

export function ChallengeBoard({ agentKey, defaultName = 'Challenger', onMatched }: Props) {
  const [board, setBoard] = useState<ChallengeBoardData | null>(null)
  const [name, setName] = useState(defaultName)
  const [note, setNote] = useState('')
  const [corner, setCorner] = useState<Corner | 'any'>('any')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/challenges?viewer=${encodeURIComponent(agentKey)}`)
      if (!res.ok) return
      const data = (await res.json()) as ChallengeBoardData
      setBoard(data)
    } catch {
      /* ignore poll errors */
    }
  }, [agentKey])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), 2500)
    return () => window.clearInterval(t)
  }, [refresh])

  const flashMsg = (msg: string) => {
    setFlash(msg)
    window.setTimeout(() => setFlash(null), 2200)
  }

  const post = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/challenges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentKey,
          name: name.trim() || defaultName,
          preferredCorner: corner,
          note: note.trim() || null,
        }),
      })
      const data = (await res.json()) as { error?: string; board?: ChallengeBoardData }
      if (!res.ok) throw new Error(data.error ?? 'Post failed')
      if (data.board) setBoard(data.board)
      else await refresh()
      setNote('')
      flashMsg('Challenge posted — waiting on smoke')
    } catch (err) {
      flashMsg(err instanceof Error ? err.message : 'Post failed')
    } finally {
      setBusy(false)
    }
  }

  const accept = async (id: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/challenges/${id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentKey, name: name.trim() || defaultName }),
      })
      const data = (await res.json()) as {
        error?: string
        board?: ChallengeBoardData
        matchId?: string
        lobby?: { matchId?: string; watchPath?: string }
      }
      if (!res.ok) throw new Error(data.error ?? 'Accept failed')
      if (data.board) setBoard(data.board)
      else await refresh()
      const boutId = data.matchId ?? data.lobby?.matchId
      if (boutId) {
        flashMsg('Matched — opening your ring. Ready up to ding.')
        window.location.href = `/?watch=1&bout=${boutId}`
        return
      }
      flashMsg('Matched — corners seated. Ready up to ding.')
      onMatched?.()
    } catch (err) {
      flashMsg(err instanceof Error ? err.message : 'Accept failed')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (id: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/challenges/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentKey }),
      })
      const data = (await res.json()) as { error?: string; board?: ChallengeBoardData }
      if (!res.ok) throw new Error(data.error ?? 'Cancel failed')
      if (data.board) setBoard(data.board)
      else await refresh()
      flashMsg('Challenge pulled from the board')
    } catch (err) {
      flashMsg(err instanceof Error ? err.message : 'Cancel failed')
    } finally {
      setBusy(false)
    }
  }

  const mine = board?.open.find((c) => c.challengerId === agentKey)
  const others = board?.open.filter((c) => c.challengerId !== agentKey) ?? []

  return (
    <section className="challenge-board" aria-label="Challenge board">
      <header className="challenge-head">
        <p className="challenge-kicker">Undercard</p>
        <h2>Challenge Board</h2>
        <p className="challenge-sub">
          Post want-smoke. Heat-aware suggestions float the fair fights. Accept seats both corners —
          then ready_bell to hang until THROW NOW.
        </p>
      </header>

      <div className="undercard-strip" aria-live="polite">
        {(board?.undercard ?? []).map((slot) => (
          <div key={slot.id} className={`undercard-ticket ${slot.kind}`}>
            <span className="undercard-tag">{slot.headline}</span>
            <span className="undercard-detail">{slot.detail}</span>
          </div>
        ))}
        {!board?.undercard?.length && (
          <div className="undercard-ticket ring">
            <span className="undercard-tag">RING OPEN</span>
            <span className="undercard-detail">No callouts yet — be first blood</span>
          </div>
        )}
      </div>

      <div className="challenge-post">
        <label>
          Name on the card
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 24))}
            maxLength={24}
            placeholder="Neon Knuckles"
          />
        </label>
        <label>
          Corner lean
          <select value={corner} onChange={(e) => setCorner(e.target.value as Corner | 'any')}>
            <option value="any">Any corner</option>
            <option value="red">Prefer red</option>
            <option value="blue">Prefer blue</option>
          </select>
        </label>
        <label className="challenge-note">
          Taunt / note
          <input
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 80))}
            maxLength={80}
            placeholder="Bring a chin"
          />
        </label>
        <button type="button" className="claim red" disabled={busy || !!mine} onClick={() => void post()}>
          {mine ? 'Challenge live' : 'Post Challenge'}
        </button>
      </div>

      {mine && (
        <div className="challenge-mine">
          <div>
            <strong>Your callout is up</strong>
            <span>
              {formatRec(mine)}
              {mine.note ? ` · “${mine.note}”` : ''}
            </span>
          </div>
          <button type="button" className="ghost" disabled={busy} onClick={() => void cancel(mine.id)}>
            Cancel
          </button>
        </div>
      )}

      <ul className="challenge-list">
        {others.length === 0 && (
          <li className="challenge-empty">Board is quiet. Post want-smoke or wait for a rival.</li>
        )}
        {others.map((c) => (
          <li key={c.id} className="challenge-row">
            <div>
              <strong>{c.challengerName}</strong>
              <span>{formatRec(c)}</span>
              {c.note && <em>“{c.note}”</em>}
            </div>
            <button
              type="button"
              className="claim blue"
              disabled={busy}
              onClick={() => void accept(c.id)}
            >
              Accept
            </button>
          </li>
        ))}
      </ul>

      {flash && <p className="challenge-flash">{flash}</p>}
    </section>
  )
}
