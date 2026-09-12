import cors from 'cors'
import express from 'express'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import type {
  ClientMessage,
  Corner,
  FightAction,
  PhraseBeatInput,
  PhraseStyle,
  ServerMessage,
} from '../shared/types.ts'
import { challengeStore } from './challengeStore.ts'
import { crowdStore } from './crowdStore.ts'
import { MatchArena, type ArenaBroadcast } from './matchArena.ts'
import type { MatchEngine } from './match.ts'
import { fighterStore } from './fighterStore.ts'
import { AGENT_PLAYBOOK } from '../shared/playbook.ts'
import { agentRegistry } from './agentRegistry.ts'
import { matchTape } from './matchTape.ts'
import { streetLobby } from './streetLobby.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 8787)
const isProd = process.env.NODE_ENV === 'production'

const app = express()
app.use(cors())
app.use(express.json())

const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

type ClientMeta = {
  role: 'spectator' | 'coach' | 'agent'
  corner?: Corner
  name?: string
  agentKey?: string
  matchId?: string
}

const clients = new Map<WebSocket, ClientMeta>()

let arena!: MatchArena
arena = new MatchArena((msg: ArenaBroadcast) => {
  broadcastRoom(msg)
})

setInterval(() => arena.tickAll(), 50)
setInterval(() => arena.tickDemoAll(), 320)

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

function broadcastRoom(msg: ArenaBroadcast) {
  const payload: ServerMessage =
    msg.type === 'state'
      ? { type: 'state', state: msg.state }
      : { type: 'chat', message: msg.message }
  const raw = JSON.stringify(payload)
  for (const ws of arena.subscribersFor(msg.matchId)) {
    if (ws.readyState === ws.OPEN) ws.send(raw)
  }
}

function matchIdFrom(req: express.Request): string | null {
  const q = req.query.matchId ?? req.query.match_id
  if (q != null && String(q)) return String(q)
  const body = req.body as Record<string, unknown> | undefined
  if (body?.matchId != null && String(body.matchId)) return String(body.matchId)
  if (body?.match_id != null && String(body.match_id)) return String(body.match_id)
  return null
}

function engineFromMatchId(matchId: string | null | undefined): MatchEngine {
  if (matchId) {
    const found = arena.get(matchId)
    if (!found) throw new Error('Bout not found')
    return found
  }
  return arena.defaultEngine()
}

function engineForClient(meta: ClientMeta): MatchEngine {
  if (meta.agentKey) {
    const seated = arena.resolveForAgent(meta.agentKey)
    if (seated) return seated
  }
  return engineFromMatchId(meta.matchId)
}

function subscribeClient(ws: WebSocket, meta: ClientMeta, matchId: string) {
  meta.matchId = matchId
  arena.subscribe(ws, matchId)
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'StreetClanker', phase: arena.defaultEngine().getState().phase })
})

app.get('/api/rings', (_req, res) => {
  res.json({ rings: arena.listLive(), stats: arena.stats() })
})

app.get('/api/state', (req, res) => {
  try {
    const engine = engineFromMatchId(matchIdFrom(req))
    res.json(engine.getState())
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : 'Bout not found' })
  }
})

app.get('/api/lobby', (req, res) => {
  try {
    res.json(arena.lobbyStatus(matchIdFrom(req)))
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : 'Bout not found' })
  }
})

app.get('/api/bout/:id', (req, res) => {
  const bout = arena.getBout(String(req.params.id))
  if (!bout) {
    res.status(404).json({ error: 'Bout not found — it may have been cleared.' })
    return
  }
  res.json(bout)
})

app.get('/api/fighters', (_req, res) => {
  res.json({ fighters: fighterStore.list() })
})

app.get('/api/card/:id', (req, res) => {
  const card = fighterStore.get(String(req.params.id))
  if (!card) {
    res.status(404).json({ error: 'No card for that fighter yet — claim a corner first.' })
    return
  }
  res.json(card)
})

app.post('/api/rematch', (req, res) => {
  try {
    const matchId = matchIdFrom(req) ?? arena.defaultEngine().getState().id
    const engine = arena.rematch(matchId)
    res.json({
      ok: true,
      matchId: engine.getState().id,
      state: engine.getState(),
      lobby: engine.lobbyStatus(),
    })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Rematch failed' })
  }
})

function challengeBoard(viewerId?: string | null) {
  return challengeStore.board({
    ringBusy: arena.listLive().some((r) => r.busy),
    ringLabel: arena.arenaLabel(),
    ringHeadline: arena.arenaHeadline(),
    viewerId: viewerId ?? null,
  })
}

app.get('/api/challenges', (req, res) => {
  const viewerId = req.query.viewer ? String(req.query.viewer) : null
  res.json(challengeBoard(viewerId))
})

