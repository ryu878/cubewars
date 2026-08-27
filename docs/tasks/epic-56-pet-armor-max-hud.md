# EPIC 56 — Pet armor max HUD + pet grant integrity + combat HUD typography

| Field | Value |
|-------|-------|
| **EPIC ID** | 56 |
| **Name** | Dog maxArmor `156/156`; HP/SPD/DMG integrity; health/armor font ÷3; ratings strip ×3 |
| **Status** | Assigned |
| **Branch** | `feature/epic-56-pet-armor-max-hud` |
| **Base** | `master` (after EPIC 55 merge `e71b1ae` / tip including review docs) |
| **Specification (author)** | Team Lead (Tusya) |
| **Approval (Team Lead)** | Tusya — 2026-08-27 |
| **Assignee** | Programmer (Pusya) |

---

## 1. EPIC

### System goal

1. **Armor:** Pet flat Armor raises effective `maxArmor` so dog +156 shows **`156/156`** on spawn/respawn (not `100/100`).
2. **Integrity:** Verify HP / speed / damage pet grants apply fully (no silent clamps); top ratings HUD shows readable EPIC 51-style grants.
3. **Typography:** Shrink health/armor value fonts to ~⅓; enlarge top `#ratingsHud` to ~3×; keep usable at 1280×800.

### Business / gameplay problem

- Dog +156 armor is clamped to 100 via `Math.min(COMBAT.maxArmor, …)` and hardcoded `maxArmor: COMBAT.maxArmor` in `toWorldState`.
- User wants the same confidence for HP (cat), speed (bird %), and damage (lion %): combat must use full ratings; top strip must not look cryptic/capped.
- Current combat HUD: health/armor values are huge (`150px`); ratings strip is tiny (`12px`) — invert relative emphasis per user ask.

### Architectural role

- **Game server** — `maxArmor` / armor spawn; confirm speed/damage multipliers unclamped
- **Shared** — docs + `formatRatingGrant` reuse for ratings strip if practical
- **Client HUD** — `combatHud.ts`, `client/index.html` CSS
- **Player-facing docs** — About dog armor + changelog

### Stack (fixed)

Three.js/TS client + Vite; Node.js/TS + `ws` server; `shared/` protocol. No new frameworks.

### Chosen armor design (authoritative)

```
petArmor = armorBonusFromRatings(ratings.armorRating)
maxArmor = Math.max(COMBAT.maxArmor, petArmor)
// spawn/respawn: armor = petArmor (clamped to maxArmor)
```

| Scenario | maxArmor | spawn armor | HUD |
|----------|----------|-------------|-----|
| Dog +156 | 156 | 156 | **156/156** |
| Dog +22 | 100 | 22 | **22/100** |
| No dog | 100 | 0 | **0/100** |

**Rejected:** `100 + pet` (=256); `maxArmor = pet only` when pet &lt; 100 (nerfs pickups).

### HP / speed / damage integrity (verify + fix if broken)

| Axis | Expected combat math | HUD |
|------|----------------------|-----|
| **HP (cat)** | `maxHealth = COMBAT.maxHealth + healthBonus`; spawn/respawn full `health = maxHealth`; pickups heal to `player.maxHealth` (EPIC 55) | Combat badge `245/245`; ratings strip readable `+145 HP` (or similar via `formatRatingGrant`) |
| **Speed (bird)** | `speedMultiplierFromRatings` = `1 + rating/100` applied in movement — **no extra clamp** | Ratings: `+N% Speed` |
| **Damage (lion)** | `damageMultiplierFromRatings` = `1 + rating/100` on shot damage — **no extra clamp** | Ratings: `+N% Damage` |

If any axis is incorrectly clamped, remove the bad clamp and cover with regression. Document “verified OK” in handoff if already correct.

### Ratings strip display

Replace cryptic `HP 145 · ARM 156 · SPD 100 · DMG 50` with inventory-aligned grants, e.g.:

`+145 HP · +156 Armor · +100% Speed · +50% Damage`

Prefer reusing `formatRatingGrant` from `shared/src/economy.ts`. Hide axes at 0 or show zeros consistently — pick one readable approach and document in handoff. Prefer showing only non-zero grants when any pet is equipped; if all zero, hide strip (existing `hidden` behavior OK).

### Typography

| Element | Current | Target |
|---------|---------|--------|
| `#healthHud` / `#armorHud` `.hud-value` | `150px` | **~50px** (÷3) |
| `#ratingsHud` (font shorthand `12px`) | `12px` | **~36px** (×3) |

