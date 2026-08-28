# EPIC 58 — Player collision, themed floors, respawn beam, 3× walls + fog

| Field | Value |
|-------|-------|
| **EPIC ID** | 58 |
| **Name** | Player-player collision; per-map ground textures; respawn beam VFX; 3× wall height + fog |
| **Status** | Assigned |
| **Branch** | `feature/epic-58-collision-floors-respawn-walls` |
| **Base** | `master` (after EPIC 57 merge `5328646`) |
| **Specification (author)** | Team Lead (Tusya) |
| **Approval (Team Lead)** | Tusya — 2026-08-28 |
| **Assignee** | Programmer (Pusya) |

---

## 1. EPIC

### System goal

1. **Player-player collision:** Alive players and bots cannot ghost through each other — server-authoritative separation after wall resolution; client prediction aligned.
2. **Themed ground textures:** Each of the 8 catalog maps gets a distinct procedural floor texture/structure (not flat `palette.ground` color alone).
3. **Respawn beam VFX:** Green semi-transparent light column at spawn point for ~2–3s, visible to all clients on `RespawnEvent`.
4. **3× wall height + fog:** `WALL_HEIGHT` 6 → 18; per-map fog scaled/tuned so wall tops dissolve with no hard visible cap.

### Business / gameplay problem

- Players walk through each other — breaks combat positioning and cover tactics.
- Maps still feel samey at floor level despite EPIC 49 palettes (flat ground color only).
- Respawns are invisible to teammates/enemies — hard to orient after a kill.
- 6m walls feel capped; taller walls + higher fog sell “infinite horizon” arena feel.

### Architectural role

- **Shared** — `PLAYER_COLLISION_RADIUS` player-player separation helper; `WALL_HEIGHT` constant
- **Server** — post-tick player separation in `PlayerRegistry.step()` or equivalent
- **Client** — prediction mirror in `fpsController.ts`; ground texture swap in `mapThemes.ts`/`textures.ts`; respawn beam module
- **Docs** — About EN+RU + changelog (player-facing-docs)

### Stack (fixed)

Three.js/TS client + Vite; Node.js/TS + `ws` server; `shared/` protocol. No Rapier. Server remains authoritative for positions; client prediction is feel-only.

### Explore findings (fold-in)

| Area | Finding |
|------|---------|
| Wall collision | `resolveSteppedMovement()` + `boxesBlockingAt()` in `shared/src/collision.ts`; used by `playerRegistry.stepPlayer()` and `fpsController.ts`. No player-player logic today. |
| Player radius | `PLAYER_COLLISION_RADIUS = 0.4` already shared. |
| Ground | `applyMapTheme()` sets `groundMat.color` only (`mapThemes.ts` L260). One ground mesh in `main.ts`; swap texture/material on map change. |
| Respawn event | `RespawnEvent` broadcast with `playerId`, `position`, `health`. Client `onRespawn` only clears local HUD dead state — no VFX. |
| Wall height | `WALL_HEIGHT = 6` in `shared/src/maps/types.ts`; all wall boxes use it via `primitives.ts`. |
| Fog fade | `createFogFadeWallMaterial()` in `textures.ts`; `WALL_FOG_FADE_START = 0.35` (normalized local Y). Must still fade 18m walls into fog. |
| Regressions | `regression-epic49-palettes.ts` asserts `WALL_HEIGHT === 6` — update to 18. |

---

## 2. Stories

### Story 58.1 — Server-authoritative player-player collision

**As a** player **I want** other players and bots to block my movement **so that** positioning and chokepoints matter.

**Design:**

- After each player's wall/crate resolution in a tick, run a **post-pass** over all alive players/bots.
- Shared helper in `shared/src/collision.ts` (preferred): given a list of `{ id, x, z }` circles of radius `PLAYER_COLLISION_RADIUS`, push overlapping pairs apart symmetrically (half each along separation axis) or process pairs in stable id order.
- Skip dead players. Only horizontal (x/z); Y unchanged.
- Call from `PlayerRegistry.step()` after all `stepPlayer()` calls, OR integrate at end of each `stepPlayer()` with stable ordering — prefer one post-pass for symmetry.
- Multiple overlap resolution passes (2–3) acceptable for corner cases.

