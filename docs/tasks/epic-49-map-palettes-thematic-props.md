# EPIC 49 — Distinct Map Palettes & Thematic Props

**Status:** Approved for implementation (Team Lead)  
**Date:** 2026-08-26  
**Depends on:** EPIC 46 (catalog maps), 47 (density), 48 (pickup spread + map select) — merge tip `5eeba67`+

## User intent

Maps must **feel and look different**: each of the 8 catalog maps needs a **clearly distinct color palette** and **theme-readable props/silhouette** matching lore (not the same sand/wood/brick look on every map). Fixed stack: procedural Three.js AABB boxes only — **no external 3D asset pipeline**. Collision/hitscan remain server-authoritative from shared `MapBox[]`.

| MapId | Theme cues (lore) |
|-------|-------------------|
| `base` | Building + car (already started); keep as warm “classic” desert base |
| `rust_canyon` | Ravine, old bridges, military wrecks, dry riverbed ambushes |
| `glass_dome` | Sealed biolab dome; vegetation + fog inside; wasteland outside; CQC |
| `dead_station` | Abandoned spaceport hangars + runway; cover + sniper lanes |
| `fuel_depot` | Tanks/cisterns, pump stations, narrow alleys |
| `crystal_cave` | Glowing crystals, light/shadow, vertical fights |
| `abyss_bridge` | Damaged cable-stayed bridge; upper deck + lower supports; fog |
| `elite_quarter` | Multi-story scientists’ housing, collapsed roofs, multi-level |

---

## 1. EPIC

| Field | Description |
|-------|-------------|
| **Name** | Map visual differentiation — per-map palettes + thematic AABB props |
| **System goal** | At a glance, every catalog map is recognizable by color atmosphere and prop silhouette, without changing match authority or EPIC 48 pickup balance. |
| **Business/gameplay problem** | After EPIC 46–48, layouts differ but client still paints one shared sand ground, wood/brick walls, grey props, and one fog/sky — maps feel samey. |
| **Architectural role** | client visual themes by `mapId`; shared AABB geometry/prop enrichment; server unchanged for authority except shipping new shared boxes |
| **Main components** | **`client/src/mapThemes.ts`** (preferred), `client/src/main.ts` (`renderMapGeometry`, leave→lobby reset), `client/src/textures.ts`; `shared/src/maps/{primitives,themedMaps,base}.ts`; regressions / Playwright |
| **Stack** | Fixed: Three.js/TS client + Vite; Node/TS `ws` server; `shared/` protocol. Procedural boxes only. No Rapier. No GLTF/asset packs. |
| **Interaction** | Server sends `map_state` with `mapId` + geometry → client `applyMapTheme(mapId)` + materials by box kind / **prop id prefixes**. Leave→lobby resets theme. ESC change-map / bots / public rejoin must re-apply. |

---

## 2. Architecture

**Explore finding (fold-in):** layouts are already theme-shaped in shared AABBs, but the client ignores `mapId` for materials — one desert fog/sky/ground, wood/brick walls, one metal prop color. Landmarks (cars, tanks, crystals, hangars) exist; make them **visually distinct** via palette + materials + denser props where silhouettes are thin.

**Preferred implementation order:**

1. **`client/src/mapThemes.ts`** — per-`MapId` palette (fog, ground, lights, sky, wall/crate tints, prop defaults) + `applyMapTheme(mapId)` on every `map_state` and on leave→lobby reset (Base/desert default or explicit reset).
2. **`renderMapGeometry`** — materials by `prop` **id prefixes** (e.g. `*_wheel_*`, car body/cabin, `rc_tank_*` / `fd_tank_*`, `cc_crystal_*` emissive glow, rubble/ruins, veg blocks) in addition to kind + map palette.
3. **Enrich** `primitives.ts` / `themedMaps.ts` (and Base if needed) with clearer multi-box thematic props where silhouettes are thin — collision stays shared AABB; **no client-only blockers**.

