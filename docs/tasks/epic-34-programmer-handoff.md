# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-25 |
| Author (Pusya) | Programmer (Pusya) |
| Task / Story / EPIC | EPIC 34 — Email + Code Stub Auth, Persistent Sessions |
| Branch / commit / PR | `task/epic-34-account-auth-sessions` — see tip SHA after push; base `master` @ `158f4f4` |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. Shared WS protocol: `account_register` / `account_login` / `account_session_resume` + `account_created` / `account_login_result` / `account_session_result`.
2. Redis `AccountStore` (`cw:account:v1:…`): bcrypt-hashed `NNN-NNN` codes, SHA-256-hashed session tokens, 180-day sliding TTL, login rate limits (5/email + 10/connection per 15 min).
3. Lobby UI: email → code reveal (stub, not emailed) / login / silent `localStorage` resume (`cubewars_session_token`); nickname/join unchanged. Economy keying untouched.

## Changed files / areas

- `shared/src/index.ts` — account message types
- `server/src/accounts/` — store + rate limit; `server/src/index.ts` — pre-join WS handlers
- `client/src/accountAuth.ts`, `network.ts`, `main.ts`, `client/index.html`
- `scripts/regression-account-auth.ts`, `package.json` (`regression:account-auth`)
- `README.md`, `config.vars.example` — document account Redis namespace (no new env vars)
- Dependency: `bcryptjs` (server) for code hashing

## How to verify (steps for Trusya)

1. `docker compose up -d redis` + `npm run dev`. Open client with empty localStorage → enter email → Continue → **save the on-screen code** → Continue → nickname/mode-select works; session token stored.
2. Reload: email/code UI skipped (“Signed in as …”); nickname/mode-select immediately usable.
3. Clear `localStorage` (or other browser): email → Continue → enter saved code → login succeeds.
4. Wrong code → generic rejection (no “email not found”). Repeat wrong codes ≥5 times → `rate_limited`; server log shows abuse / rate_limited (no plaintext code/token in logs).
5. Existing nickname join / lobby regressions still behave (auth does not replace nickname).

## Build and run

- Build command: `npm run typecheck` && `npm run build`
- Run command: `npm run regression:account-auth` (also `npm run regression:lobby-nicknames` PASS locally)
- Expected smoke result: typecheck/build clean; `[account-auth] PASS`

## Configuration

- New environment variables: no (reuses `CUBEWARS_REDIS_URL` / same Redis prefix as economy)
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout
- Key success messages: `[accounts] redis ready: …`, `[accounts] registered …`, `[accounts] login ok …`, `[accounts] session resume ok …`; abuse: `[accounts] abuse signal: …` / `login rate_limited …` (emails redacted; never log code or token)

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: email normalize/validate; code generate+bcrypt verify; session issue/validate/refresh; rate limits; generic failure reasons (no email enumeration on login)
- What the client is allowed to predict/render only: send register/login/resume intents; display one-time stub code from `account_created`; persist opaque token in `localStorage`

## Risks / known limitations

- 6-digit code space is small — rate limit is load-bearing; recommend Infosec pass before treating as hardened (per EPIC 34 §8).
- Session TTL is **180 days sliding** (judgment call vs literal forever) — override if product wants zero expiry.
- Hash library choice: **bcryptjs** (pure JS; no native addon). Session tokens stored as SHA-256 digests, not raw.
- Second Redis TCP connection for AccountStore (same pattern as AvatarProfileStore); economy documents untouched.
- Auth is UI-gated on the client; server still allows `join` without account (by design — nickname stays independent).

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
