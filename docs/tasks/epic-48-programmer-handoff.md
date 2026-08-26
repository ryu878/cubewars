# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-26 |
| Author (Pusya) | Pusya |
| Task / Story / EPIC | EPIC 48 — Pickup Balance / Spread + Map Select Fix |
| Branch / commit / PR | `task/epic-48-pickup-balance-map-select` @ `4d50814` — compare: https://github.com/ryu878/cubewars/compare/master...task/epic-48-pickup-balance-map-select?expand=1 (gh PR create blocked) |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. **Pickup rebalance:** `densePickups` now targets **8 weapon / 8 ammo / 6 health / 6 armor (28 total)** — mid guidance band for ~8 players on ~184×104 arenas (was EPIC 47 carpet **16/16/12/12 = 56**).
2. **Spatial spread:** replaced sequential lattice `next()` with farthest-from-existing + quadrant quotas + anti-collinear checks; kept `isPickupClear`. Regression fails on weapon “runway” rows.
3. **Map select root cause + fix:**
   - **Root cause (public):** MatchManager always pre-created an empty **Base** public match (`Game 1 · Base · 0/8`). Players picking a themed map then clicking lobby **Join** hit join-existing → server ignored client `mapId` → **Base always**. ESC leave→rejoin also **painted Base geometry** in `clearMatchClientState` before `map_state`, which looked like Base stuck.
   - **Fix:** lazy-create public matches (no startup empty Base); tear down empty public matches on last leave; lobby Join syncs picker to that match’s map + hint text; leave→rejoin skips Base geometry reset; rejoin always sends explicit `mapId`.
4. **Regression:** `scripts/regression-epic48.ts` — catalog counts/spread; public+bots non-Base geometry; leave→rejoin; no empty Base lobby at boot. EPIC 47 count assertions updated to EPIC 48 totals.

### Pickup before / after (all densify catalog maps)

| Category | EPIC 47 (before) | EPIC 48 (after) |
|----------|------------------|-----------------|
| weapon   | 16               | **8** |
| ammo     | 16               | **8** |
| health   | 12               | **6** |
| armor    | 12               | **6** |
| **total**| 56               | **28** |

**Rationale:** Enough for ~8 concurrent players to contest sites without carpeting the floor; alternate rifle/GL weapons and matching ammo; health/armor slightly below weapons so fights still pull players to weapon spawns. Mid-band of the EPIC 48 guidance (6–10 / 6–10 / 4–8 / 4–8, ~20–32 total).

## Changed files / areas

- `shared/src/maps/densify.ts` — EPIC48 counts + spread placement; export `EPIC48_PICKUP_COUNTS`
- `shared/src/mapData.ts`, `shared/src/maps/base.ts`, `shared/src/maps/themedMaps.ts` — export / comments
- `server/src/matchManager.ts` — lazy public create; empty public teardown
- `server/src/match.ts` — `onEmpty` for all modes when last human leaves
- `client/src/main.ts` — leave→rejoin skips Base geometry paint; explicit rejoin `mapId`
- `client/src/modeSelect.ts` — lobby Join syncs map picker
- `client/src/pauseMenu.ts` — validate catalog `mapId` on change-map
- `client/index.html` — map picker hint + CSS
- `scripts/regression-epic48.ts` (new), `scripts/regression-epic47.ts` (counts + exit cleanup)
- `package.json` — `regression:epic48`
- `README.md` — EPIC 48 status blurb
- `docs/tasks/epic-48-*.md` — spec/assignment/handoff

## How to verify (steps for Trusya)

1. `npm run typecheck` and `npm run build`
2. `npm run regression:epic48` — expect `[epic48] PASS`
3. `npm run regression:epic47` and `npm run regression:epic46-maps` — still green
4. Manual: pick **Rust Canyon** → **Quick Join — Deathmatch** → status/`map_state` must be rust_canyon (not Base geometry). Same for **vs Bots**.
5. Manual: ESC → Change Map → confirm another non-Base map → leave→rejoin loads that map (no prolonged Base flash).
6. Manual: lobby starts with **No games yet** (no empty Base row). After someone is in a themed match, **Join** on that row uses that map (picker syncs).

## Build and run

- Build command: `npm run typecheck && npm run build`
- Run command: `npm run dev` (or deploy stack)
- Expected smoke result: themed map pickups ~28, spread; Quick Join/bots honor picker; no empty Base lobby trap

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout
- Key success messages:
  - `[server] public match available: … map=<non-base>`
  - `[server] player joined match "…" (mode=… map=<id>)`
  - `[server] match torn down: …` when last human leaves public/bots

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: match `mapId`, catalog geometry/pickups/bounds, join-existing ignores client mapId, pickup spawn lists from densify
- What the client is allowed to predict/render only: render `map_state` geometry; lobby picker is a create/find hint only

## Risks / known limitations

- Joining an **occupied** listed match still uses that match’s map (server wins) — intentional; UI hint + picker sync reduce confusion.
- Densify fallback far-corner packing still exists if clear pool is exhausted (current catalogs do not hit it).
- Programmer does not merge/deploy.

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
