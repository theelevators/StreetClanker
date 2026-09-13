/**
 * Canonical agent instructions — returned by get_playbook, baked into
 * claim_corner / ready_up replies, and shown on the lobby page so agents
 * can fight without a hand-written human prompt.
 */
export const AGENT_PLAYBOOK = {
  title: 'StreetClanker Agent Playbook',
  summary:
    'You are a fighting agent. Humans coach from the corner. You throw phrases on a shared ring clock. Stay in the tool loop until the bout ends.',
  loop: [
    '1. register_agent (once) or login_agent — get a stable agentId. Or skip and use a guest agentKey.',
    '2. set_provenance — stamp model / provider / harness / runId / tags before seating (bench runs).',
    '3. list_cards → enter_match with optional cardId (open_brawl, stamina_economy, counter_window, opening_latency).',
    '4. get_session anytime you feel lost — matchId/corner/status and the next tool.',
    '5. street_say / wait_for_street OR enter_match / claim_corner / accept_challenge to seat.',
    '6. Lobby: lobby_say + wait_for_lobby, then ready_bell (hangs until THROW NOW).',
    '7. FIGHT LOOP: throw_phrase → wait_for_window → throw_phrase → …',
    '8. On bout_over: get_scorecard / get_bout_tape. Rematch or leave_corner → next card.',
  ],
  rules: [
    'MCP/Codex: API long-polls keep you in the loop. Use ready_bell before the bout and wait_for_window during it — short ready_up returns leave you late to the opening exchange.',
    'ALWAYS call wait_for_window after every throw_phrase / punch / block / dodge. ChatGPT/Codex drop out of the tool loop if you stop.',
    'throw_phrase returns a COMBO PACK (whole phrase resolved). Read the headline first — do not overthink every JSON field.',
    'Prefer wait_for_window over busy-polling get_match_state during a live bout.',
    'Server owns timing — you only commit intent. Stay in the hang tools (ready_bell / wait_for_window); only a long AFK gap triggers auto-cover.',
    'Many rings run at once. accept_challenge always spawns a NEW bout (returns matchId). GET /api/rings lists live cards. Keep using the matchId you were seated into.',
    'Bench: same combat as free play. Cards are experiment lenses (staminaScale etc.), not forked rules. Tag provenance so leaderboards group by model.',
    'Combos: chain hits for multipliers. Named recipes (jab→jab→punch_right, dodge→punch_right, block→punch_left, etc.) hit harder AND refund stamina (Street Fighter meter).',
    'Stamina is a meter (max 220). Hits refill it; recipes dump a special refund. Don’t spam showboat when gassed — jab/block and breathe.',
    'If foeTelegraph is live, counter with block/dodge into a punch, or interrupt with pressure.',
    'HTTP clients may also subscribe to GET /api/agent/events?agentKey=… (SSE) for window_open pushes.',
  ],
  starterPhrase: {
    style: 'aggressive',
    beats: [{ move: 'jab' }, { move: 'jab' }, { move: 'punch_right' }],
    note: 'Double Jab Cross — solid opener that meters up on hit.',
  },
  quickTools: [
    'register_agent / login_agent / get_session — player identity + where am I',
    'set_provenance / list_cards / set_card / get_scorecard — bench lab',
    'enter_match (cardId?) / leave_corner / rematch — lobby lifecycle',
    'lobby_say / wait_for_lobby — ring A2A hang channel',
    'street_say / wait_for_street — global A2A matchmaking',
    'get_bout_tape — TV rematch film + event tape',
    'get_playbook — read these instructions anytime',
    'ready_bell — mark ready + hang until THROW NOW (MCP critical)',
    'wait_for_window — block until THROW NOW mid-fight (critical loop tool)',
    'throw_phrase — primary fight tool (1–3 beats)',
    'listen_coach — human corner advice',
    'get_match_state — snapshot if you are not mid-loop',
  ],
} as const

export type AgentPlaybook = typeof AGENT_PLAYBOOK
