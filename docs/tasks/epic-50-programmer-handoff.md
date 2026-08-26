# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-26 |
| Author (Pusya) | Pusya (Programmer) |
| Task / Story / EPIC | EPIC 50 — Half-size maps + pet inventory clarity & type icons |
| Branch / commit / PR | `task/epic-50-half-maps-pet-clarity` — see PR (opened after this handoff) |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. **Story A — Half-size catalog maps:** Introduced `MAP_LINEAR_SCALE = 0.5` and `finalizeCatalogMap()` so authored X/Z geometry/spawns (±92/±52) scale to playable `STANDARD_MAP_BOUNDS` (±46/±26). Densify/clearance runs on **scaled** geometry (world-unit clearance). `WALL_HEIGHT` kept at 6 (fog-fade unchanged). Endless untouched (own procedural chunks; documented on `ARENA_BOUNDS`).
2. **Story B — Pet clarity + icons:** Shared `formatPetPrimaryGrant` / `describePetGrants` (via `PET_TYPE_RATING` + `aggregateEquippedRatings` floor/slot fractions). Inventory bag/rail/detail show e.g. `+156 Armor`, gem lines, and totals. Distinct CSS icons for dog/cat/bird/lion (pig-snout removed).

## Changed files / areas

- `shared/src/maps/types.ts` — `MAP_LINEAR_SCALE`, `MAP_AUTHORING_BOUNDS`, playable `STANDARD_MAP_BOUNDS`, `scaleCatalogBox`
- `shared/src/maps/finalize.ts` — **new** scale-then-densify helper
- `shared/src/maps/{base,themedMaps,densify,primitives}.ts`, `shared/src/mapData.ts` — wire finalize; densify lattice for ±46/±26; endless note
- `shared/src/economy.ts` — display helpers for pet grants
- `client/src/inventoryOverlay.ts`, `client/index.html` — labels + species icons
- `scripts/regression-epic46-maps.ts`, `scripts/regression-economy-pets.ts` — half bounds + grant label asserts
- `scripts/qa-epic50-programmer-playwright.mjs` — map + inventory evidence
- `docs/tasks/epic-50-*.md` — spec, assignment, this handoff

## How to verify (steps for Trusya)

1. Open lobby Deathmatch inventory: bag metas read `+N HP/Armor/Speed/Damage` (not `dog 156`); four species icons differ; equipped rail shows primary + gems + totals with slot fraction when slot 2.
2. Select a pet with gems: detail shows primary, `Gems: …`, `Total: …` from shared formulas only.
3. Join bots on several catalog maps: playable footprint ~half of EPIC 49; walls still fog-fade at height 6; props/palettes readable; pickups placeable/clear.
4. Review `qa-artifacts/epic-50/` shots `01`–`08` (maps) and `09`–`11` (pets); optional re-run: `node scripts/qa-epic50-programmer-playwright.mjs`.

## Build and run

- Build command: `npm run typecheck && npm run build`
- Regressions run: `npm run regression:epic46-maps && npm run regression:epic48 && npm run regression:economy-pets && npm run regression:epic49-palettes`
- Run command: `npm run dev` (or production compose per README)
- Expected smoke result: typecheck/build green; regressions PASS; Playwright OK with bounds ±46/±26 and pet grant copy

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout (`[server] … map=…`); Playwright script stdout (`[epic50-qa] …`)
- Key success messages: `[epic46-maps] PASS`, `[epic48] PASS`, `[economy-pets] PASS`, `[epic50-qa] OK — map + pet shots written`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: map geometry/spawns/pickups from shared catalog (server ships `map_state` / pickups); economy ratings from server `economy_profile` + shared `aggregateEquippedRatings`
- What the client is allowed to predict/render only: themes/fog materials; inventory **display** lines via shared pure helpers (no invented combat multipliers)

## Risks / known limitations

- Catalog authored at pre-scale coords then finalized — any new map must go through `finalizeCatalogMap` (do not densify on unscaled boxes).
- Endless mode intentionally not scaled (independent procedural layout).
- Equip rail repeats primary grant in label + sub-lines (readable; slightly redundant).
- Playwright evidence under `qa-artifacts/epic-50/` is git-ignored — Tester regenerates locally.

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
