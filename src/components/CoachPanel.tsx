import type { Corner, FightAction, MatchState } from '../types'

type Props = {
  state: MatchState
  connected: boolean
  coachCorner: Corner | null
  onClaimCoach: (corner: Corner) => void
  onCommand: (action: FightAction) => void
  onStart: () => void
  onReset: () => void
  onDemo: () => void
  webmcpStatus: 'unsupported' | 'registering' | 'ready' | 'error'
  webmcpTools: string[]
  lastToolCall: string | null
  error: string | null
  onClearError: () => void
}

export function CoachPanel({
  state,
  connected,
  coachCorner,
  onClaimCoach,
  onCommand,
  onStart,
  onReset,
  onDemo,
  webmcpStatus,
  webmcpTools,
  lastToolCall,
  error,
  onClearError,
}: Props) {
  return (
    <section className="panel coach-panel">
      <header className="panel-head">
        <h2>Coach Corner</h2>
        <p>You call strategy. Your agent throws hands.</p>
      </header>

      <div className="status-row">
        <span className={`dot ${connected ? 'on' : 'off'}`} />
        {connected ? 'Ring linked' : 'Reconnecting…'}
        <span className="webmcp-pill" data-status={webmcpStatus}>
          WebMCP {statusLabel(webmcpStatus)}
        </span>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={onClearError}>
            dismiss
          </button>
        </div>
      )}

      {!coachCorner ? (
        <div className="claim-grid">
          <button type="button" className="claim red" onClick={() => onClaimCoach('red')}>
            Coach Red
          </button>
          <button type="button" className="claim blue" onClick={() => onClaimCoach('blue')}>
            Coach Blue
          </button>
        </div>
      ) : (
        <div className="coach-active">
          <p>
            You are coaching <strong className={coachCorner}>{coachCorner.toUpperCase()}</strong>
            {state[coachCorner].connected
              ? ` — agent “${state[coachCorner].name}” is laced up.`
              : ' — waiting for an agent to claim this corner via WebMCP.'}
          </p>
        </div>
      )}

      <div className="action-grid">
        {(
          [
            ['jab', 'Jab'],
            ['punch_left', 'Left Hook'],
            ['punch_right', 'Right Hook'],
            ['block', 'Block'],
            ['dodge', 'Dodge'],
          ] as [FightAction, string][]
        ).map(([action, label]) => (
          <button
            key={action}
            type="button"
            className="pad"
            disabled={!coachCorner || state.phase !== 'fighting'}
            onClick={() => onCommand(action)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="match-controls">
        <button type="button" onClick={onDemo}>
          Demo Bout
        </button>
        <button
          type="button"
          onClick={onStart}
          disabled={
            state.phase !== 'lobby' || !state.red.connected || !state.blue.connected
          }
        >
          Start Fight
        </button>
        <button type="button" className="ghost" onClick={onReset}>
          Reset Ring
        </button>
      </div>

      <div className="tools-card">
        <h3>Agent Tools</h3>
        <p>
          Browser agents discover these through <code>document.modelContext</code>. HTTP
          fallback lives at <code>/api/agent/*</code>.
        </p>
        <ul>
          {(webmcpTools.length
            ? webmcpTools
            : [
                'get_playbook',
                'claim_corner',
                'ready_bell',
                'wait_for_bell',
                'ready_up',
                'get_match_state',
                'wait_for_window',
                'throw_phrase',
                'punch',
                'block',
                'dodge',
                'trash_talk',
                'listen_coach',
              ]
          ).map((t) => (
            <li key={t}>
              <code>{t}</code>
            </li>
          ))}
        </ul>
        {lastToolCall && <div className="last-call">Last tool: {lastToolCall}</div>}
      </div>
    </section>
  )
}

function statusLabel(status: Props['webmcpStatus']) {
  switch (status) {
    case 'ready':
      return 'live'
    case 'registering':
      return 'hooking up'
    case 'error':
      return 'error'
    default:
      return 'polyfill / HTTP'
  }
}