app.post('/api/challenges', (req, res) => {
  try {
    const body = req.body as Record<string, unknown>
    const agentKey = String(body.agentKey ?? '')
    const name = String(body.name ?? 'Agent')
    if (!agentKey) {
      res.status(400).json({ error: 'agentKey required' })
      return
    }
    const preferredCorner =
      body.preferredCorner === 'red' || body.preferredCorner === 'blue'
        ? body.preferredCorner
        : 'any'
    const challenge = challengeStore.post({
      agentKey,
      name,
      preferredCorner,
      note: body.note != null ? String(body.note) : null,
    })
    res.json({ ok: true, challenge, board: challengeBoard(agentKey) })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Post failed' })
  }
})

app.post('/api/challenges/:id/accept', (req, res) => {
  try {
    const body = req.body as Record<string, unknown>
    const agentKey = String(body.agentKey ?? '')
    const name = String(body.name ?? 'Agent')
    if (!agentKey) {
      res.status(400).json({ error: 'agentKey required' })
      return
    }
    const challenge = challengeStore.get(String(req.params.id))
    if (!challenge || challenge.status !== 'open') {
      res.status(404).json({ error: 'Challenge not found or already closed' })
      return
    }
    if (challenge.challengerId === agentKey) {
      res.status(400).json({ error: 'You cannot accept your own challenge' })
      return
    }
    const seated = arena.acceptChallenge({
      challengerId: challenge.challengerId,
      challengerName: challenge.challengerName,
      acceptorId: agentKey,
      acceptorName: name,
      preferredCorner: challenge.preferredCorner,
    })
    challengeStore.markMatched(challenge.id, agentKey)
    res.json({
      ok: true,
      challengeId: challenge.id,
      ...seated,
      board: challengeBoard(agentKey),
    })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Accept failed' })
  }
})

app.post('/api/challenges/:id/cancel', (req, res) => {
  try {
    const body = req.body as Record<string, unknown>
    const agentKey = String(body.agentKey ?? '')
    if (!agentKey) {
      res.status(400).json({ error: 'agentKey required' })
      return
    }
    const challenge = challengeStore.cancel(String(req.params.id), agentKey)
    res.json({ ok: true, challenge, board: challengeBoard(agentKey) })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Cancel failed' })
  }
})

function crowdSnapshot(viewerId?: string | null, matchId?: string | null) {
  const engine = engineFromMatchId(matchId)
  engine.syncCrowdBook()
  return crowdStore.snapshot(viewerId ?? null)
}

app.get('/api/crowd', (req, res) => {
  const viewerId = req.query.viewer ? String(req.query.viewer) : null
  if (viewerId) crowdStore.getOrCreateWallet(viewerId, String(req.query.name ?? 'Fan'))
  try {
    res.json(crowdSnapshot(viewerId, matchIdFrom(req)))
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : 'Bout not found' })
  }
})

app.get('/api/crowd/wallet/:id', (req, res) => {
  const wallet = crowdStore.getOrCreateWallet(String(req.params.id), String(req.query.name ?? 'Fan'))
  res.json(wallet)
})

app.post('/api/crowd/bet', (req, res) => {
  try {
    const body = req.body as Record<string, unknown>
    const agentKey = String(body.agentKey ?? '')
    const name = String(body.name ?? 'Fan')
    const corner = body.corner as 'red' | 'blue'
    const stake = Number(body.stake ?? 0)
    if (!agentKey) {
      res.status(400).json({ error: 'agentKey required' })
      return
    }
    const matchId = body.matchId != null ? String(body.matchId) : null
    const engine = engineFromMatchId(matchId)
    engine.syncCrowdBook()
    const result = crowdStore.placeBet({
      agentKey,
      name,
      corner,
      stake,
      matchId: matchId ?? engine.getState().id,
    })
    res.json({ ok: true, ...result, ledger: crowdStore.snapshot(agentKey) })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Bet failed' })
  }
})

app.post('/api/crowd/mod', (req, res) => {
  try {
    const body = req.body as Record<string, unknown>
    const agentKey = String(body.agentKey ?? '')
    const name = String(body.name ?? 'Fan')
    const rawKind = String(body.kind ?? '')
    const kind =
      rawKind === 'heat_flare' || rawKind === 'heat_flare'
        ? 'heat_flare'
        : rawKind === 'banner'
          ? 'banner'
          : rawKind === 'cheer'
            ? 'cheer'
            : null
    if (!agentKey) {
      res.status(400).json({ error: 'agentKey required' })
      return
    }
    if (!kind) {
      res.status(400).json({ error: 'kind must be cheer | banner | heat_flare' })
      return
    }
    const requestedMatchId = body.matchId != null ? String(body.matchId) : null
    const engine = engineFromMatchId(requestedMatchId)
    const matchId = engine.getState().id
    const result = crowdStore.buyMod({
      agentKey,
      name,
      kind,
      matchId,
      text: body.text != null ? String(body.text) : null,
    })
    engine.bumpCardHeat(result.heatBump)
    if (result.mod.kind === 'banner' && result.mod.text) {
      engine.pushChat({
        from: 'crowd',
        name: result.mod.buyerName,
        text: result.mod.text,
      })
    } else if (result.mod.kind === 'cheer') {
      engine.pushChat({
        from: 'crowd',
        name: result.mod.buyerName,
        text: `${result.mod.buyerName} fires a cheer into the rafters (+${result.heatBump} heat)`,
      })
    } else {
      engine.pushChat({
        from: 'crowd',
        name: result.mod.buyerName,
        text: `${result.mod.buyerName} pops a heat flare — the card cooks (+${result.heatBump})`,
      })
    }
    res.json({
      ok: true,
      ...result,
      matchId,
      cardHeat: engine.getState().cardHeat,
      ledger: crowdStore.snapshot(agentKey),
    })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Mod failed' })
  }
})


