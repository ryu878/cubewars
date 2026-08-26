# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-26 |
| Task / Story / EPIC | EPIC 47 — Map Density + Bots MapId + ESC Menu + Changelog + Auth UX |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-47-programmer-handoff.md` — feature commit `29fd60d` (`feat(epic-47): densify maps, bots mapId, ESC leave, changelog, auth UX`); branch tip at QA time `73782ad` (docs commits after feature) |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Linux 5.15 (local Node, Redis on `127.0.0.1:6379`)
- Branch / commit: `task/epic-47-map-density-bots-esc` — verified feature SHA `29fd60df99f03f085c2a54add9a2b03a91d4993b`
- Node: `v24.18.1` via `PATH=$HOME/.nvm/versions/node/v24.18.1/bin:$PATH`
- Worktree: `.claude/worktrees/epic-47-map-density-bots-esc`

## Checklist sections applied

- Universal (acceptance, secrets, docs)
- Build and run
- Client (web/game client)
- Backend / game server (match `mapId`, `leave_match`, account reset — smoke via regressions)
- Real-time / multiplayer (join/leave WS paths)
- Gameplay & feel (bots match, ESC menu, light move/jump, inventory/auction overlays)

## Check results

### Build

- Command: `npm run typecheck` then `npm run build`
- Result: OK — shared/server/client typecheck clean; server `tsc` + client Vite production build succeeded

### Run

- Command: `npm run regression:epic47`; `npm run regression:epic46-maps`; `npm run regression:account-auth`; `node scripts/qa-epic47-programmer-playwright.mjs`; plus Tester Playwright extras for auth/inventory/auction/change-map
- Result: OK —
  - `[epic47] catalog density + clearance OK` then `[epic47] PASS` (bots `map=rust_canyon`, `leave_match` → rejoin `glass_dome`)
  - `[epic46-maps] PASS`
  - `[account-auth] PASS` (dashed + digit-only login; `reset_code ok`; rate limit)
  - `[epic47-qa] PASS` (programmer Playwright)
  - Tester extras: auth resend honest on-screen code + digit-only login; pause Inventory / Auction / Change Map panels — PASS
  - Note: epic47 regression + Playwright child servers sometimes hang on `SIGTERM` after printing PASS; logic completed; ports cleaned by Tester after runs

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| Pickup density all catalog maps | 16W+16A+12H+12Armor = **56** (was 14); clearance from wall/prop/crate; base interior sample clear | `regression:epic47` density+clearance OK; live counts: every map `pickups=56` |
| More cover | Extra walls/crates/props; navigable AABB | Catalog geometry present (e.g. base walls=31 crates=21 props=12; rust_canyon walls=20 crates=10 props=20); no clearance failures |
| Bots loads selected non-Base map | `rust_canyon` in join_accepted + map_state (`rc_` geometry, no `base_`) | Server log `match created: … map=rust_canyon`; summary `joinMapId/acceptedMapId/mapStateMapId=rust_canyon`, `hasRc=true`, `hasBase=false`; HUD toast `map rust_canyon` in screenshots |
| Public map select after leave | Rejoin public on `glass_dome` works | epic47 regression: leave_ack then `join_accepted`/`map_state` `glass_dome` with `gd_` boxes |
| ESC pause menu | Resume, Exit to Lobby, Change map, Inventory, Auction | All buttons present (`02-esc-pause-menu.png`); Inventory opens Sandbox pool (`08`); Auction Deathmatch overlay (`09`); Change Map picker with catalog (`10`) |
| Exit to Lobby | Clean `leave_match` → mode-select; no stuck pause | `leaveAcks=1`, mode-select visible, pause hidden (`03-exit-to-lobby.png`); status “back in lobby — choose a mode”; Changelog near Telegram |
| Changelog | Link near Telegram → `/changelog.html`; 10/page; newest first; pagination | Link `href=/changelog.html` near Telegram; page1 first title EPIC 47; 22 entries → Next enabled; page2 screenshot shows 10 entries + “Page 2 of 3” |
| Send/Resend password | New on-screen code; honest (not emailed); rate-limited | UI hint “New login code — shown on screen only (not emailed)” (`05-auth-resend-code.png`); server `reset_code ok`; store/WS rate limits in account-auth regression |
| Code normalization | Login with `NNN-NNN` and digit-only | Unit+WS digit-only login PASS; UI digit-only after reset → signed in (`06-auth-digit-login.png`) |
| Light gameplay | Move / jump; scene readable | W + Space exercised (`07-movement-jump.png`); colorful low-poly scene + HUD OK in match screenshots |

### Config and secrets

- `config.vars.example` / README up to date: yes — README documents EPIC 47 behavior; no new env vars
- No secrets in diff: yes — no `.env` / credential files in `master...29fd60d`; auth codes only shown in transient QA UI

### Documentation

- README / docs updated: yes — README EPIC 47 blurb; `docs/tasks/epic-47-*` present

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: yes — catalog geometry/pickups server-side; join `mapId` echoed on `join_accepted`/`map_state`; `leave_match` server teardown + lobby re-attach; account code hash/`normalizeCode`/rate-limit on server

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s): `qa-artifacts/epic-47/`
  - `01-bots-rust-canyon.png`
  - `02-esc-pause-menu.png`
  - `03-exit-to-lobby.png`
  - `04-changelog-page.png` (page 2 after Next — pagination proof; page1 newest-first in `summary.json`)
  - `05-auth-resend-code.png`
  - `06-auth-digit-login.png`
  - `07-movement-jump.png`
  - `08-pause-inventory.png`
  - `09-pause-auction.png`
  - `10-pause-change-map.png`
  - `summary.json`, `tester-auction-changemap-summary.json`, Playwright console logs
- Movement: OK — W held in bots match
- Jump: OK — Space pressed; no stuck state observed
- Shoot / hit registration: N/A for this EPIC scope (bots combat continued in background; not AC-critical) — no new shoot regressions observed
- Camera / controls feel: OK — ESC unlocks pointer into pause; Exit returns lobby UI
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK — brick/arena scenes + HUD readable
- Matches intended "Roblox-like" look (colorful, readable, low-poly): yes

## On FAIL: reproduction

N/A — PASS

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`). Verified: ~4× pickup density (56) + clearance; bots honor `rust_canyon`; ESC pause (Resume / Change Map / Inventory / Auction / Exit to Lobby); changelog near Telegram with 10/page newest-first pagination; honest on-screen resend code + digit-only login; typecheck/build + epic47/epic46/account-auth regressions + Playwright evidence under `qa-artifacts/epic-47/`.
