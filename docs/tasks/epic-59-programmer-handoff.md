# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-28 |
| Author (Pusya) | Pusya |
| Task / Story / EPIC | EPIC 59 — Mid-map rift hazard rivers (T59.1–T59.5) |
| Branch / commit / PR | `feature/epic-59-map-rift-hazards` @ `PENDING_SHA` — PR: `PENDING_URL` |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. **Shared (T59.1):** `MapRiftHazard` on `MapDefinition`; authored zig-zag polylines per map with distinct kinds; `isPointInRift` thick-polyline hit test; XZ + halfWidth scaled in `finalizeCatalogMap`; spawns kept outside rift footprint.
2. **Server (T59.2):** After `registry.step`, `applyRiftHazardDamage()` for non-endless catalog matches — grounded living humans+bots inside rift take `applyEnvironmentalDamage` (armor→health); broadcast as `"rift"`; no kill/gold/leaderboard credit; airborne skips.
3. **Client (T59.3):** `MapRiftRenderer` ribbon + per-kind VFX from shared catalog on `map_state`; dispose/rebuild; does not block movement; no client HP.
4. **Docs (T59.5):** About maps section (EN+RU) + Changelog entry; `LAST_UPDATED` already 2026-08-28.
5. **Smoke (T59.4):** `scripts/regression-epic59-rifts.ts` + `npm run regression:epic59-rifts`.

## Changed files / areas

- `shared/src/maps/types.ts`, `rift.ts`, `riftDefs.ts`, `finalize.ts`, `base.ts`, `themedMaps.ts`, `mapData.ts`
- `server/src/match.ts`
- `client/src/mapRiftRenderer.ts`, `client/src/main.ts`
- `client/public/about.html`, `client/public/changelog.json`
- `scripts/regression-epic59-rifts.ts`, `package.json`
- `docs/tasks/epic-59-map-rift-hazards.md`, `docs/tasks/epic-59-task-assignment.md`, `docs/tasks/epic-59-programmer-handoff.md`

## How to verify (steps for Trusya)

1. `npm run build` (workspaces) succeeds.
2. `npm run regression:epic59-rifts` — point-in-rift, kinds, scale, spawn clearance.
3. `npm run regression:epic49-palettes` — still green.
4. **Manual — stand vs jump:** Join vs Bots on **Base** (piranha water). Walk into the mid-map ribbon and stand still — armor then HP should drain (server `hit` with shooter `rift`). Jump across the ribbon without landing in it — no rift damage while airborne.
5. Spot-check 2–3 other maps (e.g. Rust Canyon lava, Glass Dome acid) — themed color/VFX differ; same stand-vs-jump rule.
6. Confirm bots standing in the rift also take damage.
7. Endless mode — no catalog rift mesh / no rift DoT.
8. Spawns never appear inside the ribbon.

### Screenshot guidance

- One frame standing in Base rift (ribbon visible under feet).
- One frame mid-jump over the same rift.
- Optional: Rust Canyon lava ribbon for kind contrast.

## Build and run

- Build command: `npm run build`
- Run command: `npm run dev` (or docker compose per project norms)
- Expected smoke result: catalog match shows mid-map themed ribbon; standing drains armor→HP; jump-clear safe; endless unchanged.

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout — existing `hit:` lines with shooterId `rift`
- Key success messages: `hit: rift -> <playerId> (... dmg ...)` while grounded in rift

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: rift footprint (`isPointInRift`), grounded check, DPS via `applyEnvironmentalDamage`, death without kill credit
- What the client is allowed to predict/render only: cosmetic ribbon + VFX from shared catalog polyline; no local HP/armor mutation for rift

## Risks / known limitations

- Rift halfWidth (~0.8 world after scale) tuned for normal jump; very slow approaches while barely airborne may still tick if `grounded` flips true on a frame inside the footprint.
- Some mid walls/props may sit near the ribbon; placement prefers open lanes but is not a full pathfinding solve.
- `regression:epic46-maps` still fails on master with `base needs denser pickups` (base has 6 pickups after EPIC 50 half-maps) — pre-existing, not introduced by EPIC 59.
- No rift sound (out of scope).

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
