# EPIC 6: Weapons & Ammo

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

## 1. EPIC

| Field | Description |
|-------|-------------|
| **Name** | Weapons & Ammo |
| **System goal** | Replace the single fixed pistol with a weapon-tier system: pistol (default, infinite ammo) plus rifle and grenade launcher that spawn on the map, can be picked up, carry limited ammo that runs out, and are switched between with `E`. The currently-equipped weapon must be visible to the player. |
| **Business/gameplay problem** | Combat currently has one weapon with no progression or resource management — user explicitly asked for weapon tiers with different damage, pickup-based acquisition, and ammo scarcity for everything except the pistol. |
| **Architectural role** | shared (weapon/ammo/pickup data + protocol) + server (authoritative pickup state, ammo tracking, damage-per-weapon) + client (weapon pickup rendering, HUD weapon indicator, ammo display, `E` switch input) |
| **Main components** | `shared/`, `server/`, `client/` |
| **Stack** | Fixed project stack, no deviation — hitscan/AABB only, no physics engine (grenade launcher is a high-damage hitscan weapon, not a projectile with splash — deliberate simplification, documented in Risks) |
| **Interaction with other components** | Builds on EPIC 4's hitscan (`server/src/combat.ts`) and EPIC 3's arena geometry (pickup spawn points must be inside the arena, clear of walls, reusing the same collision-safety discipline as `SPAWN_POINTS`). EPIC 7 (health/armor pickups) reuses this EPIC's generic pickup-spawn infrastructure — build it generically, not pistol/rifle-specific. |

## 2. Weapon balance (fixed by Team Lead — do not rebalance without asking)

| Weapon | Tier | Damage/hit | Fire cooldown | Ammo per pickup | Max ammo carried | Starts with |
|---|---|---|---|---|---|---|
| Pistol | 0 | 25 (4 hits to kill) | 300ms (unchanged from EPIC 4) | — | ∞ (never runs out) | Owned from spawn, always |
| Rifle | 1 | 50 (2 hits to kill) | 250ms | +12 | 48 | Not owned until picked up |
| Grenade launcher | 2 | 100 (1 hit to kill) | 1500ms | +2 | 6 | Not owned until picked up |

