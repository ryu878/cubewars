# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-25 |
| Author (Pusya) | Pusya (Programmer) |
| Task / Story / EPIC | EPIC 45 — Dual Lobby Inventories + Lobby Deathmatch Auction |
| Branch / commit / PR | `feature/epic-45-dual-lobby-inventory-auction` @ `8c45e55050ad3d222a0dc368f01198d1974c7af9` — branch pushed; open PR into `master` via https://github.com/ryu878/cubewars/pull/new/feature/epic-45-dual-lobby-inventory-auction (`gh` as `ltrvtrb2` cannot resolve `ryu878/cubewars`) |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. Replaced the single lobby Inventory button with **Deathmatch Inventory**, **Bots Inventory**, and **Auction** on mode-select; both inventories open the existing `InventoryOverlay`; Auction opens the existing `AuctionPanel` after Deathmatch bind.
2. Extended `lobby_bind_nickname` with optional `economyPool: "deathmatch" | "sandbox"` (default Deathmatch); server tracks `lobbyEconomyPool` and scopes lobby inventory mutations to that pool only; invalid pool → `pool_invalid`.
3. Confirmed auction list/browse/bid/buyout remain available when `nicknameReady` without join; auction stays Deathmatch-only. Updated misleading auction listing copy. Extended `regression:lobby-inventory` for dual-pool bind, mutation isolation, and lobby auction without join. README Current status updated.

## Changed files / areas

- `shared/src/index.ts` — `LobbyBindNicknameMessage.economyPool?`
- `server/src/index.ts` — pool validation, `lobbyEconomyPool`, pool-scoped lobby mutations + logging
- `client/index.html` — dual inventory + auction buttons + CSS
- `client/src/modeSelect.ts` — callbacks for inventory pool + auction
- `client/src/main.ts` — bind + open overlay/panel wiring
- `client/src/auctionPanel.ts` — listing UX copy (lobby Deathmatch bind is enough)
- `scripts/regression-lobby-inventory.ts` — EPIC 45 regression coverage + reliable server teardown
- `README.md` — Current status EPIC 45
- `docs/tasks/epic-45-dual-lobby-inventory-auction.md`, `docs/tasks/epic-45-programmer-assignment.md`, `docs/tasks/epic-45-programmer-handoff.md`

## How to verify (steps for Trusya)

1. Sign in on lobby; enter a valid nickname. Confirm three buttons visible without joining: **Deathmatch Inventory**, **Bots Inventory**, **Auction**.
2. Open Deathmatch Inventory → overlay shows Deathmatch badge/profile; mutate (e.g. move/discard) and confirm only Deathmatch pool changes.
3. Open Bots Inventory → Sandbox badge/profile; mutate and confirm Sandbox only (no Deathmatch bleed).
4. Open Auction from lobby → auction panel lists/browses; list/bid/buyout work without `join`. Confirm Sandbox inventory is never used for auction.
5. From lobby, confirm drop/trade still rejected (`match_required`). Confirm I/P hotkeys do nothing while mode-select is visible.
6. Capture Playwright evidence for dual buttons + auction open (`qa-artifacts/epic-45/`).

## Build and run

- Build command: `npm run typecheck && npm run build`
- Regression: `npm run regression:lobby-inventory`
- Run command: start Redis + `npm run dev` (or project compose) as usual; open client, auth, use lobby buttons
- Expected smoke result: typecheck/build PASS; `regression:lobby-inventory OK`; lobby buttons open correct pools / auction without join

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: game server stdout
- Key success messages:
  - `[lobby/deathmatch] nickname bound for inventory: …`
  - `[lobby/sandbox] nickname bound for inventory: …`
  - `[economy] <action> ok for <nick> [lobby/deathmatch|sandbox]`
  - Rejects: `pool_invalid`, `nickname_invalid`, `match_required` for drop/trade from lobby

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: nickname normalize; `economyPool` allow-list; `lobbyEconomyPool` tracked on connection; lobby inventory mutations use server-tracked pool only; auction always Deathmatch via existing AuctionHouse; drop/trade/ground still match-gated.
- What the client is allowed to predict/render only: which button was pressed, loading status text, overlay/panel visibility, server-authored `economy_profile` / auction state.

## Risks / known limitations

- Opening Auction after Bots Inventory pushes Deathmatch profile (can clobber an open Sandbox overlay snapshot) — accepted per spec.
- Old clients omitting `economyPool` still bind Deathmatch (backward compatible).
- Playwright lobby dual-button / auction evidence is Tester-owned (not run in this handoff).

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
