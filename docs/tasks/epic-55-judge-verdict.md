# Judge packet / verdict (Jasya) → Team Lead

## Meta

- Task ID: EPIC 55 / F-001
- Iteration: 1
- Judge: Jasya
- Critic review ref: `docs/tasks/epic-55-critic-review.md`
- Packet: `docs/tasks/epic-55-judge-packet-f001.md`
- HEAD judged: `c1e7b837995689a80e45e121572fc5279ec62eef`
- Fix commit: `4784ef1535b780457299af80f459b32e1b99544b`

## Allowed inputs only

### Original finding(s) (copy)

- ID: F-001
- Severity: major
- Text: After EPIC 55 stockpile, an unowned weapon can reach `ammo[weapon] === maxAmmo` via ammo crates alone. `applyPickup` then treated any full stockpile as useless (`if (currentAmmo >= stats.maxAmmo) return { applied: false }`) **before** the `"weapon"` unlock path, permanently blocking ownership. Required: do not refuse unowned `"weapon"` solely because ammo is at `maxAmmo`; keep reject for full `"ammo"` and owned full `"weapon"`; add regression for full stockpile → weapon unlock.

### Changes

- Files / description:
  - `server/src/playerRegistry.ts` — split max-ammo gate: `"ammo"` still rejects at cap; `"weapon"` rejects only when `alreadyOwned && atMaxAmmo`; unowned at cap unlocks with ammo unchanged.
  - `scripts/regression-weapon-autoswitch.ts` — case 10: fill unowned rifle to max via ammo, then weapon pickup must own + equip, ammo stays at max; extra ammo and owned refill still rejected.
  - `docs/tasks/epic-55-programmer-handoff.md` — revision F-001 notes.

### Re-test results

- Tester re-verify outcome: **PASS** (`docs/tasks/epic-55-tester-reverify-f001.md`) — case 10 PASS; full `"ammo"` rejected; owned-at-max `"weapon"` rejected; cases 7–9 PASS
- Regression pass outcome: `npm run regression:weapon-autoswitch` OVERALL PASS at tip `c1e7b83` (Tester evidence)

### Diff summary

- Before → after (for the specific finding):
  - Before: single early `currentAmmo >= maxAmmo` → `{ applied: false }` for both categories → unowned full stockpile never unlocked.
  - After: `atMaxAmmo` checked per category; unowned `"weapon"` at cap adds ownership and returns `applied: true` with ammo left at cap.

---

## Per-finding decisions

| Finding ID | Status | Evidence | Residual risk |
|------------|--------|----------|---------------|
| F-001 | CLOSED | Diff `4784ef1` restores unlock path for unowned `"weapon"` at `maxAmmo`; case 10 asserts stockpile 48/48 → `applied=true`, owns rifle, ammo stays 48, equip rifle, rejects extra ammo + owned refill; Tester PASS at `c1e7b83`; tip `playerRegistry.ts` matches claimed gate | None for listed finding; light scope only (cases 7–10), not full EPIC re-QA |

## Overall

- `ALL_CLOSED`
- Open IDs: none
- Iteration count: 1
- Note to TL (factual, no debate): F-001 closed on iteration 1. Team Lead may proceed to final merge approval for EPIC 55 (Critic REVISE loop complete for listed findings). Out-of-scope Critic notes (About asset refresh, pet-rating strip, `gh` PR auth) remain non-blocking and are not Judge findings.