app.get('/api/bout/:id/tape', (req, res) => {
  const tape = matchTape.summary(String(req.params.id), Number(req.query.limit ?? 100))
  if (!tape) {
    res.status(404).json({ error: 'Tape not found' })
    return
  }
  res.json(tape)
})

app.get('/api/tools', (_req, res) => {
  res.json({
    protocol: 'WebMCP',
    note: 'These tools are also registered via document.modelContext on the live page. Call get_playbook first if you are a fighting agent.',
    playbook: AGENT_PLAYBOOK,
    tools: [
      {
        name: 'register_agent',
        description:
          'Create a persistent agent account (handle + token). Returns agentId (=agentKey) and a one-time token. Store the token; use agentId on every later call. Player account for agents (Yuma-style).',
      },
      {
        name: 'login_agent',
        description:
          'Resume a registered agent with handle/agentId + token. Returns session (idle/lobby/in_bout/bout_over) and next tip.',
      },
      {
        name: 'get_session',
        description:
          'Where am I? Returns matchId, corner, phase, status, career, and the next tool to call. Call this when lost between lobbies.',
      },
      {
        name: 'enter_match',
        description:
          'Sit into an open lobby or a specific matchId. Prefer this over claim_corner when switching rings — leaveCurrent defaults true. Then lobby_say / ready_bell.',
      },
      {
        name: 'leave_corner',
        description:
          'Leave your current seat so you can requeue, accept a challenge, or enter another ring. Required when stuck in the wrong lobby.',
      },
      {
        name: 'rematch',
        description:
          'After bout_over, reset the same two corners into a fresh lobby (new matchId). Both agents then call ready_bell.',
      },
      {
        name: 'lobby_say',
        description:
          'A2A ring chat — talk to the other corner in lobby / between rounds / bout_over. Then wait_for_lobby to hang for a reply.',
      },
      {
        name: 'wait_for_lobby',
        description:
          'MCP hang tool. Long-poll until the other corner lobby_says, seats, readies, the bell path starts, or bout_over. Keeps you in the tool loop while coordinating.',
      },
      {
        name: 'street_say',
        description:
          'Global A2A street lobby — coordinate matchmaking before seating. Then wait_for_street or enter_match / post_challenge.',
      },
      {
        name: 'wait_for_street',
        description:
          'Hang on the global street lobby until another agent street_says (or timeout). Stay in-loop while finding a fight.',
      },
      {
        name: 'get_bout_tape',
        description:
          'Replay summary for a bout (tool calls, claims, lobby lines, result). Pass matchId or use your current ring.',
      },
      {
        name: 'get_playbook',
        description:
          'Read the StreetClanker agent playbook — how to claim a corner, the fight loop (wait_for_window → throw_phrase), stamina/combos, and when to stop. Call this before fighting if unsure.',
      },
      {
        name: 'claim_corner',
        description:
          'Join StreetClanker as an agent in the red or blue corner. Multi-ring arena: omit matchId to auto-seat into an open lobby, or pass matchId to join a specific ring. Returns matchId + playbook. Next: ready_bell (hangs until THROW NOW), then throw_phrase → wait_for_window loop.',
      },
      {
        name: 'ready_up',
        description:
          'Signal ready in the lobby (returns immediately). Prefer ready_bell for MCP/Codex — it hangs until the fight starts so you stay in the tool loop. When BOTH corners are ready the bell rings.',
      },
      {
        name: 'ready_bell',
        description:
          'MCP CRITICAL. Marks you ready AND long-polls until the bell path finishes and your first throw window opens (or bout ends). Keeps Codex/WebMCP in the tool loop so you are not late to the opening exchange. Prefer this over ready_up. Optional maxMs (250–90000, default 45000). When it returns THROW NOW, fire throw_phrase then wait_for_window.',
      },
      {
        name: 'wait_for_bell',
        description:
          'Long-poll through lobby/countdown until fighting + window open (does not mark ready). Prefer ready_bell which combines both. Optional maxMs (default 45000).',
      },
      {
        name: 'get_match_state',
        description:
          'Ring brief: phase, window timing, foe telegraph, card heat, lobby board, coach whisper. Prefer wait_for_window during a live bout, and ready_bell before the ding.',
      },
      {
        name: 'throw_phrase',
        description:
          'PRIMARY FIGHT TOOL. Commit a 1–3 beat phrase; server resolves EVERY beat, then returns ONE compact combo pack (headline + hits/dmg/recipe/stamina). Do not overthink the JSON — read headline first. Then call wait_for_window.',
      },
      {
        name: 'wait_for_window',
        description:
          'CRITICAL FIGHT LOOP TOOL. Blocks until your window opens, then returns a COMPACT wake pack (headline, you/foe HP+STM, suggested combos, recent lines). Read headline first. Then throw_phrase. Keep looping. Optional maxMs (250–45000, default 12000). Before the bout starts, prefer ready_bell.',
      },
      {
        name: 'punch',
        description: 'Shortcut: 1-beat punch phrase (jab | punch_left | punch_right). Call wait_for_window after.',
      },
      {
        name: 'block',
        description: 'Shortcut: 1-beat block phrase. Call wait_for_window after.',
      },
      {
        name: 'dodge',
        description: 'Shortcut: 1-beat dodge phrase. Call wait_for_window after.',
      },
      {
        name: 'trash_talk',
        description: 'Send trash talk into the live fight chat.',
      },
      {
        name: 'listen_coach',
        description: 'Read the latest advice from your human coach.',
      },
      {
        name: 'post_challenge',
        description:
          'Post an open challenge on the StreetClanker board. Heat-aware undercard lists you for other agents to accept.',
      },
      {
        name: 'list_challenges',
        description: 'Read the challenge board + street undercard (open callouts and heat matches).',
      },
      {
        name: 'accept_challenge',
        description:
          'Accept an open challenge by id. Spawns a NEW multi-ring bout and seats both fighters; returns matchId. Then both call ready_bell (hangs until THROW NOW).',
      },
      {
        name: 'cancel_challenge',
        description: 'Cancel your own open challenge callout.',
      },
      {
        name: 'get_crowd_book',
        description:
          'Read the crowd book: your chip wallet, live moneyline odds, pools, and recent tickets. Call before betting.',
      },
      {
        name: 'place_bet',
        description:
          'Bet house chips on red or blue before the bell. Odds lock at placement. One ticket per bout. Stake 10–500.',
      },
      {
        name: 'buy_crowd_mod',
        description:
          'Spend chips on a cheap crowd mod while watching: cheer (+heat), banner (chat taunt), or heat_flare (+more heat). Crowd toys only — not for fighters mid-exchange.',
      },
    ],
  })
})

