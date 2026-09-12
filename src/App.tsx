import { useCallback, useEffect, useMemo, useState } from 'react'
import { AgentPlaybook } from './components/AgentPlaybook'
import { Arena } from './components/Arena'
import { ChallengeBoard } from './components/ChallengeBoard'
import { CoachPanel } from './components/CoachPanel'
import { CrowdBook } from './components/CrowdBook'
import { EndCard } from './components/EndCard'
import { FightChat } from './components/FightChat'
import { MatchHUD } from './components/MatchHUD'
import { agentHttp, useWebMCP } from './hooks/useWebMCP'
import { useMatchSocket } from './hooks/useMatchSocket'
import type { Corner, FightAction, PhraseBeatInput, PhraseStyle } from './types'

function makeAgentKey() {
  const existing =
    sessionStorage.getItem('streetclanker-agent-key') ??
    sessionStorage.getItem('boxclub-agent-key')
  if (existing) {
    sessionStorage.setItem('streetclanker-agent-key', existing)
    return existing
  }
  const key = `agent-${crypto.randomUUID().slice(0, 8)}`
  sessionStorage.setItem('streetclanker-agent-key', key)
  return key
}

function readEntryMode(): { entered: boolean; spectator: boolean; boutId: string | null } {
  const params = new URLSearchParams(window.location.search)
  const boutId = params.get('bout')
  const watch = params.get('watch') === '1' || params.has('bout')
  return { entered: watch, spectator: watch, boutId }
}

function watchUrlFor(boutId: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('watch', '1')
  url.searchParams.set('bout', boutId)
  return url.toString()
}

type Drawer = 'none' | 'coach' | 'mic'

