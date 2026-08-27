# EPIC 55 — Programmer assignment (Team Lead → Pusya)

## Branch / worktree

- Create from current `master` (tip includes EPIC 54 merge `779d0da` or later).
- Branch: `feature/epic-55-ammo-not-unlock-hud-maxhp`
- Preferred worktree: `/home/dmitry/Documents/Projects/Python/cubewars/.claude/worktrees/epic-55-ammo-not-unlock-hud-maxhp`
- Spec (authoritative): `docs/tasks/epic-55-ammo-not-unlock-hud-maxhp.md` — copy/sync into worktree.

## Environment

`export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"` or `source ~/.nvm/nvm.sh`

## Must deliver

### Story 55.1 — Ammo does not unlock

1. In `server/src/playerRegistry.ts` `applyPickup()`: **split** `"weapon"` vs `"ammo"`.
   - **`ammo`**, weapon not owned: allow if ammo &lt; maxAmmo; stockpile `player.ammo[weapon]`; **do not** `ownedWeapons.add`; **do not** auto-equip.
   - **`ammo`**, weapon owned: refill + EPIC 13 auto-equip (higher tier + has ammo) — keep existing behavior.
   - **`weapon`**: unlock + ammo as today; auto-equip higher tier if usable.
   - **Weapon after stockpile:** ownership + keep stockpiled ammo + add pickup ammo, cap `maxAmmo`.
2. Update `shared/src/pickups.ts` comments that say weapon/ammo apply identical effect.
3. Update stale JSDoc on `applyPickup` (including health cap wording).
4. Check bots / other callers that assume ammo grants ownership; fix if needed.
5. Extend `scripts/regression-weapon-autoswitch.ts` and/or add a dedicated regression for:
   - unowned ammo → stockpile, not owned, no auto-equip, E cannot cycle to it
   - owned ammo refill still auto-equips
   - stockpile then weapon pickup → owned with capped ammo

### Story 55.2 — HUD current/max + maxHealth integrity

6. **Investigate** why players report heal cap at 100 after damage below 100 despite boosted respawn HP. Fix any real server clamp/reset. Document root cause in handoff (even if “no server bug; was HUD opacity only”).
7. Add `maxHealth` to `PlayerState`; broadcast in `toWorldState()`. Armor: broadcast `maxArmor` **or** use `COMBAT.maxArmor` for HUD — prefer one clear authoritative pattern; do **not** invent max from client pet ratings.
8. HUD: `setHealth(current, max)` → `85/245`; `setArmor(current, max)` → `22/100`. Wire from `main.ts` world_state.
9. i18n only if labels change.
10. About + changelog (`ai-office/policies/player-facing-docs.md`): ammo vs weapon pickup rule; HUD current/max; heal-to-boosted-max if player-facing.
11. Regression: apply pet boost → damage below 100 → health pickup heals above 100 toward `maxHealth`.
12. Playwright evidence under `qa-artifacts/epic-55/` (HUD `current/max` at minimum; pickup behavior if automatable).

### Delivery hygiene

13. `docs/tasks/epic-55-programmer-handoff.md`; open PR to `master`.
14. Do **not** merge or deploy. Do not mix unrelated dirty parent files (favicons, other worktrees, `docs/ops/mail.md`).

## Read first

- `ai-office/agents/programmer/role.mdc`
- `ai-office/global/{global-standards,handoff-contracts,english-only,security-baseline}.mdc`
- `ai-office/templates/programmer-handoff-template.md`
- `ai-office/policies/{player-facing-docs,branch-and-pr-policy}.md`
- Spec: `docs/tasks/epic-55-ammo-not-unlock-hud-maxhp.md`
- Key code: `server/src/playerRegistry.ts` (`applyPickup`, `applyPetRatings`, `processRespawns`, `toWorldState`), `shared/src/pickups.ts`, `shared/src/index.ts` (`PlayerState`), `client/src/combatHud.ts`, `client/src/main.ts`
- Regressions: `scripts/regression-weapon-autoswitch.ts`
- Deploy docs (context only — do not deploy): `docs/ops/production-deploy.md`

## Return summary (to Team Lead)

Branch, PR URL, HEAD SHA, root cause of maxHealth/100-cap (if found), files touched, regression commands + results, About/changelog notes, evidence paths, handoff path, blockers.
