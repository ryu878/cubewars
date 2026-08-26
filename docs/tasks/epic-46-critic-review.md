# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 46 — Multi-Map Catalog, Map Picker, Expanded Base, 8-Player Public
- Diff / PR reference: `master...task/epic-46-multi-map-select-capacity` @ `1f78d87` (impl `ccc437a`; Tester PASS package tip)
- Tester PASS report reference: `docs/tasks/epic-46-tester-report.md` (**PASS** @ `1f78d87`)
- Iteration: 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff --stat master...HEAD` — 35 files; impl `ccc437a` + QA `1f78d87` |
| Tester PASS report matches this commit | PASS | `docs/tasks/epic-46-tester-report.md` Status PASS; Environment tip aligned with reviewed branch tip `1f78d87` |
| Every acceptance criterion traceable to a change or explicit note | PASS | Catalog/picker/capacity/Base building+car/`map_state` authority all present in shared/server/client; merge/deploy explicitly out of Tester scope |
| Scope matches the task (no unexplained extra changes) | PASS | Diff limited to EPIC 46 maps/protocol/lobby/regressions/QA/docs/README |
| Gameplay evidence present (player-facing tasks only) | PASS | `qa-artifacts/epic-46/01`–`09` + `smoke-summary.json` present (quality of landmark shots evaluated in checklist) |

- Gate overall: PASS → continue checklist

## Verdict

- `REVISE`
- One-line rationale: Themed maps reuse `standardPickups()` / shared spawn templates that collide with catalog geometry (unreachable pickups; `elite_quarter` spawns inside rubble props) — AC “spawn/pickups sane” fails for multiple maps (`shared/src/maps/themedMaps.ts`, `shared/src/maps/primitives.ts` `standardPickups`).

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | FAIL | major | Pickup/spawn AABB overlaps on 6/7 themed maps (see F-001). Base itself clear. Lobby/capacity/protocol ACs otherwise met (`MAX_PUBLIC_PLAYERS_PER_MATCH = 8` in `shared/src/index.ts:191`; catalog 8 ids in `shared/src/maps/types.ts` / `catalog.ts`). |
| 2 | Server authority for gameplay-relevant state | PASS | | Match stores `mapId` + `mapDefinition` (`server/src/match.ts`); join-existing ignores client `mapId` (`server/src/index.ts`); invalid → `map_invalid`; geometry/`map_state` from catalog |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | | Three.js/TS + Vite client, Node/`ws` server, shared catalog; no new engines/UI frameworks |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | | No secrets; `mapId` validated via `isMapId`; lobby labels from catalog display names |
| 5 | Error handling | PASS | | `map_invalid` rejection + lobby UI string in `client/src/modeSelect.ts` |
| 6 | Logging / observability | PASS | | Server logs create/join map id + ignore-mismatch (`server/src/matchManager.ts`, `server/src/index.ts`) |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | FAIL | major | Regressions cover capacity/join/authority (`scripts/regression-epic46-maps.ts`) but **not** pickup/spawn clearance vs geometry. Playwright never reaches Base building/car landmarks (`smoke-summary.json` `endPos` ≈ `(-32.7, 24.9)` vs building ~`(-68,-21)` / car `(58,-2)`); `05`/`07` are wall face-plants |
| 8 | Readability / maintainability | PASS | | Clear `shared/src/maps/*` split; legacy aliases documented in `mapData.ts` |
| 9 | Scope discipline | PASS | | No unrelated EPIC/policy files in branch diff |
| 10 | Config / docs updated | PASS | | README Current status EPIC 46; handoff documents 2× linear Base scale |
| 11 | No dead code / debug scaffolding | PASS | note | `wallWithWindowAlongX` in `primitives.ts` unused (Base uses full-height segment gaps) — non-blocking |
| 12 | Regression risk considered | PASS | | Endless regression run by Tester; BotAI gets match geometry/waypoints (`server/src/match.ts`) |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | PASS | note | Move smoke OK (`smoke-summary.json` `moved: true`); jump/fire screenshots weak (wall/sky clips) but not a new combat regression |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS | note | Base spawn/movement shots (`03`,`06`) readable low-poly; Rust Canyon spawn shot (`09`) sparse but geometry present in `map_state` |
| 15 | Controls & feel usable | PASS | | Pointer lock + WASD move evidenced |
| 16 | Playability sanity (honest fun/usability call) | FAIL | major | Multi-map picker + capacity 8 are usable; themed loot placement makes several maps partially unplayable for pickups / two `elite_quarter` spawns sit in blocking props (F-001) |

## Findings (actionable)

### F-001

- Checklist # / Gate: 1, 16 (also 7)
- Severity: major
- Issue: Themed maps share `standardPickups("…")` and several hand-placed spawns without clearance against each map’s walls/props/crates. Critic overlap probe (player radius ~0.6 / spawn radius ~0.4 vs `boxBounds`) found collisions including: `glass_dome` GL mid inside `gd_veg_5`; `crystal_cave` mid GL inside `cc_crystal_g` + shelf overlaps; `abyss_bridge` mid GL inside `ab_support_mid` + armor in wreck; `fuel_depot` health inside truck props; `elite_quarter` multiple pickups in walls/crates/car **and** spawns `(-65,22)` / `(65,-22)` inside `eq_nw_rubble` / `eq_se_rubble`; plus ammo overlaps on `rust_canyon`. Spec AC requires sane spawns/pickups for 8-player maps.
- Required fix (file/behavior): Reposition per-map `pickupPoints` / `spawnPoints` in `shared/src/maps/themedMaps.ts` (and/or stop blind reuse of `standardPickups` centers that sit on landmark geometry in `shared/src/maps/primitives.ts`) so every pickup and spawn footprint is clear of blocking boxes. Add a regression assertion (e.g. in `scripts/regression-epic46-maps.ts`) that fails if any catalog map has spawn/pickup AABB overlap with walls/props (and preferably crates for pickups).
- Suggested check to prove closed: Re-run overlap probe + `npm run regression:epic46-maps`; spot-check one previously broken map (e.g. Crystal Cave mid + Elite Quarter rubble spawns) in-match.

### F-002

- Checklist # / Gate: 7, 13–14 (product evidence for Base AC)
- Severity: major
- Issue: Spec requires Base enterable building (doors both sides + window holes) + recognizable collidable car. Geometry exists (`shared/src/maps/base.ts` `base_bld_*`, `base_car_*`; `smoke-summary.json` lists ids), but Tester gameplay screenshots do **not** show them: `04-base-building-approach.png` is generic corridor; `05-base-car-area.png` and `07-base-jump.png` are camera jammed into wood texture; session `endPos` never approaches building or car coordinates. Map_state id presence alone does not satisfy player-facing proof of enterability / silhouette.
- Required fix (file/behavior): (1) Ensure a known free point inside the Base building footprint is walkable (no blocking wall/prop at that xz) and document/regress it; (2) refresh Playwright evidence with aimed shots: exterior→door opening / interior, and a readable car AABB silhouette (dark `prop` meshes) from a clear vantage — update `scripts/qa-epic46-tester-playwright.mjs` navigation (or temporary look-at) so landmarks are actually framed.
- Suggested check to prove closed: New screenshots under `qa-artifacts/epic-46/` clearly showing door gap + car cluster; regression asserts interior sample point clear of blocking geometry.

## Revision task (if REVISE)

- Finding IDs to fix: `F-001`, `F-002`
- Out of scope for this revision: Endless map picker; art pipeline / non-AABB assets; inventing true multi-floor physics; merge/deploy
- Re-verify required: yes (Tester re-runs scoped check + light regression)

## Notes (non-blocking)

- Base scale choice (2× linear → ~184×104) matches preferred AC and is documented in handoff/README.
- Server authority / capacity-8 / lobby map labels / `map_invalid` path look solid and well regression-covered.
- Base E/W “windows” are full-height ~8u segment gaps (walk-through), not sill/lintel holes; still within spec’s “gaps between segments” wording. `wallWithWindowAlongX` remains unused.
- Themed maps are intentionally MVP silhouettes; Rust Canyon live shot is sparse from corner spawn — acceptable as MVP once F-001/F-002 closed.
- `qa-artifacts/epic-46/` committed on branch despite global note that QA artifacts are typically ephemeral — fine for chain evidence this round; Team Lead may prefer gitignore later.
