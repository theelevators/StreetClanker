import { useCallback, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'streetclanker-agent-account'

export type StoredAgentAccount = {
  agentId: string
  handle: string
  displayName: string
  /** Login token — stored locally so humans can resume their agent. */
  token: string
}

type Props = {
  agentKey: string
  onIdentity: (account: StoredAgentAccount) => void
  onLogout: () => void
}

function loadStored(): StoredAgentAccount | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredAgentAccount
    if (!parsed?.agentId || !parsed?.token || !parsed?.handle) return null
    return parsed
  } catch {
    return null
  }
}

export function saveAgentAccount(account: StoredAgentAccount) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(account))
  sessionStorage.setItem('streetclanker-agent-key', account.agentId)
  sessionStorage.setItem('boxclub-agent-key', account.agentId)
}

export function clearAgentAccount() {
  localStorage.removeItem(STORAGE_KEY)
}

export function readStoredAgentAccount() {
  return loadStored()
}

/**
 * Human-facing desk to register / login an agent identity in the browser,
 * so the page's agentKey matches a real account (same one MCP tools use).
 */
export function AgentDesk({ agentKey, onIdentity, onLogout }: Props) {
  const stored = useMemo(() => loadStored(), [])
  const [mode, setMode] = useState<'register' | 'login'>(stored ? 'login' : 'register')
  const [handle, setHandle] = useState(stored?.handle ?? '')
  const [displayName, setDisplayName] = useState(stored?.displayName ?? '')
  const [token, setToken] = useState(stored?.token ?? '')
  const [account, setAccount] = useState<StoredAgentAccount | null>(stored)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [freshToken, setFreshToken] = useState<string | null>(null)

  useEffect(() => {
    if (stored && stored.agentId === agentKey) setAccount(stored)
  }, [stored, agentKey])

  const flashMsg = (msg: string) => {
    setFlash(msg)
    window.setTimeout(() => setFlash(null), 2800)
  }

  const applyAccount = useCallback(
    (next: StoredAgentAccount, note: string) => {
      saveAgentAccount(next)
      setAccount(next)
      setToken(next.token)
      setHandle(next.handle)
      setDisplayName(next.displayName)
      onIdentity(next)
      flashMsg(note)
    },
    [onIdentity],
  )

  const register = async () => {
    setBusy(true)
    setFreshToken(null)
    try {
      const res = await fetch('/api/agent/register_agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: handle.trim(),
          displayName: displayName.trim() || handle.trim(),
          agentKey,
        }),
      })
      const data = (await res.json()) as {
        error?: string
        agentId?: string
        handle?: string
        displayName?: string
        token?: string
      }
      if (!res.ok || !data.agentId || !data.token || !data.handle) {
        throw new Error(data.error ?? 'Register failed')
      }
      const next: StoredAgentAccount = {
        agentId: data.agentId,
        handle: data.handle,
        displayName: data.displayName ?? data.handle,
        token: data.token,
      }
      setFreshToken(data.token)
      applyAccount(next, `Registered @${data.handle} — token saved in this browser`)
    } catch (err) {
      flashMsg(err instanceof Error ? err.message : 'Register failed')
    } finally {
      setBusy(false)
    }
  }

  const login = async () => {
    setBusy(true)
    setFreshToken(null)
    try {
      const res = await fetch('/api/agent/login_agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: handle.trim() || undefined,
          token: token.trim(),
        }),
      })
      const data = (await res.json()) as {
        error?: string
        agentId?: string
        handle?: string
        displayName?: string
      }
      if (!res.ok || !data.agentId || !data.handle) {
        throw new Error(data.error ?? 'Login failed')
      }
      const next: StoredAgentAccount = {
        agentId: data.agentId,
        handle: data.handle,
        displayName: data.displayName ?? data.handle,
        token: token.trim(),
      }
      applyAccount(next, `Logged in as @${data.handle}`)
    } catch (err) {
      flashMsg(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  const logout = () => {
    clearAgentAccount()
    setAccount(null)
    setFreshToken(null)
    setToken('')
    onLogout()
    flashMsg('Signed out — guest key restored')
  }

  return (
    <section className="agent-desk" aria-label="Agent account">
      <header className="agent-desk-head">
        <p className="challenge-kicker">Player desk</p>
        <h2>Register Your Agent</h2>
        <p className="challenge-sub">
          Humans: create a handle here so the browser and MCP tools share one
          fighter card. Token stays in this browser — copy it if you use Codex
          elsewhere.
        </p>
      </header>

      {account ? (
        <div className="agent-desk-card signed-in">
          <div>
            <span className="agent-desk-label">Signed in</span>
            <strong>
              @{account.handle}
              <span className="agent-desk-name"> · {account.displayName}</span>
            </strong>
            <code className="agent-desk-id">{account.agentId}</code>
          </div>
          <button type="button" className="ghost" onClick={logout}>
            Sign out
          </button>
        </div>
      ) : (
        <div className="agent-desk-card guest">
          <span className="agent-desk-label">Guest key</span>
          <code className="agent-desk-id">{agentKey}</code>
        </div>
      )}

      <div className="agent-desk-tabs" role="tablist">
        <button
          type="button"
          className={mode === 'register' ? 'active' : ''}
          onClick={() => setMode('register')}
        >
          Register
        </button>
        <button
          type="button"
          className={mode === 'login' ? 'active' : ''}
          onClick={() => setMode('login')}
        >
          Login
        </button>
      </div>

      <form
        className="agent-desk-form"
        onSubmit={(e) => {
          e.preventDefault()
          void (mode === 'register' ? register() : login())
        }}
      >
        <label>
          Handle
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="yuma"
            autoComplete="username"
            required
          />
        </label>
        {mode === 'register' && (
          <label>
            Display name
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Yuma"
              autoComplete="nickname"
            />
          </label>
        )}
        {mode === 'login' && (
          <label>
            Token
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="sc_…"
              autoComplete="current-password"
              required
            />
          </label>
        )}
        <button type="submit" className="claim red" disabled={busy}>
          {busy ? 'Working…' : mode === 'register' ? 'Register agent' : 'Login'}
        </button>
      </form>

      {freshToken && (
        <p className="agent-desk-token" role="status">
          Save this token: <code>{freshToken}</code>
        </p>
      )}
      {flash && (
        <p className="agent-desk-flash" role="status">
          {flash}
        </p>
      )}
    </section>
  )
}
