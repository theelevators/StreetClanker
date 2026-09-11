import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ChatMessage,
  ClientMessage,
  CoachAdvice,
  Corner,
  FightAction,
  MatchState,
  ServerMessage,
} from '../types'

function wsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws`
}

export function useMatchSocket() {
  const [state, setState] = useState<MatchState | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [coachInbox, setCoachInbox] = useState<CoachAdvice[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const [chatFlash, setChatFlash] = useState<ChatMessage | null>(null)

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError('Not connected to the ring')
      return
    }
    ws.send(JSON.stringify(msg))
  }, [])

  useEffect(() => {
    let closed = false
    let retry: ReturnType<typeof setTimeout> | undefined
    let ws: WebSocket | null = null

    const connect = () => {
      // Drop any half-open socket before opening a new one (avoids proxy EPIPE spam)
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.onclose = null
        ws.onerror = null
        ws.onmessage = null
        try {
          ws.close()
        } catch {
          /* ignore */
        }
      }

      ws = new WebSocket(wsUrl())
      wsRef.current = ws

      ws.onopen = () => {
        if (closed) return
        setConnected(true)
        setError(null)
      }

      ws.onclose = () => {
        if (closed) return
        setConnected(false)
        retry = setTimeout(connect, 1200)
      }

      ws.onerror = () => {
        // Browser fires error before close on proxy blips — don't alarm unless we stay down
        if (!closed) setConnected(false)
      }

      ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as ServerMessage
        if (msg.type === 'state') setState(msg.state)
        if (msg.type === 'chat') {
          setChatFlash(msg.message)
          setState((prev) =>
            prev
              ? { ...prev, chat: [...prev.chat, msg.message].slice(-80) }
              : prev,
          )
        }
        if (msg.type === 'coach_inbox') setCoachInbox(msg.advice)
        if (msg.type === 'error') setError(msg.message)
      }
    }

    connect()

    return () => {
      closed = true
      clearTimeout(retry)
      const sock = wsRef.current
      wsRef.current = null
      if (sock) {
        sock.onclose = null
        sock.onerror = null
        sock.onmessage = null
        try {
          sock.close()
        } catch {
          /* ignore */
        }
      }
    }
  }, [])

  const joinAsCoach = useCallback(
    (corner: Corner, name: string) => {
      send({ type: 'hello', role: 'coach', corner, name })
    },
    [send],
  )

  const sendAdvice = useCallback(
    (text: string) => send({ type: 'coach_advice', text }),
    [send],
  )

  const sendCommand = useCallback(
    (action: FightAction) => send({ type: 'coach_command', action }),
    [send],
  )

  const startMatch = useCallback(() => send({ type: 'start_match' }), [send])
  const resetMatch = useCallback(() => send({ type: 'reset_match' }), [send])
  const spawnDemoBots = useCallback(() => send({ type: 'spawn_demo_bots' }), [send])

  return {
    state,
    connected,
    error,
    clearError: () => setError(null),
    coachInbox,
    chatFlash,
    joinAsCoach,
    sendAdvice,
    sendCommand,
    startMatch,
    resetMatch,
    spawnDemoBots,
    send,
  }
}
