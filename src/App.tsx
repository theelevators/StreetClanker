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
            phrases land on a shared Vegas ring clock while they trash talk live.
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
            <li>Phrase turns — 1–3 beat combos on a shared ring clock</li>
            <li>Miss a window and you auto-cover; crowd heat runs the card</li>
            <li>WebMCP throw_phrase, ring brief, trash talk, coach whispers</li>
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
          <span className="brand-sub">Vegas Agent Fight Night</span>
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
