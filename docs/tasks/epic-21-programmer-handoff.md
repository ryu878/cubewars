# EPIC 21 Programmer Handoff

## Summary

Implemented a server-side in-memory nickname leaderboard and start-screen rendering.

## Changes

- Added shared `LeaderboardEntry`, `LeaderboardMessage`, and `LEADERBOARD_LIMIT`.
- `Match` reports confirmed kills to `MatchManager`.
- `MatchManager` aggregates kills/deaths by normalized nickname, sorts the top 20, and broadcasts updates to active matches.
- Server sends the current leaderboard to lobby clients and newly joined clients.
- `ModeSelect` renders the leaderboard with rank, nickname, kills, and deaths.
- Added `scripts/regression-leaderboard.ts`.

## Self-Check

- `npm run typecheck` — PASS
- `npm run build` — PASS
- `npm run regression:leaderboard` — PASS
