# EPIC 59 — Mid-map rift hazard rivers

## Context

Players want a jumpable mid-map “rift / small river” on every catalog map. Standing in it drains armor then health; jumping across is safe. Each map gets a distinct hazardous medium (lava, acid, bubbling sludge, piranha water, etc.). Shape must look like an irregular crack/fissure crossing roughly through the map middle — not a straight rectangle.

## Architecture

- **Shared (`shared/`)**: per-`MapId` rift definition (hazard kind + irregular polyline + half-width + DPS). Author in `MAP_AUTHORING_BOUNDS`, scale X/Z via `MAP_LINEAR_SCALE` in `finalizeCatalogMap` (same as geometry). Point-in-rift helper (distance to thick polyline) for server (+ optional client FX). Hazards are **not** blocking `MapBox`es.
- **Server (`server/`)**: after `registry.step` each tick (non-endless catalog matches), if alive player feet are inside rift and grounded (`onGround` / `y ≈ groundY`), apply `applyEnvironmentalDamage` (armor→health). Broadcast like fog (`"rift"` / `"hazard"`). Skip airborne players over the rift (jump-clear).
- **Client (`client/`)**: render themed ribbon/strip mesh + simple VFX (bubbles/fish/lava glow) from the same shared polyline. Cosmetic only — damage is server-authoritative.
- **Endless**: no catalog rifts (leave empty / skip).

Stack: Three.js/TS client + Vite, Node.js/TS + `ws` server, `shared/` protocol. No Rapier.

## Map ↔ hazard pairing (required)

| MapId | Hazard kind | Visual intent |
|-------|-------------|-----------------|
| `base` | `water_piranha` | murky water + fish silhouettes |
| `rust_canyon` | `lava` | glowing lava |
| `glass_dome` | `acid` | green acid |
| `dead_station` | `toxic_sludge` | bubbling purple/black sludge |
| `fuel_depot` | `oil_fire` | dark oil with fire patches |
| `crystal_cave` | `plasma` | cyan energy crack |
| `abyss_bridge` | `void_ink` | deep black void with sparkles |
| `elite_quarter` | `molten_gold` | shimmering molten gold |

## Stories

### Story 59.1 — Shared rift data + hit test

- Extend `MapDefinition` with `rift?: MapRiftHazard` (or parallel table finalized into map).
- Fields: `kind`, `polyline: {x,z}[]` (≥6–10 control points, zig-zag across mid), `halfWidth` (~1.2–2.0 authoring → half after scale so jumpable with normal jump), `damagePerSecond` (~10–14).
- `isPointInRift(x, z, rift)` using segment distance ≤ halfWidth.
- Scale polyline in `finalizeCatalogMap`. Keep clear of spawn points (no spawn inside rift footprint).

### Story 59.2 — Server DoT

- `Match` tick: `applyRiftHazardDamage()` for catalog maps with a rift.
- Only grounded living players (humans + bots).
- Reuse `applyEnvironmentalDamage`; death does not award kill.
- Optional: thin shared constant for DPS.

### Story 59.3 — Client visuals

- Build irregular strip mesh from polyline (extrude along segments or triangulated ribbon) slightly above ground (`y ≈ 0.02–0.05`).
- Per-kind materials/colors + light animation (bubbles/emissive pulse/simple fish sprites for water).
- Rebuild on `map_state` with map geometry; dispose previous.
- Do not block movement on client.

### Story 59.4 — Placement polish

- Each polyline roughly bisects the map (often along X or diagonal through center), with lateral wobble (± several meters) so it reads as a fault line, not a canal box.
- Avoid burying under solid wall corridors where jump is impossible; prefer open mid lanes / plazas. If a wall crosses the rift, leave a jumpable gap or route around dense geometry.

### Story 59.5 — Player-facing docs

- Update `client/public/about.html` (Last updated date) and add a Changelog entry in `client/public/changelog.json` describing mid-map rift hazards (jump across / standing drains armor then HP; per-map themes). Same PR — mandatory per `ai-office/policies/player-facing-docs.md`.

## Tasks (Programmer)

1. **T59.1** Shared types + per-map polylines + `isPointInRift` + finalize scale + spawn clearance.
2. **T59.2** Server tick DoT using environmental damage.
3. **T59.3** Client rift renderer + theme materials/VFX; wire into `main.ts` / map rebuild.
4. **T59.4** Smoke: unit/regression for point-in-rift + palette/map list still green; manual checklist notes for Tester.
5. **T59.5** About + Changelog for the new player-facing hazard mechanic.

Branch: `feature/epic-59-map-rift-hazards` from `master`.

## Acceptance criteria

- [ ] Every catalog `MapId` has a distinct rift kind and irregular mid-map polyline (not a single AABB rectangle).
- [ ] Standing in the rift drains armor first, then health (server-authoritative); jumping across without landing in it deals no rift damage.
- [ ] Bots take the same damage.
- [ ] Client shows a themed hazard surface matching the map’s kind.
- [ ] Spawns are not inside the rift.
- [ ] Endless mode unchanged (no catalog rift DoT).
- [ ] About page + Changelog updated in the same PR.
- [ ] `npm run build` workspaces succeed; existing map/palette regressions still pass.
- [ ] PR opened; Tester PASS + Critic APPROVED (or Judge ALL_CLOSED) before merge.

## Risks

- Rift too wide → hard to jump; too narrow → invisible. Tune halfWidth vs jump distance (~7.5 jumpSpeed).
- Walls blocking mid path → unjumpable death traps; place rifts in open corridors.
- Client-only prediction of damage would desync — do not apply client HP; FX only.

## Out of scope

- Sound for rift (optional follow-up).
- Making rift physically impassable / swimming mechanics.
- Changing jump height or movement constants.
