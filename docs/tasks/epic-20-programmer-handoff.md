# EPIC 20 Programmer Handoff

## Summary

Implemented lobby listing, 4-player public match capacity, join accepted/rejected flow, and per-match nickname uniqueness.

## Changes

- Added shared nickname normalization/validation.
- Extended `JoinMessage` with `nickname` and optional `matchId`.
- Added `LobbyStateMessage`, `JoinAcceptedMessage`, and `JoinRejectedMessage`.
- Added `nickname` to `PlayerState` and `PlayerScore`; `KillEvent` now carries attacker/victim nicknames.
- `MatchManager` now creates `public`, `public-2`, etc. and quick-joins the first non-full public match.
- `Match` enforces public human capacity through `canAcceptHuman()` and exposes nickname-key checks.
- Client mode select now has a nickname input, public game list, quick join, per-match join, and join error messages.
- Added `scripts/regression-lobby-nicknames.ts`.

## Self-Check

- `npm run typecheck` — PASS
- `npm run build` — PASS
- `npm run regression:lobby-nicknames` — PASS