- **A weapon pickup and an ammo pickup for the same weapon apply the identical effect**: unlock the weapon if not owned (rifle/GL only — pistol is never a pickup), then add that weapon's `ammoPerPickup` to current ammo, capped at `maxAmmo`. This is one mechanic, not two — do not special-case "starting ammo" separately from "ammo pickup" amounts.
- **Pickup consumption rule (applies to all pickup types in this EPIC and EPIC 7)**: a pickup is only consumed if it actually benefits the player — e.g. an ammo/weapon pickup does nothing and is **not** removed if the player already owns that weapon at max ammo. This avoids wasting a spawn on a player who can't use it; it stays for someone else (or for the same player later).
- **Auto-equip rule**: picking up a weapon you didn't previously own auto-switches your equipped weapon to it **only if its tier is higher than your currently-equipped weapon's tier** ("always have the best" per the user's request). Picking up ammo for an already-owned weapon does not change your equipped weapon.
- **`E` cycles** forward through **owned** weapons in tier order (pistol → rifle → grenade launcher → pistol → …), skipping tiers you don't own. Always at least the pistol is available.
- **Dry weapon**: firing a weapon with 0 ammo does nothing server-side (no damage, no ammo further decremented) — HUD should indicate "empty" so the player knows to switch or find ammo. Does not auto-switch for you.
- **Visual/color identity** (so weapon and its matching ammo pickup are recognizable at a glance in the 3D world and in the HUD): pistol = grey, rifle = orange, grenade launcher = red/purple. Ammo pickups use the same color family as their weapon, in a visually distinct shape from the weapon pickup itself (e.g. weapon = a larger silhouette mesh, ammo = a small crate/box in the weapon's color) so a player can tell "weapon vs. ammo for that weapon" apart at a glance, per the user's explicit ask.

## 3. Story 6.1 — Generic pickup-spawn system (shared infrastructure for this EPIC and EPIC 7)

**As a** developer **I want** one reusable pickup-spawn system (spawn points, occupancy, respawn timers scaled by player count) **so that** EPIC 7's health/armor pickups plug into the same mechanism instead of a second implementation.

- **Outputs:** a small number of fixed pickup spawn points placed across the arena (both sites + mid + tunnel — reuse the same "inside the arena, clear of walls" placement discipline as `SPAWN_POINTS` in `shared/src/mapData.ts`), each holding at most one item at a time; on pickup, the point goes empty and respawns (possibly a **different** item type/weapon, Programmer's call on whether spawn points are typed-per-category or fully generic — simplest is fine) after a delay.
- **Respawn delay formula** (scaled by currently connected+alive player count in that match — for now there is only one match, EPIC 9 will generalize this): `delayMs = clamp(baseDelayMs / playerCount, minDelayMs, baseDelayMs)`. Use these bases for this EPIC's categories:
  - Weapon pickups: base 25000ms, min 10000ms
  - Ammo pickups: base 18000ms, min 7000ms
- **Design note for EPIC 9 compatibility**: do **not** implement the pickup spawner as a module-level singleton tied to one global player list. Encapsulate it as something instantiable (e.g. a class/factory taking the player-count source as a parameter) — EPIC 9 will need one instance per match. This is guidance, not a requirement to over-engineer now; a small refactor later is fine if the current shape is reasonably clean.
- **Acceptance criteria:**
  - [ ] At least 2-3 weapon spawn points and 2-3 ammo spawn points exist, spread across the arena (not clustered in one spot), none inside a wall/crate
  - [ ] A picked-up point goes empty immediately and respawns after the formula above

## 4. Story 6.2 — Pickup, own, and switch weapons

**As a** player **I want** to walk over a weapon to pick it up, see what I currently have, and press `E` to switch **so that** I have real weapon choice and progression.

- **Outputs:** server-authoritative pickup-on-proximity (walking within some small radius of a spawned item, server-checked against server-tracked position — same trust discipline as everything else, client never asserts "I picked this up"); `E` key cycles equipped weapon; client HUD shows the currently equipped weapon's name/color and current ammo (or "∞" for pistol).
- **Acceptance criteria:**
  - [ ] Walking near a weapon pickup picks it up (server-confirmed), the pickup disappears for all clients, and if it was a higher tier than currently equipped, auto-equips
  - [ ] `E` switches between owned weapons in tier order; pressing it with only the pistol owned does nothing (only one weapon to cycle to)
  - [ ] HUD always shows which weapon is equipped and its ammo count

## 5. Story 6.3 — Ammo depletes, damage is weapon-specific

**As a** player **I want** each weapon to deal its own damage and run out of ammo (except the pistol) **so that** weapon choice has real stakes.

- **Outputs:** `server/src/combat.ts`'s hitscan resolution uses the shooter's **currently equipped weapon's** damage value, not a hardcoded constant; firing decrements ammo for non-pistol weapons; ammo pickups replenish per the table above.
- **Acceptance criteria:**
  - [ ] A rifle hit deals exactly 50 damage, grenade launcher exactly 100, pistol exactly 25 (unchanged from EPIC 4)
  - [ ] Firing the rifle/grenade launcher decrements ammo by 1 per confirmed accepted shot; firing the pistol never decrements anything
  - [ ] At 0 ammo, firing that weapon does not deal damage and does not go negative

## 6. Tasks

| # | Task | Expected result | Place in code | Completion criterion |
|---|------|------------------|----------------|----------------------|
| 1 | `shared/`: weapon/ammo/pickup protocol types + balance table | `WeaponType`, `WeaponStats`, pickup message types | `shared/src/` | typechecks, imported both sides |
| 2 | Server: generic pickup spawner | spawn points, occupancy, respawn timing per formula | `server/src/` | picked-up point empties and respawns correctly |
| 3 | Server: weapon ownership + equip state per player | owned weapons, equipped weapon, ammo counts in `PlayerRecord` | `server/src/playerRegistry.ts` | reflected in broadcast state |
| 4 | Server: pickup-on-proximity + consume-if-useful rule | server checks distance, applies weapon/ammo effect, skips consuming if not useful | `server/src/` | verified via scripted test |
| 5 | Server: `E` switch handling + weapon-specific hitscan damage/ammo | cycles equipped weapon; `fire()` uses equipped weapon's damage/cooldown/ammo | `server/src/index.ts`, `server/src/combat.ts`, `server/src/playerRegistry.ts` | exact damage per weapon verified |
| 6 | Client: render weapon/ammo pickups in the world | color-coded meshes per Section 2 | `client/src/main.ts` | visually distinguishable in screenshots |
| 7 | Client: `E` input, weapon+ammo HUD indicator | key handling, HUD element | `client/src/` | visible in every screenshot during play |

## 7. Acceptance Criteria (EPIC-level, Definition of Done)

- [ ] Pistol/rifle/grenade launcher deal exactly 25/50/100 damage per hit
- [ ] Rifle and grenade launcher have finite, depletable ammo; pistol never runs out
- [ ] Weapon and ammo pickups are server-authoritative (client cannot assert a pickup or a damage value)
- [ ] Weapons/ammo are visually distinct by color/shape in the world and in the HUD
- [ ] `E` cycles owned weapons; newly picked-up higher-tier weapon auto-equips
- [ ] Pickups only consume when useful (not already owned+maxed)
- [ ] No TypeScript build errors; `npm run build` / `npm run typecheck` pass
- [ ] Tester's Gameplay & feel section includes screenshots of: a weapon pickup in the world, the HUD showing a non-pistol weapon equipped with ammo count, an ammo pickup, and a rifle/GL kill with correct damage numbers in server logs

## 8. Risks

- **Grenade launcher is a reskinned high-damage hitscan weapon, not a real explosive/splash projectile** — the fixed stack has no physics engine and this EPIC doesn't introduce one. If the user wants real grenade arcs/splash later, that's a much larger follow-up EPIC, not a silent scope-creep here.
- Balance numbers (damage/cooldown/ammo/respawn) are Team Lead's judgment call per the user's "calculate it yourself" instruction — reasonable, not exhaustively playtested against real humans; expect these to be tunable constants (named, not magic numbers) so they're easy to adjust later without hunting through the code.
- This EPIC changes `server/src/combat.ts`'s damage resolution, which was twice reviewed for security in EPIC 4 — Critic should specifically re-check that ammo/weapon state is still fully server-authoritative and that switching weapons or claiming a weapon in a `fire` message (there should be none — server already knows the shooter's equipped weapon) isn't a new spoofing surface.
- Building the pickup spawner generically (per the Story 6.1 design note) adds a small amount of upfront structure — don't over-engineer it into a plugin framework, a straightforward parameterized module is enough.

---

## Sign-off

- **Specification (author):** Team Lead (Tusya)
- **Approval (Team Lead):** Tusya — approved for assignment
- **Assignee:** Programmer (Pusya)
