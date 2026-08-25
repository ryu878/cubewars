# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 37 — Competitive Leaderboard Excludes "vs Bots" Kills
- Diff / PR reference: branch `task/epic-37-leaderboard-excludes-bots-mode` vs `master`; feature commit `226f8dd` (`fix(server): gate career leaderboard to public-mode kills only`); tip reviewed `080f48f` (handoff-doc SHA pins only after feature)
- Tester PASS report reference: `docs/tasks/epic-37-tester-report.md` (PASS @ `080f48f`)
- Iteration (1 if first pass): 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff master...HEAD`: `server/src/match.ts`, `scripts/regression-leaderboard-excludes-bots.ts`, `package.json`, `docs/tasks/epic-37-programmer-handoff.md` |
| Tester PASS report matches this commit | PASS | Tester meta pins tip `080f48f399f85459c102762cf7142be6ac133511` = current branch HEAD; feature body is `226f8dd` |
| Every acceptance criterion traceable to a change or explicit note | PASS | Public-only gate `match.ts:763-767`; regressions + live LB identity; typecheck/build PASS in Tester report; optional 37.2 purge explicitly skipped |
| Scope matches the task (no unexplained extra changes) | PASS | Confined to server gate + regression script + npm script + handoff docs; no protocol/client; no historical cleanup (per EPIC §4) |
| Gameplay evidence present (player-facing tasks only) | PASS | Live AC 37.4 only (LB gating, not visual redesign): `qa-artifacts/epic-37/01-*.png`–`03-*.png`, `leaderboard-before.json` === `leaderboard-after.json`, `results.json` kill of `Bot 2` |

- Gate overall: PASS → continue checklist

## Verdict

- `APPROVED`
- One-line rationale: `server/src/match.ts:763` correctly replaces the non-`endless` `else` with `else if (this.mode === "public")`, so bots-mode kills no longer call `onKillRecorded`; regression + live LB byte-identical evidence confirm AC with no scope creep.

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | PASS | — | Gate at `match.ts:757-768`; `MatchMode` is only `"public" \| "bots" \| "endless"` (`shared/src/index.ts:186`) so no other mode silently loses recording; regressions cover bots/public/endless |
| 2 | Server authority for gameplay-relevant state | PASS | — | Career K/D still only via server `onKillRecorded` → `MatchManager.recordKill` → `EconomyStore.incrementCareerKillDeath`; change only narrows which modes invoke it |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | — | No new deps; `tsx` regression + Node/TS server only |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | — | No secrets/env; no client trust introduced |
| 5 | Error handling | PASS | — | Existing `recordKill` `.catch` paths unchanged (`matchManager.ts:154-156`, `242-244`); bots fall-through is intentional silence |
| 6 | Logging / observability | N/A | — | No new service log required for silent non-record; death/kill logs still fire (`match.ts:741`) |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | PASS | — | New script asserts bots `recorded.length===0`, public nicknames still recorded, endless progress/removeBot; Critic re-ran both regressions → PASS; live bots kill left LB unchanged |
| 8 | Readability / maintainability | PASS | — | Explicit `mode === "public"` + EPIC 37 comment at `match.ts:763-766` |
| 9 | Scope discipline | PASS | — | One-condition product change in `match.ts` (+ allowed regression/package/docs); optional purge not shipped |
| 10 | Config / docs updated | N/A | — | No new env/run surface; README change not required by AC |
| 11 | No dead code / debug scaffolding | PASS | — | No debug leftovers in feature diff |
| 12 | Regression risk considered | PASS | — | Public path still calls `onKillRecorded`; endless branch untouched; `regression:leaderboard` still PASS |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | PASS | — | `03-after-bot-kill.png` + `results.json` kill feed/WS: human eliminated `Bot 2`; shoot/hit still work in bots match |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | N/A | — | No visual/art delta in EPIC 37; screenshots show existing lobby/arena HUD only |
| 15 | Controls & feel usable | N/A | — | No control changes; verification path only |
| 16 | Playability sanity (honest fun/usability call) | N/A | — | Stats-gating fix; playability of modes unchanged |

## Findings (actionable)

_None._

## Revision task (if REVISE)

_N/A — APPROVED._

## Notes (non-blocking)

- Historical `"Bot 1"` / `"Bot 2"` career rows remain in live Redis/store (`leaderboard-before.json` / lobby screenshot) — explicitly out of scope per EPIC 37 §4; forward pollution from bots-mode kills is stopped.
- Optional task 37.2 (`"Bot "`-prefixed purge) correctly skipped (no cheap store delete API) — Team Lead / user follow-up if desired.
- `MatchManager.createBotsMatch` still wires `onKillRecorded` (`matchManager.ts:153-157`) even though `match.ts` never invokes it in bots mode. Harmless dead wiring; removing it would be a clarity follow-up outside this EPIC's single-file design — do not expand this PR for that.
- Live public human-vs-human LB update was regression-covered, not re-proven live (Tester marked optional); acceptable given server unit regression + unchanged public wiring.
