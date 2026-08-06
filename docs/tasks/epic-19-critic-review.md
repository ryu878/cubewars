# EPIC 19 Critic Review

## Verdict

APPROVED.

## Findings

No blocking findings.

## Review Notes

- Server authority is preserved. Clients still send only `fire`; traces, projectile ids, impacts, hit zones, damage, death, and splash are computed server-side.
- Pistol/rifle hitscan behavior is preserved for gameplay, with client-only visual travel added from server traces.
- Grenade launcher is now genuinely dodgeable because damage is delayed until the server projectile collides during `Match.stepProjectiles()`.
- Damage application still goes through `PlayerRegistry.applyDamage()`, preserving armor-first absorption and kill-count behavior.
- Visual effects are isolated in `client/src/combatEffects.ts` and clean themselves up after short lifetimes.
- QA covers server projectile timing and browser-rendered canvas colors.

## Residual Risk

No new security finding. Balance of grenade speed (`26` units/sec) should be tuned through playtesting if it feels too slow or too easy to dodge.
