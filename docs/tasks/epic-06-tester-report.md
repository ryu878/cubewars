# Tester report (Trusya) — EPIC 6, Weapons & Ammo

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-07-31 |
| Task / Story / EPIC | EPIC 6 — Weapons & Ammo (`docs/tasks/epic-06-weapons-ammo.md`) |
| Handoff from Pusya (link/commit) | `feature/weapons-ammo` @ `d7533b5` |
| Status | **PASS** |

## Check results

### Build/typecheck

Both clean.

### Smoke / scenarios (independent raw WS + Playwright, not trusting Programmer's numbers)

| Step | Actual |
|------|--------|
| Pistol/rifle/GL hit damage | Exactly 25/50/100, confirmed via HitEvent + server log |
| Pistol rapid-fire (33 attempts/650ms) | Only 2 accepted hits (cooldown-capped), ammo stayed ∞ |
| Rifle rapid-fire (30 attempts/900ms) | Only 4 ammo consumed (cooldown-capped, not message-count-capped) |
| Rifle ammo depletion | Reaches exactly 0, dry fire produces zero further HitEvents, logs `ammo depleted` |
| Auto-equip tier logic | Rifle auto-equips (tier1>0); GL auto-equips over rifle (tier2>1); picking rifle again while GL equipped does NOT downgrade |
| E cycle order | Exact `[pistol, rifle, grenade_launcher, pistol]` from GL start; no-op with only pistol owned |
| Pickup consume-if-useful | Confirmed on all 4 assertions (1st-3rd pickup applies, 4th at max ammo does not consume, point stays active) |
| Server-authority: forged fire payload (weapon/damage/targetId/forceHit) | Ignored — actual damage matched shooter's real equipped weapon (25, pistol), not the forged 99999 |
| Server-authority: forged switch_weapon payload | Ignored — SwitchWeaponEvent structurally carries no target field; behaved as normal cycle |
| Privacy: LoadoutMessage (ammo counts) not leaked | Bystander received exactly 1 loadout message all session (own spawn only), despite target's many pickups/switches |

All required server log lines present and matching spec wording exactly.

### Config, secrets, docs

Clean/up to date. No secrets in diff.

### Server authority

Confirmed structurally (FireEvent/SwitchWeaponEvent carry no weapon/damage/target payload) and behaviorally (forged payloads ignored).

### Gameplay & feel

8 screenshots in `qa-artifacts/epic-06/`: weapon pickups color-coded and distinguishable (rifle orange, GL red/purple, ammo crates same-family small shapes), HUD showing non-pistol weapon+ammo, EMPTY state, E-cycle result, rifle kill witnessed by bystander with correct damage. One documented pre-existing Playwright/CDP mouse-look limitation (not this EPIC's regression, same as prior EPICs) — worked around via WASD-only navigation, real human play unaffected.

## Design flag for Critic/Team Lead (informational, not FAIL)

Weapon/ammo ownership persists across death/respawn (only health/position reset) — reasonable, documented, but not explicitly mandated by spec either way. Worth Team Lead confirming intent before merge.

## Outcome

**PASS** — ready for Critic review.
