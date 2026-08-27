# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-27 |
| Author (Pusya) | Programmer (Pusya) |
| Task / Story / EPIC | EPIC 56 — Pet armor max HUD + pet grant integrity + combat HUD typography |
| Branch / commit / PR | `feature/epic-56-pet-armor-max-hud` / (see HEAD after commit) / PR to `master` |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. **Armor max (Story 56.1):** Added `PlayerRecord.maxArmor`; `maxArmor = max(COMBAT.maxArmor, petArmor)`; spawn/respawn armor = petArmor; armor pickups and `toWorldState` use `player.maxArmor`. Removed force-100 `Math.min(COMBAT.maxArmor, …)` clamps on pet armor.
2. **Integrity (Story 56.2):** Verified cat HP spawn/heal/respawn (already correct from EPIC 55). Verified bird/lion `1 + rating/100` multipliers have no extra clamps (OK). Ratings strip uses `formatRatingGrant` non-zero axes only.
3. **Typography (Story 56.3):** Health/armor `.hud-value` 150→50px; `#ratingsHud` 12→36px with wrap/max-width for 1280×800.
4. **Docs:** About EN+RU dog armor (no absolute cap-at-100); changelog; shared JSDoc for `armorBonusFromRatings` / `PlayerState.maxArmor`.

## Changed files / areas

- `server/src/playerRegistry.ts` — maxArmor field, applyPetRatings, applyPickup armor, processRespawns, toWorldState
- `shared/src/index.ts`, `shared/src/economy.ts` — PlayerState / armorBonus JSDoc
- `client/src/combatHud.ts` — setRatings via formatRatingGrant
- `client/index.html` — HUD CSS ÷3 / ×3
- `client/public/about.html`, `client/public/changelog.json`
- `scripts/regression-epic56-pet-armor-max.ts`, `scripts/qa-epic56-programmer-playwright.mjs`
- `scripts/regression-epic31-bot-loadouts.ts` — maxArmor assertion
- `package.json` — regression:epic56-pet-armor-max
- `docs/tasks/epic-56-*.md` — spec, assignment, this handoff

## How to verify (steps for Trusya)

1. Run `npm run regression:epic56-pet-armor-max` (or `npx tsx scripts/regression-epic56-pet-armor-max.ts`) — expect PASS for 156/156, 22/100, 0/100, pickup, respawn, cat HP, multipliers.
2. Optional: `npm run regression:weapon-autoswitch`, `regression:epic31-bot-loadouts`, `regression:economy-pets`.
3. `node scripts/qa-epic56-programmer-playwright.mjs` — screenshots under `qa-artifacts/epic-56/`; fonts 50px / 36px; About dog copy without “caps at 100”.
4. Manual: equip strong dog → HUD armor N/N with N>100; weak dog → 22/100; cat → full maxHealth; ratings strip readable grant labels.

## Build and run

- Build command: `npm run typecheck` (PASS locally)
- Run command: `npm run regression:epic56-pet-armor-max`; `node scripts/qa-epic56-programmer-playwright.mjs`
- Expected smoke result: regressions PASS; Playwright ALL PASS; evidence PNGs present

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: regression stdout; `qa-artifacts/epic-56/playwright-run.log`
- Key success messages: `[epic56-pet-armor-max] PASS`, `[epic56] ALL PASS`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: `maxArmor`, current armor baseline from pet ratings, armor pickup cap, health max/heal, speed/damage multipliers on movement/fire
- What the client is allowed to predict/render only: HUD current/max from `PlayerState`; ratings strip from server `economy_profile` ratings via `formatRatingGrant` (display only)

## Risks / known limitations

- Ratings strip at 36px may wrap on very long four-axis lines; max-width 72vw / wrap enabled — verify at 1280×800 (evidence `01-combat-hud-typography-1280x800.png`, ratingsRight≈1262).
- Playwright stop(vite) can hang after PASS on SIGKILL wait; evidence still written — Tester may Ctrl-C after ALL PASS if needed.
- `npm install` in this worktree used `--ignore-scripts` due to local g++ lacking C++20 for better-sqlite3 rebuild; regressions that need sqlite may need a prebuilt binary (economy-pets used Redis and PASS).

## Integrity findings (HP / SPD / DMG)

| Axis | Finding |
|------|---------|
| HP (cat) | **Verified OK** — `maxHealth = COMBAT.maxHealth + bonus`; applyPetRatings heals when at old max; pickup/heal/respawn use `player.maxHealth` (EPIC 55); no fix required |
| Speed (bird) | **Verified OK** — `speedMultiplierFromRatings` = `1 + rating/100`; applied in `stepPlayer` with no extra clamp |
| Damage (lion) | **Verified OK** — `damageMultiplierFromRatings` = `1 + rating/100` in `scaleWeaponDamage`; no extra clamp |

## Typography notes

- `.hud-value`: 50px (÷3 from 150)
- `#ratingsHud`: 36px (×3 from 12); padding 10×16; `white-space: normal`; `max-width: min(72vw, 920px)`; text-align right
- Evidence: `qa-artifacts/epic-56/01-…` through `05-…` (git-ignored)

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
