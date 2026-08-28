# EPIC 51 — Developer Console (IDDQD) + Pet Combat Redesign

**Status:** Approved for implementation (Team Lead) — **final pet mapping**  
**Date:** 2026-08-26  
**Depends on:** EPIC 50 — merge tip `ec42588`+  
**Branch:** `feature/epic-51-dev-console-pet-dr-labels` (dev console already on branch; revise pet combat)

## User intent

1. **Developer console** — **`~`** opens console; **`IDDQD`** unlocks session cheats; **`get_pet`**, **`get_amulet`**, **`god_mode`** — all server-authoritative.
2. **Pet combat redesign** — replace EPIC 24 %DR model with flat stats / % multipliers per species.

---

## Final pet mapping (authoritative)

| Pet | Grant | How it applies |
|-----|--------|----------------|
| **Dog** | **flat Armor points** (guard/protection) | EPIC 7 absorptive armor. Dog +159 → spawn/respawn with **159 ARMOR** on HUD. **NOT %DR.** |
| **Cat** | **flat HP points** (9 lives lore) | 1 rating point = 1 max HP. Cat +9 → max HP = 100+9 = **109**. Gems on cat add HP 1:1. |
| **Bird** | **move speed %** | +100% → **2×** speed. Multiplier = `1 + rating/100`. |
| **Lion** | **weapon damage %** | +50% → **×1.5** damage. Multiplier = `1 + rating/100`. |

**OLD mapping (deprecated):** dog=armor DR%, cat=health (0.25 HP/point), bird/lion old fractional constants.

---

## 1. EPIC

| Field | Description |
|-------|-------------|
| **Name** | Developer console + pet combat redesign (dog armor / cat HP / bird speed / lion damage) |
| **System goal** | Owner can cheat-test; pets grant intuitive flat armor/HP or % speed/damage |
| **Architectural role** | shared formulas authoritative; server applies on spawn/respawn/equip; client display only via shared helpers |
| **Stack** | Three.js/TS client, Node/TS server, shared/ — no new deps |

---

## 2. Architecture

### Story A — Developer console (already on branch — verify intact)

- `~` toggles console in-match
- `IDDQD` → per-connection unlock
- `get_pet`, `get_amulet`, `god_mode` server-gated + logged
- `CUBEWARS_ENABLE_CHEATS`: default allow; `=0` disables

### Story B — Pet combat redesign

```text
PET_TYPE_RATING:
  dog  → armor  (flat absorptive points)
  cat  → health (flat max HP, 1:1)
  bird → speed  (% bonus)
  lion → damage (% bonus)

aggregateEquippedRatings — unchanged aggregation; slot fractions unchanged

Combat application (server playerRegistry + bots):
  healthRating → maxHealth = COMBAT.maxHealth + healthRating  (1:1, remove HEALTH_HP_PER_POINT 0.25)
  armorRating  → baseline armor on spawn/respawn/equip = min(armorRating, COMBAT.maxArmor)
                 REMOVE applyArmorDr from damage path — armor is absorptive only
  speedRating  → multiplier = 1 + speedRating/100
  damageRating → multiplier = 1 + damageRating/100
```

**Spawn / respawn / mid-match equip:**

- On spawn, respawn, and `applyPetRatings`: set max HP from cat (+ gems); set baseline armor from dog (+ gems).
- `applyBaselineLoadout` zeros armor on respawn — **re-apply pet armor bonus after baseline**.
- Pickup armor still stacks up to `COMBAT.maxArmor`; pet baseline is the floor on fresh life.
- Mid-match equip: update max HP and armor per new ratings (clamp health/armor to new caps sensibly).

**Gems:** same axes — gem on dog adds armor points; gem on cat adds HP points; etc.

**Inventory labels (shared helpers):**

- Dog: `+159 Armor`
- Cat: `+9 HP`
- Bird: `+100% Speed`
- Lion: `+50% Damage`
- Gem lines and totals use same formatters — **no DR labels**.

**HUD:**

- `#armorHud` shows dog flat armor on spawn (plus pickup gains)
- `#healthHud` max reflects cat bonus
- `ratingsHud`: update semantics — e.g. `HP 9 · ARM 159 · SPD 100 · DMG 50` or axis-appropriate labels (not "DR")

**Caps / documentation:**

- baseValue hatch range still 1–200 → bird up to +200% = 3× speed, lion up to 3× damage — document, do not silently nerf.
- Cat HP: 100 + 200 = 300 max with max pet — OK per user examples.
- Dog armor: clamp to `COMBAT.maxArmor` (100) if rating exceeds — document in spec/comments.

**Deprecate/remove from combat path:**

- `applyArmorDr`, `armorDrFromRatings`, `ARMOR_DR_*` constants — remove from damage pipeline; may keep dead exports briefly or delete if no callers.

---

## 3. Tasks

| ID | Task |
|----|------|
| 51.1 | Verify dev console intact on branch |
| 51.2 | Update `PET_TYPE_RATING`, `PET_COMBAT` constants, conversion functions in `shared/src/economy.ts` |
| 51.3 | Update `formatRatingGrant` / labels for HP, Armor, % Speed, % Damage |
| 51.4 | Server: `applyPetRatings`, spawn, respawn — flat armor baseline; remove DR from `applyDamage` |
| 51.5 | Bots path (`botAI.ts`, epic31 loadouts) — same formulas |
| 51.6 | Client HUD + inventory labels |
| 51.7 | Regressions: `regression-economy-pets`, `regression-economy-gems-amulets`, `regression-epic31-bot-loadouts`, `regression-dev-console` |

---

## 4. Acceptance Criteria

- [ ] `~` / IDDQD / get_pet / get_amulet / god_mode work server-side (unchanged from Story A)
- [ ] Dog +159 → HUD ARMOR shows 159 on spawn (clamped to maxArmor if needed)
- [ ] Cat +9 → max HP 109; gem +13 on cat → 122 max if totals aggregate that way
- [ ] Bird +100 → 2× move speed
- [ ] Lion +50 → 1.5× weapon damage
- [ ] No %DR in combat or inventory labels
- [ ] Inventory shows `+N Armor`, `+N HP`, `+N% Speed`, `+N% Damage`
- [ ] Build + all regressions pass

---

## 5. Risks

| Risk | Mitigation |
|------|------------|
| Dog armor > maxArmor (100) | Clamp to COMBAT.maxArmor; document |
| Extreme bird/lion % | Document caps from baseValue 1–200 |
| Respawn armor reset | Re-apply pet armor after applyBaselineLoadout |

---

## 6. Deploy

Merge to `master` → `./scripts/deploy-production.sh` → https://cubewars.ru/
