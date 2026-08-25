# EPIC 24: Pets, Eggs, Incubation & Equip Stats

Spec format per `ai-office/task-intake.md`.  
Product TZ: `docs/product/emerald-wasteland-economy-tz-v2.1.md`.  
Depends on: EPIC 23 (merged tip / branch base `task/epic-23-economy-foundation`).

> **Superseded by EPIC 32:** "gold still from EPIC 23" (Section 4 below, egg-drop bullet) assumed a bot-victim kill still mints gold. As of EPIC 32, a bot-victim kill grants **no** gold (and no items) — only a human-victim kill feeds the economy. See `docs/tasks/epic-32-bot-kill-no-economy-reward.md`.

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Pets, Eggs, Incubation & Equip Stats |
| **System goal** | Durable eggs → hatch into pets → equip one pet → apply profile ratings to match combat (HP / %DR / speed / damage). Growth stimulators shorten incubation. |
| **Business/gameplay problem** | Gold alone is not the Emerald Wasteland fantasy; players need the pet progression loop. |
| **Architectural role** | shared (formulas + protocol) / server (SQLite items + kill egg/stim drops + combat modifiers) / client (minimal pets panel + HUD ratings) |
| **Main components** | `shared/src/economy.ts` (+ pet math), `server/src/economy/*`, kill grant path, `playerRegistry` combat/movement, client pets/egg UI |
| **Stack** | Unchanged + existing SQLite |
| **Interaction** | Extends EPIC 23 profiles; slot-2 pets deferred until amulet EPIC 25 (`slot2Enabled` always false here). |

## 2. Design decisions

### 2.1 Schema (new migration)

- `eggs` — id, profile_id, hatch_deadline_ms, created_at
- `pets` — id, profile_id, type (`dog`|`cat`|`bird`|`lion`), base_value (1–200), equip_slot (`NULL`|`1` — only slot 1 in this EPIC), created_at
- `growth_stimulators` — id, profile_id, created_at  
  (Count toward inventory conceptually; full 8×8 grid packing is EPIC 27 — store as rows; enforce **caps** only.)

No gems/amulets tables here.

### 2.2 Rating formulas (shared, authoritative)

Pet type → primary rating:

| type | rating |
|------|--------|
| dog | armor |
| cat | health |
| bird | speed |
| lion | damage |

For EPIC 24 (no gems): pet contribution = `base_value` on its primary rating only.

Equipped loadout:

- Slot 1: 100% of pet contribution.
- Slot 2: **not available** (`slot2Enabled = false`). Protocol may still send `slot2Enabled` for forward compat.

Aggregate profile ratings (integers):

```text
healthRating  = sum of health contributions from equipped pets
armorRating   = …
speedRating   = …
damageRating  = …
```

Match application (server only):

| Rating | Formula (config constants in shared) |
|--------|--------------------------------------|
| Health | `maxHealth = COMBAT.maxHealth + floor(healthRating * PET_HEALTH_HP_PER_POINT)` |
| Armor | `damageTaken = floor(rawDamage * (1 - min(ARMOR_DR_CAP, armorRating * PET_ARMOR_DR_PER_POINT)))` then EPIC 7 absorptive armor |
| Speed | `speed *= (1 + speedRating * PET_SPEED_PER_POINT)`, still clamp to server max |
| Damage | `weaponDamage *= (1 + damageRating * PET_DAMAGE_PER_POINT)` |

Team Lead fixed starter knobs (tunable in `shared`):

```text
PET_HEALTH_HP_PER_POINT = 0.25        // value 200 → +50 max HP
PET_ARMOR_DR_PER_POINT = 0.0005       // value 200 → 10% DR
ARMOR_DR_CAP = 0.35                   // hard cap 35% DR from pets
PET_SPEED_PER_POINT = 0.0005          // value 200 → +10% speed
PET_DAMAGE_PER_POINT = 0.001          // value 200 → +20% damage
```

Recalculate on equip/unequip/hatch; push `economy_profile` (extended) to owner. Apply to living player immediately where safe (max HP bump should heal-up only the delta if currently at old max; if damaged, keep current HP unless above new max then clamp).

### 2.3 Eggs & stimulators

