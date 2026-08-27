# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-27 |
| Author (Pusya) | Pusya |
| Task / Story / EPIC | EPIC 55 — Ammo does not unlock weapons; HUD current/max; maxHealth integrity |
| Branch / commit / PR | `feature/epic-55-ammo-not-unlock-hud-maxhp` tip `dfc8733cd4cd601b36ded634523bfac16bef126c` (impl `9beaea4d9d6372e82fb6d8e4c4409c533614d165`); `gh pr create` blocked (CLI auth `ltrvtrb2`; SSH push `ryu878`). Compare URL: https://github.com/ryu878/cubewars/compare/master...feature/epic-55-ammo-not-unlock-hud-maxhp?expand=1 |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. **Story 55.1:** Split `PlayerRegistry.applyPickup()` so `"ammo"` never adds ownership / never auto-equips when unowned (stockpile only); owned ammo still auto-equips per EPIC 13; `"weapon"` unlocks and preserves prior stockpile ammo (capped at `maxAmmo`). Updated `shared/src/pickups.ts` docs and stale applyPickup JSDoc (health uses `player.maxHealth`, not `COMBAT.maxHealth`).
2. **Story 55.2:** Broadcast `maxHealth` + `maxArmor` on `PlayerState` via `toWorldState()`. HUD `setHealth(current, max)` / `setArmor(current, max)` → `N/M`, wired from `main.ts` world_state (no client pet-rating math). About + changelog updated. Regressions + Playwright evidence under `qa-artifacts/epic-55/`.

### maxHealth / “heal capped at 100” root cause

**No server mid-life heal-cap bug found.** Health pickups already used `Math.min(player.maxHealth, …)` and `player.maxHealth` survives damage; `applyPetRatings` / `processRespawns` recompute from pet ratings correctly. Stale JSDoc still said “capped at COMBAT.maxHealth”, which was misleading. Player report is best explained by **HUD showing only current HP** (no max), so after damage below 100 the boosted ceiling was invisible; healing above 100 was already possible server-side (regression case 9: 80 → 105 with maxHealth 245).

Bots: `BotAI` ignores all pickups — no ownership assumption to fix.

## Changed files / areas

- `server/src/playerRegistry.ts` — applyPickup split; toWorldState emits maxHealth/maxArmor
- `shared/src/index.ts` — PlayerState.maxHealth / maxArmor
- `shared/src/pickups.ts` — weapon vs ammo docs
- `client/src/combatHud.ts`, `client/src/main.ts`, `client/index.html` — current/max HUD
- `client/public/about.html`, `client/public/changelog.json` — player-facing docs
- `scripts/regression-weapon-autoswitch.ts` — cases 7–9 + spawn-protection clear for fire cases
- `scripts/qa-epic55-programmer-playwright.mjs` — evidence script
- `docs/tasks/epic-55-*.md` — spec, assignment, this handoff

## How to verify (steps for Trusya)

1. Run `npm run regression:weapon-autoswitch` — expect OVERALL PASS (includes unowned ammo, stockpile→weapon, pet heal above 100).
2. Run `npm run regression:playerstate-equipped-weapon` — PASS.
3. Optional Playwright: `node scripts/qa-epic55-programmer-playwright.mjs` → screenshots in `qa-artifacts/epic-55/` (HUD `245/245`, `0/100`, About weapons copy).
4. Manual: join bots with cat equipped → HUD shows `current/max`; pick unowned rifle ammo → ammo increases, E cannot cycle to rifle; pick rifle weapon → owns + auto-equip; take damage below 100, pick medkit → HP can exceed 100 toward max.

## Build and run

- Build command: `npx tsc --noEmit -p shared && npx tsc --noEmit -p server && npx tsc --noEmit -p client`
- Run command: standard server + Vite client (Playwright script self-spawns on ports 7865/5265)
- Expected smoke result: regressions exit 0; HUD shows `N/M`; ammo does not unlock

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout for join / hit / economy as usual
- Key success messages: Playwright log `ALL PASS`; regression `OVERALL: PASS`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: ownership, ammo stockpile, equip, health/maxHealth, armor/maxArmor, pickup apply rules
- What the client is allowed to predict/render only: HUD display of server `health`/`maxHealth`/`armor`/`maxArmor` — never invent max from local pet ratings

## Risks / known limitations

- `gh pr create` blocked by CLI auth mismatch — open PR from compare URL above
- Additive protocol fields: client falls back to `COMBAT.maxHealth` / `COMBAT.maxArmor` only if an older payload omits them
- Playwright evidence does not automate the ammo-pickup path in-match (covered by whitebox regression); HUD + About are screenshot-proven
- Regression `freshPlayer()` clears spawn protection so fire() auto-switch cases remain exercisable (EPIC 41)

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
