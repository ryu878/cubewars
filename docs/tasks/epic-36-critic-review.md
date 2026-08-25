# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 36 — Post-Respawn Spawn Protection (Transparency + Invincibility) (`docs/tasks/epic-36-spawn-protection.md`)
- Diff / PR reference: branch `task/epic-36-spawn-protection` vs `master`; feature `5920377`; tip `922ed8c65761059aa9b748071433b48662d47b60`
- Tester PASS report reference: `docs/tasks/epic-36-tester-report.md` (QA on tip `922ed8c`; evidence `qa-artifacts/epic-36/`)
- Iteration: 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff master...task/epic-36-spawn-protection` — shared/server/client/scripts + handoff docs; feature `5920377` |
| Tester PASS report matches this commit | PASS | Tester Meta → tip `922ed8c65761059aa9b748071433b48662d47b60` = branch HEAD |
| Every acceptance criterion traceable to a change or explicit note | PASS | AC §6 → `COMBAT.spawnProtectionMs`, server filter + `applyDamage` null, broadcast field, client opacity/HUD, `regression:spawn-protection`, live bots/public/endless evidence |
| Scope matches the task (no unexplained extra changes) | PASS | Spawn-protection only; combat regressions only clear `spawnProtectedUntilMs` so unprotected math still runs; `respawnDelayMs` untouched |
| Gameplay evidence present (player-facing tasks only) | PASS | Critic opened `qa-artifacts/epic-36/01`–`03`, `06`–`08`, `12`–`13`; selfcheck opacity + live HUD/ghosts + post-window HP drop |

- Gate overall: PASS → continue checklist

## Verdict

- `APPROVED`
- One-line rationale: Immunity is server-only (`isSpawnProtected` + candidate filters + `applyDamage` null); unprotected remain hittable (`regression-spawn-protection.ts` + Critic re-run PASS); client opacity/HUD use only `serverTimeMs < spawnProtectedUntilMs` (`remotePlayers.ts` ~406–410, `main.ts` ~382–383) with no free-running local timer.

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | PASS | | `spawnProtectionMs: 2000` (`shared/src/combat.ts`); set on `spawnAt`/`processRespawns` (`playerRegistry.ts` ~423, ~950); hitscan/splash skip (`combat.ts` ~170, ~119); projectile skip (`match.ts` ~881); env via `applyDamage` null (`playerRegistry.ts` ~721, ~760); deadline strict `<` (`combat.ts` ~105; regression case “deadline instant”) |
| 2 | Server authority for gameplay-relevant state | PASS | | Deadline owned server-side; client never writes protection; immunity not client-trusted — client only renders from broadcast (`PlayerState.spawnProtectedUntilMs` + `WorldStateMessage.serverTimeMs`) |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | | Three.js/TS + Vite client, Node/`ws` server, shared protocol; no new competing libs |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | | No secrets; no client-supplied immunity; filter cannot invent protection for `spawnProtectedUntilMs` past/0 |
| 5 | Error handling | PASS | | Protected paths return miss/empty/`null` (no silent 0-damage hit); fire treats null damage as miss (`playerRegistry.ts` ~646–648) |
| 6 | Logging / observability | PASS | | No new log spam required; existing hit logs correctly absent for protected (by design / regression asserts no damage events) |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | PASS | | Protected miss + unprotected hit + deadline + splash mixed + env + respawn re-arm (`scripts/regression-spawn-protection.ts`); Critic re-ran PASS; locational-splash / grenade-projectile clear protection and PASS |
| 8 | Readability / maintainability | PASS | | Single `isSpawnProtected` helper; clock-synced deadline pattern documented like `hatchDeadlineMs` |
| 9 | Scope discipline | PASS | | No `respawnDelayMs` change; unrelated combat scripts only zero the new field |
| 10 | Config / docs updated | PASS | | No new env/run surface; task docs/handoff present; README N/A per AC |
| 11 | No dead code / debug scaffolding | PASS | | No leftover probes in feature diff |
| 12 | Regression risk considered | PASS | | Explicit “unprotected still hittable” case; existing combat regressions updated to clear protection; Critic typecheck PASS |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | PASS | | `04`/`05` jump+fire; `06` HP 100→55 after window; server hit/no-hit via regression |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS | | `01` ghost vs solid; `03` live translucent bot; arena/viewmodel/HUD intact |
| 15 | Controls & feel usable | PASS | | Smoke movement/jump/fire; `smoke-summary.json` consoleErrorCount 0 |
| 16 | Playability sanity (honest fun/usability call) | PASS | | 2s grace + readable ghost + local SPAWN PROTECTED HUD; protection clears and damage resumes |

## Findings (actionable)

_None blocking._

## Revision task (if REVISE)

- N/A (`APPROVED`)

## Notes (non-blocking)

- **Authority / false-immunity scrutiny (requested focus):** Filtering is gated solely by `nowMs < spawnProtectedUntilMs` (`server/src/combat.ts` ~101–105). With deadline `0` or equal-to-now, `isSpawnProtected` is false; regression asserts unprotected pistol body hit still lands. No path grants immunity from client input.
- **Opacity broadcast-only:** `RemotePlayers.sync` recomputes `protectedNow` each tick from `serverTimeMs` vs broadcast deadline (`remotePlayers.ts` ~406–410); HUD same pattern (`main.ts` ~382–383). No `setTimeout`/local countdown advances protection.
- **Live remote opacity:** Clearest A/B proof is selfcheck `01`/`02` (0.35→1.0). Live bots `03` and public observer `08` also show translucent remotes; public two-client distance makes `08` subtler than the selfcheck — acceptable given same module path.
- **HUD display floor:** `setSpawnProtection` floors displayed seconds at `0.1` (`combatHud.ts`) while remaining &gt; 0 — cosmetic only; hide path still uses `remainingMs <= 0`.
- Programmer handoff tip SHA lagged docs commits; Tester correctly QA’d branch tip `922ed8c` (includes handoff pin commits atop `5920377`).
