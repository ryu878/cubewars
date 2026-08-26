# EPIC 50 — Programmer assignment (Team Lead → Pusya)

## Branch / worktree

- Create from current `master` (tip should be EPIC 49 merge `ca1b79e` or later).
- Branch: `task/epic-50-half-maps-pet-clarity`
- Preferred worktree: `/home/dmitry/Documents/Projects/Python/cubewars/.claude/worktrees/epic-50-half-maps-pet-clarity`
- Spec (authoritative): `docs/tasks/epic-50-half-maps-pet-clarity.md` — copy/sync into worktree.

## Environment

`export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"` or `source ~/.nvm/nvm.sh`

## Must deliver

### Story A — Half-size maps (~0.5 linear X/Z)

1. Scale catalog maps to **~0.5 linear** on X/Z vs current `STANDARD_MAP_BOUNDS` (±92/±52 → ≈ ±46/±26).
2. Scale **all** shared `MapBox` centers/sizes on X/Z, spawn points, and pickup positions consistently (server collision = client mesh).
3. Keep `WALL_HEIGHT` / EPIC 49 fog-fade walls unless a small documented proportion tweak is clearly needed.
4. Keep thematic palettes + prop id-prefix materials readable after shrink.
5. Re-validate pickup clearance / densify / EPIC 48 spread intent; adjust densify params if pools break.
6. Endless: keep consistent if it shares the same bounds/scale helpers; document if untouched.

### Story B — Pet clarity + type icons

1. Pet click/detail: show readable primary grant from shared rules — e.g. dog `+156 Armor` (not `dog 156`). Axes from `PET_TYPE_RATING`: dog→armor, cat→health (label **HP** or **Health**), bird→speed, lion→damage.
2. Equip rail + detail when equipped: show **what it grants** with slot fraction (`SLOT1_FRACTION` / `SLOT2_FRACTION`) matching `aggregateEquippedRatings` floor rules.
3. Socketed gems: list **each** gem contribution and **totals**.
4. Replace pig-snout `.inv-icon-pet` with distinct **dog/cat/bird/lion** CSS/SVG icons in bag, rail, ghost, detail.
5. Display-only: use server `economy_profile` numbers + shared formulas — **no fake stats**.

### Delivery hygiene

6. Typecheck + build; map/economy regressions green as applicable.
7. Playwright evidence under `qa-artifacts/epic-50/` (scaled maps + pet detail/rail/icons).
8. `docs/tasks/epic-50-programmer-handoff.md`; open PR to `master`.
9. Do **not** merge or deploy. Do not mix unrelated dirty parent files (`docs/ops/`, favicons, other worktrees).

## Read first

- `ai-office/agents/programmer/role.mdc`
- `ai-office/global/{global-standards,handoff-contracts,english-only,security-baseline}.mdc`
- `ai-office/templates/programmer-handoff-template.md`
- Spec: `docs/tasks/epic-50-half-maps-pet-clarity.md`
- Maps: `shared/src/maps/{types,primitives,base,themedMaps,densify}.ts`
- Economy: `shared/src/economy.ts` (`PET_TYPE_RATING`, `aggregateEquippedRatings`, `PET_COMBAT`)
- Inventory: `client/src/inventoryOverlay.ts`, pet icon CSS in `client/index.html`
- Themes: `client/src/mapThemes.ts` (preserve; only fix if scale breaks)

## Return summary (to Team Lead)

Branch, PR URL (or compare URL), HEAD SHA, exact linear scale used, map clearance notes, how pet labels/icons work, regression paths, handoff path, blockers.
