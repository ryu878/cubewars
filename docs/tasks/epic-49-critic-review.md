# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 49 — Distinct Map Palettes & Thematic Props (Stories 49.1–49.4)
- Diff / PR reference: `task/epic-49-map-palettes-thematic-props` vs `master` (`5eeba67`); implementation `41da7f2`; Tester PASS/evidence `4229526` (pin `d6d9d1f`); compare https://github.com/ryu878/cubewars/compare/master...task/epic-49-map-palettes-thematic-props
- Tester PASS report reference: `docs/tasks/epic-49-tester-report.md` (PASS; QA through `e214ae0`, report+evidence at `4229526`)
- Iteration: 1 (supersedes premature `APPROVED` at `4440ec2` after material-path re-audit)
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff master...HEAD` — `client/src/mapThemes.ts`, `client/src/main.ts`, `client/src/textures.ts`, `shared/src/maps/{types,primitives,themedMaps}.ts`, `server/src/endlessWorld.ts`, regressions + Playwright + `qa-artifacts/epic-49/` |
| Tester PASS report matches this commit | PASS | Tester PASS @ `4229526`; tip `d6d9d1f` is docs-only SHA pin; implementation unchanged since `41da7f2` (docs-only after) |
| Every acceptance criterion traceable to a change or explicit note | PASS | 49.1 → `MAP_PALETTES` + `applyMapTheme` on `map_state` / leave→lobby; 49.2 → shared prop helpers + prefix materials; 49.3 → `WALL_HEIGHT` 4→6 + `createFogFadeWallMaterial`; 49.4 → typecheck/build + `regression:epic49-palettes` + 8-map shots |
| Scope matches the task (no unexplained extra changes) | PASS | No GLTF/Rapier/matchmaking/EPIC-48 count changes; endless only imports shared `WALL_HEIGHT`; README EPIC 49 note only |
| Gameplay evidence present (player-facing tasks only) | PASS | Opened `qa-artifacts/epic-49/01`–`11` + `summary.json` (`maxWallH: 6`, `failures: []`) + `gameplay-smoke.json` |

- Gate overall: PASS → continue checklist

## Verdict

- `REVISE`
- One-line rationale: Story 49.2 prefix materials mis-classify dry-bed rocks — `materialForProp` matches `id.includes("_bed")` before `_rock_` (`client/src/main.ts`), so `rc_bed_*_rock_*` from `rockPile("rc_bed_w"|"rc_bed_e")` (`shared/src/maps/themedMaps.ts`) render as car-body `propAccent` instead of rock.

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | FAIL | major | Palettes / `WALL_HEIGHT` / fog-fade OK; Story 49.2 prefix materials broken for rust dry-bed rocks — F-001 (`main.ts` `_bed` before `_rock_`; `themedMaps.ts` `rockPile("rc_bed_w")`) |
| 2 | Server authority for gameplay-relevant state | PASS | | Raised walls + thematic props in shared `MapBox[]`; client collision from server `map_state` geometry; fog-fade is material on shared AABB only (`textures.ts` `createFogFadeWallMaterial`) |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | | Three.js materials/shader hook + Vite; shared TS maps; `ws` transport unchanged; no Rapier/GLTF/new UI framework |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | | No new env/secrets; cosmetic client theme; geometry still server `map_state` |
| 5 | Error handling | PASS | | Sky dispose on theme change (`mapThemes.ts`); mesh material dispose in map geometry rebuild |
| 6 | Logging / observability | N/A | | Client visual task; regression logs EPIC 49 palette + pickup OK |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | PASS | | epic49 + epic48/47/46 regressions; Playwright 8 maps; leave→lobby + rejoin fuel (`10`/`11`); gameplay smoke (`09`). Gap: no assert that `_rock_` ids get rock materials (would have caught F-001) |
| 8 | Readability / maintainability | PASS | | Dedicated `mapThemes.ts`; prefix materials localized; primitives helpers documented |
| 9 | Scope discipline | PASS | | Diff matches EPIC 49 stories; no ops/deploy mix-in |
| 10 | Config / docs updated | PASS | | README EPIC 49 status + verify commands; task/handoff/tester docs; no new env vars |
| 11 | No dead code / debug scaffolding | FAIL | major | `_hood` / `_bed` branches in `materialForProp` unused by current `carSilhouette` (`_body` / cabin / `_wheel_*` only) and false-positive on `rc_bed_*` rocks — F-001 |
| 12 | Regression risk considered | PASS | | Jump apex still ≪ wall 6; EPIC 48 pickup counts asserted in epic49 regression; endless shares `WALL_HEIGHT` |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | PASS | | `09-gameplay-crystal-move.png` + `gameplay-smoke.json`: match live; Tester logged server fire/hit (HP 90) |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | FAIL | major | `01`–`08` distinct atmospheres + taller haze tops overall OK; rust dry-bed rocks get wrong materials (F-001) — theme-readable prop materials is Story 49.2 intent |
| 15 | Controls & feel usable | PASS | | Smoke: WASD/look/jump/fire usable; no stuck/inversion in evidence |
| 16 | Playability sanity (honest fun/usability call) | PASS | | Maps read as different places at a glance; playable Roblox-like AABB arenas; landmark framing uneven but not unplayable |

## Findings (actionable)

### F-001

- Checklist # / Gate: #1, #11, #14
- Severity: major
- Issue: `materialForProp` tests `id.includes("_bed")` (intended car truck-bed) **before** `id.includes("_rock_")`. EPIC 49 places dry-bed rocks via `rockPile("rc_bed_w", …)` / `rockPile("rc_bed_e", …)` → ids like `rc_bed_w_rock_a` that contain `_bed`, so they receive `palette.propAccent` car-body metal instead of rock grey. Current `carSilhouette` does not emit `_bed` / `_hood` tokens (only `_body` / cabin / `_wheel_*`), so the `_bed` matcher is dead for cars and harmful for rocks. Verified: `'rc_bed_w_rock_a'.includes('_bed') === true`.
- Required fix (file/behavior): In `client/src/main.ts` `materialForProp`, match rock/rubble **before** any `_bed` body accent, and/or narrow car-bed matching (e.g. drop unused `_bed`/`_hood`, keep `_body`). Optionally rename `rc_bed_*` prefixes if substring `_bed` matching is kept. Shared collision AABBs can stay.
- Suggested check to prove closed: Regression assert that geometry ids containing `_rock_` on `rust_canyon` are not classified as body-accent (or that `rc_bed_w_rock_a` takes rock material). Optional re-shot `02-rust_canyon.png`; at minimum extended `regression:epic49-palettes` + visual spot-check of dry-bed piles.

## Revision task (if REVISE)

- Finding IDs to fix: F-001
- Out of scope for this revision: Playwright camera reframes; transparent-wall sorting polish; stripping force-added `qa-artifacts/` on merge; lobby UI chrome vs canvas sampling
- Re-verify required: yes (Tester re-runs scoped check + light regression)

## Notes (non-blocking)

- **Supersedes `4440ec2` APPROVED:** Prior review filed the `_bed` collision as optional polish. Re-audit treats it as Story 49.2 correctness (prefix materials for thematic props) → major → `REVISE`.
- **Playwright framing:** Spawn hold-pose under-shows some landmarks (fuel cisterns in `05`/`11`, abyss cables in `07`, glass veg in `03`) even though shared geometry + epic49 regression confirm prefixes. Crystal (`06`) and elite (`08`) already prove silhouette intent.
- **Leave→lobby shot `10`:** Top-band pixels are near-black (UI chrome / modal), so they do not prove Base desert sky the way `01` does; rejoin fuel `11` still shows correct post-lobby map palette. Soft observation only — code path `applyMapTheme("lobby")` in leave/clear match client state is present.
- **Transparent wall materials:** `createFogFadeWallMaterial` uses `transparent: true` + soft alpha at tip — rare sorting glitches possible (documented in handoff); acceptable for Story 49.3.
- **`qa-artifacts/`** is `.gitignore`d but force-committed on this branch for chain evidence — fine for review; TL may strip on merge if policy prefers ephemeral-only.
- Shot `09` is near-black upward fog gaze after free look — not a broken load; `06` shows full crystal scene.
