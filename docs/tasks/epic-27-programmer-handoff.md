# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-24 |
| Author (Pusya) | Pusya |
| Task / Story / EPIC | EPIC 27 — Redis Economy Store (`docs/tasks/epic-27-redis-economy-store.md`) |
| Branch / commit / PR | `task/epic-27-redis-economy-store` @ `c53c280` |
| Revision round (if this is a Critic/Judge fix, not first pass) | yes — finding IDs: F-001, F-002 |
| Compare URL (gh unavailable) | https://github.com/ryu878/cubewars/compare/task/epic-26-durable-achievements-drops...task/epic-27-redis-economy-store |

## What was done (brief)

1. **F-001:** SQLite→Redis auto-import no longer clobbers existing Redis economy keys (skip-if-exists). Marker `cw:meta:sqlite_imported` is set even when the SQLite file is missing. `CUBEWARS_SQLITE_IMPORT=1` may overwrite only with a loud warn; documented in README / `config.vars.example`.
2. **F-002:** `saveDoc` writes Redis via `MULTI/EXEC` first, checks per-command errors, updates cache only on success; on failure invalidates cache and throws so callers do not treat gold as saved.
3. Added `npm run regression:economy-redis-safety` covering 999→stays 999, missing-SQLite marker, and write-failure throw with Redis unchanged at 100.

## Changed files / areas

- `server/src/economy/importSqlite.ts` — no-clobber auto-import, marker on missing SQLite, force warn
- `server/src/economy/store.ts` — Redis-first `saveDoc` with exec error checks + cache invalidate on failure
- `scripts/regression-economy-redis-safety.ts`, `package.json`
- `README.md`, `config.vars.example`

## How to verify (steps for Trusya)

1. Start Redis with AOF: `docker compose up -d redis` (scripts auto-start Docker Redis if needed).
2. `npm run typecheck` && `npm run build`
3. `npm run regression:economy-gold` ; `npm run regression:economy-pets` ; `npm run regression:economy-gems-amulets` ; `npm run regression:economy-persistence` ; `npm run regression:economy-redis-safety` — all must PASS.
4. Re-verify Critic scenarios: (a) Redis gold 999 + stale SQLite gold 1 auto-import → stays 999; (b) boot with missing SQLite → marker set → later SQLite does not clobber; (c) dead Redis connection → `addGold` throws → reopen shows pre-mutation gold.

## Build and run

- Build command: `npm run typecheck` ; `npm run build`
- Run command: `docker compose up -d redis` then `npm run dev`
- Expected smoke result: `[economy] redis ready: …` then server listening

## Local checks (Pusya, 2026-08-24 revision F-001/F-002)

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run regression:economy-gold` | PASS |
| `npm run regression:economy-pets` | PASS |
| `npm run regression:economy-gems-amulets` | PASS |
| `npm run regression:economy-persistence` | PASS |
| `npm run regression:economy-redis-safety` | PASS (F-001, F-002) |

## Configuration

- New environment variables: no new vars; clarified `CUBEWARS_SQLITE_IMPORT=1` force-overwrite danger in `config.vars.example` / README
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout
- Key success / warn messages: `[economy] sqlite import complete: imported=… skipped_existing=…`, `[economy] CUBEWARS_SQLITE_IMPORT=1: FORCE overwrite — …`, Redis write failures throw to callers (kill paths `.catch` log)

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: economy mutations still only via server `EconomyStore`; Redis write failure now surfaces as throw (no silent cache-ahead gold)
- What the client is allowed to predict/render only: HUD/lobby from server messages only

## Risks / known limitations

- Force import (`CUBEWARS_SQLITE_IMPORT=1`) still destroys overlapping Redis nicknames by design — ops must not leave it set.
- Item-owner key binding remains a separate round-trip after `saveDoc` (Critic note; out of scope for this revision).
- Out of scope: inventory UI, auction, OBS, auth, drop math, multi-process Redis concurrency.

## Status

- [x] Ready for QA (Trusya) — re-verify F-001 / F-002
- [ ] Draft / WIP (do not take into QA)
