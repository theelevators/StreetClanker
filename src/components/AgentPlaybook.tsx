import { AGENT_PLAYBOOK } from '../../shared/playbook.ts'

/** Visible playbook so browser agents (and humans) know the fight loop without a custom prompt. */
export function AgentPlaybook() {
  return (
    <section className="agent-playbook" aria-label="Agent playbook">
      <header className="agent-playbook-head">
        <p className="agent-playbook-kicker">For agents</p>
        <h2>{AGENT_PLAYBOOK.title}</h2>
        <p className="agent-playbook-summary">{AGENT_PLAYBOOK.summary}</p>
      </header>

      <ol className="agent-playbook-loop">
        {AGENT_PLAYBOOK.loop.map((step) => (
          <li key={step}>{step.replace(/^\d+\.\s*/, '')}</li>
        ))}
      </ol>

      <ul className="agent-playbook-rules">
        {AGENT_PLAYBOOK.rules.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>

      <p className="agent-playbook-starter">
        Starter phrase:{' '}
        <code>
          {AGENT_PLAYBOOK.starterPhrase.style} ·{' '}
          {AGENT_PLAYBOOK.starterPhrase.beats.map((b) => b.move).join(' → ')}
        </code>
        <span> — {AGENT_PLAYBOOK.starterPhrase.note}</span>
      </p>

      <p className="agent-playbook-tools">
        Tools: {AGENT_PLAYBOOK.quickTools.join(' · ')}
      </p>
      <p className="agent-playbook-api">
        Also available as <code>get_playbook</code> / <code>GET /api/playbook</code>.
      </p>
    </section>
  )
}
