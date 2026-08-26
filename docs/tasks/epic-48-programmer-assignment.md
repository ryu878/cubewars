# EPIC 48 — Programmer assignment (Team Lead → Pusya)

## Branch / worktree

- Create from current `master` (tip should be EPIC 47 merge `686d73e` or later).
- Branch: `task/epic-48-pickup-balance-map-select`
- Preferred worktree: `/home/dmitry/Documents/Projects/Python/cubewars/.claude/worktrees/epic-48-pickup-balance-map-select`
- Spec (authoritative): `docs/tasks/epic-48-pickup-balance-map-select.md` — sync into worktree if needed.

## Environment

`export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"` or `source ~/.nvm/nvm.sh`

## Must deliver

1. **Pickup rebalance:** leave EPIC 47’s 16/16/12/12 carpet; land in ~6–10 weapons, ~6–10 ammo, ~4–8 health, ~4–8 armor (~20–32 total). Justify exact counts in handoff (before/after).
2. **Spatial spread:** stop sequential lattice “weapon runway”; spread via landmarks/sites / spatially diverse clear points; keep `isPickupClear`.
3. **Map select fix for real:** root-cause why Base always loads (public + bots + ESC change/reload). Fix client and/or server. Document root cause.
4. **Regression:** fails if bots/public join with non-Base `mapId` still gets Base geometry/bounds; cover rejoin if feasible without browser.
5. Update EPIC 47 (and related) count assertions; typecheck/build; README if needed; `docs/tasks/epic-48-programmer-handoff.md`; open PR to `master`.

## Read first

- `ai-office/agents/programmer/role.mdc`
- `ai-office/global/{global-standards,handoff-contracts,english-only,security-baseline}.mdc`
- `ai-office/templates/programmer-handoff-template.md`
- Spec: `docs/tasks/epic-48-pickup-balance-map-select.md`
- Current densify: `shared/src/maps/densify.ts`
- Join paths: `client/src/{main,modeSelect,pauseMenu}.ts`, `server/src/{index,matchManager,match}.ts`
- Prior regressions: `scripts/regression-epic46-maps.ts`, `scripts/regression-epic47.ts`

## Constraints

- Do not merge or deploy.
- Do not mix unrelated parent dirty files (`docs/ops/`, deploy script, other worktrees).
- English artifacts; hand off to Tester only (write handoff; TL will route Tester).
- Server remains authoritative for pickups and match map.

## Return summary (to Team Lead)

Branch, PR URL (or compare URL if `gh` blocked), HEAD SHA, pickup before/after + rationale, map-select root cause + fix, regression path, handoff path, blockers.