**AC:**

- [ ] Two alive players overlapping cannot remain overlapping after a tick.
- [ ] Bots block humans and other bots the same way.
- [ ] Dead players do not participate.
- [ ] Uses `PLAYER_COLLISION_RADIUS` (0.4).
- [ ] Positions in `world_state` reflect separation.

### Story 58.2 — Client prediction mirror

**As a** player **I want** local movement to feel blocked by others **so that** prediction does not ghost through bodies.

**Design:**

- In `fpsController.ts`, after wall resolution, apply the same shared helper against other alive players' **last known** positions from `world_state` (passed in via options/callback — do not invent positions).
- Local player excluded from self-collision.
- Accept small server correction via existing reconcile if needed; avoid large desync.

**AC:**

- [ ] Local player cannot predict-walk through a stationary remote player.
- [ ] Uses same shared helper + radius as server.
- [ ] No new client authority over other players' positions.

### Story 58.3 — Per-map procedural ground textures

**As a** player **I want** each map's floor to look distinct **so that** maps are recognizable at ground level.

**Themes (procedural canvas textures, like wood/brick walls):**

| MapId | Floor look |
|-------|------------|
| `base` | Sand grid / desert tiles |
| `rust_canyon` | Cracked rust / dry earth |
| `glass_dome` | Mossy biolab tiles |
| `dead_station` | Worn concrete / hangar floor |
| `fuel_depot` | Stained asphalt / oil patches |
| `crystal_cave` | Dark rock + faint glow veins |
| `abyss_bridge` | Metal grate / deck plating |
| `elite_quarter` | Urban pavement / cracked tiles |

**Design:**

- Extend `client/src/mapThemes.ts` and/or `client/src/textures.ts` with `buildGroundTexture(mapId)` (or per-theme factory).
- `applyMapTheme()` assigns texture to existing ground mesh material (one mesh, swap on map change; dispose old texture).
- Keep `palette.ground` as tint/multiply or base color where useful.
- Endless/lobby: reuse sensible default (e.g. base sand or dedicated endless variant).

**AC:**

- [ ] All 8 catalog maps have visually distinct ground textures at match load.
- [ ] Theme swaps on `map_state` / `applyMapTheme` without extra ground meshes.
- [ ] Performant: one ground mesh; texture generated once per theme change.

### Story 58.4 — Respawn spawn beam VFX

**As a** player **I want** to see a green light column when someone respawns **so that** I can orient to spawn activity.

**Design:**

- New client module (e.g. `spawnBeamVfx.ts`) or extend `combatEffects.ts` — cosmetic only, no hitbox.
- Subscribe to `onRespawn` for **every** `playerId`, not only local.
- Green additive/semi-transparent cylinder (or shader beam) from high Y (~sky/fog line) down to `message.position`.
- ~2–3s fade-out then dispose.
- Optional: also on first alive appearance if cheap — **minimum** requirement is respawn after death.

**AC:**

- [ ] Beam visible to all clients in match on `RespawnEvent`.
- [ ] Green, semi-transparent, fades ~2–3s.
- [ ] No gameplay/collision impact.
- [ ] Playwright or screenshot evidence under `qa-artifacts/epic-58/`.

### Story 58.5 — Walls 3× taller + fog shifted up

**As a** player **I want** taller walls that fade into fog **so that** arenas feel open with no visible wall cap.

**Design:**

