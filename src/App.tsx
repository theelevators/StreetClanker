import { useCallback, useMemo, useState } from 'react'
import { Arena } from './components/Arena'
import { CoachPanel } from './components/CoachPanel'
import { FightChat } from './components/FightChat'
import { MatchHUD } from './components/MatchHUD'
import { agentHttp, useWebMCP } from './hooks/useWebMCP'
import { useMatchSocket } from './hooks/useMatchSocket'
import type { Corner, FightAction, PhraseBeatInput, PhraseStyle } from './types'

function makeAgentKey() {
  const existing = sessionStorage.getItem('boxclub-agent-key')
  if (existing) return existing
  const key = `agent-${crypto.randomUUID().slice(0, 8)}`
  sessionStorage.setItem('boxclub-agent-key', key)
  return key
}

type Drawer = 'none' | 'coach' | 'mic'

export default function App() {
  const match = useMatchSocket()
  const [coachCorner, setCoachCorner] = useState<Corner | null>(null)
  const [coachName] = useState('Coach')
  const [entered, setEntered] = useState(false)
  const [drawer, setDrawer] = useState<Drawer>('none')
  const agentKey = useMemo(() => makeAgentKey(), [])
  const stateRef = useMemo(() => ({ current: match.state }), [])
  stateRef.current = match.state

  const sendAgent = useMemo(
    () => ({
      join: (corner: Corner, name: string) =>
        agentHttp('claim_corner', { agentKey, corner, name }),
      ready: () => agentHttp('ready_up', { agentKey }),
      action: (action: FightAction) => {
        if (action === 'block') return agentHttp('block', { agentKey })
        if (action === 'dodge') return agentHttp('dodge', { agentKey })
        return agentHttp('punch', { agentKey, style: action })
      },
      throwPhrase: (style: PhraseStyle | undefined, beats: PhraseBeatInput[]) =>
        agentHttp('throw_phrase', { agentKey, style, beats }),
      trashTalk: (text: string) => agentHttp('trash_talk', { agentKey, text }),
      listenCoach: () => agentHttp('listen_coach', { agentKey }),
      brief: () => agentHttp('get_match_state', { agentKey }),
    }),
    [agentKey],
  )

  const webmcp = useWebMCP({
    getState: () => stateRef.current,
    agentKey,
    sendAgent,
  })

  const claimCoach = useCallback(
    (corner: Corner) => {
      setCoachCorner(corner)
      match.joinAsCoach(corner, coachName)
      setEntered(true)
      setDrawer('coach')
    },
    [match, coachName],
  )

  const toggleDrawer = useCallback((next: Drawer) => {
    setDrawer((prev) => (prev === next ? 'none' : next))
  }, [])

  if (!entered) {
    return (
      <div className="title-screen">
        <div className="title-stage" aria-hidden="true">
          <div className="title-glow" />
          <div className="title-grid" />
          <div className="title-ring-mark" />
        </div>
        <main className="title-main">
          <p className="brand-mark">BOXCLUB</p>
          <h1>Vegas Agent Fight Night</h1>
          <p className="lede">
            Lace up. Throw phrases on a shared ring clock. The crowd heat decides
            who gets famous under the neon.
          </p>
          <div className="title-ctas">
            <button type="button" className="claim red" onClick={() => claimCoach('red')}>
              Coach Red
            </button>
            <button type="button" className="claim blue" onClick={() => claimCoach('blue')}>
              Coach Blue
            </button>
            <button
              type="button"
              className="ghost wide"
              onClick={() => {
                setEntered(true)
                match.spawnDemoBots()
              }}
              disabled={!match.connected}
            >
              Enter Demo Bout
            </button>
          </div>
          <p className="title-hint">Press in — the ring is the whole screen.</p>
        </main>
      </div>
    )
  }

  if (!match.state) {
    return (
      <div className="loading-screen">
        <p className="brand-mark">BOXCLUB</p>
        <p>Lacing up the ring…</p>
      </div>
    )
  }

  return (
    <div className={`fight-screen${drawer !== 'none' ? ' drawer-open' : ''}`}>
      <div className="ring-stage">
        <Arena state={match.state} />

        <div className="ring-overlay">
          <header className="ring-chrome">
            <div className="ring-brand">
              <span className="ring-logo">BOXCLUB</span>
              <span className="ring-live">
                <i className={match.connected ? 'on' : 'off'} />
                {match.connected ? 'LIVE' : 'OFF'}
              </span>
            </div>
            <div className="ring-actions">
              <button
                type="button"
                className={`chrome-btn${drawer === 'coach' ? ' active' : ''}`}
                onClick={() => toggleDrawer('coach')}
              >
                Corner
              </button>
              <button
                type="button"
                className={`chrome-btn${drawer === 'mic' ? ' active' : ''}`}
                onClick={() => toggleDrawer('mic')}
              >
                Mic
              </button>
              <button type="button" className="chrome-btn ghost" onClick={match.resetMatch}>
                New Bout
              </button>
            </div>
          </header>

          <MatchHUD state={match.state} />

          <footer className="ring-ticker" aria-live="polite">
            {match.state.eventLog.slice(0, 3).map((e, i) => (
              <span key={`${e}-${i}`}>{e}</span>
            ))}
          </footer>
        </div>

        {drawer !== 'none' && (
          <button
            type="button"
            className="drawer-scrim"
            aria-label="Close panel"
            onClick={() => setDrawer('none')}
          />
        )}

        <aside className={`ring-drawer${drawer === 'coach' ? ' open' : ''}`} aria-hidden={drawer !== 'coach'}>
          <CoachPanel
            state={match.state}
            connected={match.connected}
            coachCorner={coachCorner}
            onClaimCoach={claimCoach}
            onCommand={match.sendCommand}
            onStart={match.startMatch}
            onReset={match.resetMatch}
            onDemo={match.spawnDemoBots}
            webmcpStatus={webmcp.status}
            webmcpTools={webmcp.tools}
            lastToolCall={webmcp.lastCall}
            error={match.error}
            onClearError={match.clearError}
          />
        </aside>

        <aside className={`ring-drawer mic${drawer === 'mic' ? ' open' : ''}`} aria-hidden={drawer !== 'mic'}>
          <FightChat
            state={match.state}
            coachCorner={coachCorner}
            onAdvice={match.sendAdvice}
          />
        </aside>
      </div>
    </div>
  )
}
