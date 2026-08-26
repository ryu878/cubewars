# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-26 |
| Task / Story / EPIC | EPIC 49 — Distinct Map Palettes & Thematic Props (Stories 49.1–49.4) |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-49-programmer-handoff.md` @ branch tip `e214ae0` (implementation `41da7f2`+) |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Linux 5.15; Node `v24.18.1` via nvm; local Redis for server regressions
- Branch / commit: `task/epic-49-map-palettes-thematic-props` @ `e214ae01c8a6c76b9ca97293e5a1c00359b4bb1a` (QA re-ran at this tip; report commit follows)
- Worktree: `.claude/worktrees/epic-49-map-palettes-thematic-props`
- Compare: https://github.com/ryu878/cubewars/compare/master...task/epic-49-map-palettes-thematic-props

## Check results

### Build

- Command: `npm run typecheck && npm run build`
- Result: OK — shared/server/client typecheck clean; server `tsc` + client Vite build succeeded

### Run

- Command: `npm run regression:epic49-palettes && npm run regression:epic48 && npm run regression:epic47 && npm run regression:epic46-maps`
- Result: OK — all four suites PASS (EPIC 49 palette distinctness + `WALL_HEIGHT=6` + EPIC 48 pickup counts; epic48/47/46-maps green)
- Command: `node scripts/qa-epic49-programmer-playwright.mjs`
- Result: OK — 8 map wide shots + `summary.json` (`failures: []`, every map `maxWallH: 6`)
- Command: ad-hoc Playwright gameplay smoke (move/jump/look/fire + leave→lobby + rejoin)
- Result: OK — evidence `09`–`11` + `gameplay-smoke.json`; server logged fire + hit registration

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| AC1 — 8 distinct palettes | Each catalog map clearly different in screenshots | PASS — `01`–`08`: base warm desert; rust_canyon orange/rust; glass_dome green haze; dead_station near-black; fuel_depot tan/industrial; crystal_cave dark blue + emissive crystals; abyss_bridge dark deck/fog; elite_quarter bronze/tan plaza. Regression `assertPalettesDistinct` OK |
| AC2 — thematic props/silhouette | Theme-readable props beyond generic walls/crates | PASS — crystals (`06`), bridge deck/supports (`07`), plaza rubble/cover (`08`), rust rock piles (`02`), green veg tints (`03`); shared geometry prefixes verified by epic49 regression (`rc_tank_`, `fd_tank_*cistern`, `crystal`, `cable`, `veg`, `rubble`) |
| AC3 — `map_state` / mapId theme apply + leave reset | Palette applies on join/switch; leave→lobby resets | PASS — each bots join got matching `mapId` in `map_state`/status; leave between every map in Playwright; `10-lobby-after-leave.png` lobby restored; `11-rejoin-fuel-after-lobby.png` shows fuel_depot palette (not crystal bleed) |
| AC4 — taller walls + fog fade | `WALL_HEIGHT` 6; tops fade into map fog (not hard bright cap) | PASS — `maxWallH: 6` all maps in `summary.json`; regression asserts full-height walls; wide shots show haze dissolve at wall tops (esp. `01`,`02`,`04`,`06`,`07`,`08`) |
| AC5 — no pool/collision authority regressions + builds | typecheck/build + epic46–49 + Playwright | PASS — all listed commands green; EPIC 48 pickup counts unchanged in epic49 regression |
| AC6 — fair collision | No undocumented client-only blockers above wall AABB | PASS — `fps.setCollisionGeometry(message.geometry)` from server `map_state`; fog-fade is material on shared AABB only (`createFogFadeWallMaterial`); endless `fogWall` mesh is visual/not in collision set and out of catalog-map scope |

Checklist sections applied: Universal; Build and run; Client; Real-time/multiplayer (authority for geometry); Gameplay & feel.

### Config and secrets

- `config.vars.example` / README up to date: yes — README documents EPIC 49 palettes / `WALL_HEIGHT` 4→6 / verify commands; no new env vars
- No secrets in diff: yes

### Documentation

- README / docs updated: yes — README EPIC 49 note; task/handoff docs present

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: yes — shared `MapBox[]` (incl. raised walls + thematic props) ship via `map_state`; palette/materials client-only cosmetics

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s):
  - `qa-artifacts/epic-49/01-base.png` … `08-elite_quarter.png`
  - `qa-artifacts/epic-49/summary.json`
  - `qa-artifacts/epic-49/09-gameplay-crystal-move.png` (in-match after WASD/jump/look/fire; HP 90 after bot hit)
  - `qa-artifacts/epic-49/10-lobby-after-leave.png`
  - `qa-artifacts/epic-49/11-rejoin-fuel-after-lobby.png`
  - `qa-artifacts/epic-49/gameplay-smoke.json`
- Movement: OK — WASD exercised on crystal_cave; match stayed live
- Jump: OK — Space pressed in smoke; no stuck state observed
- Shoot / hit registration: OK — client fires accepted by server (fire rate-limit log); bot→player hit registered (`90 HP` in `09`)
- Camera / controls feel: OK — mouse look + FPS view usable; no inversion/stuck camera in smoke
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK — wide shots readable; `09` is a dark upward/fog gaze after free look (not a broken load — `06` shows full crystal scene)
- Matches intended "Roblox-like" look (colorful, readable, low-poly): yes — blocky AABB arenas with distinct colorful atmospheres

## On FAIL: reproduction

### Failure reason

- N/A (PASS)

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`). Verified: 8 distinct map palettes + thematic shared props, `map_state`/leave→lobby theme apply, `WALL_HEIGHT=6` with fog-fade tops, fair shared collision (no client-only ceiling blockers), typecheck/build + epic46–49 regressions, Playwright + gameplay smoke evidence under `qa-artifacts/epic-49/`.
