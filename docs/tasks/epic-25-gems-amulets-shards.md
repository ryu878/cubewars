# EPIC 25: Gems, Amulets, Shards & Death Penalties

Spec format per `ai-office/task-intake.md`.  
Product TZ: `docs/product/emerald-wasteland-economy-tz-v2.1.md`.  
Depends on: EPIC 24 (`task/epic-24-pets-eggs-equip`).

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Gems, Amulets, Shards & Death Penalties |
| **System goal** | Complete the persistent power loop: gems socket into pets; amulets unlock pet slot 2 (40% contrib); shards craft amulets; repair kits restore durability; death applies amulet durability loss + 10% active-pet effectiveness penalty. |
| **Business/gameplay problem** | Without gems/amulets, pets are one-dimensional and slot 2 from TZ cannot exist. |
| **Architectural role** | shared / server SQLite + combat ratings / client panel extensions |
| **Stack** | Unchanged + SQLite |
| **Interaction** | Extends EPIC 24 ratings to include gem bonuses; enables `slot2Enabled` when an amulet is equipped. |

## 2. Design decisions

### 2.1 Schema (migration)

- `gems` — id, profile_id, type (`health`|`armor`|`speed`|`damage`), value (5–100), pet_id NULLABLE, created_at
- `amulets` — id, profile_id, durability (0–10), equipped (0/1), created_at  
  At most **one** amulet `equipped=1` per profile.
- `shards` — profile_id PRIMARY, count (0–10) — single stack row per profile
- `repair_kits` — id, profile_id, created_at

Caps: gems 20, amulets 4, shards 10, repair kits soft-cap 20 (same anti-bloat as stimulators).

### 2.2 Gems

- Insert into a pet: one gem per type per pet; gem must be owned and unequipped (`pet_id IS NULL`); pet owned by same profile.
- Remove: sets `pet_id NULL` if gem count would remain ≤20 (always true on remove).
- Pet rating contribution for EPIC 25:

```text
primaryBase = pet.base_value                    // still only primary type from pet species
gemBonus(type) = gem.value if socketed else 0
// Total toward a rating axis:
// - Pet species primary axis gets base_value + gem of that type
// - Other axes get only their gem values (pets don't give off-axis base)
```

Clarify: a **dog** contributes `base_value + armorGem` to **armor** rating, and only gem values to health/speed/damage if those gems are socketed on that dog. Same pattern for other species (primary axis = species + matching gem).

Slot multipliers: slot1 ×1.0, slot2 ×0.4 (if slot2 enabled), applied to the pet’s **full** rating vector after gems.

### 2.3 Amulets & slot 2

- Equip amulet → `slot2Enabled=true`; unequip → force unequip pet in slot 2, `slot2Enabled=false`.
- Only one amulet equipped.
- Durability 1–10 while alive in inventory; 0 deletes amulet.

### 2.4 Death penalties (human players only; on confirmed death)

When a human player dies (any killer including bots/fog):

1. If equipped amulet: durability −1; if 0 destroy amulet and unequip slot2 pet.
2. Apply **10%** effectiveness loss to each **active** (equipped) pet:  
   `base_value = max(1, floor(base_value * 0.9))`  
   Each socketed gem: `value = max(1, floor(value * 0.9))`  
   (TZ: 10% of current effectiveness including gems.)
3. Recalc ratings; push profile.

Do **not** apply death penalties to bots.

### 2.5 Shards & craft

- On killing a **human** who has **any** amulet (equipped or in bag — TZ “has amulet”): if killer amulet count &lt; 4 and killer has not received a shard from this victim in this match → +1 shard (cap 10).
- Track match grants in memory: `Map<killerKey, Set<victimKey>>` on Match (not durable).
- Craft: spend 10 shards → create amulet durability 10; reject if amulets ≥ 4 or shards &lt; 10.

### 2.6 Repair kits

- Use on owned amulet: durability = min(10, durability+1); consume kit.
- Drop chance on human kill: `DROP_CHANCE.repairKit` (10%), soft-cap 20 kits.

### 2.7 Kill drops added this EPIC (human victim only)

| Item | Chance | Conditions |
|------|--------|------------|
| Gem | 20% | killer gems &lt; 20; victim has ≥1 gem on an **equipped** pet — transfer/copy that gem’s type+value as **new** gem for killer (victim keeps theirs — TZ “from active pet” as loot generation, not steal). |
| Shard | 100% if victim has amulet | rules in §2.5 |
| Amulet | 2% if victim has amulet | killer amulets &lt; 4; new amulet with **victim equipped amulet’s durability** if equipped, else a random owned amulet’s durability; victim keeps their amulet (loot copy) unless Team Lead later switches to steal — **v2.1 copy** for fairness in nickname-spoof world. |
| Repair kit | 10% | soft-cap 20 |

**Clarification vs TZ “выпадает амулет”:** implement as **copy** of durability state for MVP (no inventory theft PvP grief). Document in README. Egg/stimulator rules remain EPIC 24.

### 2.8 Protocol

Client→server:

- `economy_socket_gem` `{ gemId, petId }`
- `economy_unsocket_gem` `{ gemId }`
- `economy_equip_amulet` / `economy_unequip_amulet` `{ amuletId }`
- `economy_craft_amulet`
- `economy_repair_amulet` `{ amuletId }`
- `economy_equip_pet` allows `slot: 2` only if `slot2Enabled`

Extend `economy_profile` with gems, amulets, shardCount, repairKitCount, slot2Enabled.

### 2.9 Client

Extend pets panel: gems list + socket UI, amulets + equip/repair/craft, shard count. Show slot 2 when enabled.

### 2.10 Out of scope

Auction, trade, 8×8 grid, OBS, gold substitute on failed item drop (EPIC 26 polish).

## 3. Tasks

| # | Task | Place |
|---|------|-------|
| 25.1 | Shared constants (death penalty 0.9, gem value range) + protocol | `shared/` |
| 25.2 | Migrations + store APIs | `server/src/economy/` |
| 25.3 | WS handlers + death hook + kill drops + match shard memory | `server/` |
| 25.4 | Rating recalc with gems + slot2 ×0.4 | `server/` + shared math |
| 25.5 | Client panel extensions | `client/` |
| 25.6 | `regression:economy-gems-amulets` | `scripts/` |

**Branch:** `task/epic-25-gems-amulets-shards`  
**Base:** `task/epic-24-pets-eggs-equip`

## 4. Acceptance criteria

- [ ] typecheck, build PASS
- [ ] regression:economy-gold, economy-pets, economy-gems-amulets PASS
- [ ] Socket uniqueness per type; slot2 only with amulet; 40% second pet
- [ ] Death: durability−1, 10% pet/gem decay, amulet destroy at 0
- [ ] Shard once per victim per match; craft 10→amulet
- [ ] Server rejects cross-profile actions

## 5. Sign-off

- **Author/Approval:** Team Lead (Tusya), 2026-08-24
- **Assignee:** Programmer (Pusya)
