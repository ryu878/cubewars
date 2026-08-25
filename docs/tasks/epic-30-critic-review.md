# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 30 — Weapon Viewmodel & Pickup Visual Polish (Round 2); Stories 30.1–30.4
- Diff / PR reference: branch `task/epic-30-weapon-pickup-visual-polish`; tip `1501bae` (handoff pin); implementation `8029c65` (`feat(client): EPIC 30 weapon viewmodel and pickup visual polish`). Diff vs `master` (`99175fe`): `client/src/viewmodel.ts`, `client/src/pickups.ts`, epic-30 docs, `scripts/qa-epic30-programmer-selfcheck-playwright.mjs`
- Tester PASS report reference: `docs/tasks/epic-30-tester-report.md` (2026-08-25, Status **PASS**, commit `1501bae` / feat `8029c65`); evidence `qa-artifacts/epic-30/`
- Iteration: 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff 99175fe...8029c65` — +912/−65 across 5 files; mesh/material changes in `client/src/viewmodel.ts` and `client/src/pickups.ts` |
| Tester PASS report matches this commit | PASS | Tester report Meta + Environment cite `1501bae` / `8029c65`; live log `Qa30Leu64v6`, `moveDist: 9.14`, `[qa] PASS (live)` |
| Every acceptance criterion traceable to a change or explicit note | PASS | Multi-material viewmodels (`buildPistolVisual`/`buildRifleVisual`/`buildGrenadeLauncherVisual`); world weapon + ammo lid (`buildWeaponPickupMesh`, ammo lid path); armor breastplate (`buildMesh` armor branch); typecheck/build + client-only scope; behavior preserved (`setEmpty`/`triggerFire`/`update` untouched in diff); QA screenshots + live smoke |
| Scope matches the task (no unexplained extra changes) | PASS | `git diff --name-only master...HEAD` → only viewmodel, pickups, epic-30 docs, Playwright script — no `server/` / `shared/` |
| Gameplay evidence present (player-facing tasks only) | PASS | Opened `01`/`05`/`09` idle viewmodels, `03`/`06` fire flashes, `14` empty-dim, `04`/`11`/`12`/`20` pickups/armor/lineup, `32` live jump; `BEFORE-AFTER-NOTES.md` |

- Gate overall: **PASS** → checklist completed

## Verdict

- **`APPROVED`**
- One-line rationale: Cosmetic-only client meshes land multi-material viewmodels and readable armor breastplate (`pickups.ts` armor `buildMesh`, `viewmodel.ts` `build*Visual`) with Tester PASS screenshots and live smoke; no server/protocol drift — **Team Lead may merge**.

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | PASS | — | Viewmodels: body + `darken(..., 0.4)` accent + `METAL_ACCENT_COLOR` + 2–3 details each (`viewmodel.ts` pistol/rifle/GL builders). Pickups: matching multi-material weapons + wood body/`AMMO_CRATE_BODY_COLOR` + weapon-color lid (`pickups.ts`). Armor: plate/collar/ridge/strap/rivets with `ARMOR_PICKUP_COLOR` + trim/strap accents. Screenshots `01`/`05`/`09`/`20`/`12` confirm. |
| 2 | Server authority for gameplay-relevant state | N/A | — | Diff touches no gameplay state; pickup radius/protocol remain server/shared (file list + handoff authority note). |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | — | Three.js procedural `BoxGeometry`/`CylinderGeometry` + `MeshStandardMaterial` only; no new deps/assets (`8029c65` diff). |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | — | No secrets/env; no user-generated HTML; cosmetic client only. |
| 5 | Error handling | N/A | — | No new failure paths; mesh construction only. |
| 6 | Logging / observability | N/A | — | Not a service change; QA script logs under `qa-artifacts/epic-30/`. |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | PASS | — | Selfcheck: 3 weapons idle/fire, sway frames, empty-dim, pickup lineup, armor closeup. Live: move/jump/fire, 0 console errors (`playwright-live-tester.log`). |
| 8 | Readability / maintainability | PASS | — | Story comments + named constants (`METAL_TRIM_COLOR`, `ARMOR_*`, `AMMO_LID_SIZE`); builders stay local and parallel between viewmodel/pickups. |
| 9 | Scope discipline | PASS | — | Confined to allowed paths; optional pickup bob/spin explicitly skipped (spec nice-to-have). |
| 10 | Config / docs updated | N/A | — | No new config surface; EPIC spec + handoff + before/after notes present. |
| 11 | No dead code / debug scaffolding | PASS | — | No leftover debug; materials tracked via existing `trackMaterial` for `setEmpty`. |
| 12 | Regression risk considered | PASS | — | `update`/`triggerFire`/`setEmpty`/`applyEmptyState` not rewritten; flash meshes retained; live smoke + sway/fire/empty evidence. |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | PASS | — | Live `32-live-jump-smoke.png` (joined `Qa30Leu64v6`, HP 100, pistol viewmodel); fire flashes `03`/`06`/`31`; moveDist 9.14 in tester log. Hit-reg untouched (cosmetic epic). |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS | — | Blocky multi-primitive composites, bright category colors; armor strap/rivets readable in `11`/`12`; lineup `20` distinguishes weapons/ammo/armor/health; no black/missing meshes. |
| 15 | Controls & feel usable | PASS | — | Live FPS HUD + crosshair + pistol hold in `30`/`31`/`32`; Tester Gameplay & feel OK. |
| 16 | Playability sanity (honest fun/usability call) | PASS | — | Meets the epic’s player ask: held weapons and world pickups read as distinct low-poly props; armor no longer a generic gem. Still procedural primitives (by design), but clearly a step past EPIC 10 flat composites. |

## Findings (actionable)

None.

## Revision task (if REVISE)

N/A — `APPROVED`

## Notes (non-blocking)

- `darken()` is duplicated in `viewmodel.ts` and `pickups.ts` — fine for this cosmetic pass; optional later shared helper if a third caller appears.
- World pistol pickup has no dedicated closeup frame (lineup/script emphasizes rifle + GL), but `buildWeaponPickupMesh("pistol", …)` is upgraded in the same commit and viewmodel pistol evidence (`01`/`03`) covers identity language.
- Pickup mesh remove still does not `dispose()` geometries/materials (pre-existing pattern in `sync()`); not introduced as a new leak class by this epic.
- Optional idle bob/spin omitted per budget — allowed by spec Story 30.2.

## Team Lead

**Merge OK** after your final checklist. Critic gate cleared; no Judge loop required.
