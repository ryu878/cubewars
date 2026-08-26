# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-26 |
| Author (Pusya) | Programmer (Pusya) |
| Task / Story / EPIC | EPIC 47 — Map Density + Bots MapId + ESC Menu + Changelog + Auth UX |
| Branch / commit / PR | `task/epic-47-map-density-bots-esc` @ `bb9d379` — branch pushed; open PR via https://github.com/ryu878/cubewars/compare/master...task/epic-47-map-density-bots-esc?expand=1 (`gh` logged in as `ltrvtrb2`, cannot see `ryu878/cubewars`) |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. **Pickup density ~4×** on all 8 catalog maps via `shared/src/maps/densify.ts` (16 weapon / 16 ammo / 12 health / 12 armor = **56** total; EPIC 46 baseline was **14**). Clearance from wall/prop/crate retained; EPIC 46 building-interior sample still asserted.
2. **More interior cover** on Base + all themed maps (extra walls/crates/props; AABB-only; spawn-clear).
3. **Bots mapId:** Hardened join payload (always send explicit `mapId` for public/bots); echo `mapId`/`mode` on `join_accepted` and `map_state`. Root cause / note: protocol already honored `mapId` when sent; silent Base fallback when omitted + no in-match map confirmation made failures hard to see. Regression + Playwright prove non-Base (`rust_canyon`).
4. **ESC pause menu:** Resume; Exit to Lobby; Change Map / Reload (picker; endless = reload without picker); Inventory (pool by mode); Auction (Deathmatch). Pointer unlocked while open; input zeroed.
5. **In-band leave:** client `leave_match` → server `removeHuman` + re-attach lobbySockets → `leave_match_ack` (WS/auth preserved).
6. **Changelog:** lobby link near Telegram → `/changelog.html` (static JSON, 10/page, newest first, pagination).
7. **Auth UX:** `account_reset_code` issues new on-screen code (no fake email); login accepts `NNN-NNN` and digit-only via normalize; regressions extended.

### Pickup before → after (every catalog map)

| Map | Before (EPIC 46) | After (EPIC 47) |
|-----|------------------|-----------------|
| base, rust_canyon, glass_dome, dead_station, fuel_depot, crystal_cave, abyss_bridge, elite_quarter | 4W+4A+3H+3Armor = **14** | 16W+16A+12H+12Armor = **56** |

## Changed files / areas

- `shared/src/maps/{densify,base,themedMaps}.ts`, `shared/src/mapData.ts`, `shared/src/index.ts` (leave + mapId echo + account_reset_code)
- `server/src/{index,match}.ts`, `server/src/accounts/*`
- `client/src/{main,modeSelect,pauseMenu,network,uiInput,accountAuth}.ts`, `client/index.html`, `client/public/changelog.*`
- `scripts/regression-epic47.ts`, `scripts/qa-epic47-programmer-playwright.mjs`, `scripts/regression-epic46-maps.ts`, `scripts/regression-account-auth.ts`
- `README.md`, `docs/tasks/epic-47-*`

## How to verify (steps for Trusya)

1. `export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"`
2. `npm run typecheck` && `npm run build`
3. `npm run regression:epic47` — density/clearance, bots→rust_canyon, leave_match→rejoin glass_dome
4. `npm run regression:epic46-maps` && `npm run regression:account-auth`
5. `node scripts/qa-epic47-programmer-playwright.mjs` — screenshots under `qa-artifacts/epic-47/`
6. Manual: select Rust Canyon → vs Bots → confirm non-Base; ESC → Exit to Lobby → mode-select; Changelog link; Resend code + login with `123456` style digits

## Build and run

- Build command: `npm run build`
- Run command: `npm run dev` (or deploy stack)
- Expected smoke result: lobby map picker + changelog; bots loads selected map; ESC menu works; leave returns lobby

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout
- Key success messages:
  - `[server] match created: bots:… map=rust_canyon`
  - `[server] player left match "…" via leave_match`
  - `[accounts] reset_code ok …`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: match membership/`mapId`, geometry/pickups from catalog, `leave_match` cleanup, account code hash/normalize/rate-limit
- What the client is allowed to predict/render only: HUD, pause UI, changelog page, local pointer-lock

## Risks / known limitations

- Endless Change Map = reload endless only (no catalog picker) — documented in pause UI
- After leave, a brief pre-join input may be dropped once (server log) — harmless
- Changelog is static JSON in `client/public/` (manual update per EPIC)

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
