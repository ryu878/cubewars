# EPIC 58 — Programmer assignment (Team Lead → Pusya)

## Branch / worktree

- From current `master` (EPIC 57 merged `5328646`).
- Branch: `feature/epic-58-collision-floors-respawn-walls`
- Preferred worktree: `/home/dmitry/Documents/Projects/Python/cubewars/.claude/worktrees/epic-58-collision-floors-respawn-walls`
- Spec: `docs/tasks/epic-58-collision-floors-respawn-walls.md` (sync into worktree).

## Environment

`export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"` or `source ~/.nvm/nvm.sh`

## Must deliver

### A — Player-player collision (Stories 58.1–58.2)

1. **`shared/src/collision.ts`:** Add exported helper e.g. `resolvePlayerOverlaps(players: { id: string; x: number; z: number }[], radius = PLAYER_COLLISION_RADIUS): void` — mutates positions in place; symmetric separation; stable pair order; 2–3 passes; skip same id.
2. **`server/src/playerRegistry.ts`:** After all `stepPlayer()` in `step()`, collect alive players, run helper, write back x/z.
3. **`client/src/fpsController.ts`:** After wall resolution, run same helper against remote alive positions (exclude self). Wire positions from `main.ts` / world_state each frame.
4. Add **`scripts/regression-epic58-player-collision.ts`** (or extend existing): two overlapping circles pushed apart; dead excluded; stable behavior.
5. Register script in root `package.json` as `regression:epic58-player-collision`.

### B — Themed ground textures (Story 58.3)

6. **`client/src/textures.ts`:** `buildGroundTexture(themeId: MapThemeId)` — procedural canvas per map (see spec table: sand grid, cracked rust, mossy tiles, concrete, asphalt, dark rock+glow veins, metal grate, pavement). Reuse patterns from `buildWallTextures`.
7. **`client/src/mapThemes.ts`:** Extend `MapThemeScene` if needed (ground texture ref); `applyMapTheme()` swaps ground material map + tint; dispose previous texture.
8. **`client/src/main.ts`:** Ensure ground mesh uses material that accepts texture swap; call path already goes through `applyMapTheme`.
9. Extend **`scripts/regression-epic49-palettes.ts`** (or epic58 script): assert each MapId has a ground texture builder entry.

### C — Respawn beam VFX (Story 58.4)

10. New **`client/src/spawnBeamVfx.ts`:** Pool or spawn-on-event; green additive cylinder/beam from ~Y=40–60 down to spawn point; fade 2–3s; update in render loop.
11. **`client/src/main.ts`:** `onRespawn` → spawn beam for any `message.playerId`; hook update/dispose in animate loop.
12. Playwright script **`scripts/qa-epic58-tester-playwright.mjs`** (or reuse pattern from epic-57): screenshot beam visible; save under `qa-artifacts/epic-58/`.

### D — Walls 3× + fog (Story 58.5)

13. **`shared/src/maps/types.ts`:** `WALL_HEIGHT = 18`.
14. **`client/src/mapThemes.ts`:** Scale each map's `fogNear`/`fogFar` ~3× (tune for visual — wall tops must dissolve).
15. **`client/src/textures.ts`:** Verify `createFogFadeWallMaterial` / `WALL_FOG_FADE_START` works for 18m — adjust fade start if hard cap visible.
16. **`scripts/regression-epic49-palettes.ts`:** Expect `WALL_HEIGHT === 18`.
17. Fix stale **`shared/src/index.ts`** comments mentioning WALL_HEIGHT 6.
18. Re-run: `regression:epic46-maps`, `regression:epic49-palettes`, `regression:crate-mount`.

### E — Docs / delivery (Story 58.6)

19. About EN+RU: players block each other; distinct map floors; green respawn beam; taller fog walls.
20. `client/public/changelog.json` + `LAST_UPDATED`.
21. `npm run typecheck` && `npm run build`.
22. `docs/tasks/epic-58-programmer-handoff.md`; open PR to `master`.
23. **Do not merge/deploy.** Ignore unrelated dirty parent files.

## Read first

- `ai-office/agents/programmer/role.mdc`, global standards, handoff template, `player-facing-docs.md`, branch policy
- Spec `docs/tasks/epic-58-collision-floors-respawn-walls.md`
- Key: `shared/src/collision.ts`, `server/src/playerRegistry.ts`, `client/src/fpsController.ts`, `client/src/mapThemes.ts`, `client/src/textures.ts`, `client/src/main.ts`, `shared/src/maps/types.ts`
- Reference VFX: `client/src/killLootVfx.ts`, `combatEffects.ts`
- EPIC 49: fog fade walls, palettes

## Return to Team Lead

Branch, PR/compare URL, HEAD SHA, files touched, regression commands + results, evidence paths (`qa-artifacts/epic-58/`), handoff path, blockers.
