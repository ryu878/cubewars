# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-24 |
| Author (Pusya) | Pusya |
| Task / Story / EPIC | EPIC 27 — Redis Economy Store (`docs/tasks/epic-27-redis-economy-store.md`) |
| Branch / commit / PR | `task/epic-27-redis-economy-store` @ `625ae90` |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. Replaced runtime SQLite `EconomyStore` with Redis (`ioredis`): one JSON document per nickname (`cw:economy:v1:{key}`), ZSETs for PvP/endless leaderboards, write-through in-process cache, fail-fast PING on open.
2. Optional SQLite→Redis import (`CUBEWARS_SQLITE_IMPORT` / marker `cw:meta:sqlite_imported`); `better-sqlite3` retained for import only.
3. Added `docker-compose.yml` Redis service with AOF; documented `CUBEWARS_REDIS_URL`, AOF warning, and Docker start commands in README / `config.vars.example`.
4. Updated Match / MatchManager / server bootstrap for async store; regressions open isolated Redis key prefixes and prove reopen persistence.

## Changed files / areas

- `server/src/economy/` — `store.ts`, `redis.ts`, `document.ts`, `importSqlite.ts`, `db.ts`, `index.ts`
- `server/src/index.ts`, `match.ts`, `matchManager.ts`
- `scripts/regression-economy-*.ts`, `scripts/economy-test-helpers.ts`
- `docker-compose.yml`, `README.md`, `config.vars.example`
- `docs/product/emerald-wasteland-economy-tz-v2.1.md` (§4.1 Redis), `docs/tasks/epic-27-redis-economy-store.md`

## How to verify (steps for Trusya)

1. Start Redis with AOF: `docker compose up -d redis` (or `docker run -d --name cubewars-redis -p 6379:6379 redis:7 redis-server --appendonly yes`). Host has Docker; `redis-server` package may be absent.
2. `npm run typecheck` && `npm run build`
3. `npm run regression:economy-gold` ; `npm run regression:economy-pets` ; `npm run regression:economy-gems-amulets` ; `npm run regression:economy-persistence` — all must PASS against Redis (scripts auto-start Docker Redis if port 6379 is down).
4. Optional live: with Redis up, `npm run dev` — join bots match, confirm gold/profile; stop **game server** only and restart — progress still present. Confirm server exits with a clear error if Redis is stopped.
5. Optional import: point `CUBEWARS_ECONOMY_DB` at a legacy sqlite, clear Redis / use fresh DB, start once (marker or `CUBEWARS_SQLITE_IMPORT=1`), confirm profiles appear in Redis.

## Build and run

- Build command: `npm run typecheck` ; `npm run build`
- Run command: `docker compose up -d redis` then `npm run dev` (or `CUBEWARS_REDIS_URL=redis://127.0.0.1:6379 npm run dev --workspace=server`)
- Expected smoke result: `[economy] redis ready: …` then `[server] cubewars game server listening on ws://localhost:7777`

## Configuration

- New environment variables: yes → `CUBEWARS_REDIS_URL` (default `redis://127.0.0.1:6379`), `CUBEWARS_SQLITE_IMPORT` (0\|1); `CUBEWARS_ECONOMY_DB` now import-only. See `config.vars.example` / README.
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout
- Key success messages: `[economy] redis ready: …`, `[economy] leaderboards hydrated: …`, `[economy] sqlite import complete: …` (if importing), existing gold/drop logs unchanged

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: all economy mutations (gold, pets, drops, career, endless) still only via server `EconomyStore` / Match paths; Redis is the durable backend, not a client trust surface.
- What the client is allowed to predict/render only: HUD/lobby from server messages only

## Risks / known limitations

- Extra ops dependency: Redis must run beside the game server.
- Misconfigured Redis without AOF → silent wipe on Redis restart (mitigated by compose AOF default + README warnings).
- Kill/death economy paths are async (fire-and-forget with error logs); extremely rapid successive kills could interleave Redis writes (single-process Node still serializes awaits per path).
- Out of scope: inventory UI, auction, OBS, drop math changes.

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
