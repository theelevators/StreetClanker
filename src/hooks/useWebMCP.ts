import { useEffect, useRef, useState } from 'react'
import type { Corner, FightAction, MatchState } from '../types'

type ToolResult = string | Record<string, unknown>

type RegisterToolInput = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: {
    readOnlyHint?: boolean
    consequentialHint?: boolean
    untrustedContentHint?: boolean
  }
  execute: (
    args: Record<string, unknown>,
    opts?: { signal?: AbortSignal },
  ) => Promise<ToolResult> | ToolResult
}

type ModelContext = {
  registerTool: (
    tool: RegisterToolInput,
    options?: { signal?: AbortSignal },
  ) => Promise<void> | void
}

declare global {
  interface Document {
    modelContext?: ModelContext
  }
  interface Navigator {
    modelContext?: ModelContext
  }
}

function getModelContext(): ModelContext | null {
  return document.modelContext ?? navigator.modelContext ?? null
}

export type WebMCPStatus = 'unsupported' | 'registering' | 'ready' | 'error'

type Options = {
  getState: () => MatchState | null
  agentKey: string
  sendAgent: {
    join: (corner: Corner, name: string) => Promise<ToolResult>
    ready: () => Promise<ToolResult>
    action: (action: FightAction) => Promise<ToolResult>
    trashTalk: (text: string) => Promise<ToolResult>
    listenCoach: () => Promise<ToolResult>
  }
}

export function useWebMCP(options: Options) {
  const [status, setStatus] = useState<WebMCPStatus>('unsupported')
  const [tools, setTools] = useState<string[]>([])
  const [lastCall, setLastCall] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    const ctx = getModelContext()
    if (!ctx?.registerTool) {
      setStatus('unsupported')
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    setStatus('registering')

    const wrap =
      (name: string, fn: (args: Record<string, unknown>) => Promise<ToolResult>) =>
      async (args: Record<string, unknown>) => {
        setLastCall(`${name}(${JSON.stringify(args)})`)
        try {
          const result = await fn(args)
          return typeof result === 'string' ? result : JSON.stringify(result)
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Tool failed'
          throw new Error(message)
        }
      }

    const defs: RegisterToolInput[] = [
      {
        name: 'claim_corner',
        description:
          'Join BoxClub as a fighting agent. Pick red or blue corner and a fighter name. Human coaches sit ringside; you throw the punches.',
        inputSchema: {
          type: 'object',
          properties: {
            corner: {
              type: 'string',
              enum: ['red', 'blue'],
              description: 'Which corner to claim',
            },
            name: {
              type: 'string',
              description: 'Your fighter display name',
            },
          },
          required: ['corner', 'name'],
        },
        annotations: { consequentialHint: true },
        execute: wrap('claim_corner', async (args) =>
          optionsRef.current.sendAgent.join(
            args.corner as Corner,
            String(args.name ?? 'Agent'),
          ),
        ),
      },
      {
        name: 'ready_up',
        description: 'Signal ready for the bout or next round.',
        inputSchema: { type: 'object', properties: {} },
        execute: wrap('ready_up', async () => optionsRef.current.sendAgent.ready()),
      },
      {
        name: 'get_match_state',
        description:
          'Read the live match: phase, round timers, your health/stamina, opponent status, and recent events. Call often between punches.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        execute: wrap('get_match_state', async () => {
          const state = optionsRef.current.getState()
          if (!state) return { error: 'No match state yet' }
          return {
            phase: state.phase,
            round: state.round,
            maxRounds: state.maxRounds,
            roundEndsAt: state.roundEndsAt,
            winner: state.winner,
            red: state.red,
            blue: state.blue,
            recentEvents: state.eventLog.slice(0, 8),
            recentChat: state.chat.slice(-6),
          }
        }),
      },
      {
        name: 'punch',
        description:
          'Throw a punch during a live round. jab is fast/light; punch_left and punch_right are heavier hooks. Respect stamina and cooldown.',
        inputSchema: {
          type: 'object',
          properties: {
            style: {
              type: 'string',
              enum: ['jab', 'punch_left', 'punch_right'],
            },
          },
          required: ['style'],
        },
        execute: wrap('punch', async (args) =>
          optionsRef.current.sendAgent.action(args.style as FightAction),
        ),
      },
      {
        name: 'block',
        description: 'Raise your guard to absorb incoming damage.',
        inputSchema: { type: 'object', properties: {} },
        execute: wrap('block', async () =>
          optionsRef.current.sendAgent.action('block'),
        ),
      },
      {
        name: 'dodge',
        description: 'Slip for a short window to avoid a punch.',
        inputSchema: { type: 'object', properties: {} },
        execute: wrap('dodge', async () =>
          optionsRef.current.sendAgent.action('dodge'),
        ),
      },
      {
        name: 'trash_talk',
        description:
          'Send trash talk into the live fight chat. Keep it playful fight-night energy — roast the other agent, not humans.',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Trash talk line' },
          },
          required: ['text'],
        },
        annotations: { untrustedContentHint: true },
        execute: wrap('trash_talk', async (args) =>
          optionsRef.current.sendAgent.trashTalk(String(args.text ?? '')),
        ),
      },
      {
        name: 'listen_coach',
        description:
          'Read advice from your human coach. You are the fighter; they are the coach — follow their game plan when it makes sense.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        execute: wrap('listen_coach', async () =>
          optionsRef.current.sendAgent.listenCoach(),
        ),
      },
    ]

    ;(async () => {
      try {
        for (const tool of defs) {
          await ctx.registerTool(tool, { signal: controller.signal })
        }
        if (!controller.signal.aborted) {
          setTools(defs.map((t) => t.name))
          setStatus('ready')
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.warn('WebMCP registration failed', err)
          setStatus('error')
        }
      }
    })()

    return () => controller.abort()
  }, [])

  return { status, tools, lastCall, supported: status !== 'unsupported' }
}

export async function agentHttp(
  action: string,
  body: Record<string, unknown>,
): Promise<ToolResult> {
  const res = await fetch(`/api/agent/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as ToolResult & { error?: string }
  if (!res.ok) throw new Error(data.error ?? 'Agent call failed')
  return data
}
