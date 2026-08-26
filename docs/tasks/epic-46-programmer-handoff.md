# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-26 |
| Author (Pusya) | Pusya |
| Task / Story / EPIC | EPIC 46 — Multi-Map Catalog, Map Picker, Expanded Base, 8-Player Public |
| Branch / commit / PR | `task/epic-46-multi-map-select-capacity` @ `ccc437a` (impl) / `ca12879` (handoff SHA) — open PR: https://github.com/ryu878/cubewars/compare/master...task/epic-46-multi-map-select-capacity?expand=1 (`gh pr create` blocked: CLI auth `ltrvtrb2`, SSH push `ryu878`) |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. Shared static map catalog (`shared/src/maps/`): 8 maps (`base` + 7 themed). `MapBoxKind` extended with `"prop"` (blocks like walls). Doors/windows = gaps between wall segments.
2. **Base scale choice: 2× linear X/Z** (preferred) from ~92×52 → **~184×104** (~4× area). Bounds `±92` / `±52`. Enterable building (doors N/S + window gaps E/W) + collidable car AABB silhouette (`prop`).
3. Server owns `match.mapId`; geometry/spawns/pickups/bounds from catalog; `map_state` reused; join-existing ignores client `mapId`; invalid → `map_invalid`. `MAX_PUBLIC_PLAYERS_PER_MATCH = 8`.
4. Lobby `#mapSelect` for Public + Bots; lobby rows show map name; protocol `LobbyMatchSummary.mapId` + `mapDisplayName`, `JoinMessage.mapId`.
5. Regressions: `regression:epic46-maps`, updated `regression:lobby-nicknames`; README Current status EPIC 46.

## Changed files / areas

- `shared/src/maps/*` (types, primitives, base, themedMaps, catalog)
- `shared/src/mapData.ts`, `pickups.ts`, `collision.ts`, `index.ts`
- `server/src/match.ts`, `matchManager.ts`, `index.ts`
- `client/src/modeSelect.ts`, `main.ts`, `index.html`
- `scripts/regression-epic46-maps.ts`, `scripts/regression-lobby-nicknames.ts`
- `package.json`, `README.md`
- `docs/tasks/epic-46-*.md`

## How to verify (steps for Trusya)

1. `npm run typecheck` && `npm run build`
2. `npm run regression:epic46-maps` — capacity 8, themed map join, ignore client mapId on existing, `map_invalid`, lobby map fields
3. `npm run regression:lobby-nicknames` — 8-cap quick-join spillover
4. Manual / Playwright: lobby map picker visible; pick Base + one themed (e.g. Rust Canyon); Public + Bots; join listed match and confirm map name; walk into Base building doors; confirm car blocks; 8th player can join public
5. Smoke endless still works (`npm run regression:endless`) — no map picker required

## Build and run

- Build command: `npm run typecheck` && `npm run build`
- Run command: `npm run dev` (or docker compose per README)
- Expected smoke result: mode-select shows Map dropdown; Public/Bots use selection; matches list includes map name; in-match geometry matches selected catalog map via `map_state`

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout
- Key success messages:
  - `[server] public match available: … map=<id> (8 max players)`
  - `[server] match created: bots:… map=<id>`
  - `[server] join existing match "…": ignoring client mapId=… (server map=…)` when mismatch on join-existing

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: match `mapId`, geometry, spawns, pickups, bounds, capacity 8; client `mapId` only used when creating/finding a new public/bots match; ignored when joining existing `matchId`; invalid catalog ids rejected
- What the client is allowed to predict/render only: last `map_state` geometry/bounds + `pickup_state` (positions included); must not invent divergent collision

## Risks / known limitations

- Themed maps are MVP AABB silhouettes (readable themes, not art-complete)
- `regression:collision-overshoot` sweeps all Base corners and is slower on the larger Base footprint — allow longer runtime or run selectively
- Endless map picker intentionally out of scope
- Playwright screenshot helper left for Tester (AC 46.4.3)

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
