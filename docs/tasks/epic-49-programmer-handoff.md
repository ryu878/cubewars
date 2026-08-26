# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-26 |
| Author (Pusya) | Programmer (Pusya) |
| Task / Story / EPIC | EPIC 49 — Map Palettes & Thematic Props (Stories 49.1–49.4) |
| Branch / commit / PR | `task/epic-49-map-palettes-thematic-props` @ `41da7f2` — PR after push |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. **Per-map palettes** (`client/src/mapThemes.ts`): distinct fog/ground/sky/lights/wall/crate/prop tints for all 8 `MapId`s; `applyMapTheme` on every `map_state` and leave→lobby; endless/lobby use Base-like desert.
2. **Prefix materials** in `renderMapGeometry`: wheels, cabin/body, tanks, cisterns/barrels, crystals (emissive), rubble/rocks, veg, cables, towers/hangars, pumps — not one grey metal.
3. **Thematic AABB props** enriched in `primitives.ts` / `themedMaps.ts` (tank wrecks, cisterns, crystal clusters, cable-stays, rubble heaps, veg patches, barrels) — shared collision only.
4. **Taller fog-fading walls (49.3):** shared `WALL_HEIGHT` **4 → 6** (`shared/src/maps/types.ts`); endless imports the same constant (no hardcoded 4). Window lintels use `WALL_HEIGHT`. Client `createFogFadeWallMaterial` (local-Y shader): albedo mixes toward **per-map fogColor**, soft alpha at tip. No visual mesh above the shared AABB.
5. Regressions + Playwright 8-map wide shots under `qa-artifacts/epic-49/`.

## Changed files / areas

- `client/src/mapThemes.ts` (new), `client/src/main.ts`, `client/src/textures.ts`
- `shared/src/maps/{types,primitives,themedMaps}.ts`, `shared/src/index.ts` (comment)
- `server/src/endlessWorld.ts` (import shared `WALL_HEIGHT`)
- `scripts/regression-epic49-palettes.ts`, `scripts/qa-epic49-programmer-playwright.mjs`
- `package.json`, `README.md`, `docs/tasks/epic-49-*.md`, `qa-artifacts/epic-49/*`

## How to verify (steps for Trusya)

1. `export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"`
2. `npm run typecheck && npm run build`
3. `npm run regression:epic49-palettes` (distinct palettes + WALL_HEIGHT=6 + EPIC 48 pickup counts)
4. `npm run regression:epic48 && npm run regression:epic47 && npm run regression:epic46-maps`
5. `node scripts/qa-epic49-programmer-playwright.mjs` → `qa-artifacts/epic-49/01-…08-*.png` + `summary.json` (`maxWallH: 6` per map)
6. Manual smoke: join each map via bots; confirm atmosphere changes on map switch and resets on leave→lobby; walls read taller with haze tops (not a hard bright cap).

## Build and run

- Build command: `npm run typecheck && npm run build`
- Run command: `npm run dev` (or Playwright script above)
- Expected smoke result: 8 distinct palettes; walls height 6 with fog dissolve; pickups still EPIC 48 counts

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server join / `map_state` mapId lines; Playwright console `[epic49-qa]`
- Key success messages: `EPIC 49 palette + pickup regression OK`; `[epic49-qa] OK — 8 map wide shots written`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: shared `MapBox[]` geometry/collision (including raised `WALL_HEIGHT`); pickups/spawns unchanged in counts
- What the client is allowed to predict/render only: palette, materials, wall fog-fade (visual only — no client-only blockers above AABB)

## Risks / known limitations

- Fog-fade uses transparent wall materials (local-Y shader); rare alpha sorting glitches possible at glancing angles
- Playwright camera is a fixed QA hold-pose — some maps frame low cover in foreground while full-height outer walls sit in the haze band
- No visual-only extension above collision AABB (documented)

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
