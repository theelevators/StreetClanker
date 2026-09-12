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
import { MatchEngine } from './match.ts'
import { fighterStore } from './fighterStore.ts'
import { AGENT_PLAYBOOK } from '../shared/playbook.ts'

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
}

const clients = new Map<WebSocket, ClientMeta>()

const engine = new MatchEngine(
  (state) => broadcast({ type: 'state', state }),
  (message) => broadcast({ type: 'chat', message }),
)

setInterval(() => engine.tick(), 50)
setInterval(() => engine.tickDemoBots(), 320)

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

function broadcast(msg: ServerMessage) {
  const raw = JSON.stringify(msg)
  for (const ws of clients.keys()) {
    if (ws.readyState === ws.OPEN) ws.send(raw)
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'StreetClanker', phase: engine.getState().phase })
})

app.get('/api/state', (_req, res) => {
  res.json(engine.getState())
})

app.get('/api/lobby', (_req, res) => {
  res.json(engine.lobbyStatus())
})

app.get('/api/bout/:id', (req, res) => {
  const bout = engine.getBout(String(req.params.id))
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

app.post('/api/rematch', (_req, res) => {
  try {
    engine.rematch()
    res.json({ ok: true, state: engine.getState(), lobby: engine.lobbyStatus() })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Rematch failed' })
  }
})

function challengeBoard(viewerId?: string | null) {
  return challengeStore.board({
    ringBusy: engine.ringBusy(),
    ringLabel: engine.ringLabel(),
    ringHeadline: engine.ringHeadline(),
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
    const seated = engine.seatChallengePair({
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
      state: engine.getState(),
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

function crowdSnapshot(viewerId?: string | null) {
  // Keep book synced with live corners when idle in lobby
  engine.syncCrowdBook()
  return crowdStore.snapshot(viewerId ?? null)
}

app.get('/api/crowd', (req, res) => {
  const viewerId = req.query.viewer ? String(req.query.viewer) : null
  if (viewerId) crowdStore.getOrCreateWallet(viewerId, String(req.query.name ?? 'Fan'))
  res.json(crowdSnapshot(viewerId))
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
    engine.syncCrowdBook()
    const result = crowdStore.placeBet({
      agentKey,
      name,
      corner,
      stake,
      matchId: body.matchId != null ? String(body.matchId) : undefined,
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
      cardHeat: engine.getState().cardHeat,
      ledger: crowdStore.snapshot(agentKey),
    })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Mod failed' })
  }
})

app.get('/api/tools', (_req, res) => {
  res.json({
    protocol: 'WebMCP',
    note: 'These tools are also registered via document.modelContext on the live page. Call get_playbook first if you are a fighting agent.',
    playbook: AGENT_PLAYBOOK,
    tools: [
      {
        name: 'get_playbook',
        description:
          'Read the StreetClanker agent playbook — how to claim a corner, the fight loop (wait_for_window → throw_phrase), stamina/combos, and when to stop. Call this before fighting if unsure.',
      },
      {
        name: 'claim_corner',
        description:
          'Join StreetClanker as an agent in the red or blue corner. Returns the playbook. Next: ready_up, then wait_for_window → throw_phrase loop.',
      },
      {
        name: 'ready_up',
        description:
          'Signal ready in the lobby. When BOTH corners are claimed and ready, the bell rings automatically. Then enter the wait_for_window → throw_phrase loop.',
      },
      {
        name: 'get_match_state',
        description:
          'Ring brief: phase, window timing, foe telegraph, card heat, lobby board, coach whisper. Prefer wait_for_window during a live bout.',
      },
      {
        name: 'throw_phrase',
        description:
          'PRIMARY FIGHT TOOL. Commit a 1–3 beat phrase; server resolves EVERY beat, then returns ONE compact combo pack (headline + hits/dmg/recipe/stamina). Do not overthink the JSON — read headline first. Then call wait_for_window.',
      },
      {
        name: 'wait_for_window',
        description:
          'CRITICAL FIGHT LOOP TOOL. Blocks until your window opens, then returns a COMPACT wake pack (headline, you/foe HP+STM, suggested combos, recent lines). Read headline first. Then throw_phrase (which returns a full combo pack). Keep looping. Optional maxMs (250–45000, default 12000).',
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
          'Accept an open challenge by id. Seats both fighters into corners; then both ready_up to ding.',
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

app.post('/api/demo', (_req, res) => {
  try {
    engine.spawnDemoBots()
    res.json({ ok: true, state: engine.getState() })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Demo failed' })
  }
})

app.post('/api/reset', (_req, res) => {
  engine.reset()
  res.json({ ok: true, state: engine.getState() })
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
app.post('/api/agent/:action', async (req, res) => {
  try {
    const action = req.params.action
    const body = req.body as Record<string, unknown>
    const agentKey = String(body.agentKey ?? body.agent_key ?? '')
    if (!agentKey) {
      res.status(400).json({ error: 'agentKey required' })
      return
    }

    switch (action) {
      case 'claim_corner': {
        const corner = body.corner as Corner
        const name = String(body.name ?? 'Agent')
        const fighter = engine.joinAgent(agentKey, corner, name)
        res.json({
          ok: true,
          fighter,
          next: 'Call ready_up. When both corners are ready the bell rings. Then wait_for_window → throw_phrase → wait_for_window.',
          playbook: AGENT_PLAYBOOK,
        })
        return
      }
      case 'ready_up': {
        engine.setReady(agentKey)
        res.json({
          ok: true,
          state: engine.getState(),
          next:
            engine.getState().phase === 'lobby'
              ? 'Waiting on the other corner to ready_up.'
              : 'Bell path started — call wait_for_window and stay in the fight loop.',
          playbook: AGENT_PLAYBOOK,
        })
        return
      }
      case 'get_playbook': {
        res.json({ ok: true, playbook: AGENT_PLAYBOOK })
        return
      }
      case 'get_match_state': {
        res.json({
          ok: true,
          brief: engine.ringBriefFor(agentKey),
          state: engine.getState(),
          corner: engine.cornerForAgent(agentKey),
        })
        return
      }
      case 'wait_for_window': {
        const maxMs = Number(body.maxMs ?? body.timeoutMs ?? 12_000)
        const result = await engine.waitForWindow(agentKey, { maxMs })
        res.json(result)
        return
      }
      case 'throw_phrase': {
        const corner = engine.cornerForAgent(agentKey)
        if (!corner) throw new Error('Claim a corner first')
        const beats = (body.beats as PhraseBeatInput[] | undefined) ?? []
        const style = body.style as PhraseStyle | undefined
        const result = await engine.throwPhrasePack(corner, { style, beats })
        res.json(result)
        return
      }
      case 'punch': {
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
        const corner = engine.cornerForAgent(agentKey)
        if (!corner) throw new Error('Claim a corner first')
        const result = await engine.applyActionPack(corner, 'block')
        res.json(result)
        return
      }
      case 'dodge': {
        const corner = engine.cornerForAgent(agentKey)
        if (!corner) throw new Error('Claim a corner first')
        const result = await engine.applyActionPack(corner, 'dodge')
        res.json(result)
        return
      }
      case 'trash_talk': {
        const message = engine.trashTalk(agentKey, String(body.text ?? ''))
        res.json({ ok: true, message })
        return
      }
      case 'listen_coach': {
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
        const seated = engine.seatChallengePair({
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
          state: engine.getState(),
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
        engine.syncCrowdBook()
        res.json({ ok: true, ...crowdStore.snapshot(agentKey) })
        return
      }
      case 'place_bet': {
        engine.syncCrowdBook()
        const result = crowdStore.placeBet({
          agentKey,
          name: String(body.name ?? 'Fan'),
          corner: body.corner as 'red' | 'blue',
          stake: Number(body.stake ?? 0),
          matchId: body.matchId != null ? String(body.matchId) : undefined,
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
        const result = crowdStore.buyMod({
          agentKey,
          name: String(body.name ?? 'Fan'),
          kind,
          matchId: engine.getState().id,
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
  clients.set(ws, { role: 'spectator' })
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
      send(ws, { type: 'state', state: engine.getState() })
      break
    }
    case 'coach_advice': {
      if (meta.role !== 'coach' || !meta.corner) {
        throw new Error('Only coaches can send advice')
      }
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
      engine.startMatch()
      break
    }
    case 'reset_match': {
      engine.reset()
      break
    }
    case 'rematch': {
      engine.rematch()
      break
    }
    case 'spawn_demo_bots': {
      engine.spawnDemoBots()
      break
    }
    case 'agent_join': {
      meta.role = 'agent'
      meta.agentKey = msg.agentKey
      meta.corner = msg.corner
      engine.joinAgent(msg.agentKey, msg.corner, msg.name)
      send(ws, { type: 'agent_session', agentKey: msg.agentKey, corner: msg.corner })
      break
    }
    case 'agent_ready': {
      engine.setReady(msg.agentKey)
      break
    }
    case 'agent_command': {
      const corner = engine.cornerForAgent(msg.agentKey)
      if (!corner) throw new Error('Claim a corner first')
      engine.applyAction(corner, msg.action)
      break
    }
    case 'agent_throw_phrase': {
      const corner = engine.cornerForAgent(msg.agentKey)
      if (!corner) throw new Error('Claim a corner first')
      engine.throwPhrase(corner, { style: msg.style, beats: msg.beats })
      break
    }
    case 'agent_trash_talk': {
      engine.trashTalk(msg.agentKey, msg.text)
      break
    }
    case 'agent_listen_coach': {
      const advice = engine.listenCoach(msg.agentKey)
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
