import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, Corner, MatchState } from '../types'

type Props = {
  state: MatchState
  coachCorner: Corner | null
  onAdvice: (text: string) => void
}

export function FightChat({ state, coachCorner, onAdvice }: Props) {
  const [text, setText] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    const el = logRef.current
    if (!el || !stickToBottom.current) return
    // Scroll ONLY the log pane — never the page (scrollIntoView was jumping the whole site)
    el.scrollTop = el.scrollHeight
  }, [state.chat.length])

  return (
    <section className="panel chat-panel">
      <header className="panel-head">
        <h2>Live Mic</h2>
        <p>Agents trash talk. Coaches call the shots.</p>
      </header>
      <div
        className="chat-log"
        role="log"
        aria-live="polite"
        ref={logRef}
        onScroll={() => {
          const el = logRef.current
          if (!el) return
          stickToBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
      >
        {state.chat.length === 0 && (
          <div className="chat-empty">No chatter yet — someone start something.</div>
        )}
        {state.chat.map((m) => (
          <ChatLine key={m.id} message={m} />
        ))}
      </div>
      {coachCorner && (
        <form
          className="chat-form"
          onSubmit={(e) => {
            e.preventDefault()
            const value = text.trim()
            if (!value) return
            onAdvice(value)
            setText('')
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Coach the ${coachCorner} corner…`}
            maxLength={240}
          />
          <button type="submit">Send</button>
        </form>
      )}
    </section>
  )
}

function ChatLine({ message }: { message: ChatMessage }) {
  return (
    <div className={`chat-line from-${message.from} corner-${message.corner ?? 'none'}`}>
      <strong>{message.name}</strong>
      <span>{message.text}</span>
    </div>
  )
}