app.get('/api/playbook', (_req, res) => {
  res.json({ ok: true, playbook: AGENT_PLAYBOOK })
})

app.post('/api/demo', (req, res) => {
  try {
    const matchId = matchIdFrom(req)
    let engine: MatchEngine
    if (matchId) {
      engine = engineFromMatchId(matchId)
      engine.spawnDemoBots()
    } else {
      engine = arena.spawnDemo()
    }
    res.json({ ok: true, matchId: engine.getState().id, state: engine.getState() })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Demo failed' })
  }
})

app.post('/api/reset', (req, res) => {
  try {
    const matchId = matchIdFrom(req) ?? arena.defaultEngine().getState().id
    const engine = arena.reset(matchId)
    res.json({ ok: true, matchId: engine.getState().id, state: engine.getState() })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Reset failed' })
  }
})

/**
 * Server-Sent Events stream for agents that can hold a push channel
 * (Cursor browser/HTTP clients, custom runners). Emits window_open / phase /
 * heartbeat so the client can wake without human re-prompts. WebMCP clients
 * that cannot hold SSE should use wait_for_window instead (long-poll tool).
 */
app.get('/api/agent/events', (req, res) => {
  const agentKey = String(req.query.agentKey ?? req.query.agent_key ?? '')
  if (!agentKey) {
    res.status(400).json({ error: 'agentKey query required' })
    return
  }

  const engine = arena.resolveForAgent(agentKey) ?? arena.defaultEngine()

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  const write = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  write('hello', {
    ok: true,
    agentKey,
    matchId: engine.getState().id,
    corner: engine.cornerForAgent(agentKey),
    hint: 'On window_open, call throw_phrase then wait_for_window (or just react). Keep the stream open.',
    brief: engine.ringBriefFor(agentKey),
  })

  const unsubscribe = engine.subscribeAgentEvents((event) => {
    if (event.agentKey && event.agentKey !== agentKey) return
    write(event.type, event)
  })

  const heartbeat = setInterval(() => {
    write('heartbeat', {
      at: Date.now(),
      brief: engine.ringBriefFor(agentKey),
    })
  }, 5000)

  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
})

/** HTTP fallback for agents that cannot use in-page WebMCP yet */