```text
map_state { mapId, geometry, bounds }
        │
        ▼
client:
  1. applyMapTheme(mapId)  → fog, ground, sky, hemi/sun, default tints
  2. renderMapGeometry(boxes) → wall/crate tinted; props by id prefix + accents
leave → lobby:
  applyMapTheme(default) / reset atmosphere
```

**Authority rules:**

- Blocking geometry stays in shared `MapBox[]` (kind `wall` / `crate` / `prop`). Door/window = missing segments.
- Palette/materials are **visual only** (client). Palette table may live in `mapThemes.ts` keyed by `MapId` (shared export optional if useful for regressions).
- Optional non-colliding decor: only if documented and **not** required for cover; prefer colliding props in shared geometry so prediction matches.

**Playability:**

- Do not clog spawn/pickup clearance (`isPickupClear` / densify still pass).
- Keep EPIC 48 balanced pickup spreads; if geometry additions shrink clear pools, re-run densify / adjust prop placement — do not silently drop below EPIC 48 counts.

---

## 3. Stories

### Story 49.1 — Per-map color palette

**As a** player **I want** each map to have a different color atmosphere **so that** maps are instantly distinguishable.

**Acceptance:**

- [ ] Shared (or shared-exported) palette per `MapId`: at least ground, wall tint / primary, crate tint, prop/metal, sky horizon (or sky rebuild params), fog color + near/far, hemi sky/ground, sun color, optional accent emissive for crystal/lab props.
- [ ] Client applies palette when `map_state` arrives (and on ESC map change / bots / public join) — no leftover Base sand after switching to Crystal Cave etc.
- [ ] Endless mode keeps a sensible default (Base-like or existing endless look) and is not broken.
- [ ] All 8 maps are **clearly different** in screenshots (Tester evidence).

### Story 49.2 — Thematic prop clusters / silhouettes

**As a** player **I want** theme-readable cover and landmarks **so that** maps match lore beyond generic walls/crates.

**Guidance (AABB clusters — enhance existing, do not rebuild from scratch):**

| Map | Prop / silhouette direction |
|-----|----------------------------|
| Base | Keep building + cars; optional light palette-only polish |
| Rust Canyon | Rock piles / ridge blocks, bridge rails, more wrecks/tank bits, dry-bed markers |
| Glass Dome | Dome ring readable; vegetation blocks (green-tinted crates/props); foggy interior feel via palette |
| Dead Station | Hangar shells, runway edge markers, control tower; shuttle/tug wrecks |
| Fuel Depot | Tall cisterns, pump rows, barrel clusters, alley pinch points |
| Crystal Cave | Tall/emissive crystal pillars (prop + emissive accent), shelves/ledges for verticality |
| Abyss Bridge | Cable-stayed thin boxes as cables; towers; upper deck vs lower support contrast + deep fog |
| Elite Quarter | Multi-height building shells, rubble roofs, plaza cover |

**Acceptance:**

- [ ] Each map has theme-appropriate props beyond “same crate farm”.
- [ ] New blocking props are in shared geometry (server collision matches visuals).
- [ ] Spawns and pickups remain clear; EPIC 48 pickup balance not regressed.
- [ ] Screenshots show recognizable silhouette per map.

### Story 49.3 — Taller walls fading into fog (user fold-in)

**As a** player **I want** taller walls whose tops dissolve into haze **so that** the arena does not feel flat and true wall height is unclear.

**Intent (RU):** walls too short / world flat → raise walls; tops fade upward into fog so height is ambiguous.

**Guidance:**

- Prefer raising real wall AABB heights in shared (`WALL_HEIGHT` / outer+interior walls) **moderately** so collision matches what players see for the climbable/blockable body.
- Plus client vertical fade: wall materials (or a tall visual extension) alpha/fog-blend toward map fog color so tops dissolve into sky/fog — compose with per-map fog from `mapThemes`.
- If any visual-only mesh extends above collision, document clearly (no invisible blockers above the fade). Best: real height up + gradient/fog dissolve, not cheat colliders.
- Apply across **all 8 catalog maps** (and endless walls if they share the constant — keep fair).
- Do not break jump/crate climb assumptions without checking (apex stays below wall top).

**Acceptance:**

