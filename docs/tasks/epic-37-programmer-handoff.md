# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-25 |
| Author (Pusya) | Pusya (Programmer) |
| Task / Story / EPIC | EPIC 37 — Competitive Leaderboard Excludes "vs Bots" Kills |
| Branch / commit / PR | `task/epic-37-leaderboard-excludes-bots-mode` / feature `226f8dd` (branch tip after handoff docs) / PR not opened yet (QA first) |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. Gated `onKillRecorded` in `server/src/match.ts` to `mode === "public"` only — bots-mode kills no longer feed the career leaderboard; endless branch unchanged.
2. Added `scripts/regression-leaderboard-excludes-bots.ts` (+ `npm run regression:leaderboard-excludes-bots`) proving bots-mode does not call `onKillRecorded`, public-mode still does, and endless still increments `endlessBotKills` / removes the bot without touching the leaderboard.
3. Skipped optional one-time `"Bot "`-prefixed purge script (task 37.2) — not cheap: `EconomyStore` has no safe public delete/purge API; would require new store surface or raw Redis key surgery beyond this gating fix.

## Changed files / areas

- `server/src/match.ts` — public-only gate on `onKillRecorded`
- `scripts/regression-leaderboard-excludes-bots.ts` — new mode-gating regression
- `package.json` — `regression:leaderboard-excludes-bots` script
- `docs/tasks/epic-37-programmer-handoff.md` — this handoff

## How to verify (steps for Trusya)

1. `npm run typecheck` and `npm run build` — expect PASS.
2. `npm run regression:leaderboard` — expect `[leaderboard] PASS` (existing EPIC 21 behavior unchanged).
3. `npm run regression:leaderboard-excludes-bots` — expect `[leaderboard-excludes-bots] PASS` (bots / public / endless cases).
4. Live (task 37.4): note public leaderboard before a "vs Bots" match, kill a bot, confirm leaderboard unchanged for the human and that no `"Bot N"` row appears; optionally confirm a Quick Join human-vs-human kill still updates the board. Evidence under `qa-artifacts/epic-37/` (git-ignored).

## Build and run

- Build command: `npm run typecheck && npm run build`
- Run command: `npm run regression:leaderboard && npm run regression:leaderboard-excludes-bots` (live smoke: `npm run dev`)
- Expected smoke result: both regressions print PASS; live bots-mode kill does not change career leaderboard

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: existing `[server] [<matchId>] death:` / `hit:` lines on kill; no new log line for the gate (silent fall-through for bots mode is intentional — same pattern as not recording endless to career).
- Key success messages: `[leaderboard-excludes-bots] PASS`, `[leaderboard] PASS`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: career K/D increments remain server-only via `MatchManager.recordKill` → `EconomyStore.incrementCareerKillDeath`; this change only narrows which match modes invoke that path.
- What the client is allowed to predict/render only: kill feed / scoreboard presentation; client never writes career stats.

## Risks / known limitations

- Historical pollution (inflated human K/D from past bots-mode kills, existing `"Bot N"` rows) is **not** retroactively fixed — out of scope per EPIC 37 §4.
- Optional purge script for `"Bot "`-prefixed entries not shipped (no cheap store API); can be a follow-up if Team Lead / user wants it.

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
