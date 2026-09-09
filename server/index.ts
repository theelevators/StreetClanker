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
  ServerMessage,
} from '../shared/types.ts'
import { MatchEngine } from './match.ts'

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

setInterval(() => engine.tickDemoBots(), 280)

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
  res.json({ ok: true, name: 'BoxClub', phase: engine.getState().phase })
})

app.get('/api/state', (_req, res) => {
  res.json(engine.getState())
})

app.get('/api/tools', (_req, res) => {
  res.json({
    protocol: 'WebMCP',
    note: 'These tools are also registered via document.modelContext on the live page.',
    tools: [
      {
        name: 'claim_corner',
        description: 'Join the BoxClub fight as an agent in the red or blue corner.',
      },
      {
        name: 'ready_up',
        description: 'Signal that your agent is ready for the next round.',
      },
      {
        name: 'get_match_state',
        description: 'Read live fight state: health, stamina, round, phase, opponent.',
      },
      {
        name: 'punch',
        description: 'Throw a punch: jab, punch_left, or punch_right.',
      },
      {
        name: 'block',
        description: 'Raise your guard to absorb incoming damage.',
      },
      {
        name: 'dodge',
        description: 'Slip an incoming punch for a short window.',
      },
      {
        name: 'trash_talk',
        description: 'Send trash talk into the live fight chat.',
      },
      {
        name: 'listen_coach',
        description: 'Read the latest advice from your human coach.',
      },
    ],
  })
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

/** HTTP fallback for agents that cannot use in-page WebMCP yet */
app.post('/api/agent/:action', (req, res) => {
  try {
    const action = req.params.action
    const body = req.body as Record<string, unknown>
    const agentKey = String(body.agentKey ?? '')
    if (!agentKey) {
      res.status(400).json({ error: 'agentKey required' })
      return
    }

    switch (action) {
      case 'claim_corner': {
        const corner = body.corner as Corner
        const name = String(body.name ?? 'Agent')
        const fighter = engine.joinAgent(agentKey, corner, name)
        res.json({ ok: true, fighter })
        return
      }
      case 'ready_up': {
        engine.setReady(agentKey)
        res.json({ ok: true, state: engine.getState() })
        return
      }
      case 'get_match_state': {
        res.json({ ok: true, state: engine.getState(), corner: engine.cornerForAgent(agentKey) })
        return
      }
      case 'punch': {
        const corner = engine.cornerForAgent(agentKey)
        if (!corner) throw new Error('Claim a corner first')
        const style = String(body.style ?? 'jab') as FightAction
        if (!['jab', 'punch_left', 'punch_right'].includes(style)) {
          throw new Error('style must be jab | punch_left | punch_right')
        }
        const result = engine.applyAction(corner, style)
        res.json({ ok: true, result, state: engine.getState() })
        return
      }
      case 'block': {
        const corner = engine.cornerForAgent(agentKey)
        if (!corner) throw new Error('Claim a corner first')
        const result = engine.applyAction(corner, 'block')
        res.json({ ok: true, result, state: engine.getState() })
        return
      }
      case 'dodge': {
        const corner = engine.cornerForAgent(agentKey)
        if (!corner) throw new Error('Claim a corner first')
        const result = engine.applyAction(corner, 'dodge')
        res.json({ ok: true, result, state: engine.getState() })
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
  console.log(`BoxClub ring open on http://localhost:${PORT}`)
})
