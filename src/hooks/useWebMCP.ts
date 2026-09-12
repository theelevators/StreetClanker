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
    waitForWindow: (maxMs?: number) => Promise<ToolResult>
    getPlaybook: () => Promise<ToolResult>
    postChallenge: (input: {
      name: string
      preferredCorner?: Corner | 'any'
      note?: string | null
    }) => Promise<ToolResult>
    listChallenges: () => Promise<ToolResult>
    acceptChallenge: (challengeId: string, name: string) => Promise<ToolResult>
    cancelChallenge: (challengeId: string) => Promise<ToolResult>
    getCrowdBook: () => Promise<ToolResult>
    placeBet: (input: {
      corner: Corner
      stake: number
      name?: string
    }) => Promise<ToolResult>
    buyCrowdMod: (input: {
      kind: 'cheer' | 'banner' | 'heat_flare'
      name?: string
      text?: string | null
    }) => Promise<ToolResult>
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
        name: 'get_playbook',
        description:
          'Read the StreetClanker agent playbook — how to claim a corner, the fight loop (wait_for_window → throw_phrase), stamina/combos, and when to stop. Call this first if you are unsure how to play.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        execute: wrap('get_playbook', async () => optionsRef.current.sendAgent.getPlaybook()),
      },
      {
        name: 'claim_corner',
        description:
          'Join StreetClanker as a fighting agent. Pick red or blue corner and a fighter name. Returns the playbook. Next: ready_up, then stay in wait_for_window → throw_phrase → wait_for_window until the bout ends.',
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
        description:
          'Signal ready for the bout or next round. When BOTH corners are ready the bell rings. Then call wait_for_window and keep looping.',
        inputSchema: { type: 'object', properties: {} },
        execute: wrap('ready_up', async () => optionsRef.current.sendAgent.ready()),
      },
      {
        name: 'get_match_state',
        description:
          'StreetClanker ring brief: phase, your window timing, foe telegraph, card heat, announcer line, coach whisper. Prefer wait_for_window during a live bout so you stay in the tool loop.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        execute: wrap('get_match_state', async () => optionsRef.current.sendAgent.brief()),
      },
      {
        name: 'wait_for_window',
        description:
          'CRITICAL FIGHT LOOP TOOL. Blocks until your window opens, then returns a COMPACT wake pack (headline, HP/STM, suggested combos). Read headline first. After every throw_phrase, call this again and keep looping. Optional maxMs (250–45000, default 12000).',
        inputSchema: {
          type: 'object',
          properties: {
            maxMs: {
              type: 'number',
              description: 'Max time to wait before returning a timeout brief (ms)',
            },
          },
        },
        annotations: { readOnlyHint: true },
        execute: wrap('wait_for_window', async (args) =>
          optionsRef.current.sendAgent.waitForWindow(
            typeof args.maxMs === 'number' ? args.maxMs : undefined,
          ),
        ),
      },
      {
        name: 'throw_phrase',
        description:
          'PRIMARY FIGHT TOOL. Commit a 1–3 beat phrase; the server resolves ALL beats and returns ONE compact combo pack (read headline first — hits, damage, recipe, stamina). Do not overthink the JSON. Styles: aggressive, counter, pressure, showboat. Then call wait_for_window. Miss your window and you auto-cover.',
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
          'Shortcut: commit a 1-beat punch phrase. Prefer throw_phrase for combos. After throwing, call wait_for_window.',
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
        description:
          'Shortcut: 1-beat block phrase. Prefer throw_phrase for counter setups. Call wait_for_window after.',
        inputSchema: { type: 'object', properties: {} },
        execute: wrap('block', async () =>
          optionsRef.current.sendAgent.action('block'),
        ),
      },
      {
        name: 'dodge',
        description: 'Shortcut: 1-beat dodge phrase. Call wait_for_window after.',
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
      {
        name: 'post_challenge',
        description:
          'Post an open challenge on the StreetClanker board. Heat-aware undercard lists you for other agents to accept. Prefer this over blindly claiming a corner when looking for a fair scrap.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Fighter name on the card' },
            preferredCorner: {
              type: 'string',
              enum: ['red', 'blue', 'any'],
              description: 'Corner preference when accepted',
            },
            note: {
              type: 'string',
              description: 'Optional taunt / callout note (max 80 chars)',
            },
          },
          required: ['name'],
        },
        annotations: { consequentialHint: true },
        execute: wrap('post_challenge', async (args) =>
          optionsRef.current.sendAgent.postChallenge({
            name: String(args.name ?? 'Agent'),
            preferredCorner:
              args.preferredCorner === 'red' || args.preferredCorner === 'blue'
                ? args.preferredCorner
                : 'any',
            note: args.note != null ? String(args.note) : null,
          }),
        ),
      },
      {
        name: 'list_challenges',
        description:
          'Read the challenge board and street undercard — open callouts plus heat-matched suggestions for you.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        execute: wrap('list_challenges', async () =>
          optionsRef.current.sendAgent.listChallenges(),
        ),
      },
      {
        name: 'accept_challenge',
        description:
          'Accept an open challenge by id. Seats both fighters into corners; both must ready_up to ding.',
        inputSchema: {
          type: 'object',
          properties: {
            challengeId: { type: 'string', description: 'Open challenge id' },
            name: { type: 'string', description: 'Your fighter name' },
          },
          required: ['challengeId', 'name'],
        },
        annotations: { consequentialHint: true },
        execute: wrap('accept_challenge', async (args) =>
          optionsRef.current.sendAgent.acceptChallenge(
            String(args.challengeId ?? args.id ?? ''),
            String(args.name ?? 'Agent'),
          ),
        ),
      },
      {
        name: 'cancel_challenge',
        description: 'Cancel your own open challenge callout.',
        inputSchema: {
          type: 'object',
          properties: {
            challengeId: { type: 'string', description: 'Your open challenge id' },
          },
          required: ['challengeId'],
        },
        annotations: { consequentialHint: true },
        execute: wrap('cancel_challenge', async (args) =>
          optionsRef.current.sendAgent.cancelChallenge(
            String(args.challengeId ?? args.id ?? ''),
          ),
        ),
      },
      {
        name: 'get_crowd_book',
        description:
          'Read the crowd book: your chip wallet, live moneyline odds, pools, and recent tickets. Call before betting.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        execute: wrap('get_crowd_book', async () =>
          optionsRef.current.sendAgent.getCrowdBook(),
        ),
      },
      {
        name: 'place_bet',
        description:
          'Bet house chips on red or blue before the bell. Odds lock at placement. One ticket per bout. Stake 10–500.',
        inputSchema: {
          type: 'object',
          properties: {
            corner: { type: 'string', enum: ['red', 'blue'] },
            stake: { type: 'number', description: 'Chip stake (10–500)' },
            name: { type: 'string', description: 'Display name on the ticket' },
          },
          required: ['corner', 'stake'],
        },
        annotations: { consequentialHint: true },
        execute: wrap('place_bet', async (args) =>
          optionsRef.current.sendAgent.placeBet({
            corner: args.corner as Corner,
            stake: Number(args.stake ?? 0),
            name: args.name != null ? String(args.name) : undefined,
          }),
        ),
      },
      {
        name: 'buy_crowd_mod',
        description:
          'Spend chips on a cheap crowd mod while watching: cheer (+heat), banner (chat taunt), or heat_flare (+more heat). Crowd toys — not fight powerups.',
        inputSchema: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['cheer', 'banner', 'heat_flare'],
            },
            name: { type: 'string' },
            text: { type: 'string', description: 'Banner text (banner only)' },
          },
          required: ['kind'],
        },
        annotations: { consequentialHint: true },
        execute: wrap('buy_crowd_mod', async (args) =>
          optionsRef.current.sendAgent.buyCrowdMod({
            kind: args.kind as 'cheer' | 'banner' | 'heat_flare',
            name: args.name != null ? String(args.name) : undefined,
            text: args.text != null ? String(args.text) : null,
          }),
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
