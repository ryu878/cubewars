# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-25 |
| Task / Story / EPIC | EPIC 45 — Dual Lobby Inventories + Lobby Deathmatch Auction |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-45-programmer-handoff.md` @ branch `feature/epic-45-dual-lobby-inventory-auction` (`b813aac` includes `8c45e55`) |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Linux 5.15 (host); Redis local `127.0.0.1:6379`; Node v24.18.1
- Branch / commit: `feature/epic-45-dual-lobby-inventory-auction` @ `b813aacf0bb8fe8217322c32de1c40ca00d18ea8`

## Checklist scope applied

- Universal (AC, secrets, docs)
- Build and run
- Backend / game server (lobby bind + economy authority)
- Client (lobby UI + overlays)
- Gameplay & feel (lobby UI evidence + light in-match movement smoke)

## Check results

### Build

- Command: `npm run typecheck && npm run build`
- Result: OK — shared/server/client typecheck PASS; server `tsc` + client Vite build PASS

### Run

- Command: `npm run regression:lobby-inventory`
- Result: OK — printed `regression:lobby-inventory OK`
- Command: `node scripts/qa-epic45-tester-playwright.mjs`
- Result: OK — printed `[epic45-qa] PASS`; artifacts under `qa-artifacts/epic-45/`

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| Lobby shows Deathmatch Inventory, Bots Inventory, Auction without join | Three labeled buttons on mode-select | PASS — pre-auth disabled; after auth enabled; legacy `#lobbyInventoryBtn` absent (`01`/`02` screenshots + smoke-summary) |
| Deathmatch Inventory loads Deathmatch pool; badge matches | Bind `economyPool: "deathmatch"`; badge Deathmatch; no `join` | PASS — badge `Pool: Deathmatch (competitive)`; `data-pool=deathmatch`; bind deathmatch; joinCount=0 (`03`) |
| Bots Inventory loads Sandbox pool; badge matches | Bind `economyPool: "sandbox"`; badge Sandbox; no `join` | PASS — badge Sandbox; `data-pool=sandbox`; bind sandbox; joinCount=0 (`04`) |
| Mutations stay in bound pool (no bleed) | Discard in one pool leaves other unchanged | PASS — covered by `regression:lobby-inventory` (seeded DM/SB gems; cross-pool discard isolation) |
| Lobby Auction list/browse/bid/buyout without join; never Sandbox | Open AuctionPanel; Deathmatch only; no join | PASS — overlay open, heading `Auction (Deathmatch)`, browse OK + auction state with Bid/Buyout UI (`05`); bind deathmatch; joinCount=0; no sandbox profile during auction open. Regression: `economy_auction_browse` OK from lobby. List/bid/buyout share the same `nicknameReady` auction gate as browse (server). |
| Drop/trade from lobby still `match_required` | Reject drop/trade without match | PASS — regression asserts `drop_item` and `trade_open` → `match_required` |
| I/P hotkeys ignored on lobby | Typing i/p in nickname does not open inventory/auction | PASS — nick `ippi`; inventory/auction not visible; mode-select still visible (`06`) |
| Invalid pool reject | `pool_invalid` | PASS — regression sends invalid `economyPool` |
| Default omitted pool → deathmatch | Backward compatible | PASS — regression |
| Light gameplay regression after bots join | Movement still works | PASS — position changed after W/Space (`07`); pointer lock OK |

### Config and secrets

- `config.vars.example` / README up to date: yes (no new env vars; README Current status EPIC 45 added)
- No secrets in diff: yes (branch diff is client/server/shared/scripts/docs/README only)

### Documentation

- README / docs updated: yes — README Current status EPIC 45; task docs present

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: yes — allow-listed `economyPool`; `lobbyEconomyPool` tracked on connection; lobby inventory mutations use server-tracked pool; auction always Deathmatch via existing AuctionHouse; drop/trade/ground still match-gated. Client only chooses which button to press / UI visibility.

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s):
  - `qa-artifacts/epic-45/01-lobby-dual-buttons-preauth.png`
  - `qa-artifacts/epic-45/02-lobby-dual-buttons-authed.png`
  - `qa-artifacts/epic-45/03-deathmatch-inventory-open.png`
  - `qa-artifacts/epic-45/04-bots-inventory-open.png`
  - `qa-artifacts/epic-45/05-lobby-auction-open.png`
  - `qa-artifacts/epic-45/06-lobby-hotkeys-ignored.png`
  - `qa-artifacts/epic-45/07-inmatch-gameplay-smoke.png`
  - `qa-artifacts/epic-45/smoke-summary.json`
  - Script: `scripts/qa-epic45-tester-playwright.mjs`
- Movement: OK — in-match W moved player (smoke)
- Jump: OK — Space used during smoke; y changed
- Shoot / hit registration: N/A — not in EPIC 45 scope (bots fighting in background only)
- Camera / controls feel: OK — pointer lock + look smoke; no jank observed on lobby path
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK — lobby + overlays readable in screenshots
- Matches intended "Roblox-like" look (colorful, readable, low-poly): yes / N/A for lobby UI — inventory/auction overlays render as expected over existing scene

## On FAIL: reproduction

N/A (PASS)

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`). Verified dual lobby inventory buttons + lobby Deathmatch Auction without join, pool badges, regression isolation / match_required / auction browse, typecheck, build, and Playwright evidence under `qa-artifacts/epic-45/`.
