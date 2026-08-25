# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 41 — Spawn Protection Must Block Firing (`docs/tasks/epic-41-spawn-protection-no-fire.md`)
- Diff / PR reference: branch `task/epic-41-spawn-protection-no-fire` @ `795c684` (impl `05ca5a1`) vs `master`; compare https://github.com/ryu878/cubewars/compare/master...task/epic-41-spawn-protection-no-fire
- Tester PASS report reference: `docs/tasks/epic-41-tester-report.md` (QA tip `795c684`); evidence `qa-artifacts/epic-41/`
- Iteration: 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff master...HEAD` — 9 files; authoritative impl in `05ca5a1` (`playerRegistry.ts`, `index.ts`, `botAI.ts`, `main.ts`, `regression-spawn-protection.ts`, README, match doc) |
| Tester PASS report matches this commit | PASS | Tester report pins tip `795c684502e24c193c0ed1ae4090071379c73b7a` = current `HEAD`; impl under test `05ca5a1` |
| Every acceptance criterion traceable to a change or explicit note | PASS | AC §6 mapped: server no-op `playerRegistry.ts:657`; client gate `main.ts:192–206`; incoming EPIC 36 untouched + regression retained; after-window fire regression + live `04`/`05`; humans/bots share `registry.fire()` (+ bot case in regression); cooldown skip `index.ts:719–724`, `botAI.ts:377–383`; typecheck/build/regression Critic-reconfirmed PASS |
| Scope matches the task (no unexplained extra changes) | PASS | Diff limited to EPIC 41 fire-block + docs/README/regression; no protocol/duration/immunity redesign |
| Gameplay evidence present (player-facing tasks only) | PASS | Critic opened `qa-artifacts/epic-41/01`–`05` PNGs + `smoke-summary.json`; Playwright `ALL PASS`; HUD SPAWN PROTECTED + no muzzle while protected; muzzle + outbound fire after window |

- Gate overall: PASS → continue checklist

## Verdict

- `APPROVED`
- One-line rationale: `PlayerRegistry.fire()` early-returns `{ hit:false, dry:false }` with no `weapon` when `isSpawnProtected(shooter)` (`playerRegistry.ts:650–657`) before any ammo/hitscan/projectile path; live smoke shows `outboundFireCount=0` / `muzzleVisible=false` while protected (`smoke-summary.json` + `01-…png`) and fire resumes after window (`04`/`05`).

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | PASS | — | Gate before ammo (`playerRegistry.ts:657` then ammo at `:667–680`); no `weapon` → no `fire_broadcast` (`match.ts:1022–1030`); client suppresses juice+send (`main.ts:192–203`); after-window regression asserts hit+ammo 12→11; Critic `npm run regression:spawn-protection` → `[spawn-protection] PASS` |
| 2 | Server authority for gameplay-relevant state | PASS | — | Authoritative choke `registry.fire()`; human WS path also early-returns (`index.ts:719–724`); client gate is prediction-only (`main.ts:184–192` comment + broadcast fields only) |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | — | Existing Three.js/TS + Vite client, Node/TS + `ws` server, shared types; no new deps in diff |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | — | No secrets/config secrets; fire still server-validated; cheater past client still blocked at index + registry |
| 5 | Error handling | PASS | — | Protected fire is intentional silent no-op matching dead-shooter bail shape (`playerRegistry.ts:652–657`) |
| 6 | Logging / observability | PASS | — | Spec does not require blocked-fire logs; no hit/death/fire_broadcast side effects when gated |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | PASS | — | Regression: protected shooter no ammo/hit/weapon + TTL uncleared; fire after `deadline==now`; bot-id same path; EPIC 36 target cases retained (`placeFacing` clears shooter protection). Live: WS + muzzle asserts both sides of window. Cooldown stamp fairness code-path only (see Notes) |
| 8 | Readability / maintainability | PASS | — | EPIC 41 comments at gate sites; shared `isSpawnProtected` reused |
| 9 | Scope discipline | PASS | — | No unrelated refactors; match.ts comment-only alignment with new bail |
| 10 | Config / docs updated | PASS | — | README Current status EPIC 41 note; no new env vars |
| 11 | No dead code / debug scaffolding | PASS | — | No leftover debug; QA Playwright script is Tester-local artifact (untracked), not product dead code |
| 12 | Regression risk considered | PASS | — | Incoming immunity paths (`applyDamage` / candidate filters) unchanged in diff; Critic re-ran spawn-protection regression PASS; typecheck+build PASS |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | PASS | — | `01`: SPAWN PROTECTED 1.0s, no muzzle; smoke `outboundFireCount=0` while `protected:true`. `04`: HUD cleared, pale yellow muzzle, HP 85 (bots damaged after window). `02`/`03`: WASD + jump. Regression covers hit-reg after window |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS | — | Blocky pistol viewmodel + readable HUD in `01`/`04`; no black screen / missing viewmodel in opened shots |
| 15 | Controls & feel usable | PASS | — | Pointer lock + fire path exercised; smoke `pointerLocked:true`; movement/jump screenshots captured mid-session |
| 16 | Playability sanity (honest fun/usability call) | PASS | — | Core unfairness fixed: ghost cannot shoot while invincible (server + client); fire returns after ~2s — usable and matches the user ask |

## Findings (actionable)

_(none)_

## Revision task (if REVISE)

- N/A (`APPROVED`)

## Notes (non-blocking)

- Cooldown fairness (preferred AC) is implemented in `index.ts` / `botAI.ts` before `lastFireAcceptedAt` stamps, but `regression-spawn-protection.ts` asserts ammo/hit/weapon absence rather than stamp values — adequate for this delivery; optional future assert if stamp bugs recur.
- If the player presses and holds LMB *during* protection, `startAutoFire` bails because `shouldAutoFire` is false (`fpsController.ts:99–101` + `main.ts:205–206`); they must release and re-press after the window. Spec does not require seamless hold-through; after-window tap/hold paths are covered by Tester smoke.
- Programmer handoff tip SHA lagged docs-pin commits; Tester correctly verified tip `795c684`. Critic independently confirmed `npm run regression:spawn-protection`, `npm run typecheck`, and `npm run build` PASS on that tip.