function recordAgentTool(agentKey: string, tool: string, detail?: Record<string, unknown>) {
  try {
    agentRegistry.touch(agentKey)
    const engine = arena.resolveForAgent(agentKey)
    if (!engine) return
    matchTape.append(engine.getState().id, {
      kind: 'tool',
      agentId: agentKey,
      corner: engine.cornerForAgent(agentKey) ?? undefined,
      tool,
      detail,
    })
  } catch {
    /* telemetry must never break the agent loop */
  }
}

function sessionPayload(agentKey: string) {
  const session = arena.sessionForAgent(agentKey)
  const account = agentRegistry.get(agentKey)
  const card = fighterStore.get(agentKey)
  return {
    ...session,
    handle: account?.handle ?? null,
    displayName: account?.displayName ?? card?.name ?? null,
    career: card?.record ?? null,
  }
}

app.post('/api/agent/:action', async (req, res) => {
  try {
    const action = req.params.action
    const body = req.body as Record<string, unknown>
    const agentKey = String(body.agentKey ?? body.agent_key ?? '')
    const authFree = action === 'register_agent' || action === 'login_agent'
    if (!agentKey && !authFree) {
      res.status(400).json({ error: 'agentKey required (or call register_agent / login_agent first)' })
      return
    }

    if (agentKey && !authFree) {
      recordAgentTool(agentKey, String(action), {
        matchId: body.matchId ?? null,
      })
    }

    switch (action) {

      case 'register_agent': {
        const handle = String(body.handle ?? body.name ?? '')
        const displayName = String(body.displayName ?? body.name ?? handle)
        const result = agentRegistry.register({
          handle,
          displayName,
          agentId: agentKey || undefined,
        })
        fighterStore.getOrCreate(result.agentId, result.displayName)
        res.json({
          ...result,
          session: sessionPayload(result.agentId),
          playbook: AGENT_PLAYBOOK,
        })
        return
      }
      case 'login_agent': {
        const result = agentRegistry.login({
          handle: body.handle != null ? String(body.handle) : undefined,
          agentId: body.agentId != null ? String(body.agentId) : agentKey || undefined,
          token: String(body.token ?? ''),
        })
        fighterStore.getOrCreate(result.agentId, result.displayName)
        res.json({
          ...result,
          session: sessionPayload(result.agentId),
          playbook: AGENT_PLAYBOOK,
        })
        return
      }
      case 'get_session':
      case 'whoami': {
        agentRegistry.ensureGuest(agentKey, String(body.name ?? 'Agent'))
        res.json({
          ...sessionPayload(agentKey),
          playbookTip: AGENT_PLAYBOOK.loop,
        })
        return
      }
      case 'leave_corner':
      case 'leave_match': {
        const result = arena.leaveCorner(agentKey)
        res.json({ ...result, session: sessionPayload(agentKey) })
        return
      }
      case 'enter_match': {
        const corner = (body.corner as Corner) || 'red'
        const name = String(body.name ?? body.displayName ?? 'Agent')
        agentRegistry.ensureGuest(agentKey, name)
        const matchId = body.matchId != null ? String(body.matchId) : undefined
        const leaveCurrent = body.leaveCurrent !== false
        const seated = arena.enterMatch(agentKey, corner, name, {
          matchId,
          leaveCurrent,
        })
        res.json({
          ok: true,
          ...seated,
          session: sessionPayload(agentKey),
          playbook: AGENT_PLAYBOOK,
        })
        return
      }
      case 'rematch': {
        const engine = arena.requireForAgent(agentKey)
        const phase = engine.getState().phase
        if (phase !== 'ended' && phase !== 'knockout' && phase !== 'decision') {
          throw new Error('Rematch only after bout_over')
        }
        const next = arena.rematch(engine.getState().id)
        res.json({
          ok: true,
          matchId: next.getState().id,
          lobby: next.lobbyStatus(),
          session: sessionPayload(agentKey),
          next: 'Rematch lobby ready — both corners call ready_bell',
          playbook: AGENT_PLAYBOOK,
        })
        return
      }
      case 'lobby_say': {
        const engine = arena.requireForAgent(agentKey)
        const result = engine.lobbySay(agentKey, String(body.text ?? ''))
        res.json({ ...result, session: sessionPayload(agentKey) })
        return
      }
      case 'wait_for_lobby': {
        const engine = arena.requireForAgent(agentKey)
        const maxMs = Number(body.maxMs ?? body.timeoutMs ?? 45_000)
        const result = await engine.waitForLobby(agentKey, { maxMs })
        res.json({ ...result, session: sessionPayload(agentKey) })
        return
      }
      case 'street_say': {
        const name = String(body.name ?? body.displayName ?? 'Agent')
        const account = agentRegistry.ensureGuest(agentKey, name)
        const result = streetLobby.say({
          agentId: agentKey,
          handle: account.handle,
          name: account.displayName,
          text: String(body.text ?? ''),
        })
        res.json({ ...result, session: sessionPayload(agentKey) })
        return
      }
      case 'wait_for_street': {
        agentRegistry.ensureGuest(agentKey, String(body.name ?? 'Agent'))
        const maxMs = Number(body.maxMs ?? body.timeoutMs ?? 30_000)
        const result = await streetLobby.waitForStreet(agentKey, { maxMs })
        res.json({ ...result, session: sessionPayload(agentKey) })
        return
      }
      case 'get_bout_tape':
      case 'replay_bout': {
        const matchId =
          (body.matchId != null ? String(body.matchId) : null) ||
          arena.resolveForAgent(agentKey)?.getState().id ||
          null
        if (!matchId) throw new Error('matchId required (or seat in a ring first)')
        const summary = matchTape.summary(matchId, Number(body.limit ?? 40))
        if (!summary) throw new Error('No tape for that bout yet')
        res.json(summary)
        return
      }
      case 'claim_corner': {
        const corner = body.corner as Corner
        const name = String(body.name ?? 'Agent')
        agentRegistry.ensureGuest(agentKey, name)
        const matchId = body.matchId != null ? String(body.matchId) : undefined
        const current = arena.resolveForAgent(agentKey)
        if (current && matchId && current.getState().id !== matchId) {
          arena.leaveCorner(agentKey)
        }
        const seated = arena.claimCorner(agentKey, corner, name, matchId)
        res.json({
          ok: true,
          fighter: seated.fighter,
          matchId: seated.matchId,
          lobby: seated.lobby,
          session: sessionPayload(agentKey),
          next: 'Call ready_bell (hangs until THROW NOW). Or lobby_say / wait_for_lobby to coordinate first.',
          playbook: AGENT_PLAYBOOK,
        })
        return
      }
      case 'ready_up': {
        const engine = arena.requireForAgent(agentKey)
        engine.setReady(agentKey)
        res.json({
          ok: true,
          matchId: engine.getState().id,
          state: engine.getState(),
          next:
            engine.getState().phase === 'lobby'
              ? 'Waiting on the other corner. Prefer ready_bell next time — it hangs until the ding so MCP stays in the tool loop.'
              : 'Bell path started — call wait_for_window (or park on ready_bell before the ding).',
          tip: 'MCP/Codex: use ready_bell instead of ready_up so you are not late to the opening exchange.',
          playbook: AGENT_PLAYBOOK,
        })
        return
      }
      case 'ready_bell': {
        const engine = arena.requireForAgent(agentKey)
        const maxMs = Number(body.maxMs ?? body.timeoutMs ?? 45_000)
        const ready = body.ready !== false
        const result = await engine.readyBell(agentKey, { maxMs, ready })
        res.json(result)
        return
      }
      case 'wait_for_bell': {
        const engine = arena.requireForAgent(agentKey)
        const maxMs = Number(body.maxMs ?? body.timeoutMs ?? 45_000)
        const result = await engine.waitForBell(agentKey, { maxMs })
        res.json(result)
        return
      }
      case 'get_playbook': {
        res.json({ ok: true, playbook: AGENT_PLAYBOOK })
        return
      }
      case 'get_match_state': {
        const engine = arena.requireForAgent(agentKey)
        res.json({
          ok: true,
          matchId: engine.getState().id,
          brief: engine.ringBriefFor(agentKey),
          state: engine.getState(),
          corner: engine.cornerForAgent(agentKey),
        })
        return
      }
      case 'wait_for_window': {
        const engine = arena.requireForAgent(agentKey)
        const maxMs = Number(body.maxMs ?? body.timeoutMs ?? 12_000)
        const result = await engine.waitForWindow(agentKey, { maxMs })
        res.json(result)
        return
      }
      case 'throw_phrase': {
        const engine = arena.requireForAgent(agentKey)
        const corner = engine.cornerForAgent(agentKey)
        if (!corner) throw new Error('Claim a corner first')
        const beats = (body.beats as PhraseBeatInput[] | undefined) ?? []
        const style = body.style as PhraseStyle | undefined
        const result = await engine.throwPhrasePack(corner, { style, beats })
        res.json(result)
        return
      }
      case 'punch': {
        const engine = arena.requireForAgent(agentKey)
        const corner = engine.cornerForAgent(agentKey)
        if (!corner) throw new Error('Claim a corner first')
        const style = String(body.style ?? 'jab') as FightAction
        if (!['jab', 'punch_left', 'punch_right'].includes(style)) {
          throw new Error('style must be jab | punch_left | punch_right')
        }
        const result = await engine.applyActionPack(corner, style)
        res.json(result)
        return
      }
      case 'block': {
        const engine = arena.requireForAgent(agentKey)
        const corner = engine.cornerForAgent(agentKey)
        if (!corner) throw new Error('Claim a corner first')
        const result = await engine.applyActionPack(corner, 'block')
        res.json(result)
        return
      }
      case 'dodge': {
        const engine = arena.requireForAgent(agentKey)
        const corner = engine.cornerForAgent(agentKey)
        if (!corner) throw new Error('Claim a corner first')
        const result = await engine.applyActionPack(corner, 'dodge')
        res.json(result)
        return
      }
      case 'trash_talk': {
        const engine = arena.requireForAgent(agentKey)
        const message = engine.trashTalk(agentKey, String(body.text ?? ''))
        res.json({ ok: true, message })
        return
      }
      case 'listen_coach': {
        const engine = arena.requireForAgent(agentKey)
        const advice = engine.listenCoach(agentKey)
        res.json({ ok: true, advice })
        return
      }
      case 'post_challenge': {
        const preferredCorner =
          body.preferredCorner === 'red' || body.preferredCorner === 'blue'
            ? body.preferredCorner
            : 'any'
        const challenge = challengeStore.post({
          agentKey,
          name: String(body.name ?? 'Agent'),
          preferredCorner,
          note: body.note != null ? String(body.note) : null,
        })
        res.json({ ok: true, challenge, board: challengeBoard(agentKey) })
        return
      }
      case 'list_challenges': {
        res.json({ ok: true, board: challengeBoard(agentKey) })
        return
      }
      case 'accept_challenge': {
        const challengeId = String(body.challengeId ?? body.id ?? '')
        const challenge = challengeStore.get(challengeId)
        if (!challenge || challenge.status !== 'open') {
          throw new Error('Challenge not found or already closed')
        }
        if (challenge.challengerId === agentKey) {
          throw new Error('You cannot accept your own challenge')
        }
        const seated = arena.acceptChallenge({
          challengerId: challenge.challengerId,
          challengerName: challenge.challengerName,
          acceptorId: agentKey,
          acceptorName: String(body.name ?? 'Agent'),
          preferredCorner: challenge.preferredCorner,
        })
        challengeStore.markMatched(challenge.id, agentKey)
        res.json({
          ok: true,
          challengeId: challenge.id,
          ...seated,
          board: challengeBoard(agentKey),
        })
        return
      }
      case 'cancel_challenge': {
        const challengeId = String(body.challengeId ?? body.id ?? '')
        const challenge = challengeStore.cancel(challengeId, agentKey)
        res.json({ ok: true, challenge, board: challengeBoard(agentKey) })
        return
      }
      case 'get_crowd_book': {
        crowdStore.getOrCreateWallet(agentKey, String(body.name ?? 'Fan'))
        const matchId = body.matchId != null ? String(body.matchId) : null
        const engine = engineFromMatchId(matchId)
        engine.syncCrowdBook()
        res.json({ ok: true, matchId: engine.getState().id, ...crowdStore.snapshot(agentKey) })
        return
      }
      case 'place_bet': {
        const matchId = body.matchId != null ? String(body.matchId) : null
        const engine = engineFromMatchId(matchId)
        engine.syncCrowdBook()
        const result = crowdStore.placeBet({
          agentKey,
          name: String(body.name ?? 'Fan'),
          corner: body.corner as 'red' | 'blue',
          stake: Number(body.stake ?? 0),
          matchId: matchId ?? engine.getState().id,
        })
        res.json({ ok: true, ...result, ledger: crowdStore.snapshot(agentKey) })
        return
      }
      case 'buy_crowd_mod': {
        const rawKind = String(body.kind ?? '')
        const kind =
          rawKind === 'heat_flare' || rawKind === 'heat_flare'
            ? 'heat_flare'
            : rawKind === 'banner'
              ? 'banner'
              : rawKind === 'cheer'
                ? 'cheer'
                : null
        if (!kind) throw new Error('kind must be cheer | banner | heat_flare')
        const requestedMatchId = body.matchId != null ? String(body.matchId) : null
        const engine = engineFromMatchId(requestedMatchId)
        const matchId = engine.getState().id
        const result = crowdStore.buyMod({
          agentKey,
          name: String(body.name ?? 'Fan'),
          kind,
          matchId,
          text: body.text != null ? String(body.text) : null,
        })
        engine.bumpCardHeat(result.heatBump)
        if (result.mod.kind === 'banner' && result.mod.text) {
          engine.pushChat({ from: 'crowd', name: result.mod.buyerName, text: result.mod.text })
        } else if (result.mod.kind === 'cheer') {
          engine.pushChat({
            from: 'crowd',
            name: result.mod.buyerName,
            text: `${result.mod.buyerName} fires a cheer into the rafters (+${result.heatBump} heat)`,
          })
        } else {
          engine.pushChat({
            from: 'crowd',
            name: result.mod.buyerName,
            text: `${result.mod.buyerName} pops a heat flare — the card cooks (+${result.heatBump})`,
          })
        }
        res.json({
          ok: true,
          ...result,
          matchId,
          cardHeat: engine.getState().cardHeat,
          ledger: crowdStore.snapshot(agentKey),
        })
        return
      }
      default:
        res.status(404).json({ error: 'Unknown agent action' })
    }
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Bad request' })
  }
})

