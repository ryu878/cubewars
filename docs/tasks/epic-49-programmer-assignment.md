# EPIC 49 — Programmer assignment (Team Lead → Pusya)

## Branch / worktree

- Create from current `master` (tip should be EPIC 48 merge `5eeba67` or later).
- Branch: `task/epic-49-map-palettes-thematic-props`
- Preferred worktree: `/home/dmitry/Documents/Projects/Python/cubewars/.claude/worktrees/epic-49-map-palettes-thematic-props`
- Spec (authoritative): `docs/tasks/epic-49-map-palettes-thematic-props.md` — sync into worktree if needed.

## Environment

`export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"` or `source ~/.nvm/nvm.sh`

## Must deliver (preferred order — explore + wall-height fold-in)

**Note:** Worktree already has substantial WIP (mapThemes, prefix materials, prop enrich). Finish that, then add Story 49.3 walls, commit, handoff, PR.

1. **`client/src/mapThemes.ts`** — per-`MapId` palette (fog, ground, lights, sky, wall/crate tints, prop defaults) + `applyMapTheme(mapId)` on every `map_state` and on leave→lobby reset. Endless: sensible default; do not break.
2. **`renderMapGeometry`** — materials by prop **id prefixes** (`*_wheel_*`, car body/cabin, `rc_tank_*`/`fd_tank_*`, `cc_crystal_*` emissive, rubble/ruins, veg, cables, etc.) so existing landmarks become visually distinct — not one grey metal for all props.
3. **Enrich** `primitives.ts` / `themedMaps.ts` (+ Base if needed) with clearer multi-box thematic props where silhouettes are thin. Collision = shared AABB only; **no client-only blockers**. Preserve spawn/pickup clearance and EPIC 48 pickup balance.
4. **Taller fog-fading walls (all maps):** raise shared wall AABB height moderately (`WALL_HEIGHT` today = 4); client vertical alpha/fog fade so tops dissolve into **per-map fog** (not a hard cap). Fair collision — no undocumented invisible blockers above fade. Fix door/window lintels that depend on wall height. Endless: keep consistent if it shares the constant.
5. **Evidence:** typecheck + build; keep epic46/47/48 regressions green; Playwright wide shots of all 8 maps under `qa-artifacts/epic-49/` (palettes + taller haze walls).
6. README note if useful; `docs/tasks/epic-49-programmer-handoff.md`; open PR to `master`.

## Read first

- `ai-office/agents/programmer/role.mdc`
- `ai-office/global/{global-standards,handoff-contracts,english-only,security-baseline}.mdc`
- `ai-office/templates/programmer-handoff-template.md`
- Spec: `docs/tasks/epic-49-map-palettes-thematic-props.md` (includes explore fold-in)
- Maps: `shared/src/maps/{types,base,themedMaps,primitives,densify}.ts`
- Client: `client/src/main.ts` (`renderMapGeometry`, ground, fog, lights, leave→lobby), `client/src/textures.ts` — **new** `client/src/mapThemes.ts`
- Prior: EPIC 46 map catalog notes in `docs/tasks/epic-46-multi-map-select-capacity.md` §3.4–3.6

## Constraints

- Procedural Three.js / AABB only — no external 3D assets.
- Server remains authoritative for geometry/collision/pickups.
- Do not merge or deploy.
- Do not mix unrelated parent dirty files (`docs/ops/`, deploy script, other worktrees).
- English artifacts; hand off to Tester only (write handoff; TL will route Tester).

## Return summary (to Team Lead)

Branch, PR URL (or compare URL if `gh` blocked), HEAD SHA, palette approach summary, prop changes per map (short), clearance/pickup notes, regression paths, handoff path, blockers.
