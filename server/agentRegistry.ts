import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '../data')
const DATA_FILE = path.join(DATA_DIR, 'agents.json')

export type AgentAccount = {
  /** Stable id — also used as agentKey / fighter card id. */
  agentId: string
  /** Unique login handle (e.g. "yuma"). */
  handle: string
  /** SHA-256 of the login token — never store the raw token. */
  tokenHash: string
  displayName: string
  createdAt: number
  lastSeenAt: number
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function normalizeHandle(raw: string) {
  const handle = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24)
  if (handle.length < 2) throw new Error('Handle must be at least 2 characters')
  return handle
}

/**
 * Persistent agent accounts so a player like Yuma can register, log back in,
 * and keep the same fighter card / seating identity across sessions.
 */
export class AgentRegistry {
  private accounts = new Map<string, AgentAccount>()
  private byHandle = new Map<string, string>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.load()
  }

  private load() {
    try {
      const raw = readFileSync(DATA_FILE, 'utf8')
      const parsed = JSON.parse(raw) as AgentAccount[]
      for (const account of parsed) {
        if (!account?.agentId || !account.handle || !account.tokenHash) continue
        this.accounts.set(account.agentId, account)
        this.byHandle.set(account.handle, account.agentId)
      }
    } catch {
      /* fresh registry */
    }
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.save(), 250)
  }

  private save() {
    try {
      mkdirSync(DATA_DIR, { recursive: true })
      writeFileSync(DATA_FILE, JSON.stringify([...this.accounts.values()], null, 2))
    } catch {
      /* best-effort */
    }
  }

  list(): AgentAccount[] {
    return [...this.accounts.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt)
  }

  get(agentId: string): AgentAccount | null {
    return this.accounts.get(agentId) ?? null
  }

  getByHandle(handle: string): AgentAccount | null {
    const id = this.byHandle.get(normalizeHandle(handle))
    return id ? (this.accounts.get(id) ?? null) : null
  }

  touch(agentId: string) {
    const account = this.accounts.get(agentId)
    if (!account) return
    account.lastSeenAt = Date.now()
    this.scheduleSave()
  }

  /**
   * Create an account. Returns the raw token ONCE — client must store it.
   * agentId is the agentKey for all later tool calls.
   */
  register(input: { handle: string; displayName?: string; agentId?: string }) {
    const handle = normalizeHandle(input.handle)
    if (this.byHandle.has(handle)) {
      throw new Error(`Handle @${handle} is taken — pick another or login_agent`)
    }
    const agentId = (input.agentId?.trim() || randomUUID()).slice(0, 64)
    if (this.accounts.has(agentId)) {
      throw new Error('That agentId is already registered — login_agent instead')
    }
    const token = `sc_${randomBytes(18).toString('base64url')}`
    const now = Date.now()
    const account: AgentAccount = {
      agentId,
      handle,
      tokenHash: hashToken(token),
      displayName: (input.displayName?.trim() || handle).slice(0, 24),
      createdAt: now,
      lastSeenAt: now,
    }
    this.accounts.set(agentId, account)
    this.byHandle.set(handle, agentId)
    this.scheduleSave()
    return {
      ok: true as const,
      agentId,
      handle,
      displayName: account.displayName,
      /** Store this — required for login_agent. Shown only once. */
      token,
      tip: 'Use agentId as agentKey on every tool call. Call login_agent later with handle+token to resume.',
    }
  }

  login(input: { handle?: string; agentId?: string; token: string }) {
    const token = String(input.token ?? '')
    if (!token) throw new Error('token required')
    let account: AgentAccount | null = null
    if (input.agentId) account = this.get(String(input.agentId))
    else if (input.handle) account = this.getByHandle(String(input.handle))
    if (!account) throw new Error('Unknown agent — register_agent first')
    if (account.tokenHash !== hashToken(token)) {
      throw new Error('Bad token')
    }
    account.lastSeenAt = Date.now()
    this.scheduleSave()
    return {
      ok: true as const,
      agentId: account.agentId,
      handle: account.handle,
      displayName: account.displayName,
      tip: 'Logged in. Use this agentId as agentKey. Call get_session for lobby status, then enter_match or accept_challenge.',
    }
  }

  /**
   * Ensure an anonymous agentKey has a lightweight registry row so tapes and
   * session views still resolve. Does not issue a login token.
   */
  ensureGuest(agentId: string, displayName: string) {
    const existing = this.accounts.get(agentId)
    if (existing) {
      if (displayName && displayName !== existing.displayName) {
        existing.displayName = displayName.slice(0, 24)
      }
      existing.lastSeenAt = Date.now()
      this.scheduleSave()
      return existing
    }
    const now = Date.now()
    const handleBase = normalizeHandle(displayName || agentId.slice(0, 8))
    let handle = handleBase
    let n = 1
    while (this.byHandle.has(handle)) {
      handle = `${handleBase}_${n++}`.slice(0, 24)
    }
    const account: AgentAccount = {
      agentId,
      handle,
      tokenHash: hashToken(`guest_${agentId}`),
      displayName: (displayName || handle).slice(0, 24),
      createdAt: now,
      lastSeenAt: now,
    }
    this.accounts.set(agentId, account)
    this.byHandle.set(handle, agentId)
    this.scheduleSave()
    return account
  }
}

export const agentRegistry = new AgentRegistry()
