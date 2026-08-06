# EPIC 18 Programmer Handoff

## Summary

Implemented pistol hold-to-fire, server-authoritative locational damage, and grenade-launcher splash damage.

## Changes

- `client/src/fpsController.ts` now starts a left-mouse hold timer only when the equipped weapon is the pistol. The first shot remains immediate; repeated shots follow the shared pistol cooldown.
- `shared/src/weapons.ts` changed pistol cooldown to `500ms`.
- `shared/src/combat.ts` added direct-hit damage zones and grenade splash constants.
- `server/src/combat.ts` now returns direct hit zone and geometry impact point for misses blocked by map geometry.
- `server/src/playerRegistry.ts` centralizes damage application, applies head/body/legs multipliers, and applies grenade splash from server-computed geometry impacts.
- `server/src/match.ts` broadcasts each damage event from a shot, including optional hit-zone/debug context.
- Added `scripts/regression-locational-splash-damage.ts` and `scripts/qa-epic18-hold-fire.mjs`.

## Balance

- Pistol: `5` body damage, `500ms` cooldown.
- Direct hits: head `2.0x`, body `1.0x`, legs `0.75x`.
- Grenade splash: radius `5m`, max `60%` base damage at distance `0`, linear falloff.

## Self-Check

- `npm run typecheck` — PASS
- `npm run build` — PASS
- `npm run regression:locational-splash-damage` — PASS
- `npm run qa:epic18-hold-fire` — PASS (`3` accepted held pistol shots over `1.3s`)
- `npm run regression:weapon-autoswitch` — PASS
- `npm run regression:fire-input-drop-rate` — PASS (`0.0%` control and real-architecture drop rate)