- [ ] Walls read taller than pre-EPIC-49 (~4u) on all catalog maps.
- [ ] Tops fade into map fog/haze (not a hard bright cap); works with per-map fog colors.
- [ ] Collision fair: no undocumented invisible ceiling blockers; shared wall AABBs raised if collision height changes.
- [ ] Screenshots show vertical atmosphere (Tester).

### Story 49.4 — Regression & evidence

**As a** Team Lead **I want** automated + Playwright proof **so that** palette/map load and authority stay green.

**Acceptance:**

- [ ] Typecheck + build green.
- [ ] Existing map/pool regressions still pass (`regression:epic46-maps`, epic47/48 as applicable); add/extend a small check that each catalog map has a distinct palette entry (or client apply hook) if useful.
- [ ] Playwright (or equivalent): join each of 8 maps (bots OK) and capture wide shots under `qa-artifacts/epic-49/` (include wall height / fog-fade readability).
- [ ] No collision-authority regressions (client still renders server `map_state` boxes).

---

## 4. Tasks

| # | Task | Expected result | Place | Done when |
|---|------|-----------------|-------|-----------|
| 49.1.1 | Add `client/src/mapThemes.ts`: per-`MapId` palette + `applyMapTheme(mapId)`; call on `map_state` and leave→lobby | Distinct atmosphere per map; no Base bleed | `client/src/mapThemes.ts`, `main.ts` | 8 distinct themes; reset on lobby |
| 49.1.2 | `renderMapGeometry`: tint walls/crates from theme; props by **id prefixes** (wheels, car body, tanks, crystals emissive, rubble, veg, cables…) | Landmarks read as theme objects | `client/src/main.ts`, `textures.ts` | Prefix materials visible in shots |
| 49.2.1 | Enrich multi-box thematic props where silhouettes are thin; densify/clearance OK | Recognizable silhouettes | `shared/src/maps/{primitives,themedMaps,base}.ts` | Screenshots + densify still OK |
| 49.3.1 | Raise wall AABB height (shared) + client vertical fog/alpha fade into map fog on all maps | Taller, haze-topped walls; fair collision | `shared/.../types.ts` (+ endless if shared const), `main.ts` / materials / `mapThemes` | Shots + docs note |
| 49.4.1 | Regressions + typecheck/build; Playwright 8-map shots; handoff | QA-ready | `scripts/`, `qa-artifacts/epic-49/`, docs | Handoff filled |

**Branch:** `task/epic-49-map-palettes-thematic-props`  
**Worktree (preferred):** `.claude/worktrees/epic-49-map-palettes-thematic-props`

---

## 5. Out of scope

- External meshes / GLTF / new npm art packages
- Redesigning endless maze generation
- Changing public capacity, matchmaking, or EPIC 48 pickup *counts* (unless densify forced by clearance — document)
- Rapier / new physics
- Lobby lore copy rewrite (unless one-line README note)

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Palette only on ground — walls still identical | Tint or rebuild procedural wall textures from palette primaries; props get metal/accent colors |
| New props block spawns/pickups | Place away from spawn lists; re-run densify; keep clearance helpers |
| Sky rebuild every map_state leaks GPU | Dispose previous sky/textures; build once per map change, not per frame |
| Crystal emissives blow exposure | Modest emissiveIntensity; Tester screenshot check |
| Taller walls break jump-on-wall or door lintels | Keep doors/windows as gaps; raise lintels with WALL_HEIGHT; verify crate climb apex still below wall top |
| Visual-only tall tops vs collision mismatch | Prefer raising shared AABB; document any decorative fade-only extension |
| Parent dirty `docs/ops/` / deploy script | Do not mix into this branch unless TL asks |

---

## 7. Deploy

After Tester PASS + Critic APPROVED (or Judge ALL_CLOSED) + TL merge approve: merge to `master`, then `./scripts/deploy-production.sh` → https://cubewars.ru/

---

## 8. Sign-off

- **Specification (author):** Team Lead (Tusya) — 2026-08-26  
- **Approval (Team Lead):** Approved for Programmer  
- **Assignee:** Programmer (Pusya)
