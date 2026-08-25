# EPIC 23: Economy Persistence Foundation

Spec format per `ai-office/task-intake.md`.  
Product TZ: `docs/product/emerald-wasteland-economy-tz-v2.1.md`.

> **Superseded by EPIC 32:** the "(or bot, gold-only)" framing below (Section 1 Interaction row, and any "human kills, including bot victims, mint gold" language elsewhere in this doc) is historical. As of EPIC 32, a bot-victim kill grants **no** gold (and no items) — only a human-victim kill feeds the economy. See `docs/tasks/epic-32-bot-kill-no-economy-reward.md`.

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Economy Persistence Foundation |
| **System goal** | Introduce authoritative, durable player economy profiles (gold + empty inventory scaffold) and grant gold on eligible kills, without yet shipping pets/UI/auction. |
| **Business/gameplay problem** | Emerald Wasteland economy needs persistent gold across matches; today cubewars has no durable player inventory or currency. |
| **Architectural role** | shared (config + protocol) / server (SQLite persistence + kill grant) / client (gold readout only) |
| **Main components** | `shared/src/economy.ts`, `server/src/economy/` (db + store), `server/src/match.ts` (kill hook), `client` HUD gold, regression script |
| **Stack** | Fixed cubewars stack + **SQLite via `better-sqlite3`** (approved in TZ v2.1 §0) |
| **Interaction** | On confirmed human (or bot, gold-only) kill already producing DeathEvent / leaderboard kill, also mint gold into killer profile. Profile keyed by nickname `key`. |

## 2. Design decisions

- **DB file:** env `CUBEWARS_ECONOMY_DB` (document in `config.vars.example`); default `server/data/economy.sqlite`.
- **Identity:** `profiles.nickname_key` UNIQUE from `normalizeNickname().key`; display nickname stored separately.
- **Schema (minimal for EPIC 23):** `profiles` (id, nickname_key, nickname, gold, created_at, updated_at). Later EPICs add item tables; do **not** invent full pet schema here beyond optional forward-compatible empty tables **only if** needed for migrations — prefer profiles + `schema_migrations` only in this EPIC.
- **Gold grant:** on kill resolution path used by leaderboard (`Match` / damage broadcast), call economy service: `addGold(killerNicknameKey, amount)` with `amount = randomInt(GOLD_MIN, GOLD_MAX)` from shared config.
- **Bot policy:** grant gold on bot kills too (gold always); item drops deferred to EPIC 26.
- **Thread safety:** better-sqlite3 sync API; single server process assumption (current architecture).
- **Client:** show gold in lobby/HUD from server `economy_profile` (or extend welcome/join snapshot). Client cannot set gold.

## 3. Stories

### Story 23.1 — Economy config

**As a** developer **I want** all economy numeric knobs in `shared/` **so that** balance changes need no handler edits.

Acceptance:

- [ ] `GOLD_DROP_MIN`, `GOLD_DROP_MAX`, inventory/item caps constants present (caps used later; defined now).
- [ ] Drop chance constants present for later EPICs (eggs, gems, …) even if unused.

### Story 23.2 — SQLite profile store

**As a** server **I want** durable profiles by nickname key **so that** gold survives restarts.

Acceptance:

- [ ] Open/create DB; migrate schema.
- [ ] `getOrCreateProfile(nickname)` / `addGold(key, amount)` / `getGold(key)`.
- [ ] Transactions for gold updates; gold never negative.

### Story 23.3 — Gold on kill

**As a** player **I want** gold when I get a confirmed kill **so that** the first economy loop works.

Acceptance:

- [ ] Human and bot kills grant 1–500 gold to killer profile.
- [ ] Self-kills / fog deaths do not grant gold to victim.
- [ ] Killer notified via protocol (profile snapshot or gold delta event).

### Story 23.4 — Client gold display

**As a** player **I want** to see my gold **so that** kill rewards are visible.

Acceptance:

- [ ] Lobby or in-match HUD shows server-provided gold.
- [ ] Value updates after kills without trusting client math.

## 4. Tasks

| # | Task | Expected result | Place | Completion |
|---|------|-----------------|-------|------------|
| **23.1** | Shared economy config + protocol types for profile/gold | `shared` exports constants + message types | `shared/src/` | typecheck |
| **23.2** | SQLite store + migrations + env | profiles CRUD/gold; `config.vars.example` | `server/src/economy/` | unit/regression open DB |
| **23.3** | Hook kill path to grant gold + push update | gold increases on kill | `server/src/match.ts` (+ manager if needed) | `regression:economy-gold` PASS |
| **23.4** | Client gold readout | display updates | `client/` | typecheck + manual/QA note |

**Branch policy:** one branch per task.  
**First assignment:** Task **23.1** then **23.2** may be combined only if Team Lead explicitly allows a single PR for “foundation slice” — **this intake allows Tasks 23.1–23.3 in one branch** `task/epic-23-economy-foundation` because they are not independently shippable; Task 23.4 may stay in the same PR if small. Critic reviews one PR for the EPIC foundation slice.

## 5. Acceptance criteria (EPIC)

- [ ] `npm run typecheck` PASS
- [ ] `npm run build` PASS
- [ ] `npm run regression:economy-gold` PASS (scripted: create profiles, simulate kill grant range + persistence across reopen)
- [ ] No secrets in repo; DB path configurable
- [ ] Server authoritative for gold

## 6. Out of scope (this EPIC)

Pets, eggs, gems, amulets, inventory grid UI, auction, trade, OBS, pet stat modifiers.

## 7. Risks

- Nickname-key identity is spoofable without auth — accepted until auth EPIC; document in README.
- SQLite file locking if multiple server processes — document single-process requirement.
- Existing branch `task/epic-21-nickname-leaderboard` holds unmerged game features; **branch EPIC 23 from that tip** (or from `master` after merge). Record base in PR.

## 8. Verification commands

```bash
npm run typecheck
npm run build
npm run regression:economy-gold
```

## Sign-off

- **Specification (author):** Team Lead (Tusya), 2026-08-24
- **Approval (Team Lead):** Team Lead (Tusya), 2026-08-24
- **Assignee (foundation slice 23.1–23.4):** Programmer (Pusya)
