# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 55 — Ammo does not unlock weapons; HUD `current/max`; maxHealth integrity
- Diff / PR reference: branch `feature/epic-55-ammo-not-unlock-hud-maxhp` @ `ec973c4b64abf7d23718243013ebd051170a0b89` (impl `9beaea4d9d6372e82fb6d8e4c4409c533614d165`); `git diff master...HEAD` in worktree (no PR — `gh` auth blocked)
- Tester PASS report reference: `docs/tasks/epic-55-tester-report.md` (tip tested `ec973c4…`)
- Iteration (1 if first pass): 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff master...HEAD` — 13 files; impl commit `9beaea4` |
| Tester PASS report matches this commit | PASS | Tester Meta tip `ec973c4…` = `HEAD`; status **PASS** |
| Every acceptance criterion traceable to a change or explicit note | PASS | Ammo split `playerRegistry.ts` applyPickup; `maxHealth`/`maxArmor` on `PlayerState` + HUD; heal investigation noted (no server bug); About/changelog; regressions 7–9 |
| Scope matches the task (no unexplained extra changes) | PASS | Server/shared/client HUD/docs/scripts only; no unrelated features |
| Gameplay evidence present (player-facing tasks only) | PASS | Opened `qa-artifacts/epic-55/01`–`07` (+ `tester-gameplay-smoke.json`); HUD `245/245` / `0/100` and movement/jump smoke present |

- Gate overall: PASS → continue checklist

## Verdict

- `REVISE`
- One-line rationale: `applyPickup` early-returns when `currentAmmo >= maxAmmo` for **unowned** `"weapon"` pickups (`server/src/playerRegistry.ts` ~926–929), so a full ammo stockpile permanently blocks unlock — reproduced (rifle 48 ammo → weapon `applied:false`, still unowned).

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | FAIL | major | Stockpile-at-max then weapon unlock broken — see F-001; partial stockpile path (case 8) OK; unowned ammo no-unlock OK (case 7); heal above 100 OK (case 9 + `applyPickup` health uses `player.maxHealth` ~909–910) |
| 2 | Server authority for gameplay-relevant state | PASS | | Ownership/ammo/heal in `PlayerRegistry.applyPickup`; HUD reads `self.maxHealth`/`maxArmor` from world_state (`main.ts` ~695–696), not pet-rating math |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | | Three.js/TS + Vite, Node/TS + ws, shared protocol; Playwright evidence only |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | | No secrets; additive public combat fields (spec risk accepted); no new trust of client combat state |
| 5 | Error handling | PASS | | Pickup still returns `applied: false` when useless; no new swallow paths |
| 6 | Logging / observability | N/A | | No new service/logging surface required by EPIC |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | FAIL | major | Case 8 only stockpiles 24/48 (`scripts/regression-weapon-autoswitch.ts` ~246–267); never hits full-cap → unlock; Tester did not exercise max stockpile |
| 8 | Readability / maintainability | PASS | | Clear ammo vs weapon branch comments; JSDoc updated |
| 9 | Scope discipline | PASS | | Diff matches EPIC 55 stories |
| 10 | Config / docs updated | PASS | | `about.html` weapons/pets copy + `LAST_UPDATED=2026-08-27`; `changelog.json` EPIC 55 entry; no new env vars |
| 11 | No dead code / debug scaffolding | PASS | | No leftover debug; QA scripts are intentional evidence harnesses |
| 12 | Regression risk considered | PASS | | EPIC 13 cases 1–6 retained; owned ammo auto-equip path kept in ammo branch when `alreadyOwned` |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | PASS | | `tester-gameplay-smoke.json`: `moved=true` (z 22.70→16.65), `jumped=true` (y 0.615); fire path smoke noted; `05`–`07` screenshots |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS | | `01`, `06`, `07`: Base map, brick volumes, readable HUD — not a bare default scene |
| 15 | Controls & feel usable | PASS | | Pointer lock + look/fire smoke; HUD readable (`02`/`03` closeups) |
| 16 | Playability sanity (honest fun/usability call) | PASS | | HUD current/max and ammo-ownership rules are player-usable; F-001 is a correctness edge case, not “unplayable tech demo” |

## Findings (actionable)

### F-001

- Checklist # / Gate: 1 (Correctness), 7 (QA coverage)
- Severity: major
- Issue: After EPIC 55 stockpile, an unowned weapon can reach `ammo[weapon] === maxAmmo` via ammo crates alone. `applyPickup` then treats **any** full stockpile as useless (`if (currentAmmo >= stats.maxAmmo) return { applied: false }` in `server/src/playerRegistry.ts` ~926–929) **before** the `"weapon"` unlock path. Critic reproduction: 4× rifle ammo → stockpile 48, unowned; `"weapon"` rifle → `applied: false`, still unowned, still on pistol. This violates AC “weapon pickup after ammo stockpile: owns weapon” whenever the stockpile is already at cap (GL reaches max after fewer crates: maxAmmo 6 / ammoPerPickup 2). Pre-fix behavior only early-returned when `alreadyOwned && currentAmmo >= maxAmmo`, so unowned weapon pickups still unlocked.
- Required fix (file/behavior): In `server/src/playerRegistry.ts` `applyPickup`, do **not** refuse an unowned `"weapon"` pickup solely because ammo is already at `maxAmmo`. Unlock ownership (ammo may stay at cap); keep auto-equip if higher tier + usable. Keep early-reject for `"ammo"` at full stockpile and for **owned** `"weapon"` at full ammo (nothing useful). Add a regression case: fill unowned rifle (or GL) to `maxAmmo` via ammo only, then apply `"weapon"` → must own + equip as appropriate.
- Suggested check to prove closed: New regression exits 0 with explicit full-stockpile→weapon case; manual/whitebox: unowned at maxAmmo + weapon pickup → `ownedWeapons.has(weapon) === true` and `applied: true`.

## Revision task (if REVISE)

- Finding IDs to fix: **F-001**
- Out of scope for this revision: Redesigning pet-rating overlay vs combat HUD copy; refreshing About embedded `combat.png` (text already updated); opening the GitHub PR (`gh` auth); any pet formula / armor-max changes
- Re-verify required: yes (Tester re-runs scoped check + light regression)

## Notes (non-blocking)

- Heal-above-100: agree with Programmer — server already caps heals at `player.maxHealth` (~909–910); no mid-life reset to 100 found on damage/heal paths; HUD opacity was the plausible player confusion. Case 9 evidence is sound.
- Top-right ratings strip (`HP 145` in `01-hud-current-max-in-match.png`) vs combat HUD `245/245` is pre-existing pet-flat-bonus UI; Tester correctly marked non-AC. Combat HUD is server `maxHealth`.
- About figure in `04-about-weapons-ammo-hud.png` still embeds an older in-match shot without bottom combat `N/M` HUD; body copy for EPIC 55 is correct. Optional follow-up to refresh About assets, not blocking this REVISE.
- PR still missing due to `gh` auth — Team Lead/human must open from compare URL before merge; does not change code verdict.
