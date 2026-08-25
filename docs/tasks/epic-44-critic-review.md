# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 44 — Kill Loot Drop VFX (Victim → Killer)
- Diff / PR reference: branch `task/epic-44-kill-loot-drop-vfx`, feature `897f101`, tip `7c21a24`, base `f28ab5b` (`f28ab5b...897f101`)
- Tester PASS report reference: `docs/tasks/epic-44-tester-report.md` (commit `7c21a24`)
- Iteration: 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `897f101` touches `shared/src/index.ts`, `server/src/match.ts` (`grantKillGold` emit), `client/src/killLootVfx.ts` (new), `client/src/network.ts` / `main.ts`, `scripts/regression-kill-loot-vfx.ts`, `README.md` |
| Tester PASS report matches this commit | PASS | Tester meta cites tip `7c21a24` / feature `897f101` / base `f28ab5b`; artifacts under `qa-artifacts/epic-44/` |
| Every acceptance criterion traceable to a change or explicit note | PASS | Protocol + server emit + client VFX + regression + README + Playwright evidence paths present |
| Scope matches the task (no unexplained extra changes) | PASS | Diff is EPIC 44 only (+ task docs); no EPIC 32/35 rule edits; no new deps |
| Gameplay evidence present (player-facing tasks only) | PASS | Screenshots `01`, `03`, `05`, `06`, `07` + JSON summaries exist and were opened |

- Gate overall: PASS → continue checklist

## Verdict

- `REVISE`
- One-line rationale: Live rewarding-kill mid-flight evidence (`05-sandbox-kill-loot-midflight.png`) shows kill banner + HUD gold but **zero in-world loot VFX pixels** despite `economy_kill_loot_fx` grants=`gold` in `live-post-kill.json` — AC “readable at engagement range / clear for local killer” is not met for the always-granted gold path.

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | FAIL | major | Server/protocol/regression meet “only granted kinds” (`match.ts` ~808–838, `regression-kill-loot-vfx.ts`); player-facing readable flight fails on live gold path — see F-001 / `05-*.png` pixel scan |
| 2 | Server authority for gameplay-relevant state | PASS | | Grants built only after `grantKillGold` mint/drops (`match.ts` 808–819); client `spawnFromMessage` renders listed kinds only (`killLootVfx.ts` 166–167); empty grants early-return |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | | Three.js procedural meshes + emissive `MeshStandardMaterial`; raw WS message; shared types; no new npm deps in `897f101` |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | | Cosmetic broadcast only; no client-trusted drop kinds; no secrets in diff |
| 5 | Error handling | PASS | | Empty grants no-op; dispose path in `disposePiece`; unknown kind has default mesh (exhaustiveness) |
| 6 | Logging / observability | PASS | | `[economy] kill_loot_fx kinds=...` after broadcast (`match.ts` 835–838); DM bot still early-returns with no fx |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | FAIL | major | Regression covers DM-bot / forced / substitute; live natural kill visual gate weak — `05` has no in-world loot pixels; Tester text also mismatches artifacts (`gold,egg`/GOLD 153 vs `gold`/420) |
| 8 | Readability / maintainability | PASS | | Dedicated `KillLootVfx` module; clear comments; kinds table mirrors EPIC |
| 9 | Scope discipline | PASS | | Feature commit scoped to protocol/server emit/client VFX/regression/README/docs |
| 10 | Config / docs updated | PASS | | README Current status EPIC 44 blurb; no new env vars |
| 11 | No dead code / debug scaffolding | PASS | | `clear()` exists but unused — note only; no debug leftovers in feature commit |
| 12 | Regression risk considered | PASS | | EPIC 32/35 paths untouched except post-grant fx append; regression Case 1 asserts 0 fx on DM bot |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | PASS | | `03-gameplay-smoke.png` + kill banner in `05`/`06`; smoke-summary `moveJumpFire: exercised` |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | FAIL | major | Selfcheck `01` and inject `07` show distinct emissive low-poly kinds; live gold kill `05` does **not** show flying loot — F-001; shard barely present in `07` — F-002 |
| 15 | Controls & feel usable | PASS | | Pointer-lock join UI in `02`; smoke inputs exercised; no stuck-camera evidence |
| 16 | Playability sanity (honest fun/usability call) | FAIL | major | Feature goal is that players **notice** loot leave victim → killer; common gold-only kill is invisible in the live FPS evidence — same failure mode the user reported |