Also scale labels/padding/container as needed so 1280×800 does not overflow badly (wrap or slightly reduce padding; do not leave clipped text). Labels (HEALTH/ARMOR) may stay similar or shrink slightly for balance — values are the primary ÷3 target.

### Main components

| Component | Change |
|-----------|--------|
| `PlayerRecord` + pet apply / respawn / armor pickup / `toWorldState` | Effective `maxArmor`; remove COMBAT.maxArmor-only clamps on pet armor |
| Speed/damage paths | Audit; fix clamps if any |
| `combatHud.setRatings` | EPIC 51-style grant strings |
| `client/index.html` CSS | Font ÷3 / ×3 |
| Regressions + About/changelog | Armor max; integrity cases; docs |

---

## 2. Stories

### Story 56.1 — Effective maxArmor from pet armor

**As a** player with Dog armor ≥ 100  
**I want** spawn/respawn HUD **`N/N`** with N = pet armor grant  
**So that** dog +156 shows **156/156**, not 100/100.

**AC:**

- [ ] `maxArmor = max(COMBAT.maxArmor, petArmor)`; spawn/respawn armor = petArmor
- [ ] Armor pickups / broadcast use `player.maxArmor`
- [ ] No `Math.min(COMBAT.maxArmor, …)` forcing 100 when petArmor &gt; 100

### Story 56.2 — HP / speed / damage integrity + readable ratings strip

**As a** player with cat/bird/lion (or gems)  
**I want** full pet HP ceiling and full speed/damage % in combat, with a clear top ratings readout  
**So that** grants are not silently capped or cryptic.

**AC:**

- [ ] Cat: spawn/respawn `health/maxHealth` full (e.g. 245/245); medkit still heals to boosted max
- [ ] Bird/lion: multipliers apply as `1 + rating/100` with no wrongful clamp
- [ ] `#ratingsHud` uses readable grant labels (EPIC 51 style)
- [ ] Handoff notes verify-or-fix per axis

### Story 56.3 — Combat HUD typography

**As a** player  
**I want** smaller health/armor numbers and a much larger top ratings strip  
**So that** pet grants are easier to read mid-fight.

**AC:**

- [ ] Health/armor `.hud-value` ≈ ÷3 (150→50)
- [ ] `#ratingsHud` ≈ ×3 (12→36)
- [ ] Usable at 1280×800 (evidence screenshot preferred)
- [ ] About/changelog if player-facing cap/display text changes

---

## 3. Tasks

| # | Task | Place | Completion |
|---|------|-------|------------|
| 1 | `PlayerRecord.maxArmor` + apply/respawn/pickup/`toWorldState` | `server/src/playerRegistry.ts` | 156/156 path works |
| 2 | Grep/fix stale COMBAT.maxArmor clamps on pet armor | server + scripts | No force-100 |
| 3 | Audit HP / speed / damage; fix bad clamps | server | Documented + regressions |
| 4 | Ratings strip via `formatRatingGrant` (or equivalent) | `client/src/combatHud.ts` | Readable grants |
| 5 | CSS ÷3 / ×3 + layout tune | `client/index.html` | 1280×800 OK |
| 6 | Shared JSDoc / PlayerState maxArmor comment | `shared/` | Docs match |
| 7 | Regressions: armor 156/156, 22/100, 0/100; pickup; HP full; speed/dmg multipliers | `scripts/` | Pass |
| 8 | About EN+RU + changelog | `client/public/` | player-facing-docs |
| 9 | Handoff + PR | `docs/tasks/` | No merge/deploy |

---

## 4. Risks

| Risk | Mitigation |
|------|------------|
| Ratings ×3 overflows right edge | Allow wrap / max-width / slightly reduce if needed after screenshot |
| Weak dog 22/100 vs user mental model | Spec documents; keep pickup cap ≥ 100 |
| Stale About “caps at 100” | Update in this PR |

---

## 5. Out of scope

- Changing rating contribution formulas / slot fractions
- Client inventing combat max from local pet lists
- Weapon HUD font changes (unless overlap forces a tiny tweak — prefer leave alone)

---

## 6. Sign-off

- **Specification (author):** Tusya — 2026-08-27
- **Approval (Team Lead):** Tusya — 2026-08-27
- **Assignee:** Programmer (Pusya)
