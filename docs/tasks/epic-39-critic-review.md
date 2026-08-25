# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 39 — Visible Companion Pets + Pet Color Customization
- Diff / PR reference: `task/epic-39-visible-companion-pets` vs `master` @ `55f13f242c72aa97253722a9ceb21c6955ced6d7` (feature `c0d3889` + docs pin commits); no open PR (`gh` auth could not resolve repo per handoff)
- Tester PASS report reference: `docs/tasks/epic-39-tester-report.md` (commit `55f13f2`; evidence `qa-artifacts/epic-39/`)
- Iteration (1 if first pass): 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff master...HEAD` — 17 files, +805/−106; feature commit `c0d3889` |
| Tester PASS report matches this commit | PASS | Tester report pins `55f13f2`; branch tip matches; Playwright `ALL PASS` in `qa-artifacts/epic-39/playwright-run.log` |
| Every acceptance criterion traceable to a change or explicit note | PASS | Shared visual types + `economy_set_pet_color`; server persist/side/bots; client meshes/glow/opacity; inventory swatches; regression `scripts/regression-epic39-companion-pets.ts` |
| Scope matches the task (no unexplained extra changes) | PASS | Companion visuals + colors + regression; epic31 QA fixtures updated for `equippedPetsVisual` only |
| Gameplay evidence present (player-facing tasks only) | PASS | Opened `01`–`03` selfcheck (types/sides/glow/opacity), `04`–`08` live bots, `09`–`11` inventory; `smoke-summary.json` |

- Gate overall: PASS → continue checklist

## Verdict

- `REVISE`
- One-line rationale: Dual-equip companions independently roll `side` with no collision avoidance (`server/src/playerRegistry.ts` `setEquipmentVisual` ~509–517 + client `PET_SIDE_X` only), so ~50% of two-pet loadouts stack both meshes on the same anchor and fail the readable silhouette goal.

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | FAIL | major | AC “recognizable companions” broken when two pets share `side`: `playerRegistry.ts` 509–517 rolls `randomPetSide()` per slot with no deconflict; `remotePlayers.ts` 39–40 / 480 place both at the same `PET_SIDE_X` |
| 2 | Server authority for gameplay-relevant state | PASS | | `economy_set_pet_color` ownership + `isValidPaletteIndex` (`store.ts` `setPetColor`, `match.ts` 498–513); sides/colors via `setEquipmentVisual` + `toWorldState` `equippedPetsVisual`; bots `botAI.ts` `randomBotPet` / `@cN` logs |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | | Three.js companions in `remotePlayers.ts`; `ws` economy message; shared types in `shared/src/economy.ts` / `index.ts` |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | | Palette index validated server-side; no secrets; inventory labels use pet type/id text only |
| 5 | Error handling | PASS | | Invalid color → `EconomyActionError` / `sendEconomyActionResult`; malformed WS drops tracked in `index.ts` 780–787 |
| 6 | Logging / observability | PASS | | `[economy] set_pet_color ok…`; bot loadout `@cN` (`botAI.ts`) |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | FAIL | major | Regression covers side *stability* and bot colors (`regression-epic39-companion-pets.ts`) but never asserts two equipped pets get distinct sides; selfcheck fixtures are one pet per avatar |
| 8 | Readability / maintainability | PASS | | Clear companion builders (`buildDogMesh`…`buildLionMesh`); visual key + EPIC 36 re-apply path documented |
| 9 | Scope discipline | PASS | | No unrelated feature work; epic31 fixture delta is protocol-compatible only |
| 10 | Config / docs updated | PASS / N/A | | No new env vars; task docs + handoff present; README N/A |
| 11 | No dead code / debug scaffolding | PASS | | EPIC 31 orbs removed; no leftover `pet-orb` in selfcheck (`smoke-summary.json` `petOrbs: 0`) |
| 12 | Regression risk considered | PASS | | `npm run regression:epic39-companion-pets` PASS; epic31 bot-loadouts still covers `@cN`; spawn-protection opacity re-applied after companion rebuild (`remotePlayers.ts` 646–649) |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | PASS | | `05`/`06` move/jump; `07` fire smoke; combat still avatar AABB only (`combat.ts` — no pet volumes); hits continue in server log during QA |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | FAIL | major | `01`/`02`/`03` show readable dog/cat/bird/lion + cyan glow `0x4ec8ff`; dual-slot same-side stack (see F-001) is a glaring overlap bug when it hits |
| 15 | Controls & feel usable | PASS | | Live HUD + pointer-lock smoke; inventory open/swatch click path in Playwright |
| 16 | Playability sanity (honest fun/usability call) | PASS* | | Single-pet companions read well and fit the low-poly look; two-pet readability is unreliable until F-001 is fixed (*blocked by F-001 for archetype D / dual equip) |

## Findings (actionable)

### F-001

- Checklist # / Gate: #1, #7, #14, #16
- Severity: major
- Issue: Server assigns each equipped pet’s `side` with independent `randomPetSide()` and never avoids collisions. Client anchors are only `PET_SIDE_X.left|right` at the same Y/Z, so two pets with the same `side` fully overlap (silhouette + glow). ~50% of dual-equip cases (archetype D / human slot1+slot2) lose readable type separation — contradicts EPIC 39’s “silhouette must read as lion / dog / cat / bird” goal even though each field is still `"left"|"right"`.
- Required fix (file/behavior): In `PlayerRegistry.setEquipmentVisual` (`server/src/playerRegistry.ts`), when assigning sides for 2+ pets in one apply, ensure distinct sides (e.g. first pet random; remaining pets take the unused side, or re-roll until unique). Keep stability-by-`slotId`. Extend `scripts/regression-epic39-companion-pets.ts` to assert two-slot visuals never share `side`.
- Suggested check to prove closed: Regression fails if both visuals have equal `side`; selfcheck or Playwright with two companions on one avatar shows one at `sideX≈-0.48` and one at `≈+0.48`.

### F-002

- Checklist # / Gate: #11 / maintainability
- Severity: minor
- Issue: `applyPetVisual` removes the old `avatar:pet-body` group without disposing geometries/materials (`remotePlayers.ts` ~484–490). Frequent color/type/equip churn can leak GPU resources over long sessions.
- Required fix (file/behavior): On replace, traverse/dispose mesh geometry + material (and any nested) before `remove`, matching other disposable patterns in the client if present.
- Suggested check to prove closed: Code review of dispose path; optional long-session note in Tester re-verify (not required for functional PASS).

## Revision task (if REVISE)

- Finding IDs to fix: **F-001** (required); **F-002** (optional in same pass if cheap)
- Out of scope for this revision: New pet art, pet combat/AI, high-poly models, inventory layout redesign, forcing local first-person self-pets
- Re-verify required: yes (Tester re-runs scoped check + light regression)

## Notes (non-blocking)

- Inventory screenshots `09`–`11` crop above the Pet colors swatch row (Appearance header only); DOM + Redis evidence in `smoke-summary.json` / Playwright log still prove AC (8 swatches, `set_pet_color ok`, persist `colorIndex` 2→0, rejoin `lion color 1`). Prefer `scrollIntoView` on `#inventoryPetColorRows` next QA pass.
- Live bots frames `04`–`08` are weak for close-range companion silhouettes (distance / death sky); selfcheck `01`–`03` + `worldPets` in `smoke-summary.json` carry the visual/broadcast proof.
- `resolvePetsVisual` client fallback invents sides/colors when `equippedPetsVisual` is empty but types exist (`remotePlayers.ts` 545–554) — acceptable fixture shim; live server always broadcasts both.
- Two pets *may* still sit on opposite sides by chance today; F-001 is about making that reliable, not about inventing a third placement axis.
- Critic re-ran `npm run regression:epic39-companion-pets` and `npm run typecheck` — both PASS on reviewed tip.