- **Incubation duration:** `INCUBATION.durationMs` (24h). Override for tests/QA via env `CUBEWARS_INCUBATION_MS` (positive int) read only on server grant — document in `config.vars.example`.
- **Stimulator:** `hatch_deadline = min(hatch_deadline, now + INCUBATION.stimulatorMaxRemainingMs)`; consume one stimulator row; never extends a ready egg.
- **Hatch:** if `now >= hatch_deadline` and pet count &lt; 8: create pet random type + `base_value` uniform 1–200; delete egg. Else error code to client.
- **Egg drop:** on **human** victim kill only, chance `DROP_CHANCE.egg` if killer eggs &lt; 3 and pets &lt; 8; else skip (gold still from EPIC 23).
- **Stimulator drop:** on **human** victim kill only, chance `DROP_CHANCE.growthStimulator` (no count cap beyond practical row storage; soft-cap optional = 20 stimulators — if at soft-cap skip drop). Soft-cap **20** stimulators for anti-bloat.

### 2.4 Protocol (server authoritative)

Client → server (validate ownership, caps, state):

- `economy_equip_pet` `{ petId, slot: 1 }` — unequip others from slot 1 first; reject slot 2.
- `economy_unequip_pet` `{ petId }`
- `economy_hatch_egg` `{ eggId }`
- `economy_apply_stimulator` `{ eggId }`

Server → owner:

- Extend `economy_profile` with: pets[], eggs[], stimulatorCount, ratings, slot2Enabled:false
- Optional events: `economy_item_update` for deltas after kill/hatch (or full profile refresh — full refresh OK for v1)

### 2.5 Client UI (minimal — not EPIC 27 grid)

Plain HTML/CSS/TS panel (lobby and/or pause/in-match toggle):

- List eggs with remaining time / ready state + Hatch + Apply stimulator (if count &gt; 0)
- List pets with type, value, Equip/Unequip
- Show aggregate ratings + gold
- No drag-drop grid required

### 2.6 Out of scope

Gems, amulets, shards, repair, slot 2, auction, trade, 8×8 grid packing, OBS, full drop table (gems/amulets/etc.).

## 3. Stories

### Story 24.1 — Persistence & shared math

Acceptance: migrations; pet/egg/stimulator CRUD; rating helpers unit-tested via regression.

### Story 24.2 — Hatch / stimulator / equip actions

Acceptance: protocol handlers; caps enforced; stimulator math correct; hatch blocked at 8 pets.

### Story 24.3 — Kill drops (egg + stimulator)

Acceptance: human kills only; chances/caps; gold path unchanged.

### Story 24.4 — Combat modifiers

Acceptance: equipped ratings affect max HP, DR, speed, damage on server; client HUD shows ratings.

### Story 24.5 — Minimal pets UI

Acceptance: panel usable to hatch/equip/stim; shows timers from server deadlines.

## 4. Tasks (one branch slice)

| # | Task | Place |
|---|------|-------|
| 24.1 | Shared pet types, rating formulas, protocol messages, incubation env note | `shared/` |
| 24.2 | Migrations + EconomyStore pet/egg/stimulator/equip/hatch/stim APIs | `server/src/economy/` |
| 24.3 | WS handlers + kill egg/stim drops | `server/src/index.ts`, `match.ts` |
| 24.4 | Apply ratings in registry combat/movement/spawn | `server/src/playerRegistry.ts` (+ match wiring) |
| 24.5 | Client panel + HUD ratings | `client/` |
| 24.6 | `scripts/regression-economy-pets.ts` + `npm run regression:economy-pets` | `scripts/`, `package.json` |

**Branch:** `task/epic-24-pets-eggs-equip`  
**Base:** `task/epic-23-economy-foundation` (latest).

## 5. Acceptance criteria (EPIC)

- [ ] `npm run typecheck` / `build` PASS
- [ ] `npm run regression:economy-gold` PASS (no regression)
- [ ] `npm run regression:economy-pets` PASS — covers: grant egg (store or drop helper), stimulator clamp, hatch → pet, equip ratings math, pet cap block, human-only drop helper
- [ ] Server rejects forged equip/hatch for other profiles
- [ ] Slot 2 rejected / disabled
- [ ] Minimal UI shows eggs/pets/ratings from server

## 6. Risks

- Nickname spoofing still applies (known).
- Short `CUBEWARS_INCUBATION_MS` in prod misconfig — document; default remains 24h.
- Combat feel: high lion pets may spike damage — DR/damage caps mitigate; balance EPIC 29.

## 7. Sign-off

- **Specification (author):** Team Lead (Tusya), 2026-08-24
- **Approval (Team Lead):** Team Lead (Tusya), 2026-08-24
- **Assignee:** Programmer (Pusya)
