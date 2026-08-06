# EPIC 19 Programmer Handoff

## Summary

Implemented visible in-world shots, hit particles, and a server-authoritative grenade projectile.

## Changes

- Added shared projectile visual speeds and `ShotTrace`.
- Extended `FireBroadcastEvent` with optional server-computed `trace` and `projectileId`.
- Added `ProjectileImpactEvent`.
- Pistol/rifle still resolve immediate server hitscan damage, but now broadcast a visual trace.
- Grenade launcher now spawns an active projectile in `Match`, moves at `26` world units/sec, collides against map AABBs and alive player hitboxes, and applies direct or splash damage at impact.
- Added `client/src/combatEffects.ts` for cyan pistol laser, white rifle bullet/trail, purple grenade orb/trail, explosion pulse, and red hit particles.
- Added `scripts/regression-grenade-projectile.ts` and `scripts/qa-epic19-combat-effects.mjs`.

## Self-Check

- `npm run typecheck` — PASS
- `npm run build` — PASS
- `npm run regression:locational-splash-damage` — PASS
- `npm run regression:grenade-projectile` — PASS
- `npm run qa:epic18-hold-fire` — PASS
- `npm run qa:epic19-combat-effects` — PASS
