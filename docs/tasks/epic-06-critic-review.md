# Critic review (Krisya) → Team Lead — EPIC 6

## Meta

- Diff: `git diff f201a41..feature/weapons-ammo` (+1432/-38)
- Tester PASS: `docs/tasks/epic-06-tester-report.md`

## Verdict

**APPROVED** — correctly implements weapon/pickup/ammo mechanics with no new server-trust gaps, preserves EPIC 4's flood-guard/cooldown structure, screenshot evidence confirms the full pickup/HUD/kill loop works end-to-end.

## Checklist

16/16 PASS (one minor non-blocking QA-coverage gap noted: pickup respawn timing wasn't independently timed, only observed as a side effect). Key confirmations:

- **#2 Server authority**: pickup proximity computed server-side from server-tracked positions; no client "I picked this up" message type exists at all; `FireEvent`/`SwitchWeaponEvent` carry zero payload fields.
- **#3 Pickup spawner instantiability**: confirmed genuinely parameterized (not a disguised singleton) per the EPIC 9 compatibility note.
- **#12 Regression**: `server/src/combat.ts` (hitscan resolver, twice EPIC-4-reviewed) is untouched — weapon damage applied one layer up; the `MIN_INPUT_INTERVAL_MS` debounce structure closed by EPIC 4's flood-guard saga is untouched, per-weapon cooldown is a value substitution inside the same existing gate.

## Design decision made (Team Lead, per Critic's note)

Critic flagged (non-blocking) that weapon/ammo ownership persisting across death/respawn undercuts the "ammo scarcity has real stakes" intent the EPIC is building toward, and recommended resetting to pistol-only on death (arena-FFA genre convention). **Team Lead agrees** — routing a small scoped fix before merge rather than deferring, since it's a trivial, well-understood change.

## Notes (non-blocking, carried to backlog if not addressed)

- Pickup respawn timing formula not independently timed by Tester (low risk, formula is simple and was read directly).
- Forged-payload spoofing tests aren't checked into a committed regression script — future EPICs touching this trust boundary would benefit from one.
