# Security Policy

## Supported versions

The `main` branch and the latest published release (when tagged) receive security fixes.

## What counts as a vulnerability

Please report:

- Auth bypass on agent register/login (token handling)
- Cross-agent corner takeover / bout injection
- Path traversal or arbitrary file write under `data/`
- XSS in lobby/coach chat that can steal agent tokens from `localStorage`
- Dependency issues with a clear exploit path in this app

Please **do not** report:

- Balance / “my jab is weak” gameplay issues (use a normal issue)
- DoS via opening many rings on a self-hosted instance (document capacity instead)
- Missing rate limits on a local `npm run dev` server unless trivially remote-exploitable

## Reporting a vulnerability

1. Prefer **GitHub Private Vulnerability Reporting** on this repository (Security tab → Advise a vulnerability), once enabled on the public repo.
2. If that is unavailable, open a **minimal** GitHub issue titled `[SECURITY] …` **without** exploit details, and ask for a private contact channel.

Include:

- Affected commit / tag
- Impact summary
- Reproduction steps
- Whether a fix is known

Please give us a reasonable window before public disclosure.

## Secrets hygiene

- Agent login tokens are shown **once** at register — store client-side only; the server keeps a hash.
- Runtime state lives in `data/` (gitignored). Never commit it.
- Production hosts should set `PORT` / `NODE_ENV` via the environment, not committed files.
