# EPIC 18: Pistol Hold Fire, Locational Damage, Grenade Splash

## 1. EPIC

| Field | Value |
|---|---|
| **Name** | Pistol Hold Fire, Locational Damage, Grenade Splash |
| **System goal** | Improve combat feel with held pistol fire, body-part damage multipliers, and grenade splash damage from nearby wall/cover impacts. |
| **Business/gameplay problem** | Semi-auto clicking makes the pistol feel stiff, all body hits currently deal flat damage, and grenade launcher misses near targets feel like complete failures even when the blast lands beside them. |
| **Architectural role** | Client input ergonomics, shared weapon/combat constants, server-authoritative hit resolution and damage application. |
| **Main components** | `client/src/fpsController.ts`, `shared/src/weapons.ts`, `shared/src/combat.ts`, `server/src/combat.ts`, `server/src/playerRegistry.ts`, `server/src/match.ts`, QA/regression scripts. |
| **Stack** | Fixed stack unchanged: Three.js + TypeScript client, Node.js + TypeScript server, shared TypeScript protocol. No new dependency. |
| **Interaction with other components** | The client may send repeated bare `fire` intents while the mouse button is held. The server remains authoritative: it enforces the equipped weapon's cooldown, resolves hit zone/splash, applies armor/health damage, and broadcasts outcomes. |

## 2. Balance

| Mechanic | Formula |
|---|---|
| Pistol cooldown | `500ms` between accepted server fire events |
| Direct head hit | `round(baseDamage * 2.0)` |
| Direct body hit | `round(baseDamage * 1.0)` |
| Direct leg/lower hit | `round(baseDamage * 0.75)` |
| Grenade splash | On grenade-launcher geometry impact only: `round(baseDamage * 0.6 * (1 - distance / 5m))`, clamped to `[1, baseDamage]` for targets inside radius |

The direct-hit numbers keep EPIC 10's `WEAPON_STATS.damage` as the torso/body baseline. Headshots are rewarding but still server-resolved from the existing AABB hitbox. Leg hits reduce damage without adding a separate limb hitbox system. Grenade splash is Quake-like in shape (nearby explosion damage with linear falloff), but intentionally simple and hand-rolled.

## 3. Story 18.1 — Hold-to-fire pistol

**As a** player  
**I want** holding the left mouse button with the pistol equipped to keep firing at a controlled cadence  
**So that** the pistol feels usable without repeated clicking.

### Acceptance criteria

- [x] Holding left mouse while pointer-locked and alive sends repeated `fire` intents.
- [x] Repeated hold fire uses the server's equipped-weapon cooldown; the client does not decide whether a shot was accepted.
- [x] Pistol cooldown is `500ms` server-side.
- [x] Existing click-to-fire responsiveness remains for all weapons.

## 4. Story 18.2 — Locational direct-hit damage

**As a** player  
**I want** head/body/leg hits to deal different damage  
**So that** aim precision matters.

### Acceptance criteria

- [x] Server hitscan classifies direct player hits as `head`, `body`, or `legs` from the server-computed hit point.
- [x] Damage is computed server-side using the multipliers in Section 2.
- [x] Armor absorption order remains unchanged: armor absorbs first, spillover reduces health.
- [x] Hit logs and `HitEvent` include optional hit-zone context for QA/debugging.

## 5. Story 18.3 — Grenade splash on nearby wall/cover misses

**As a** player  
**I want** grenade impacts near a target to deal partial splash damage  
**So that** shooting beside someone, especially near a wall, still has tactical value.

### Acceptance criteria

- [x] If a grenade-launcher shot hits map geometry before any player, the impact point becomes an explosion point.
- [x] Alive opponents inside `5m` of that point can take splash damage with linear falloff.
- [x] Splash damage is server-authoritative and never based on a client-provided explosion point.
- [x] Non-grenade weapons do not deal splash damage.
- [x] Direct grenade player hits use locational direct-hit damage, not splash math.

## 6. Tasks

| # | Task | Expected result | Place in code/service | Completion criterion |
|---|---|---|---|---|
| 1 | Add shared damage-zone/splash constants | One source for multipliers and radius | `shared/src/combat.ts`, `shared/src/weapons.ts` | Typecheck passes |
| 2 | Extend hitscan result | Direct hits report zone; geometry blocks report impact point | `server/src/combat.ts` | Regression can distinguish head/body/legs/geometry |
| 3 | Apply locational and splash damage | Server applies final damage to armor/health | `server/src/playerRegistry.ts`, `server/src/match.ts` | Direct and splash regression passes |
| 4 | Add pistol hold fire | Client repeats `fire` while held; server throttles | `client/src/fpsController.ts` | Hold-fire regression/smoke verifies repeated attempts |
| 5 | Add evidence scripts/docs | Reproducible checks for formulas and hold fire | `scripts/`, README/tasks | Scripts pass |

## 7. Risks

- Head/leg zones are derived from the existing AABB hitbox, not true skeletal hitboxes. This matches the project's hand-rolled raycast/AABB stack and keeps the task scoped.
- Splash currently uses the nearest splash-damaged opponent as the primary `FireOutcome` for existing kill/death plumbing, while still broadcasting every splash hit in the same shot. This avoids protocol churn beyond optional hit context.
- Pistol hold fire may send attempts a little faster than the server accepts; this is acceptable because the existing server cooldown gate remains authoritative and logs/drop-throttles excess attempts.

## Sign-off

- **Specification (author):** Team Lead (Tusya), 2026-08-06
- **Approval (Team Lead):** Team Lead (Tusya), 2026-08-06
- **Assignee:** Programmer (Pusya)
