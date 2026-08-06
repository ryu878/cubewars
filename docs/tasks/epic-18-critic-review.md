# EPIC 18 Critic Review

## Verdict

APPROVED.

## Findings

No blocking findings.

## Review Notes

- Server authority is preserved: clients still send only bare `fire` intents. Weapon, cooldown, hit zone, splash point, damage, armor spillover, death, and kill count are all resolved on the server.
- Pistol hold-fire is client ergonomics only. It may send repeated attempts, but accepted shots remain bounded by the server's existing per-weapon cooldown gate.
- Splash is limited to grenade-launcher geometry impacts and excludes client-supplied explosion data.
- The multi-damage-event path in `Match.resolveFire()` broadcasts one `HitEvent` per affected target and broadcasts the scoreboard once if any target dies.
- Existing auto-switch behavior remains intact after the `fire()` refactor (`npm run regression:weapon-autoswitch`).
- Existing input/fire flood behavior remains intact after changing pistol cadence (`npm run regression:fire-input-drop-rate`).

## Residual Risk

No new security finding. Balance can be tuned later from shared constants if playtesting says headshots or splash are too strong.
