# Task: EPIC 59 — Mid-map rift hazard rivers

## Context

- **EPIC:** `docs/tasks/epic-59-map-rift-hazards.md`
- **Stories:** 59.1 Shared rift data + hit test; 59.2 Server DoT; 59.3 Client visuals; 59.4 Placement polish; 59.5 Player-facing docs
- **Task ID:** T59.1–T59.5 (single delivery branch)

## Task

Implement mid-map irregular “rift/river” hazards on every catalog map. Standing in them drains armor then health (server-authoritative); jumping across without landing in the rift is safe. Each map gets a distinct hazardous medium per the EPIC pairing table. Shape must zig-zag through roughly the middle like a fault line — not a straight rectangle.

### T59.1 — Shared types + polylines + hit test

- Extend `MapDefinition` with `rift?: MapRiftHazard` (kind, polyline `{x,z}[]`, halfWidth, damagePerSecond).
- Author polylines in `MAP_AUTHORING_BOUNDS`; scale X/Z (and halfWidth) in `finalizeCatalogMap` via `MAP_LINEAR_SCALE` like geometry.
- Implement `isPointInRift(x, z, rift)` (distance to thick polyline ≤ halfWidth).
- ≥6–10 zig-zag control points per map; halfWidth authoring ~1.2–2.0 so jumpable after scale.
- damagePerSecond ~10–14.
- Keep clear of spawn points (no spawn inside rift footprint).
- Map ↔ kind pairing (required):

| MapId | Hazard kind |
|-------|-------------|
| `base` | `water_piranha` |
| `rust_canyon` | `lava` |
| `glass_dome` | `acid` |
| `dead_station` | `toxic_sludge` |
| `fuel_depot` | `oil_fire` |
| `crystal_cave` | `plasma` |
| `abyss_bridge` | `void_ink` |
| `elite_quarter` | `molten_gold` |

- Endless: no catalog rift (empty / skip).

### T59.2 — Server DoT

- After `registry.step` each tick (non-endless catalog matches), call something like `applyRiftHazardDamage()`.
- Only living players (humans + bots) whose feet are inside the rift **and** grounded (`onGround` / `y ≈ groundY`).
- Reuse `PlayerRegistry.applyEnvironmentalDamage` (armor→health), same pattern as `Match.applyEndlessFogDamage`.
- Broadcast damage like fog (`"rift"` / `"hazard"`). Death does not award kill.
- Skip airborne players over the rift.
- Do **not** apply client-side HP.

### T59.3 — Client visuals

- Irregular ribbon/strip mesh from shared polyline, slightly above ground (`y ≈ 0.02–0.05`).
- Per-kind materials/colors + light VFX (bubbles / emissive pulse / simple fish sprites for water, etc.).
- Rebuild on `map_state` with map geometry; dispose previous.
- Cosmetic only — must not block movement.

### T59.4 — Placement polish + smoke

- Polylines roughly bisect mid-map with lateral wobble; prefer open lanes so jumps are possible.
- Unit/regression for `isPointInRift`; existing map/palette regressions still green.
- Notes for Tester in programmer handoff.

### T59.5 — Player-facing docs

- Update `client/public/about.html` (bump Last updated) and add Changelog entry in `client/public/changelog.json` in the **same PR**.

## Stack for this task

- Shared: `shared/` map types + finalize + hit helper
- Server: Node.js/TS + `ws` — `Match` tick DoT, `PlayerRegistry.applyEnvironmentalDamage`
- Client: Three.js/TS + Vite — cosmetic rift mesh/VFX only
- No Rapier; no new frameworks

## Branch / git

- Branch: `feature/epic-59-map-rift-hazards` from current `master`
- One PR into `master`
- **Do not commit** unrelated untracked files (favicons, `.claude/worktrees/`, old epic docs noise, `docs/ops/mail.md`, `spawnBeaconVfx.ts`, etc.)
- Commit only EPIC 59 implementation + this task/epic docs if needed

## Expected result

- Every catalog map has a distinct themed jumpable mid-map rift
- Server drains armor then HP when standing in rift; jump-clear safe
- Client shows themed ribbon; About + Changelog updated
- PR opened with filled template; programmer handoff ready for Tester

## Place in code / service

- Repository: `/home/dmitry/Documents/Projects/Python/cubewars`
- Likely paths: `shared/src/maps/*`, `server/src/match.ts`, `server/src/playerRegistry.ts`, client map rebuild / new rift renderer module, `client/public/about.html`, `client/public/changelog.json`

## Completion criteria

- [ ] All EPIC 59 acceptance criteria met
- [ ] `npm run build` (workspaces) succeeds
- [ ] Relevant regressions green
- [ ] Branch pushed; PR opened into `master`
- [ ] Handoff written with `ai-office/templates/programmer-handoff-template.md`

## Dependencies on other Tasks

- None (depends on existing env damage / fog pattern and map finalize pipeline)

## Estimate (optional)

- Medium feature (shared + server + client + docs)
