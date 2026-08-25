# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-25 |
| Task / Story / EPIC | EPIC 34 — Email + Code Stub Auth, Persistent Sessions; AC §7; tasks 34.1–34.6 |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-34-programmer-handoff.md` (impl `c3512d6`); QA on branch tip `7bfd177` |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Linux 5.15; Node via nvm v24.18.1; Redis `PONG` on `:6379` (already bound; compose start skipped); Playwright Chromium
- Branch / commit: `task/epic-34-account-auth-sessions` @ `7bfd17769712b7a90a8f01317d31b23c9689d05d`
- Live stack for smoke: server `CUBEWARS_SERVER_PORT=7784` → `ws://127.0.0.1:7784`; client Vite `http://127.0.0.1:5202/`
- Evidence script: `qa-artifacts/epic-34/qa-epic34-tester-playwright.mjs`

## Check results

Checklist sections applied: **Universal**, **Build and run**, **Backend / game server**, **Client**, **Real-time / multiplayer** (session resume / login rate-limit), **Gameplay & feel** (post-auth bots smoke). Docs: README + `config.vars.example` updated for account Redis namespace (no new env vars).

### Build

- Command: `npm run typecheck && npm run build`
- Result: OK — shared/server/client `tsc --noEmit` clean; server `tsc` + client Vite production build OK

### Run

- Command: `npm run regression:account-auth`; `npm run regression:lobby-nicknames`; live Playwright smoke
- Result: OK — `[account-auth] PASS`; `[lobby-nicknames] PASS`; `[epic34-qa] PASS`

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| AC: typecheck/build | PASS | **PASS** |
| Register new email → one-time code + session | `NNN-NNN` shown once; token in `localStorage`; continue to mode-select | **PASS** — code `696-001` revealed (`02-register-code-reveal.png`); token stored; continue → signed-in mode-select (`03`) |
| Reload with stored token skips email/code UI | Silent resume to nickname/mode-select | **PASS** — reload shows “Signed in as …” only (`04-reload-session-resume.png`); no email/code steps |
| Fresh localStorage login with email+code | Issues working session | **PASS** — cleared storage → code prompt (`09`) → correct code → signed in (`11-login-success-mode-select.png`) |
| Wrong code → generic rejection | No email-enumeration leak | **PASS** — UI “Email or code is incorrect.” (`10-wrong-code-rejected.png`); WS `invalid_credentials` |
| Repeated failed login → rate limit | Server lockout + abuse log; no plaintext code/token in logs | **PASS** — 5× `invalid_credentials` then `rate_limited`; server log abuse + `login rate_limited`; code/token absent from logs (`server-log.txt`, `smoke-summary.json`) |
| Code never plaintext in Redis; token not logged | bcrypt `codeHash`; hashed session | **PASS** — Redis doc `codeHash` prefix `$2b$10$…`; plaintext code absent (`redis-account-doc.json`) |
| Nickname/join unaffected | Still pick nickname and join after auth | **PASS** — nickname join bots as `Qa34jyni6` (`05-bots-join-after-auth.png`); lobby-nicknames regression PASS |
| EconomyStore untouched / not keyed by accountId | Diff leaves economy alone; keys by nickname | **PASS** — `git diff master...HEAD -- server/src/economy/` empty; sample keys `cw:economy:v1:…:nicknameKey` with no accountId (`economyNotKeyedByAccountId`) |

### Config and secrets

- `config.vars.example` / README up to date: yes — account Redis namespace documented; no new env vars
- No secrets in diff: yes (bcryptjs dep + auth feature; no credentials committed)

### Documentation

- README / docs updated: yes — EPIC 34 status block in README; task + handoff docs present

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: yes — email normalize; code generate + bcrypt verify; session issue/validate (SHA-256 digest); login rate limits; generic failure reasons. Client only sends intents, displays one-time stub code from `account_created`, persists opaque token.

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s): `qa-artifacts/epic-34/`
  - `01-auth-email-empty.png` — email gate before nickname/mode
  - `02-register-code-reveal.png` — one-time stub code display
  - `03-after-register-mode-select.png` / `04-reload-session-resume.png` — signed-in lobby / silent resume
  - `05-bots-join-after-auth.png` — nickname join after auth
  - `06-bots-movement.png` / `07-bots-jump.png` / `08-bots-fire-smoke.png` — move / jump / fire smoke
  - `09-fresh-login-code-prompt.png` / `10-wrong-code-rejected.png` / `11-login-success-mode-select.png` — fresh-device login path
  - `redis-account-doc.json`, `server-log.txt`, `smoke-summary.json`, runner `qa-epic34-tester-playwright.mjs`
- Movement: OK — WASD after auth in bots
- Jump: OK — Space mid-air capture
- Shoot / hit registration: OK — fire smoke; server hit lines in `server-log.txt` during bots session
- Camera / controls feel: OK — pointer lock + canvas usable in smoke
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK — arena, viewmodel, HUD render
- Matches intended "Roblox-like" look (colorful, readable, low-poly): yes — blocky arena/viewmodel in live shots
- Console errors on exercised path: none (`consoleErrors: []`)

## On FAIL: reproduction

### Failure reason

- N/A (PASS)

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`). Briefly verified: AC §7 typecheck/build; register shows code once + immediate session; reload session resume; fresh login with code; generic wrong-code reject; rate-limit + abuse logs without plaintext secrets; bcrypt in Redis; nickname join still works; economy keying unchanged; post-auth move/jump/shoot smoke.
