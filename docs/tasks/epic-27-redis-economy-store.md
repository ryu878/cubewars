# EPIC 27: Redis Economy Store

Spec format per `ai-office/task-intake.md`.  
Product TZ: `docs/product/emerald-wasteland-economy-tz-v2.1.md` §4.1 (Redis primary).  
Depends on: EPIC 26 tip `task/epic-26-durable-achievements-drops`.  
**User ask (2026-08-24):** use Redis for fast load; SQL too slow. Keep achievements across restarts via Redis persistence (AOF).

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Redis Economy Store |
| **System goal** | Replace runtime SQLite economy/career storage with Redis for low-latency get/set of profiles and leaderboards, without losing durability across game-server restart (Redis AOF). |
| **Business/gameplay problem** | Hot path (join snapshot, kill grants, leaderboard list) should not depend on disk SQL round-trips; operators still need progress to survive restarts. |
| **Architectural role** | server economy layer + docker/ops docs; shared unchanged except maybe no schema impact |
| **Stack addition (user-approved)** | Redis + Node client **`ioredis`**. Remove **runtime** dependency on `better-sqlite3` after migration path exists. |
| **Interaction** | `EconomyStore` public API stays conceptually the same so Match/MatchManager/WS handlers need minimal call-site changes. |

## 2. Design decisions

### 2.1 Why not Redis-only without AOF

Ephemeral Redis would wipe gold/pets on Redis restart — contradicts durable-achievements requirement. **Ops requirement:** run Redis with `appendonly yes` (compose defaults to AOF). Document clearly: game-server restart ≠ data loss; Redis-without-AOF restart = data loss.

### 2.2 Data model

Prefer **one JSON document per nickname key** for the full economy profile (pets, eggs, gems, …) so read on join is a single `GET`:

- `cw:economy:v1:{nicknameKey}` → JSON `FullEconomyProfile` (+ nested items with stable numeric/string ids)
- `cw:career:v1:{nicknameKey}` → JSON `{ kills, deaths, updatedAt }` (or embed career in economy doc — pick one; embed is fine if leaderboard ZSETs updated alongside)
- ZSET `cw:lb:pvp:v1` — score = kills, member = nicknameKey (deaths from career doc / hash)
- ZSET `cw:lb:endless:v1` — score = bestBotKills (distance tie-break: secondary key or store in member payload hash `cw:endless:v1:{key}`)

Id generation: monotonic per-profile counters inside the document (`nextPetId`, …) or Redis `INCR cw:id:pet`.

Updates: read JSON → mutate in process → `SET` inside `MULTI`/`EXEC` with optional version field for optimistic concurrency; or Lua. Keep Match tick off Redis except kill/economy actions (already the case).

### 2.3 In-process cache (optional but recommended)

Keep a small process cache for `getFullProfile` during a match (invalidate on write) so repeated combat rating reads do not hit Redis every shot. Spec: **write-through** — every mutation updates Redis then cache. Leaderboard lists may be served from Redis ZSET on lobby connect.

### 2.4 Legacy SQLite import

On startup:

1. Connect Redis; ping required (fail fast with clear log if down).
2. If `CUBEWARS_ECONOMY_DB` file exists and env `CUBEWARS_SQLITE_IMPORT=1` (or auto-once marker key `cw:meta:sqlite_imported` missing): open SQLite read-only, copy all profiles/items/career/endless into Redis, set marker, log counts.
3. Runtime path never opens SQLite unless importing.

After EPIC 27: `better-sqlite3` may remain as optional dependency **only** for import, or move import to a one-shot script — prefer keep import in server startup behind flag to not break existing local `server/data/economy.sqlite` users.

### 2.5 Config / compose

- `CUBEWARS_REDIS_URL` (required for economy; default `redis://127.0.0.1:6379`)
- `CUBEWARS_SQLITE_IMPORT=0|1`
- `CUBEWARS_ECONOMY_DB` — legacy path for import only
- Add `docker-compose` redis service with AOF volume, or document `redis-server` flags in README / `config.vars.example`
- QA/regression: use real Redis if available; otherwise spin via `docker run redis:7` in script preamble, or document prerequisite. **Do not** use fake in-memory mock as the only “persistence” proof — reopen client / flush-free restart test against real Redis.

### 2.6 Out of scope

Inventory 8×8 UI, auction, OBS, auth. Do not change drop rates.

## 3. Tasks

| # | Task | Place |
|---|------|-------|
| 27.1 | Add `ioredis`, Redis connection module, config env | `server/` |
| 27.2 | Reimplement `EconomyStore` on Redis (same behaviors as EPIC 23–26) | `server/src/economy/` |
| 27.3 | Optional SQLite→Redis import + remove runtime SQLite open | `server/src/economy/` |
| 27.4 | docker-compose/README/config.vars.example AOF | root / docs |
| 27.5 | Regressions: gold/pets/gems/persistence against Redis; add reconnect/reopen proof | `scripts/`, `package.json` |

**Branch:** `task/epic-27-redis-economy-store`  
**Base:** `task/epic-26-durable-achievements-drops`

## 4. Acceptance criteria

- [ ] Game server starts only with reachable Redis (clear error otherwise)
- [ ] Join/kill/hatch/equip/leaderboard paths work unchanged from player POV
- [ ] `npm run typecheck` / `build` PASS
- [ ] economy-gold / pets / gems-amulets / persistence regressions PASS against Redis
- [ ] Persistence regression: write profile + career, new Redis connection (or server reopen), data still present (AOF or same Redis process)
- [ ] README states: enable AOF; without it Redis restart wipes progress
- [ ] Legacy SQLite import documented and testable when flag set

## 5. Risks

- Extra ops dependency (Redis must run beside the game server).
- Misconfigured Redis without AOF → silent achievement loss — mitigate with compose defaults + loud README.
- At current player counts SQLite was not proven slow; Redis is chosen per product direction for headroom and fast lobby loads.

## 6. Sign-off

- **Author/Approval:** Team Lead (Tusya), 2026-08-24  
- **Stack deviation:** Redis + ioredis — user-requested  
- **Assignee:** Programmer (Pusya)