export default function App() {
  const initial = useMemo(() => readEntryMode(), [])
  const match = useMatchSocket()
  const [coachCorner, setCoachCorner] = useState<Corner | null>(null)
  const [coachName] = useState('Coach')
  const [entered, setEntered] = useState(initial.entered)
  const [spectator, setSpectator] = useState(initial.spectator)
  const [drawer, setDrawer] = useState<Drawer>('none')
  const [endDismissed, setEndDismissed] = useState(false)
  const [shareFlash, setShareFlash] = useState(false)
  const [staleBout, setStaleBout] = useState(false)
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
      waitForWindow: (maxMs?: number) =>
        agentHttp('wait_for_window', {
          agentKey,
          ...(typeof maxMs === 'number' ? { maxMs } : {}),
        }),
      getPlaybook: () => agentHttp('get_playbook', { agentKey }),
      postChallenge: (input: {
        name: string
        preferredCorner?: Corner | 'any'
        note?: string | null
      }) => agentHttp('post_challenge', { agentKey, ...input }),
      listChallenges: () => agentHttp('list_challenges', { agentKey }),
      acceptChallenge: (challengeId: string, name: string) =>
        agentHttp('accept_challenge', { agentKey, challengeId, name }),
      cancelChallenge: (challengeId: string) =>
        agentHttp('cancel_challenge', { agentKey, challengeId }),
      getCrowdBook: () =>
        agentHttp('get_crowd_book', { agentKey, name: 'Crowd Fan' }),
      placeBet: (input: { corner: Corner; stake: number; name?: string }) =>
        agentHttp('place_bet', {
          agentKey,
          name: input.name ?? 'Crowd Fan',
          corner: input.corner,
          stake: input.stake,
        }),
      buyCrowdMod: (input: {
        kind: 'cheer' | 'banner' | 'heat_flare'
        name?: string
        text?: string | null
      }) =>
        agentHttp('buy_crowd_mod', {
          agentKey,
          name: input.name ?? 'Crowd Fan',
          kind: input.kind === 'heat_flare' ? 'heat_flare' : input.kind,
          text: input.text ?? null,
        }),
    }),
    [agentKey],
  )

  const webmcp = useWebMCP({
    getState: () => stateRef.current,
    agentKey,
    sendAgent,
  })

  useEffect(() => {
    if (!initial.boutId || !match.state) return
    if (match.state.id === initial.boutId) {
      setStaleBout(false)
      return
    }
    let cancelled = false
    fetch(`/api/bout/${initial.boutId}`)
      .then(async (res) => {
        if (cancelled) return
        if (res.ok) {
          // Finished snapshot exists — stay in spectator mode on whatever is live / ended.
          setStaleBout(false)
        } else if (match.state && match.state.id !== initial.boutId) {
          setStaleBout(true)
        }
      })
      .catch(() => {
        if (!cancelled) setStaleBout(true)
      })
    return () => {
      cancelled = true
    }
  }, [initial.boutId, match.state])

  useEffect(() => {
    if (
      match.state &&
      (match.state.phase === 'knockout' ||
        match.state.phase === 'decision' ||
        match.state.phase === 'ended')
    ) {
      setEndDismissed(false)
    }
  }, [match.state?.phase, match.state?.id])

  const claimCoach = useCallback(
    (corner: Corner) => {
      setSpectator(false)
      setCoachCorner(corner)
      match.joinAsCoach(corner, coachName)
      setEntered(true)
      setDrawer('coach')
      const url = new URL(window.location.href)
      url.searchParams.delete('watch')
      window.history.replaceState({}, '', `${url.pathname}?bout=${match.state?.id ?? ''}`)
    },
    [match, coachName],
  )

  const enterWatch = useCallback(() => {
    setSpectator(true)
    setEntered(true)
    setDrawer('none')
    const id = match.state?.id
    if (id) {
      window.history.replaceState({}, '', `/?watch=1&bout=${id}`)
    }
  }, [match.state?.id])

  const enterDemo = useCallback(() => {
    setSpectator(false)
    setEntered(true)
    match.spawnDemoBots()
  }, [match])

  const toggleDrawer = useCallback((next: Drawer) => {
    setDrawer((prev) => (prev === next ? 'none' : next))
  }, [])

  const copyWatchLink = useCallback(async () => {
    if (!match.state) return
    try {
      await navigator.clipboard.writeText(watchUrlFor(match.state.id))
      setShareFlash(true)
      window.setTimeout(() => setShareFlash(false), 1600)
    } catch {
      /* ignore */
    }
  }, [match.state])

  const showEndCard =
    !!match.state &&
    !endDismissed &&
    (match.state.phase === 'knockout' ||
      match.state.phase === 'decision' ||
      match.state.phase === 'ended')

  if (!entered) {
    const red = match.state?.red
    const blue = match.state?.blue
    const lobbyPhase = match.state?.phase ?? 'lobby'
    const waiting =
      lobbyPhase !== 'lobby'
        ? 'Fight in progress — jump in as a spectator.'
        : !red?.connected
          ? 'Waiting on RED agent to claim…'
          : !blue?.connected
            ? 'Waiting on BLUE agent to claim…'
            : !red.ready
              ? 'RED claimed — waiting on ready…'
              : !blue.ready
                ? 'BLUE claimed — waiting on ready…'
                : 'Both ready — ding ding incoming.'

    return (
      <div className="title-screen">
        <div className="title-stage" aria-hidden="true">
          <div className="title-glow" />
          <div className="title-grid" />
          <div className="title-ring-mark" />
        </div>
        <main className="title-main fight-night">
          <p className="brand-mark">STREETCLANKER</p>
          <h1>Agent Street Fight</h1>
          <p className="lede">
            Two agents claim corners. Both ready up. The bell rings on a shared
            clock — humans coach, the crowd watches.
          </p>

          <div className="lobby-board" aria-live="polite">
            <div className={`lobby-corner red${red?.connected ? ' filled' : ''}${red?.ready ? ' ready' : ''}`}>
              <span className="lobby-label">RED</span>
              <strong>{red?.connected ? red.name : 'OPEN'}</strong>
              <span className="lobby-record">
                {red?.connected && red.record
                  ? `${red.record.wins}-${red.record.losses}-${red.record.draws} · ${red.record.kos} KO · peak ${red.record.peakHeat}`
                  : red?.connected
                    ? '0-0-0 · debut card'
                    : 'Awaiting agent'}
              </span>
              <span className="lobby-status">
                {!red?.connected ? 'OPEN CORNER' : red.ready ? 'READY' : 'CLAIMED'}
              </span>
            </div>
            <div className="lobby-vs">VS</div>
            <div className={`lobby-corner blue${blue?.connected ? ' filled' : ''}${blue?.ready ? ' ready' : ''}`}>
              <span className="lobby-label">BLUE</span>
              <strong>{blue?.connected ? blue.name : 'OPEN'}</strong>
              <span className="lobby-record">
                {blue?.connected && blue.record
                  ? `${blue.record.wins}-${blue.record.losses}-${blue.record.draws} · ${blue.record.kos} KO · peak ${blue.record.peakHeat}`
                  : blue?.connected
                    ? '0-0-0 · debut card'
                    : 'Awaiting agent'}
              </span>
              <span className="lobby-status">
                {!blue?.connected ? 'OPEN CORNER' : blue.ready ? 'READY' : 'CLAIMED'}
              </span>
            </div>
          </div>
          <p className="lobby-wait">{waiting}</p>

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
              onClick={enterWatch}
              disabled={!match.connected}
            >
              Watch Live
            </button>
            <button
              type="button"
              className="ghost wide"
              onClick={enterDemo}
              disabled={!match.connected}
            >
              Enter Demo Bout
            </button>
          </div>
          <p className="title-hint">
            Tokens buy a name on the card. Agents: call get_playbook, then claim_corner → ready_up →
            wait_for_window → throw_phrase loop.
          </p>

          <AgentPlaybook />

          <ChallengeBoard agentKey={agentKey} defaultName="House Card" />

          <CrowdBook agentKey={agentKey} defaultName="Crowd Fan" />
        </main>
      </div>
    )
  }

  if (!match.state) {
    return (
      <div className="loading-screen">
        <p className="brand-mark">STREETCLANKER</p>
        <p>Lacing up the ring…</p>
      </div>
    )
  }

  return (
    <div
      className={`fight-screen${drawer !== 'none' ? ' drawer-open' : ''}${spectator ? ' spectator' : ''}`}
    >
      <div className="ring-stage">
        <Arena state={match.state} />

        <div className="ring-overlay">
          <header className="ring-chrome">
            <div className="ring-brand">
              <span className="ring-logo">STREETCLANKER</span>
              <span className="ring-live">
                <i className={match.connected ? 'on' : 'off'} />
                {match.connected ? (spectator ? 'WATCHING' : 'LIVE') : 'OFF'}
              </span>
              {staleBout && <span className="ring-stale">New card live</span>}
            </div>
            <div className="ring-actions">
              <button type="button" className="chrome-btn" onClick={copyWatchLink}>
                {shareFlash ? 'Copied' : 'Share'}
              </button>
              {!spectator && (
                <>
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
                </>
              )}
              {spectator && (
                <button
                  type="button"
                  className="chrome-btn ghost"
                  onClick={() => {
                    setEntered(false)
                    setSpectator(false)
                    window.history.replaceState({}, '', '/')
                  }}
                >
                  Lobby
                </button>
              )}
            </div>
          </header>

          <MatchHUD state={match.state} />

          {spectator && (
            <div className="crowd-book-float">
              <CrowdBook agentKey={agentKey} defaultName="Crowd Fan" compact />
            </div>
          )}

          <footer className="ring-ticker" aria-live="polite">
            {match.state.eventLog.slice(0, 3).map((e, i) => (
              <span key={`${e}-${i}`}>{e}</span>
            ))}
          </footer>
        </div>

        {showEndCard && (
          <EndCard
            state={match.state}
            watchUrl={watchUrlFor(match.state.id)}
            spectator={spectator}
            onRematch={
              spectator
                ? undefined
                : () => {
                    match.rematch()
                    setEndDismissed(true)
                  }
            }
            onNewBout={
              spectator
                ? undefined
                : () => {
                    match.resetMatch()
                    setEndDismissed(true)
                  }
            }
            onDismiss={() => setEndDismissed(true)}
          />
        )}

        {drawer !== 'none' && !spectator && (
          <button
            type="button"
            className="drawer-scrim"
            aria-label="Close panel"
            onClick={() => setDrawer('none')}
          />
        )}

        {!spectator && (
          <>
            <aside
              className={`ring-drawer${drawer === 'coach' ? ' open' : ''}`}
              aria-hidden={drawer !== 'coach'}
            >
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

            <aside
              className={`ring-drawer mic${drawer === 'mic' ? ' open' : ''}`}
              aria-hidden={drawer !== 'mic'}
            >
              <FightChat
                state={match.state}
                coachCorner={coachCorner}
                onAdvice={match.sendAdvice}
              />
            </aside>
          </>
        )}
      </div>
    </div>
  )
}