- `WALL_HEIGHT`: **6 → 18** in `shared/src/maps/types.ts` (`WALL_Y` follows).
- All wall geometry via `primitives.ts` picks up new height automatically.
- Per-map `fogNear` / `fogFar` in `MAP_PALETTES`: scale ~3× or tune so wall tops dissolve — no hard flat top visible at gameplay camera heights.
- `createFogFadeWallMaterial`: verify/adjust `WALL_FOG_FADE_START` (or pass wall height) so fade band starts high enough on 18m walls.
- Collision AABB grows with wall height — expected; verify jump/climb on crates still fair (jump apex still below 18m walls).
- Update `regression-epic49-palettes.ts` and any test assuming `WALL_HEIGHT=6`.
- Update stale comments in `shared/src/index.ts` referencing WALL_HEIGHT 6.

**AC:**

- [ ] `WALL_HEIGHT === 18`; full-height walls in all catalog maps.
- [ ] Wall tops fade into fog — no obvious hard horizontal cap at typical FOV.
- [ ] Fog distances tuned per map (scaled ~3× baseline or better).
- [ ] Regressions updated and green.

### Story 58.6 — Player-facing docs

**AC:**

- [ ] About EN+RU mentions: players block each other; distinct map floors; respawn beam; taller fog walls (brief, player-facing wording).
- [ ] `client/public/changelog.json` newest entry; `LAST_UPDATED` bumped per `ai-office/policies/player-facing-docs.md`.

---

## 3. Tasks (Programmer)

| ID | Task | Files (primary) |
|----|------|-------------------|
| 58.1.1 | Shared `resolvePlayerOverlaps()` helper | `shared/src/collision.ts`, export from index |
| 58.1.2 | Server post-tick separation | `server/src/playerRegistry.ts` |
| 58.2.1 | Client prediction mirror | `client/src/fpsController.ts`, `main.ts` (pass remote positions) |
| 58.3.1 | Ground texture builders + theme wiring | `client/src/textures.ts`, `mapThemes.ts`, `main.ts` |
| 58.4.1 | Respawn beam VFX + hook | `client/src/spawnBeamVfx.ts` (or similar), `main.ts`, `network.ts` |
| 58.5.1 | WALL_HEIGHT 18 + fog tune + fade verify | `shared/src/maps/types.ts`, `mapThemes.ts`, `textures.ts` |
| 58.5.2 | Regression updates | `scripts/regression-epic49-palettes.ts`, new `regression-epic58-player-collision.ts` if useful |
| 58.6.1 | About + changelog | `client/public/about.html`, `changelog.json` |
| 58.7.1 | Handoff + PR | `docs/tasks/epic-58-programmer-handoff.md`, PR → `master` |

---

## 4. Acceptance Criteria (EPIC)

- [ ] Players block each other (human + bot), server authoritative.
- [ ] Client prediction reasonably aligned (no chronic ghosting).
- [ ] 8 maps have distinct floor textures/structures.
- [ ] Respawn beam visible to all clients (~2–3s green fade).
- [ ] Walls ~18m; fog swallows tops.
- [ ] `npm run typecheck` + `npm run build` pass.
- [ ] Regressions pass (including updated epic49 + epic46/47/48 as needed).
- [ ] Playwright evidence under `qa-artifacts/epic-58/`.
- [ ] About EN+RU + changelog updated.

---

## 5. Risks

| Risk | Mitigation |
|------|------------|
| Player separation jitter in tight groups | Symmetric push + stable id order + 2–3 passes |
| Client/server desync on player collision | Shared helper; reconcile existing |
| Ground texture gen cost on map swap | Generate once per theme change; cache by mapId |
| 18m walls break jump/climb | Jump apex << 18m; crate mount regressions |
| Respawn beam clutter in 8-player DM | Short fade; semi-transparent |
| Performance: O(n²) player pairs | n ≤ 8 humans + few bots — trivial |

---

## 6. Delivery

Per branch/PR policy: feature branch → PR → Tester PASS → Critic APPROVED → Team Lead merge → deploy `https://cubewars.ru/` via `./scripts/deploy-production.sh`.

**Do not merge/deploy from Programmer** — hand off to chain.
