# EPIC 7: Health & Armor Pickups

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

## 1. EPIC

| Field | Description |
|-------|-------------|
| **Name** | Health & Armor Pickups |
| **System goal** | Add health pickups (heal 25%, consumed on use) and an armor system (0-100%, +25% per pickup, absorbs damage before health) on top of EPIC 6's generic pickup-spawn infrastructure. |
| **Business/gameplay problem** | Combat currently has no resource recovery beyond respawning fully healed — user asked for in-match healing and a damage-mitigation layer (armor) that must be earned by picking it up, not granted by default. |
| **Architectural role** | shared (health/armor pickup + damage-absorption protocol) + server (authoritative health/armor state, damage-absorption order) + client (pickup rendering, HUD armor readout) |
| **Main components** | `shared/`, `server/`, `client/` |
| **Stack** | Fixed project stack, no deviation |
| **Interaction with other components** | Reuses EPIC 6's generic pickup-spawn system (Story 6.1) — do **not** build a second spawn/respawn mechanism. Changes `server/src/playerRegistry.ts`'s damage-application path (armor absorbs first, then health), which EPIC 4/6 already made server-authoritative — preserve that discipline. |

## 2. Balance (fixed by Team Lead)

| Pickup | Effect | Cap | Notes |
|---|---|---|---|
| Health pack | +25 HP | 100 (cannot overheal) | Consumed only if player is below 100 HP (pickup-consumption rule from EPIC 6 §2 applies) |
| Armor pickup | +25 armor | 100 (4 pickups for full armor) | Consumed only if armor is below 100 |

- **Damage-absorption order**: on a confirmed hit, damage is applied to armor first. If armor fully absorbs the hit (armor ≥ damage), armor -= damage, health unchanged. If damage exceeds current armor, the excess spills into health: `spillover = damage - armor; armor = 0; health -= spillover`. If armor is already 0, all damage goes to health directly (unchanged from EPIC 4/6 behavior).
- **Death** occurs at health ≤ 0, exactly as established — armor does not grant extra lives, only reduces the health cost of a hit.
- **Armor does not persist across death** — on respawn, armor resets to 0 (matches "armor should not be present by default," it must be re-earned each life), health resets to 100 as already established.
- Respawn delay formula for these pickup categories (reusing EPIC 6 Story 6.1's formula, `delayMs = clamp(baseDelayMs / playerCount, minDelayMs, baseDelayMs)`):
  - Health pickups: base 20000ms, min 8000ms
  - Armor pickups: base 35000ms, min 15000ms (rarer/stronger than health, per the user's framing of armor as a bigger commitment — 4 needed for full effect)

## 3. Story 7.1 — Health pickups

**As a** player **I want** to find and use health packs **so that** I can recover mid-fight without waiting for a full respawn.

- **Outputs:** health pickup spawn points (reusing Story 6.1's spawner, new item category), server-side heal-on-proximity consistent with the weapon pickup discipline (server-authoritative, consume-if-useful).
- **Acceptance criteria:**
  - [ ] Walking over a health pickup below 100 HP heals exactly 25 (capped at 100) and consumes it
  - [ ] Walking over one at 100 HP does not consume it

## 4. Story 7.2 — Armor pickups and damage absorption

**As a** player **I want** to build up armor and have it soak damage before my health **so that** surviving fights rewards map control (picking up armor), not just aim.

- **Outputs:** armor pickup spawn points (same spawner, new item category); `PlayerRecord` gains an `armor` field; hit resolution in `server/src/playerRegistry.ts` applies the absorption-order math from Section 2; armor resets to 0 on respawn.
- **Acceptance criteria:**
  - [ ] 4 armor pickups bring a player from 0 to 100 armor (25 each, capped)
  - [ ] A hit with armor ≥ damage reduces only armor, health unchanged
  - [ ] A hit with armor < damage reduces armor to 0 and spills the remainder into health (verify the exact spillover math with a specific example, e.g. 10 armor + a 25-damage pistol hit → armor 0, health -15)
  - [ ] Armor is 0 immediately after respawn regardless of pre-death armor level

## 5. Tasks

| # | Task | Expected result | Place in code | Completion criterion |
|---|------|------------------|----------------|----------------------|
| 1 | `shared/`: health/armor pickup types | typed pickup categories extending EPIC 6's pickup protocol | `shared/src/` | typechecks |
| 2 | Server: health/armor pickup categories on the Story 6.1 spawner | new spawn points, respawn timing per Section 2 | `server/src/` | spawns/respawns correctly, doesn't duplicate the spawner |
| 3 | Server: armor field + damage-absorption order | `PlayerRecord.armor`, updated hit-resolution math | `server/src/playerRegistry.ts` | exact spillover math verified |
| 4 | Server: armor resets on respawn | respawn logic zeroes armor | `server/src/playerRegistry.ts` | verified via scripted test |
| 5 | Client: render health/armor pickups, HUD armor readout | color-coded meshes (suggest: health = white/red cross tone, armor = blue/steel tone — visually distinct from all weapon/ammo colors from EPIC 6) | `client/src/` | visible in screenshots, HUD shows armor value alongside health |

## 6. Acceptance Criteria (EPIC-level, Definition of Done)

- [ ] Health pickups heal 25, capped at 100, consumed only if useful
- [ ] Armor pickups add 25, capped at 100, consumed only if useful
- [ ] Damage absorption order (armor first, spillover to health) is exactly correct, server-authoritative
- [ ] Armor resets to 0 on respawn
- [ ] Pickups reuse EPIC 6's spawner, not a duplicate system
- [ ] No TypeScript build errors; `npm run build` / `npm run typecheck` pass
- [ ] Tester's Gameplay & feel section includes screenshots of a health pickup, an armor pickup, the HUD showing non-zero armor, and a hit that demonstrates the armor-absorbs-first math with server-log evidence

## 7. Risks

- Armor/health math touches the same hit-resolution path Critic has now reviewed twice (EPIC 4 combat, EPIC 6 weapon damage) — expect continued scrutiny on whether the spillover math is exactly right and whether it's still fully server-computed.
- Depends on EPIC 6 being merged first (needs its pickup-spawner infrastructure).

---

## Sign-off

- **Specification (author):** Team Lead (Tusya)
- **Approval (Team Lead):** Tusya — approved for assignment
- **Assignee:** Programmer (Pusya)
