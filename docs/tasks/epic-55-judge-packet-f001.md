# Judge packet — EPIC 55 / F-001

**Prepared by:** Team Lead (Tusya)  
**Date:** 2026-08-27  
**Branch:** `feature/epic-55-ammo-not-unlock-hud-maxhp`  
**HEAD:** `c1e7b837995689a80e45e121572fc5279ec62eef`  
**Fix commit:** `4784ef1535b780457299af80f459b32e1b99544b`  
**Iteration:** 1 (after Critic REVISE)  
**Worktree:** `/home/dmitry/Documents/Projects/Python/cubewars/.claude/worktrees/epic-55-ammo-not-unlock-hud-maxhp`

## Original finding(s)

### F-001 (major)

- **Source:** `docs/tasks/epic-55-critic-review.md`
- **Issue:** After EPIC 55 ammo stockpile, unowned weapon can reach `ammo[weapon] === maxAmmo`. `applyPickup` early-returned when `currentAmmo >= maxAmmo` for **unowned** `"weapon"` pickups, permanently blocking unlock (`applied: false`, still unowned).
- **Required fix:** Unowned `"weapon"` at full stockpile must still unlock; ammo may stay at cap. Keep reject for full `"ammo"` and owned full `"weapon"`. Add regression: full stockpile → weapon unlock.

## Changes made (Programmer)

- `server/src/playerRegistry.ts` `applyPickup`: do not refuse unowned `"weapon"` solely because ammo is at `maxAmmo`; unlock ownership; ammo stays at cap.
- `scripts/regression-weapon-autoswitch.ts` case 10: 48/48 unowned rifle ammo → weapon pickup owns rifle, ammo stays 48.
- Handoff updated revision round 1 / F-001.

## Re-test results (Tester)

- **Report:** `docs/tasks/epic-55-tester-reverify-f001.md` — **PASS** for F-001
- Case 10 PASS; full ammo still rejected; owned-at-max weapon still rejected; cases 7–9 still PASS
- SHA tested: `c1e7b837995689a80e45e121572fc5279ec62eef`

## Diff summary (F-001 only)

- Before: any `currentAmmo >= maxAmmo` → `{ applied: false }` before weapon unlock path → full stockpile blocked ownership forever.
- After: unowned `"weapon"` at max ammo still applies unlock; ammo/owned-at-max rejects unchanged.

## Out of scope for Judge

Do not invent new findings. Close F-001 only (CLOSED / STILL_OPEN / PARTIAL / REGRESSION). Overall: ALL_CLOSED | REVISE_AGAIN | ESCALATE_HUMAN.
