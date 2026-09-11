import { useCallback, useEffect, useState } from 'react'
import type { Corner, CrowdLedgerSnapshot } from '../types'

type Props = {
  agentKey: string
  defaultName?: string
  compact?: boolean
}

const STAKE_PRESETS = [25, 50, 100, 250]

export function CrowdBook({ agentKey, defaultName = 'Crowd Fan', compact }: Props) {
  const [ledger, setLedger] = useState<CrowdLedgerSnapshot | null>(null)
  const [name, setName] = useState(defaultName)
  const [corner, setCorner] = useState<Corner>('red')
  const [stake, setStake] = useState(50)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/crowd?viewer=${encodeURIComponent(agentKey)}&name=${encodeURIComponent(name.trim() || defaultName)}`,
      )
      if (!res.ok) return
      setLedger((await res.json()) as CrowdLedgerSnapshot)
    } catch {
      /* ignore poll errors */
    }
  }, [agentKey, name, defaultName])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), 2500)
    return () => window.clearInterval(t)
  }, [refresh])

  const flashMsg = (msg: string) => {
    setFlash(msg)
    window.setTimeout(() => setFlash(null), 2200)
  }

  const placeBet = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/crowd/bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentKey,
          name: name.trim() || defaultName,
          corner,
          stake,
          matchId: ledger?.book.matchId,
        }),
      })
      const data = (await res.json()) as { error?: string; ledger?: CrowdLedgerSnapshot }
      if (!res.ok) throw new Error(data.error ?? 'Bet failed')
      if (data.ledger) setLedger(data.ledger)
      else await refresh()
      flashMsg(`Ticket locked — ${corner.toUpperCase()} @ stake ${stake}`)
    } catch (err) {
      flashMsg(err instanceof Error ? err.message : 'Bet failed')
    } finally {
      setBusy(false)
    }
  }

  const buyMod = async (kind: 'cheer' | 'banner' | 'heat_flare') => {
    setBusy(true)
    try {
      const res = await fetch('/api/crowd/mod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentKey,
          name: name.trim() || defaultName,
          kind,
          text: kind === 'banner' ? `${name.trim() || defaultName} owns the undercard` : null,
        }),
      })
      const data = (await res.json()) as { error?: string; ledger?: CrowdLedgerSnapshot }
      if (!res.ok) throw new Error(data.error ?? 'Mod failed')
      if (data.ledger) setLedger(data.ledger)
      else await refresh()
      flashMsg(kind === 'heat_flare' ? 'Heat flare popped' : kind === 'cheer' ? 'Cheer sent' : 'Banner up')
    } catch (err) {
      flashMsg(err instanceof Error ? err.message : 'Mod failed')
    } finally {
      setBusy(false)
    }
  }

  const book = ledger?.book
  const wallet = ledger?.wallet
  const open = book?.status === 'open'
  const myOpen = ledger?.myBets.find((b) => b.status === 'open' && b.matchId === book?.matchId)

  return (
    <section className={`crowd-book${compact ? ' compact' : ''}`} aria-label="Crowd book">
      <header className="crowd-book-head">
        <p className="crowd-book-kicker">Crowd Book</p>
        <h2>House Chips</h2>
        {!compact && (
          <p className="crowd-book-sub">
            Bet the moneyline before the bell. Cheap mods juice the card while you watch.
          </p>
        )}
      </header>

      <div className="crowd-wallet-row">
        <label>
          Bettor name
          <input
            value={name}
            maxLength={24}
            onChange={(e) => setName(e.target.value.slice(0, 24))}
            placeholder="Crowd Fan"
          />
        </label>
        <div className="crowd-chips" aria-live="polite">
          <span className="crowd-chips-label">BANKROLL</span>
          <strong>{wallet ? wallet.chips : '—'}</strong>
        </div>
      </div>

      <div className="crowd-odds" aria-live="polite">
        <div className={`crowd-odds-corner red${corner === 'red' ? ' picked' : ''}`}>
          <span className="crowd-odds-name">{book?.redName ?? 'RED'}</span>
          <strong>{book ? book.redOdds.toFixed(2) : '—'}</strong>
          <span className="crowd-odds-pool">pool {book?.redPool ?? 0}</span>
        </div>
        <div className="crowd-odds-status">
          <span>{(book?.status ?? 'closed').toUpperCase()}</span>
          <span className="crowd-odds-meta">{book?.betCount ?? 0} tickets</span>
        </div>
        <div className={`crowd-odds-corner blue${corner === 'blue' ? ' picked' : ''}`}>
          <span className="crowd-odds-name">{book?.blueName ?? 'BLUE'}</span>
          <strong>{book ? book.blueOdds.toFixed(2) : '—'}</strong>
          <span className="crowd-odds-pool">pool {book?.bluePool ?? 0}</span>
        </div>
      </div>

      {myOpen ? (
        <p className="crowd-ticket">
          Your ticket: <strong>{myOpen.corner.toUpperCase()}</strong> · {myOpen.stake} @{' '}
          {myOpen.odds.toFixed(2)}
        </p>
      ) : (
        <div className="crowd-bet-row">
          <div className="crowd-corner-picks">
            <button
              type="button"
              className={`claim red${corner === 'red' ? ' active' : ''}`}
              disabled={!open || busy}
              onClick={() => setCorner('red')}
            >
              Bet Red
            </button>
            <button
              type="button"
              className={`claim blue${corner === 'blue' ? ' active' : ''}`}
              disabled={!open || busy}
              onClick={() => setCorner('blue')}
            >
              Bet Blue
            </button>
          </div>
          <div className="crowd-stakes">
            {STAKE_PRESETS.map((s) => (
              <button
                key={s}
                type="button"
                className={`ghost stake${stake === s ? ' active' : ''}`}
                disabled={!open || busy}
                onClick={() => setStake(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="claim red wide"
            disabled={!open || busy}
            onClick={() => void placeBet()}
          >
            {open ? `Lock ${stake} on ${corner.toUpperCase()}` : 'Book locked / closed'}
          </button>
        </div>
      )}

      <div className="crowd-mods">
        <button type="button" className="ghost" disabled={busy} onClick={() => void buyMod('cheer')}>
          Cheer · 25
        </button>
        <button type="button" className="ghost" disabled={busy} onClick={() => void buyMod('banner')}>
          Banner · 15
        </button>
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={() => void buyMod('heat_flare')}
        >
          Heat Flare · 50
        </button>
      </div>

      {flash && <p className="crowd-flash">{flash}</p>}
    </section>
  )
}
