# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-26 |
| Author (Pusya) | Pusya |
| Task / Story / EPIC | EPIC 47 — Critic revision **F-001** only |
| Branch / commit / PR | `task/epic-47-map-density-bots-esc` / `0e03183f91fc8925f69556675e8d104d93a3d5f7` / existing branch (no new PR; do not merge) |
| Revision round (if this is a Critic/Judge fix, not first pass) | yes — finding IDs: **F-001** |

## What was done (brief)

1. **F-001:** Pause-menu **Auction** no longer sets `lastLobbyBindPool = "deathmatch"` or sends `lobby_bind_nickname` while in-match.
2. Opening Auction from ESC now only closes the pause menu and opens `auctionPanel` — same safe pattern as Inventory (in-match guard) and the U-key auction toggle.
3. Lobby Auction on mode-select (Deathmatch bind) is unchanged. F-002 (hint copy) was **not** touched (optional; out of this revision scope).

## Changed files / areas

- `client/src/main.ts` — `PauseMenu` `case "auction"`: remove lobby bind / `lastLobbyBindPool` poke; open panel only
- `docs/tasks/epic-47-programmer-handoff-f001.md` — this revision handoff

## How to verify (steps for Trusya)

1. Join **bots** (or endless). Note Sandbox gold / ratings on HUD (or Inventory pool label).
2. ESC → **Auction** → confirm panel opens; close Auction.
3. Confirm subsequent sandbox `economy_profile` / HUD gold still update (filter not stuck on deathmatch). Optionally open Inventory and confirm Pool remains Sandbox.
4. Optional: U-key Auction still toggles without bind; lobby mode-select Auction still binds Deathmatch.
5. Light regression: pause Inventory / Exit to lobby still work.

## Build and run

- Build command: `export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"` then `npm run typecheck --workspace=client` (PASS locally)
- Run command: `npm run dev` (or project docker compose if used)
- Expected smoke result: Client typechecks; in bots match, pause Auction does not poison `lastLobbyBindPool`

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: N/A for this client-only filter fix (no new server logs)
- Key success messages: N/A

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: unchanged — auction/economy remain server-authoritative
- What the client is allowed to predict/render only: display filter `lastLobbyBindPool` must not suppress match-scoped sandbox profiles after pause Auction

## Risks / known limitations

- Pause Auction still opens Deathmatch auction UI in all modes (intentional product behavior); only the incorrect lobby-bind filter poke was removed.
- F-002 (Esc hint text) not fixed in this round.

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
