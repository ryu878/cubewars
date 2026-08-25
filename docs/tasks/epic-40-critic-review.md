# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 40 — Companion Pet Distance & Scale Polish
- Diff / PR reference: branch `task/epic-40-companion-pet-distance-scale` @ tip `a5f35950d673616e7ba6fa5988c8d73138b571ac`; impl `101183b4662559c2917c41621897141b047f6f5e`; compare `master...HEAD` (4 files: `client/src/remotePlayers.ts`, `README.md`, epic + handoff docs). No PR opened (handoff notes `gh` auth).
- Tester PASS report reference: `docs/tasks/epic-40-tester-report.md` (Status: **PASS**; QA on tip `a5f3595…`; evidence `qa-artifacts/epic-40/`)
- Iteration (1 if first pass): 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff master...HEAD` reviewed; sole product code delta in `client/src/remotePlayers.ts` (+9/−3 around PET constants + `buildCompanionSlot` scale); empty `server/` / `shared/` |
| Tester PASS report matches this commit | PASS | Tester meta: tip `a5f35950d673616e7ba6fa5988c8d73138b571ac`; workspace `git rev-parse HEAD` matches; impl SHA `101183b` is the feat commit on the tip |
| Every acceptance criterion traceable to a change or explicit note | PASS | See checklist #1 — constants `PET_SIDE_X` ±0.9, `PET_ANCHOR_Y_OFFSET` 0.9, `PET_ANCHOR_Z` 0.3, `PET_ROOT_SCALE` 1.35; amulet untouched; dual `PET_SIDE_X[visual.side]`; cosmetic-only scope; typecheck/build/epic39 per Tester |
| Scope matches the task (no unexplained extra changes) | PASS | Diff is PET layout/scale + README Current status + epic/handoff docs only — matches Story 40.1–40.3 |
| Gameplay evidence present (player-facing tasks only) | PASS | Opened `qa-artifacts/epic-40/01`–`07` PNGs + `selfcheck-lineup.json` + `smoke-summary.json`; selfcheck proves layout/scale/glow/amulet/dual; live `04`–`07` cover move/jump/fire smoke |

- Gate overall: PASS → continue checklist

## Verdict

- `APPROVED`
- One-line rationale: `remotePlayers.ts` retunes companions to ±0.9 / Y+0.9 / Z 0.3 / scale 1.35 with root-scaled cyan glow; screenshots `01`–`03` and `selfcheck-lineup.json` show arm’s-length ~45° elevated float, larger silhouettes, gold amulet distinct, dual L/R deconflict; no server/shared/authority change.

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | PASS | — | `PET_SIDE_X` ±0.9, `PET_ANCHOR_Y_OFFSET` 0.9, `PET_ANCHOR_Z` 0.3, `PET_ROOT_SCALE` 1.35 at `client/src/remotePlayers.ts:41–47`; `root.scale.setScalar(PET_ROOT_SCALE)` at `:267`; `selfcheck-lineup.json` companions `sideX` ±0.9, `z` 0.3, `scale*` 1.35, `dy≈0.901` vs `torsoY` 1.13; within spec bands (side 0.75–1.05, scale 1.25–1.45) |
| 2 | Server authority for gameplay-relevant state | PASS | — | Empty `git diff master...HEAD -- server/ shared/`; client still only renders `equippedPetsVisual`; comments at `:36–40` / `:484–486` keep cosmetic/non-hitscan; `applyPetVisual` only sets mesh visibility/position/body |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | — | Three.js + existing `remotePlayers.ts` patterns only; no new deps/libs |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | — | Diff is layout constants + docs; no secrets, no new network/input surface |
| 5 | Error handling | N/A | — | No new failure paths; body dispose path from EPIC 39 unchanged (`disposeCompanionSubtree`) |
| 6 | Logging / observability | N/A | — | Cosmetic client layout; no service surface |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | PASS | — | Selfcheck: dual + bird-left + lion-right with scene-graph dump; epic39 regression re-run PASS (Tester); live bots smoke move/jump/fire; dual opposite covered by selfcheck even though live RNG had single-pet Bot 2 (`smoke-summary.json` `sawDualOpposite: false`) |
| 8 | Readability / maintainability | PASS | — | EPIC 40 comment + JSDoc on Y offset / root scale at `:39–46`; constants named and colocated with prior PET_* block |
| 9 | Scope discipline | PASS | — | Only PET anchors/scale + README/docs; no drive-by edits |
| 10 | Config / docs updated | PASS | — | README Current status EPIC 40 bullet; `docs/tasks/epic-40-companion-pet-distance-scale.md`; no new env vars |
| 11 | No dead code / debug scaffolding | PASS | — | No leftover debug; glow radius stays 0.22 local and relies on root scale (intentional, documented) |
| 12 | Regression risk considered | PASS | — | Amulet constants/position/materials identical to `master` (no amulet hunks in code diff); dual still `PET_SIDE_X[visual.side]` at `:501`; epic39 regression PASS; spawn-protection path not altered |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | PASS | — | `05-bots-movement.png` WASD arena; `06-bots-jump.png` mid-air; `07-bots-fire.png` fire POV; `server.log` continues bot AABB hit lines — pets not in combat path |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS | — | `01`/`02`/`03`: blocky avatars, readable pet silhouettes with cyan aura, gold chest torus distinct from pets; no missing geometry / z-fight / wash-out of amulet visible in evidence |
| 15 | Controls & feel usable | PASS | — | Live smoke HUD + pointer-lock FPS view usable (`04`–`07`); pets do not obstruct crosshair or viewmodel in captures |
| 16 | Playability sanity (honest fun/usability call) | PASS | — | Pets now read as shoulder/head-adjacent companions rather than waist clutter (`01`–`03`); amulet remains a separate gold tell (`02` chest rings); polish goal met without combat feel change |

## Findings (actionable)

_(none)_

## Revision task (if REVISE)

- N/A — verdict is `APPROVED`

## Notes (non-blocking)

- Live bots session only sampled a single-pet bot (`smoke-summary.json` `worldPets` Bot 2 `lion`/`right`; `sawDualOpposite: false`). Dual L/R deconflict is still proven by `selfcheck-lineup.json` dual companions at −0.9/+0.9 plus Tester’s `regression:epic39-companion-pets` PASS — acceptable for this cosmetic layout EPIC.
- Primary visual proof is the RemotePlayers selfcheck lineup (`01`–`03` + JSON). FPS live frames show distant bot pets as small cyan-tinted silhouettes (`04`, `06`); that matches engagement-range readability, not a layout defect.
- `playwright-run.log` is a one-line `ALL PASS`; the durable numeric evidence lives in `selfcheck-lineup.json` / `smoke-summary.json` — sufficient when paired with opened screenshots.
- Spec risk (nameplate/camera fringe crowding at larger scale) not observed as a defect in evidence; stays within “slightly larger / arm’s-length” band.
