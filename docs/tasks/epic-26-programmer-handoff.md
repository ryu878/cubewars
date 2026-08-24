# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-24 |
| Author (Pusya) | Programmer (Pusya) |
| Task / Story / EPIC | EPIC 26 — Drop Table Completion & Durable Achievements (Tasks 26.1–26.5) |
| Branch / commit / PR | `task/epic-26-durable-achievements-drops` @ `134261f`; base `task/epic-25-gems-amulets-shards` @ `b4f3918` — compare https://github.com/ryu878/cubewars/compare/task/epic-25-gems-amulets-shards...task/epic-26-durable-achievements-drops (`gh pr create` may fail if token cannot see repo — use compare URL) |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. Migration `20260824_004_career_endless_stats`: `career_stats` + `endless_career_stats` tables.
2. EconomyStore APIs: `incrementCareerKillDeath`, `listCareerLeaderboard` / `listAllCareerStats`, `upsertEndlessBest`, `listEndlessLeaderboard` / `listAllEndlessCareerStats`; unified `resolveKillDrops` with overflow→gold substitute (`drop_substituted_gold`).
3. MatchManager hydrates leaderboards from SQLite on startup; `recordKill` / `recordEndlessProgress` write-through to DB (Maps are cache only when economy is present).
4. Match kill path uses `resolveKillDrops`; primary + substitute gold sent in one `economy_gold_update`.
5. `npm run regression:economy-persistence`; README + TZ §4.1 document durable vs session-only state.

## Changed files / areas

- `server/src/economy/migrations.ts`, `store.ts`, `index.ts`
- `server/src/matchManager.ts`, `server/src/match.ts`
- `scripts/regression-economy-persistence.ts`, root `package.json`
- `README.md`, `docs/product/emerald-wasteland-economy-tz-v2.1.md`, `docs/tasks/epic-26-durable-achievements-drops.md`
- This handoff: `docs/tasks/epic-26-programmer-handoff.md`

## How to verify (steps for Trusya)

1. `npm run typecheck` && `npm run build`
2. `npm run regression:economy-gold` && `npm run regression:economy-pets` && `npm run regression:economy-gems-amulets` && `npm run regression:economy-persistence`
3. Optional live: set `CUBEWARS_ECONOMY_DB` to a temp sqlite, get kills / endless bests, restart server, confirm lobby leaderboards reload; confirm match HP still resets; confirm log `drop_substituted_gold` when at egg/stim cap with a successful roll.

## Build and run

- Build command: `npm run build`
- Run command: `CUBEWARS_ECONOMY_DB=/tmp/cubewars-epic26/economy.sqlite npm run dev`
- Expected smoke result: regressions print PASS; server logs `[economy] leaderboards hydrated: …` and `[economy] migration applied: 20260824_004_career_endless_stats` on fresh DB.

## Configuration

- New environment variables: no (still `CUBEWARS_ECONOMY_DB`)
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout
- Key success messages: `[economy] leaderboards hydrated: career=N endless=M`; `[economy] drop_substituted_gold kind=… amount=…`; `[economy] gold minted: …`; migration `20260824_004_career_endless_stats`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: career K/D and endless bests written only from server-confirmed kills / endless progress; kill drops and substitute gold minted only on server.
- What the client is allowed to predict/render only: leaderboard / gold / profile display from server messages.

## Risks / known limitations

- Nickname spoofing can still claim another key’s career until auth (accepted in TZ).
- Write-through SQLite on every kill: fine at current scale; keep transactions short.
- Out of scope: auction, trade, 8×8 UI, OBS, auth; match HP/armor/ammo and per-match shard grant sets remain session-only.

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
