# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-25 |
| Author (Pusya) | Programmer (Pusya) |
| Task / Story / EPIC | EPIC 38 — Auction, P2P Trade & Ground Item Drops (`docs/tasks/epic-38-auction-trade-ground.md`) |
| Branch / commit / PR | `task/epic-38-auction-trade-ground` — feature commit `1a2ba9b` (base `master` @ `f270a3b`); branch pushed; PR after Tester PASS |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. Shared: `AUCTION_FEE`, `AUCTION_DURATION_MS`, `GROUND_DROP_TTL_MS`, and auction/trade/ground protocol (client intents + server state messages).
2. Server: Redis auction lots + developer/burn ledgers; Deathmatch-only list/bid/buyout/expire settle with 10% fee (5% burn / 5% ledger); buyer-cap cancel+refund; escrow extract/insert with reminted IDs.
3. Match: same-match P2P trade (both confirm, no fee, atomic + rollback); ground drops with 60s TTL expire-destroy; public/Deathmatch only.
4. Client: auction panel (**U**), trade window (**T** nearest), ground HUD (**F** pickup); inventory Drop/Auction on Deathmatch.
5. Regressions: `npm run regression:auction-trade-ground` (fee burn, isolation, ground TTL, trade atomicity/rollback).

## Changed files / areas

- `shared/src/economy.ts`, `shared/src/index.ts` — constants + protocol
- `server/src/economy/auction.ts`, `escrow.ts`, `store.ts`, `index.ts` — auction house + bag escrow transfer
- `server/src/matchMarket.ts`, `server/src/match.ts`, `server/src/index.ts` — trade/ground + auction WS handlers + tick
- `client/src/auctionPanel.ts`, `tradePanel.ts`, `groundHud.ts`, `network.ts`, `main.ts`, `inventoryOverlay.ts`, `client/index.html`
- `scripts/regression-auction-trade-ground.ts`, `package.json`, `config.vars.example`, `README.md`
- `docs/tasks/epic-38-auction-trade-ground.md`, `docs/tasks/epic-38-programmer-handoff.md`

## How to verify (steps for Trusya)

1. `npm run typecheck` && `npm run build`
2. `npm run regression:auction-trade-ground` — fee burn/ledger, buyer-cap refund, sandbox isolation, ground TTL, trade atomic success + rollback
3. Optional smoke: `npm run regression:economy-gold` / `economy-inventory` / `economy-pets` / `economy-gems-amulets` / `split-economy` (kept green at handoff)
4. Manual (Deathmatch/`public`): join two humans; **I** inventory → Drop to ground → **F** pickup; **U** auction list/bid/buyout; **T** near partner → offer/confirm trade
5. Manual (Sandbox/`bots`): Drop/Trade/Auction market actions must fail or not mutate sandbox pool; auction always uses Deathmatch bag
6. Capture evidence under `qa-artifacts/epic-38/` (git-ignored)

## Build and run

- Build command: `npm run typecheck && npm run build`
- Run command: `docker compose up -d redis` then `npm run dev`
- Expected smoke result: typecheck/build green; `regression:auction-trade-ground` PASS

## Configuration

- New environment variables: yes → `CUBEWARS_AUCTION_MS` (optional QA override; documented in `config.vars.example`)
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout
- Key success messages:
  - `[auction] listed lot#…` / `bid` / `settled … burn=… dev=…` / `settle cancelled … refund`
  - `[ground] drop` / `pickup` / `expired destroy`
  - `[trade] atomic swap ok …`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: all gold/item escrow, auction settle/fee/burn/ledger, trade atomicity, ground TTL, Deathmatch-only market gate from match mode / auction scope (never client-supplied pool)
- What the client is allowed to predict/render only: auction/trade/ground UI from server snapshots; intents only

## Risks / known limitations

- Auction listing UI needs a Deathmatch `economy_profile` snapshot (join Deathmatch once / be in public match) so bag item pickers are populated
- Trade offer UI is minimal (gold + one item id); sufficient for AC, not a polished multi-slot editor
- Cross-profile item ID reminting on transfer is intentional (avoids Redis owner-key collisions)
- Ground pickup range is enforced client-side for UX (`F` nearest within 3); server validates match membership, Deathmatch mode, caps, and TTL

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
