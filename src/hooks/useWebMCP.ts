import { useEffect, useRef, useState } from 'react'
import type {
  Corner,
  FightAction,
  MatchState,
  PhraseBeatInput,
  PhraseStyle,
} from '../types'

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
    options?: { signal?: AbortController['signal'] },
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
    throwPhrase: (
      style: PhraseStyle | undefined,
      beats: PhraseBeatInput[],
    ) => Promise<ToolResult>
    trashTalk: (text: string) => Promise<ToolResult>
    listenCoach: () => Promise<ToolResult>
    brief: () => Promise<ToolResult>
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
          'Join BoxClub as a fighting agent. Pick red or blue corner and a fighter name. Human coaches sit ringside; you throw the phrases.',
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
          'Vegas ring brief: phase, your window timing, foe telegraph, card heat, announcer line, coach whisper. Call between phrases.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        execute: wrap('get_match_state', async () => optionsRef.current.sendAgent.brief()),
      },
      {
        name: 'throw_phrase',
        description:
          'PRIMARY FIGHT TOOL. Commit a 1–3 beat phrase on the shared ring clock. Server owns timing — you commit intent (jab/punch_left/punch_right/block/dodge/taunt). Styles: aggressive, counter, pressure, showboat. Miss your window and you auto-cover.',
        inputSchema: {
          type: 'object',
          properties: {
            style: {
              type: 'string',
              enum: ['aggressive', 'counter', 'pressure', 'showboat'],
            },
            beats: {
              type: 'array',
              minItems: 1,
              maxItems: 3,
              items: {
                type: 'object',
                properties: {
                  move: {
                    type: 'string',
                    enum: [
                      'jab',
                      'punch_left',
                      'punch_right',
                      'block',
                      'dodge',
                      'taunt',
                    ],
                  },
                  at: {
                    type: 'number',
                    description:
                      'Optional ms offset from phrase start. Omit to let the ring space beats.',
                  },
                },
                required: ['move'],
              },
            },
          },
          required: ['beats'],
        },
        annotations: { consequentialHint: true },
        execute: wrap('throw_phrase', async (args) => {
          const beats = (args.beats as PhraseBeatInput[]) ?? []
          return optionsRef.current.sendAgent.throwPhrase(
            args.style as PhraseStyle | undefined,
            beats,
          )
        }),
      },
      {
        name: 'punch',
        description:
          'Shortcut: commit a 1-beat punch phrase. Prefer throw_phrase for combos.',
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
        description: 'Shortcut: 1-beat block phrase. Prefer throw_phrase for counter setups.',
        inputSchema: { type: 'object', properties: {} },
        execute: wrap('block', async () =>
          optionsRef.current.sendAgent.action('block'),
        ),
      },
      {
        name: 'dodge',
        description: 'Shortcut: 1-beat dodge phrase.',
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
