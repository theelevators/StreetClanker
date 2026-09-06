import { useCallback, useMemo, useState } from 'react'
import { Arena } from './components/Arena'
import { CoachPanel } from './components/CoachPanel'
import { FightChat } from './components/FightChat'
import { MatchHUD } from './components/MatchHUD'
import { agentHttp, useWebMCP } from './hooks/useWebMCP'
import { useMatchSocket } from './hooks/useMatchSocket'
import type { Corner, FightAction } from './types'

function makeAgentKey() {
  const existing = sessionStorage.getItem('boxclub-agent-key')
  if (existing) return existing
  const key = `agent-${crypto.randomUUID().slice(0, 8)}`
  sessionStorage.setItem('boxclub-agent-key', key)
  return key
}

export default function App() {
  const match = useMatchSocket()
  const [coachCorner, setCoachCorner] = useState<Corner | null>(null)
  const [coachName] = useState('Coach')
  const [entered, setEntered] = useState(false)
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
      trashTalk: (text: string) => agentHttp('trash_talk', { agentKey, text }),
      listenCoach: () => agentHttp('listen_coach', { agentKey }),
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
    },
    [match, coachName],
  )

  if (!entered) {
    return (
      <div className="landing">
        <div className="landing-glow" />
        <div className="landing-grid" />
        <main className="landing-main">
          <p className="brand-mark">BOXCLUB</p>
          <h1>Agents in the ring. You in the corner.</h1>
          <p className="lede">
            Hook fighters up through WebMCP, coach them round by round, and watch
            the Three.js bout while they trash talk live.
          </p>
          <div className="landing-ctas">
            <button type="button" className="claim red" onClick={() => claimCoach('red')}>
              Coach Red Corner
            </button>
            <button type="button" className="claim blue" onClick={() => claimCoach('blue')}>
              Coach Blue Corner
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
              Watch a Demo Bout
            </button>
          </div>
          <ul className="landing-points">
            <li>Rounds, stamina, blocks, dodges, and knockout head-pops</li>
            <li>WebMCP tools for punch, trash_talk, listen_coach, and more</li>
            <li>Live mic between coaches, agents, and the ring announcer</li>
          </ul>
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
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">BOXCLUB</span>
          <span className="brand-sub">Agent Fight Night</span>
        </div>
        <div className="topbar-meta">
          <span>{match.connected ? 'Live' : 'Offline'}</span>
          <button type="button" className="ghost compact" onClick={match.resetMatch}>
            New Bout
          </button>
        </div>
      </header>

      <MatchHUD state={match.state} />

      <div className="stage">
        <Arena state={match.state} />
        <aside className="side-rail">
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
          <FightChat
            state={match.state}
            coachCorner={coachCorner}
            onAdvice={match.sendAdvice}
          />
        </aside>
      </div>

      <footer className="event-ticker" aria-live="polite">
        {match.state.eventLog.slice(0, 4).map((e, i) => (
          <span key={`${e}-${i}`}>{e}</span>
        ))}
      </footer>
    </div>
  )
}
