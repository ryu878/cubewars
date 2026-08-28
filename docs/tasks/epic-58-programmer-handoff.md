# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-28 |
| Author (Pusya) | Pusya |
| Task / Story / EPIC | EPIC 58 — Player collision, themed floors, respawn beam, 3× walls + fog |
| Branch / commit / PR | `feature/epic-58-collision-floors-respawn-walls` — see PR URL after push |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. **Player-player collision (58.1–58.2):** Shared `resolveAllPlayerSeparations()` + `resolvePlayerOverlap()` in `shared/src/collision.ts`; server post-tick pass in `PlayerRegistry.step()`; client prediction mirror in `fpsController.ts` wired from `lastWorldPlayers` in `main.ts`.
2. **Themed floors (58.3):** Procedural `buildGroundTexture()` per map in `textures.ts`; `applyMapTheme()` swaps ground map + tint; fog distances scaled ~3× for 18m walls.
3. **Respawn beam (58.4):** `SpawnBeamVfx` module; hooked on every `onRespawn`; QA hook `window.__cwSpawnBeam`.
4. **Walls + fog (58.5):** `WALL_HEIGHT` 6 → 18; `WALL_FOG_FADE_START` 0.35 → 0.55; epic49 regression updated.
5. **Docs (58.6):** About EN+RU movement/arena section; changelog entry; `LAST_UPDATED` 2026-08-28.

## Changed files / areas

- `shared/src/collision.ts`, `shared/src/maps/types.ts`, `shared/src/index.ts`
- `server/src/playerRegistry.ts`
- `client/src/fpsController.ts`, `client/src/textures.ts`, `client/src/mapThemes.ts`, `client/src/spawnBeamVfx.ts`, `client/src/main.ts`
- `client/public/about.html`, `client/public/changelog.json`
- `scripts/regression-epic58-player-collision.ts`, `scripts/regression-epic49-palettes.ts`, `scripts/qa-epic58-tester-playwright.mjs`
- `package.json`, `docs/tasks/epic-58-*.md`, `qa-artifacts/epic-58/`

## How to verify (steps for Trusya)

1. Join a vs Bots match with 2+ entities; walk into a stationary bot/player — local movement should stop; server positions should not overlap (`world_state`).
2. Cycle all 8 catalog maps — each floor texture should look distinct (not flat palette color only).
3. Kill/respawn (or dev respawn) — green column ~2–3s at spawn point visible to all clients.
4. Observe wall tops dissolve into fog (no hard horizontal cap at typical FOV) on tall 18m walls.
5. Run regressions: `npm run regression:epic58-player-collision`, `regression:epic49-palettes`, `regression:epic46-maps`, `regression:epic47`, `regression:epic48`.
6. Review Playwright evidence: `qa-artifacts/epic-58/01-spawn-beam-early.png`, `02-spawn-beam-mid.png`, `summary.json`.

## Build and run

- Build command: `npm run typecheck && npm run build`
- Run command: `npm run dev` (or docker compose per repo README)
- Expected smoke result: client loads; map theme applies floor texture; respawn beam on `RespawnEvent`; players block in bots match.

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout on match tick (no new log lines for collision — existing movement/step path).
- Key success messages: regression scripts print `EPIC 58 player collision regression OK`, `EPIC 49 palette + pickup regression OK`.

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: player-player separation after wall resolution each tick in `PlayerRegistry.resolvePlayerCollisions()`; positions in `world_state` are authoritative.
- What the client is allowed to predict/render only: local player overlap push via `resolvePlayerOverlap()` against last-known remote positions; respawn beam VFX; ground/wall cosmetics.

## Risks / known limitations

- `regression:crate-mount` fails on this branch **and on current master** (missing `crate_a1` in `ARENA_GEOMETRY`) — pre-existing, not introduced by EPIC 58.
- Client player collision uses last `world_state` positions (~50ms stale) — small desync possible in tight groups; server reconciles.
- O(n²) player pairs — acceptable at n ≤ 8 + bots.

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
