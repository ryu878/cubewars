# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 49 — Distinct Map Palettes & Thematic Props (Stories 49.1–49.4)
- Diff / PR reference: `task/epic-49-map-palettes-thematic-props` vs `master` (`5eeba67`); implementation `41da7f2`; Tester evidence/report pin `4229526` / tip at review start `d6d9d1f`; compare https://github.com/ryu878/cubewars/compare/master...task/epic-49-map-palettes-thematic-props
- Tester PASS report reference: `docs/tasks/epic-49-tester-report.md` (PASS; QA through `e214ae0`, report+evidence at `4229526`)
- Iteration: 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff master...HEAD` — 29 files; core: `client/src/mapThemes.ts`, `client/src/main.ts`, `client/src/textures.ts`, `shared/src/maps/{types,primitives,themedMaps}.ts`, `server/src/endlessWorld.ts`, regressions + Playwright |
| Tester PASS report matches this commit | PASS | Report PASS @ `4229526` (evidence + report); tip `d6d9d1f` is docs-only SHA pin after QA — implementation unchanged since `41da7f2` |
| Every acceptance criterion traceable to a change or explicit note | PASS | 49.1 palettes → `mapThemes.ts` + `applyMapTheme` on `map_state`/lobby; 49.2 props → `primitives.ts`/`themedMaps.ts` + prefix materials; 49.3 `WALL_HEIGHT` 4→6 + `createFogFadeWallMaterial`; 49.4 typecheck/build + `regression:epic49-palettes` + `qa-artifacts/epic-49/` |
| Scope matches the task (no unexplained extra changes) | PASS | No GLTF/Rapier/matchmaking/EPIC-48 count changes; endless only imports shared `WALL_HEIGHT`; README EPIC 49 note only |
| Gameplay evidence present (player-facing tasks only) | PASS | Opened `qa-artifacts/epic-49/01`–`11` + `summary.json` (`maxWallH: 6`, `failures: []`) + `gameplay-smoke.json` |

- Gate overall: PASS → continue checklist

## Verdict

- `APPROVED`
- One-line rationale: Shared `WALL_HEIGHT=6` + server-shipped thematic AABBs (`shared/src/maps/types.ts`, `themedMaps.ts`) with client-only palettes/fog-fade (`mapThemes.ts`, `createFogFadeWallMaterial`); screenshots `01`–`08` show clearly distinct atmospheres and taller haze tops; no critical/major authority or AC gaps.

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | PASS | | `MAP_PALETTES` all 8 `MapId`s (`mapThemes.ts`); `applyMapTheme` before `renderMapGeometry` (`main.ts` `onMapState`); lobby reset `applyMapTheme("lobby")` in `clearMatchClientState`; props enriched + `WALL_HEIGHT=6`; epic49 regression asserts palettes/pickups/prefixes |
| 2 | Server authority for gameplay-relevant state | PASS | | Raised walls + new props in shared `MapBox[]`; client `fps.setCollisionGeometry(message.geometry)` from `map_state`; fog-fade is material on shared AABB only (`textures.ts` `createFogFadeWallMaterial` comment + handoff) — no client-only blockers above collision |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | | Three.js materials/shader hook + Vite client; shared TS maps; `ws` server untouched for transport; no Rapier/GLTF/new UI framework |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | | No new env/secrets; cosmetic client theme only; geometry still server `map_state` |
| 5 | Error handling | PASS | | Sky dispose on theme change (`mapThemes.ts` `disposeObject3D`); mesh material dispose in `renderMapGeometry` |
| 6 | Logging / observability | N/A | | Client visual task; regressions log `EPIC 49 palette + pickup regression OK` |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | PASS | | epic49 + epic48/47/46 regressions; Playwright 8 maps; leave→lobby + rejoin fuel (`10`/`11`); gameplay smoke move/jump/fire/hit (`09`, HP 90) |
| 8 | Readability / maintainability | PASS | | Dedicated `mapThemes.ts`; prefix materials localized in `materialForProp`; primitives helpers documented |
| 9 | Scope discipline | PASS | | Diff matches EPIC 49 stories; no `docs/ops` / deploy mix-in |
| 10 | Config / docs updated | PASS | | README EPIC 49 status + verify commands; task/handoff/tester docs; no new env vars |
| 11 | No dead code / debug scaffolding | PASS | | No leftover debug scaffolds; `void require` in regression is harmless |
| 12 | Regression risk considered | PASS | | Jump apex still ~1.56m ≪ wall 6 (`shared/src/index.ts` MOVEMENT comment updated); EPIC 48 pickup counts asserted; endless shares `WALL_HEIGHT` |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | PASS | | `09-gameplay-crystal-move.png` + `gameplay-smoke.json`: match live, HP 90 after bot hit; Tester logged server fire/hit |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS | | `01`–`08` blocky AABB arenas with distinct fog/ground/sky (base warm; rust orange; glass green haze; dead dark; fuel tan; crystal emissive blues; abyss deep fog; elite bronze plaza); taller walls fade into haze (`01`,`02`,`04`,`06`,`07`,`08`) |
| 15 | Controls & feel usable | PASS | | Smoke: WASD/look/jump/fire usable; no stuck/inversion in evidence |
| 16 | Playability sanity (honest fun/usability call) | PASS | | Maps read as different places at a glance; landmarks strongest on crystal (`06`) and elite rubble (`08`); playable, not a bare Three.js demo |

## Findings (actionable)

_None blocking. No critical/major findings._

## Revision task (if REVISE)

- N/A — verdict `APPROVED`

## Notes (non-blocking)

- **Prefix false-positive (minor):** `materialForProp` matches `id.includes("_bed")` before `_rock_` (`client/src/main.ts` ~155 vs ~191), so `rc_bed_*_rock_*` dry-bed rocks take car-body `propAccent` instead of rock grey. Rename match to car-specific tokens (e.g. `_truck_bed` / endswith) or reorder rock check earlier — optional polish, not AC-breaking on rust palette.
- **Playwright framing:** Spawn hold-pose under-shows some landmarks (fuel cisterns in `05`/`11`, abyss cables in `07`, glass veg in `03`) even though shared geometry + `regression:epic49-palettes` confirm prefixes. Future QA: yaw toward landmark clusters. Crystal (`06`) and elite (`08`) already prove silhouette intent.
- **Transparent wall materials:** `createFogFadeWallMaterial` uses `transparent: true` + soft alpha at tip — rare sorting glitches possible (documented in handoff); acceptable for Story 49.3.
- **`qa-artifacts/`** is `.gitignore`d but force-committed on this branch for chain evidence — fine for review; TL may strip on merge if policy prefers ephemeral-only.
- Shot `09` is near-black upward fog gaze after free look — not a broken load; `06` shows full crystal scene.
