# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-25 |
| Author (Pusya) | Pusya |
| Task / Story / EPIC | EPIC 45 — Critic revision **F-001** only (stale dual-bind `economy_profile` race) |
| Branch / commit / PR | `feature/epic-45-dual-lobby-inventory-auction` / `5dad425349a0d4ccf5741341837b375de784e4ca` / existing EPIC 45 PR |
| Revision round (if this is a Critic/Judge fix, not first pass) | yes — finding IDs: **F-001** |

## What was done (brief)

1. **Server:** Per-connection `lobbyBindGeneration` increments on each successful lobby bind; async profile / bind-ok / bind-error pushes are skipped when a newer bind has superseded them (checked before and after `getFullProfile`).
2. **Client (optional harden):** Track `lastLobbyBindPool` from lobby inventory/auction button binds; ignore mismatched `economy_profile` while in lobby; clear on `join_accepted` so match profiles always apply. Mutations remain server-authoritative via `lobbyEconomyPool`.
3. **Regression:** Overlapping sandbox→deathmatch bind asserts no sandbox `economy_profile` after the deathmatch profile (sandbox bind stalled via test-only env so the race is deterministic).

## Changed files / areas

- `server/src/index.ts` — bind generation cancel + optional test stall env
- `client/src/main.ts` — last lobby bind pool filter for display profiles
- `scripts/regression-lobby-inventory.ts` — overlapping dual-bind F-001 case + stall env on spawned server
- `docs/tasks/epic-45-programmer-handoff-f001.md` — this handoff

## How to verify (steps for Trusya)

1. On branch `feature/epic-45-dual-lobby-inventory-auction`, run `npm run regression:lobby-inventory` — must print `regression:lobby-inventory OK` (includes overlapping dual-bind assertion).
2. Light lobby smoke (optional Playwright): open Deathmatch Inventory, then quickly Bots Inventory (or reverse), confirm overlay pool badge matches the **last** button clicked and discard only affects that pool.
3. Confirm out-of-scope notes N-001..N-005 were **not** changed.

## Build and run

- Build command: `npm run typecheck` && `npm run build`
- Run command: `npm run regression:lobby-inventory` (Redis required, same as prior EPIC 42/45 lobby regression)
- Expected smoke result: typecheck clean; client+server build OK; regression ends with `regression:lobby-inventory OK`

## Configuration

- New environment variables: **yes (test-only, not for production)**
  - `CUBEWARS_TEST_LOBBY_BIND_STALL_MS` — delay (ms) inside lobby bind async before profile fetch (default unset / 0 = no stall)
  - `CUBEWARS_TEST_LOBBY_BIND_STALL_POOL` — optional pool name (`sandbox` / `deathmatch`); when set, only that pool is stalled
  - Set by `scripts/regression-lobby-inventory.ts` for the F-001 race; **not** documented for players / not in `config.vars.example`
- Secrets in the repository: **no**

## Logs / observability

- Where to look at logs: server stdout for lobby bind
- Key success messages:
  - `[lobby/<pool>] nickname bound for inventory: …`
  - `[lobby/<pool>] skipping stale bind profile (gen N < M)` / `… after fetch …` when a superseded bind is cancelled

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: `lobbyEconomyPool` still set synchronously on bind and remains the sole mutation scope; client pool is never trusted for inventory mutations.
- What the client is allowed to predict/render only: optional ignore of mismatched lobby `economy_profile` for HUD/overlay display until join clears the filter.

## Risks / known limitations

- Test stall env is process-wide for the regression server (sandbox binds take ~200ms extra); production leaves env unset.
- N-001..N-005 intentionally untouched.

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
