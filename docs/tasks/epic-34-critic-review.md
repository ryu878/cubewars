# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 34 — Email + Code Stub Auth, Persistent Sessions
- Diff / PR reference: branch `task/epic-34-account-auth-sessions` vs `master` (`158f4f4`…`7bfd177`); impl commit `c3512d6`; tip `7bfd177`
- Tester PASS report reference: `docs/tasks/epic-34-tester-report.md` (commit `7bfd17769712b7a90a8f01317d31b23c9689d05d`)
- Iteration: 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff master...HEAD` — 15 files, +1473/−18; core impl `server/src/accounts/store.ts`, `server/src/index.ts`, `shared/src/index.ts`, `client/src/accountAuth.ts` |
| Tester PASS report matches this commit | PASS | Tester meta pins tip `7bfd177`; matches `git rev-parse HEAD` |
| Every acceptance criterion traceable to a change or explicit note | PASS | AC §7 mapped below (checklist #1); live QA in `qa-artifacts/epic-34/` |
| Scope matches the task (no unexplained extra changes) | PASS | No `server/src/economy/` files in diff; economy keys remain nickname-scoped (`smoke-summary.json` → `economyNotKeyedByAccountId`) |
| Gameplay evidence present (player-facing tasks only) | PASS | Auth UI + post-auth bots smoke screenshots `01`–`11` opened; movement/jump/fire evidence present |

- Gate overall: PASS → continue checklist

## Verdict

- `APPROVED`
- One-line rationale: bcrypt-hashed codes (`store.ts` ~144), SHA-256 session digests (`hashToken` ~360–362), login rate-limit + abuse logs (`LOGIN_MAX_FAILURES_PER_EMAIL=5`, server-log.txt), and zero economy-key migration (`git diff master...HEAD -- server/src/economy/` empty) — AC security surface holds with only non-blocking Infosec follow-ups.

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | PASS | | Register→`account_created` + code UI (`02-register-code-reveal.png`); resume skips email UI (`04-reload-session-resume.png`); fresh login (`11`); wrong code generic (`10`, `accountAuth.ts` ~145–147); rate_limited after 5 fails (`smoke-summary.json` `rateLimit.reasons`); typecheck/build + `regression:account-auth` per Tester |
| 2 | Server authority for gameplay-relevant state | PASS | | Code gen/hash/verify + session issue/validate + rate limit all in `AccountStore` (`store.ts`); client only sends intents (`accountAuth.ts` / `main.ts` send wiring) |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | | Auth over existing `ws` messages (`shared/src/index.ts`); Redis reuse; plain HTML/CSS UI; `bcryptjs` as allowed small utility (handoff) |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | | Code: bcrypt (`store.ts` 144, Redis `$2b$10$` in `redis-account-doc.json`); tokens: `randomBytes(32)` + SHA-256 at rest (`319–332`, `360–362`); never logged (server-log.txt; regression asserts); email/code rendered via `textContent` (`accountAuth.ts` 105, 212); login failures generic (`194–199`) |
| 5 | Error handling | PASS | | WS handler `.catch` paths return safe reasons (`server/src/index.ts` account_* handlers); invalid/expired session → `invalid_token` + Redis del (`store.ts` 221–238) |
| 6 | Logging / observability | PASS | | Register/login/resume + abuse/rate_limited with redacted email (`redactEmail` 365–372); no code/token in logs (Tester + regression) |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | PASS | | Unit + live WS regression (`scripts/regression-account-auth.ts`); Playwright wrong-code + rate-limit + Redis hash inspect + economy key scan |
| 8 | Readability / maintainability | PASS | | Dedicated `server/src/accounts/`; constants for TTL/limits at top of `store.ts`; protocol comments mark stub code delivery |
| 9 | Scope discipline | PASS | | Diff confined to auth protocol/store/UI/docs/regression; economy/match combat files untouched |
| 10 | Config / docs updated | PASS | | README EPIC 34 block; `config.vars.example` documents `cw:account:v1:…` namespace (note: AOF wipe WARNING condensed away — non-blocking) |
| 11 | No dead code / debug scaffolding | PASS | | `accountId` on connection is used for already_authenticated guards; no leftover debug dumps in shipped code |
| 12 | Regression risk considered | PASS | | Nickname/join still works (`05`, lobby-nicknames regression PASS); mode-select gated until auth (`main.ts` onAuthenticated → `modeSelect.enable()`); join path unchanged aside from preceding auth handlers |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | PASS | | Post-auth bots: `06-bots-movement.png`, `07-bots-jump.png`, `08-bots-fire-smoke.png`; hit lines in `server-log.txt` |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS | | Arena brick/sand + blocky viewmodel in `06`; auth overlay is plain HTML matching existing lobby chrome |
| 15 | Controls & feel usable | PASS | | Tester: pointer lock + WASD/Space/fire after auth; consoleErrors `[]` |
| 16 | Playability sanity (honest fun/usability call) | PASS | | Auth stub UX is clear (code reveal + save warning in `02`); does not break lobby→bots play path |

## Findings (actionable)

_None blocking. No `REVISE` finding IDs._

## Revision task (if REVISE)

- N/A (`APPROVED`)

## Notes (non-blocking)

- **N-001 (Infosec follow-up):** Login rate limits are process-local Maps (`store.ts` 86–87, 276–317). Restart clears lockouts; multi-instance would not share counters. Adequate for current single-process server and verified live (`server-log.txt` abuse + `rate_limited`), but Redis-backed limits belong in the Infosec pass already flagged in EPIC §8 / handoff.
- **N-002 (by design / scope):** `join` does not require `accountId` (`server/src/index.ts` join handler). Auth is client-gated (`modeSelect.enabled` starts false; enabled only in `onAuthenticated`). Matches EPIC §4–§5 (nickname independent; no economy migration). Do not treat as a sneak-in — future EPICs may enforce account-bound identity server-side.
- **N-003:** `account_register` is not rate-limited (only `account_login`). Unbounded register spam is outside AC; worth Infosec awareness.
- **N-004:** Session TTL is 180-day sliding (`SESSION_TTL_MS`) as documented judgment call vs literal forever — product override possible.
- **N-005 (docs):** `config.vars.example` rewrite dropped the explicit Redis AOF/RDB wipe WARNING present on `master`; account namespace docs are correct, but restoring that ops warning would avoid silent doc regression.
- **N-006:** Recommend Team Lead still schedule the separate Infosec review called out in EPIC §3.3 / §8 before treating this auth surface as production-hardened — Critic security checklist for this delivery is satisfied.
