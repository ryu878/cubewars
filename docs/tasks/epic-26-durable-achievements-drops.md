# EPIC 26: Drop Table Completion & Durable Achievements

Spec format per `ai-office/task-intake.md`.  
Product TZ: `docs/product/emerald-wasteland-economy-tz-v2.1.md` §4.1 (updated).  
Depends on: EPIC 25 tip `task/epic-25-gems-amulets-shards`.

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Drop Table Completion & Durable Achievements |
| **System goal** | (1) Finish kill-drop overflow behavior (failed item roll → substitute gold). (2) Persist lobby PvP kills/deaths and endless personal bests in SQLite so server restart does not wipe player achievements. |
| **Business/gameplay problem** | User requirement: all meaningful stats/values must survive restart. Leaderboards today are in-memory Maps in `MatchManager` and reset on reboot; economy items already persist. |
| **Architectural role** | shared constants / server economy store + MatchManager load/save / client unchanged except verifying leaderboards reload |
| **Stack** | Existing SQLite (`better-sqlite3`) |
| **Interaction** | Replace in-memory `leaderboard` / `endlessLeaderboard` Maps with DB-backed read/write; keep match-scoped shard grants in memory. |

## 2. Persistence audit (baseline → target)

| Already durable (EPIC 23–25) | Still volatile (fix in this EPIC) |
|------------------------------|-------------------------------------|
| gold, pets, eggs, stimulators, gems, amulets, shards, repair kits | PvP leaderboard kills/deaths |
| hatch deadlines, equip slots, gem sockets, amulet durability | Endless best botKills + distanceKm |

Session-only (leave volatile): match HP/armor/ammo/position, Tab match scoreboard, per-match shard grant set.

## 3. Design

### 3.1 Schema migration

```sql
CREATE TABLE career_stats (
  profile_id INTEGER PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  kills INTEGER NOT NULL DEFAULT 0 CHECK (kills >= 0),
  deaths INTEGER NOT NULL DEFAULT 0 CHECK (deaths >= 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE endless_career_stats (
  profile_id INTEGER PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  best_bot_kills INTEGER NOT NULL DEFAULT 0 CHECK (best_bot_kills >= 0),
  best_distance_km REAL NOT NULL DEFAULT 0 CHECK (best_distance_km >= 0),
  updated_at INTEGER NOT NULL
);
```

Ensure profile exists (`getOrCreateProfile`) before writing stats.

### 3.2 MatchManager behavior

- On server start / EconomyStore open: load all career + endless rows into memory cache **or** query DB on each `list*` (cache + write-through preferred for tick hot path).
- `recordKill(attackerNick, victimNick)`: increment attacker kills + victim deaths **in SQLite transaction** and update cache; broadcast leaderboard as today.
- Endless personal best update: write only if new best (same compare rules as today) **to SQLite** + cache.
- After process restart: lobby and endless leaderboard UIs must show previous totals/bests for returning nicknames.

### 3.3 Drop overflow → gold substitute

When a kill roll succeeds for an item but grant fails due to cap/soft-cap/full inventory rule:

- Do **not** silently skip: grant **additional gold** in `[GOLD_DROP_MIN, GOLD_DROP_MAX]` (second independent roll) and log `drop_substituted_gold`.
- Applies to: egg, stimulator, gem, shard, amulet, repair kit failure-to-grant after a successful chance roll / deterministic shard eligibility.
- Primary gold grant (always) remains unchanged.

Centralize drop resolution in one helper (e.g. `EconomyStore.resolveKillDrops` / `Match.grantKillEconomy`) to avoid duplicated roll logic.

### 3.4 Out of scope

Auction, trade, 8×8 grid UI, OBS, auth accounts.

## 4. Stories

### 24.1 → Story 26.1 Durable PvP career stats
As a player I want my kills/deaths kept after server restart so the lobby leaderboard reflects my career.

### Story 26.2 Durable endless bests
As a player I want my best endless bot kills and distance kept after restart.

### Story 26.3 Overflow gold substitute
As a player I want gold instead of a void when a rolled drop cannot fit my caps.

## 5. Tasks

| # | Task | Place |
|---|------|-------|
| 26.1 | Migration + store APIs: `incrementCareerKillDeath`, `listCareerLeaderboard`, `upsertEndlessBest`, `listEndlessLeaderboard` | `server/src/economy/` |
| 26.2 | Wire MatchManager to durable store; remove pure in-memory Maps (or make them cache only) | `server/src/matchManager.ts`, startup |
| 26.3 | Unified kill-drop resolve + gold substitute on grant failure | `server/src/economy/`, `match.ts` |
| 26.4 | `regression:economy-persistence` — reopen DB; career K/D and endless bests survive; substitute gold path | `scripts/`, `package.json` |
| 26.5 | README + TZ note: what persists vs session-only | `README.md` |

**Branch:** `task/epic-26-durable-achievements-drops`  
**Base:** `task/epic-25-gems-amulets-shards` @ latest (`b4f3918` or tip).

## 6. Acceptance criteria

- [ ] `npm run typecheck` / `build` PASS
- [ ] Prior economy regressions PASS (`economy-gold`, `economy-pets`, `economy-gems-amulets`)
- [ ] `npm run regression:economy-persistence` PASS — write K/D + endless bests, close DB, reopen, values equal; substitute gold when egg grant blocked
- [ ] Killing after restart continues to **add** to prior career totals (not reset)
- [ ] Server restart leaves pets/gold/gems/etc. intact (smoke via existing store tests + persistence script)
- [ ] Match-scoped shard grants still reset per match (not durable)

## 7. Risks

- Nickname spoofing can still claim another key’s career — accepted until auth.
- Write-through SQLite on every kill: acceptable for current scale; keep transactions short.

## 8. Sign-off

- **Author/Approval:** Team Lead (Tusya), 2026-08-24  
- **User ask:** continue + persist all stats so restart does not wipe achievements  
- **Assignee:** Programmer (Pusya)
