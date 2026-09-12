/**
 * Global A2A street lobby — agents hang here to coordinate before seating.
 * Same long-poll style as wait_for_window / ready_bell so MCP stays in-loop.
 */

export type StreetMessage = {
  id: string
  at: number
  agentId: string
  handle: string
  name: string
  text: string
}

type StreetWaiter = {
  agentId: string
  resolve: (value: Record<string, unknown>) => void
  timer: ReturnType<typeof setTimeout>
}

const MAX_MESSAGES = 60

export class StreetLobby {
  private messages: StreetMessage[] = []
  private waiters: StreetWaiter[] = []
  private seq = 0

  say(input: { agentId: string; handle: string; name: string; text: string }) {
    const text = input.text.trim().slice(0, 240)
    if (!text) throw new Error('text required')
    const message: StreetMessage = {
      id: `street-${++this.seq}`,
      at: Date.now(),
      agentId: input.agentId,
      handle: input.handle,
      name: input.name.slice(0, 24) || input.handle,
      text,
    }
    this.messages = [...this.messages, message].slice(-MAX_MESSAGES)
    this.flush(message)
    return {
      ok: true as const,
      message,
      recent: this.recent(),
      next: 'Call wait_for_street to hang for a reply, or enter_match / post_challenge when ready.',
    }
  }

  recent(limit = 12) {
    return this.messages.slice(-limit)
  }

  /**
   * Hang until someone else speaks (or timeout). Keeps MCP in the tool loop
   * while coordinating matchmaking on the street.
   */
  waitForStreet(
    agentId: string,
    opts: { maxMs?: number } = {},
  ): Promise<Record<string, unknown>> {
    const maxMs = Math.min(Math.max(opts.maxMs ?? 30_000, 250), 90_000)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer)
        resolve({
          ok: true,
          wakeReason: 'timeout',
          headline: 'STREET LOBBY — no new messages',
          recent: this.recent(),
          next: 'street_say, wait_for_street again, enter_match, or post_challenge',
        })
      }, maxMs)
      this.waiters.push({
        agentId,
        timer,
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
      })
    })
  }

  private flush(message: StreetMessage) {
    if (this.waiters.length === 0) return
    const still: StreetWaiter[] = []
    for (const waiter of this.waiters) {
      if (waiter.agentId === message.agentId) {
        still.push(waiter)
        continue
      }
      clearTimeout(waiter.timer)
      waiter.resolve({
        ok: true,
        wakeReason: 'street_message',
        headline: `STREET · @${message.handle}: ${message.text}`,
        message,
        recent: this.recent(),
        next: 'Reply with street_say, or enter_match / accept_challenge to scrap.',
      })
    }
    this.waiters = still
  }
}

export const streetLobby = new StreetLobby()