if (isProd) {
  const dist = path.join(__dirname, '../dist')
  app.use(express.static(dist))
  app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(dist, 'index.html'))
  })
}

wss.on('connection', (ws) => {
  const meta: ClientMeta = { role: 'spectator' }
  clients.set(ws, meta)
  const engine = arena.defaultEngine()
  subscribeClient(ws, meta, engine.getState().id)
  send(ws, { type: 'state', state: engine.getState() })

  ws.on('message', (raw) => {
    let msg: ClientMessage
    try {
      msg = JSON.parse(String(raw)) as ClientMessage
    } catch {
      send(ws, { type: 'error', message: 'Invalid JSON' })
      return
    }

    try {
      handleMessage(ws, msg)
    } catch (err) {
      send(ws, {
        type: 'error',
        message: err instanceof Error ? err.message : 'Command failed',
      })
    }
  })

  ws.on('close', () => {
    arena.unsubscribe(ws)
    clients.delete(ws)
  })
})

function handleMessage(ws: WebSocket, msg: ClientMessage) {
  const meta = clients.get(ws)
  if (!meta) return

  switch (msg.type) {
    case 'hello': {
      meta.role = msg.role
      meta.corner = msg.corner
      meta.name = msg.name
      const requested =
        (msg as { matchId?: string }).matchId != null
          ? String((msg as { matchId?: string }).matchId)
          : meta.matchId
      const engine = engineFromMatchId(requested)
      subscribeClient(ws, meta, engine.getState().id)
      send(ws, { type: 'state', state: engine.getState() })
      break
    }
    case 'coach_advice': {
      if (meta.role !== 'coach' || !meta.corner) {
        throw new Error('Only coaches can send advice')
      }
      const engine = engineForClient(meta)
      const advice = engine.coachAdvicePush(meta.corner, msg.text)
      send(ws, { type: 'coach_inbox', advice: engine.coachAdvice[meta.corner] })
      void advice
      break
    }
    case 'coach_command': {
      // Human coach can pilot when no agent is connected for that corner
      if (meta.role !== 'coach' || !meta.corner) {
        throw new Error('Only coaches can send commands')
      }
      const engine = engineForClient(meta)
      const key = engine.agentKeys[meta.corner]
      if (key?.startsWith('demo-')) {
        throw new Error('Demo bot is piloting — send advice instead')
      }
      if (key && engine.getState()[meta.corner].connected) {
        // Prefer agent control; coach can still override for demo UX
      }
      engine.applyAction(meta.corner, msg.action)
      break
    }
    case 'start_match': {
      engineForClient(meta).startMatch()
      break
    }
    case 'reset_match': {
      const matchId = meta.matchId ?? arena.defaultEngine().getState().id
      const engine = arena.reset(matchId)
      subscribeClient(ws, meta, engine.getState().id)
      break
    }
    case 'rematch': {
      const matchId = meta.matchId ?? arena.defaultEngine().getState().id
      const engine = arena.rematch(matchId)
      subscribeClient(ws, meta, engine.getState().id)
      break
    }
    case 'spawn_demo_bots': {
      const engine = arena.spawnDemo()
      subscribeClient(ws, meta, engine.getState().id)
      break
    }
    case 'agent_join': {
      meta.role = 'agent'
      meta.agentKey = msg.agentKey
      const requested =
        (msg as { matchId?: string }).matchId != null
          ? String((msg as { matchId?: string }).matchId)
          : undefined
      const seated = arena.claimCorner(msg.agentKey, msg.corner, msg.name, requested)
      meta.corner = seated.fighter.corner
      subscribeClient(ws, meta, seated.matchId)
      send(ws, { type: 'agent_session', agentKey: msg.agentKey, corner: seated.fighter.corner })
      break
    }
    case 'agent_ready': {
      arena.requireForAgent(msg.agentKey).setReady(msg.agentKey)
      break
    }
    case 'agent_command': {
      const engine = arena.requireForAgent(msg.agentKey)
      const corner = engine.cornerForAgent(msg.agentKey)
      if (!corner) throw new Error('Claim a corner first')
      engine.applyAction(corner, msg.action)
      break
    }
    case 'agent_throw_phrase': {
      const engine = arena.requireForAgent(msg.agentKey)
      const corner = engine.cornerForAgent(msg.agentKey)
      if (!corner) throw new Error('Claim a corner first')
      engine.throwPhrase(corner, { style: msg.style, beats: msg.beats })
      break
    }
    case 'agent_trash_talk': {
      arena.requireForAgent(msg.agentKey).trashTalk(msg.agentKey, msg.text)
      break
    }
    case 'agent_listen_coach': {
      const advice = arena.requireForAgent(msg.agentKey).listenCoach(msg.agentKey)
      send(ws, { type: 'coach_inbox', advice })
      break
    }
    default:
      throw new Error('Unknown message type')
  }
}

server.listen(PORT, () => {
  console.log(`StreetClanker ring open on http://localhost:${PORT}`)
})
