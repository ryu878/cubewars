# EPIC 56 — Programmer assignment (Team Lead → Pusya)

## Branch / worktree

- From current `master` (EPIC 55 merged).
- Branch: `feature/epic-56-pet-armor-max-hud`
- Preferred worktree: `/home/dmitry/Documents/Projects/Python/cubewars/.claude/worktrees/epic-56-pet-armor-max-hud`
- Spec: `docs/tasks/epic-56-pet-armor-max-hud.md` (sync into worktree).

## Environment

`export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"` or `source ~/.nvm/nvm.sh`

## Must deliver

### A — Armor max (Story 56.1)

1. `PlayerRecord.maxArmor`; init `COMBAT.maxArmor` on spawn.
2. Formula:
   ```ts
   const petArmor = armorBonusFromRatings(ratings.armorRating);
   player.maxArmor = Math.max(COMBAT.maxArmor, petArmor);
   // applyPetRatings: raise floor
   player.armor = Math.min(player.maxArmor, Math.max(player.armor, petArmor));
   // respawn after loadout zeros armor:
   player.armor = Math.min(player.maxArmor, petArmor);
   ```
3. Armor pickup + `toWorldState` use `player.maxArmor`.
4. Remove hard clamps to `COMBAT.maxArmor` when petArmor &gt; 100. Grep server/scripts.

### B — HP / speed / damage integrity + ratings strip (Story 56.2)

5. Verify cat maxHealth spawn/heal path (EPIC 55); fix if broken.
6. Verify `speedMultiplierFromRatings` / `damageMultiplierFromRatings` applied without wrongful clamps; fix if found.
7. `setRatings`: display via `formatRatingGrant` style — e.g. `+145 HP · +156 Armor · +100% Speed · +50% Damage` (non-zero axes preferred).

### C — Typography (Story 56.3)

8. `#healthHud` / `#armorHud` `.hud-value`: **150px → ~50px** (÷3). Update EPIC 13 comments.
9. `#ratingsHud`: **12px → ~36px** (×3). Adjust padding/max-width/wrap so 1280×800 stays usable.
10. Playwright screenshot under `qa-artifacts/epic-56/` showing both HUD regions.

### D — Docs / delivery

11. Shared JSDoc (`armorBonusFromRatings`, `PlayerState.maxArmor`).
12. About EN+RU dog armor (no absolute “caps at 100”); Last updated; changelog.
13. Regressions: 156/156, 22/100, 0/100, armor pickup to raised max; HP full spawn; speed/dmg multipliers if you touch them.
14. `docs/tasks/epic-56-programmer-handoff.md`; open PR to `master`.
15. Do **not** merge/deploy. Ignore unrelated dirty parent files (favicons, other worktrees, `docs/ops/mail.md`).

## Read first

- Programmer role + global standards + handoff template + player-facing-docs + branch policy
- Spec `docs/tasks/epic-56-pet-armor-max-hud.md`
- Key: `server/src/playerRegistry.ts`, `shared/src/economy.ts`, `client/src/combatHud.ts`, `client/index.html` (health/armor + `#ratingsHud`), About/changelog

## Return to Team Lead

Branch, PR/compare URL, HEAD SHA, files touched, integrity findings (HP/SPD/DMG), regression results, typography notes, evidence paths, handoff path, blockers.
