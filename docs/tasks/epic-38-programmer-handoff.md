# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-25 |
| Author (Pusya) | Programmer (Pusya) |
| Task / Story / EPIC | EPIC 38 — Auction, P2P Trade & Ground Item Drops (`docs/tasks/epic-38-auction-trade-ground.md`) |
| Branch / commit / PR | `task/epic-38-auction-trade-ground` — Critic REVISE F-001–F-004; base feature `1a2ba9b`; pushed; PR after Tester re-verify |
| Revision round (if this is a Critic/Judge fix, not first pass) | yes — finding IDs: F-001, F-002, F-003, F-004 |

## What was done (brief)

1. **F-001:** Ground pickup claims/removes the entity synchronously before any await; insert failure restores the entity (no duplicate / no silent destroy).
2. **F-002:** `executeAtomicTrade` tracks reminted insert refs; on failure reverses completed inserts then restores original escrow payloads + gold (no mid-insert duplication).
3. **F-003:** Auction bid/buyout/settle under per-lot mutex; settle marks `settling` + Redis NX keys for item delivery / gold payout so double-settle cannot mint twice.
4. **F-004:** Regression covers concurrent pickup, pickup restore, mid-insert trade rollback, double settle, concurrent bids.

## Changed files / areas

- `server/src/match.ts` — atomic ground claim/restore (F-001)
- `server/src/matchMarket.ts` — claim/restore helpers; trade rollback by remint ref (F-002)
- `server/src/economy/store.ts`, `escrow.ts` — `insertEscrowItem` returns `EscrowInsertRef`
- `server/src/economy/auction.ts` — lot locks, settling checkpoint, NX delivery/payment (F-003)
- `scripts/regression-auction-trade-ground.ts` — concurrent/partial-failure cases (F-004)
- `docs/tasks/epic-38-programmer-handoff.md` — this revision handoff

## How to verify (steps for Trusya)

1. `npm run typecheck` && `npm run build`
2. `npm run regression:auction-trade-ground` — expect `[ok] F-001 …`, `F-002 …`, `F-003 …` lines then PASS
3. Optional: prior happy-path smoke (Deathmatch drop/F, auction, trade) still behaves
4. Capture evidence under `qa-artifacts/epic-38/` if re-running Playwright

## Build and run

- Build command: `npm run typecheck && npm run build`
- Run command: `docker compose up -d redis` then `npm run dev`
- Expected smoke result: typecheck/build green; `regression:auction-trade-ground` PASS including F-001–F-003 cases

## Configuration

- New environment variables: no (still `CUBEWARS_AUCTION_MS` from original EPIC 38)
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout
- Key success messages: `[ground] pickup`, `[trade] atomic swap ok`, `[auction] settled …`, `[auction] bid`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: exclusive ground claim, trade compensation, auction settle/bid mutex + idempotent NX payouts
- What the client is allowed to predict/render only: UI from server snapshots; intents only

## Risks / known limitations

- Trade offer UI still minimal (unchanged; out of Critic revision scope)
- Ground pickup range remains client UX; server enforces exclusive claim + caps + TTL

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