## Findings (actionable)

### F-001

- Checklist # / Gate: #1, #7, #14, #16
- Severity: major
- Issue: On a live Sandbox rewarding kill, the server correctly broadcast `economy_kill_loot_fx` with `grants:[{kind:"gold"}]` (`qa-artifacts/epic-44/live-post-kill.json`), HUD shows `GOLD 420`, and the kill banner is present — but the claimed mid-flight screenshot `qa-artifacts/epic-44/05-sandbox-kill-loot-midflight.png` contains **no in-world gold/loot-colored pixels** (full-image scan: gold-like pixels only in HUD text region y≈41–50; center-FOV cyan/magenta/amber/yellow loot buckets all 0). AC requires distinct glowing drops leaving the victim and traveling toward the killer, readable at engagement range, especially clear for the local killer. Gold is minted on every rewarding kill, so an unreadable gold flyout fails the EPIC’s product intent.
- Required fix (file/behavior): In `client/src/killLootVfx.ts`, increase outdoor FPS readability for low-contrast kinds (at minimum `gold`; review `egg` / `repair_kit` similarly) — e.g. larger characteristic size toward the upper AC band, stronger emissive, and/or a short high-contrast flash/silhouette so victim→killer flight reads against sand/wood/bright sky. Keep server authority unchanged. Re-capture Playwright live-kill mid-flight evidence that shows measurable **in-world** amber/yellow (or other grant) pixels during flight, not only selfcheck/inject.
- Suggested check to prove closed: Re-run live Sandbox kill QA; Critic/Judge pixel-check `05-*.png` (or successor) for non-HUD gold/loot colors while `live-post-kill.json` lists matching grants; local-killer FOV must show the arc, not only the kill banner + GOLD HUD.

### F-002

- Checklist # / Gate: #14
- Severity: minor
- Issue: Inject path `qa-artifacts/epic-44/07-inject-gem-shard-amulet-gold.png` proves gem well (cyan cluster ~16k px, ~186×167 span) but shard magenta is only ~36 pixels — not clearly “distinct / readable at engagement range” when gem/gold dominate the frame. AC calls out gem vs shard vs amulet vs gold identity.
- Required fix (file/behavior): In `buildLootMesh` for `shard` (`client/src/killLootVfx.ts`), enlarge and/or boost emissive so shard remains readable next to gem/gold at typical kill distance; re-screenshot inject or live multi-kind flight with a measurable magenta footprint.
- Suggested check to prove closed: Mid-flight evidence with shard in grants shows a clear magenta/purple wedge (not a few-dozen-pixel speck).

## Revision task (if REVISE)

- Finding IDs to fix: F-001, F-002
- Out of scope for this revision: Changing EPIC 32/35 reward rules or drop rates; inventory/HUD work; new npm deps; inventing client-side loot kinds
- Re-verify required: yes (Tester re-runs scoped check + light regression)

## Notes (non-blocking)

- Technical delivery is otherwise strong: shared `economy_kill_loot_fx`, match broadcast after real grants only, substitute→gold-only, DM bot→no fx (regression PASS), client never invents kinds, stack-clean.
- Selfcheck `01-selfcheck-loot-kinds-midflight.png` is good identity proof on a dark backdrop — not sufficient alone for outdoor FPS readability.
- Tester report prose (`kinds=gold,egg`, GOLD 153) does not match artifact JSON (`gold` only, GOLD 420) — treat artifacts as source of truth on re-verify.
- `KillLootVfx.clear()` is never called from `main.ts` on leave/disconnect (possible cross-match leftover pieces) — optional cleanup if touching the wire path.
- `KillLootFxGrant.detail` (e.g. gem type) is unused by the mesh builder — acceptable cosmetic omission for this EPIC.
- QA script waits for fx then `sleep(280)` before `05` (`scripts/qa-epic44-tester-playwright.mjs` ~534–560); flight is only 0.9s — tighten capture timing on re-verify so mid-arc is actually on camera.
