# EPIC 3: The Arena (single de_dust-inspired map)

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

## 1. EPIC

| Field | Description |
|-------|-------------|
| **Name** | The Arena — single static map, CS `de_dust`-inspired |
| **System goal** | Give the game exactly one real level to play on: an open-air, sandy-toned arena with two distinct "site" areas connected by a mid lane and at least one side tunnel/route, built from simple blocky geometry (walls, crates, ramps) in the project's low-poly style — not a literal asset port, an homage layout. Both client and server must agree on the exact same collision geometry. |
| **Business/gameplay problem** | The user explicitly asked for "1 карта типа CS: De_dust" as part of what makes this a playable game — right now there's only an open flat field with a few decorative blocks, no walls, no cover, no real space to fight over. |
| **Architectural role** | shared map data (single source of truth for collision) + client (render the level) + server (collide player movement and raycasts against the same geometry) |
| **Main components** | `shared/` (map geometry definition), `client/` (level renderer using that data), `server/` (collision against that data) |
| **Stack** | Fixed project stack, no deviation — see `ai-office/global/global-standards.mdc` |
| **Interaction with other components** | This EPIC's map data becomes an input to EPIC 2's movement code (walls now block the player) and EPIC 4's shooting code (walls block raycasts/hitscan) — both must import the *same* `shared/` map definition, not separately hand-coded copies. |

## 2. Story 3.1 — Map data as shared source of truth

**As a** developer **I want** the arena's wall/floor/cover geometry defined once in `shared/` **so that** the client renders exactly what the server collides against — no drift between visual and authoritative geometry.

- **Outputs:** a data structure in `shared/` (e.g. a list of axis-aligned boxes: position, size — keep it AABB-only for this EPIC, no rotated geometry, to keep collision math simple per "prefer simple and reliable architecture") describing: outer boundary walls, two site areas (open regions with some crate cover), a mid lane connecting them, one side tunnel/route as a second path between sites — the overall *shape* should evoke de_dust's "two sites + mid + tunnel" structure, it does not need to match real de_dust callouts or dimensions.
- **Acceptance criteria:**
  - [ ] Map data lives in `shared/`, is strongly typed, and is imported (not duplicated) by both `client/` and `server/`
  - [ ] At least: outer walls, 2 site areas, 1 mid lane, 1 alternate route (tunnel), a handful of crate/box cover pieces

## 3. Story 3.2 — Client renders the level

**As a** player **I want** to see and walk through the actual arena **so that** the game has real space to move and fight in.

- **Outputs:** client renders every piece of map geometry from the shared data (walls, crates) with materials consistent with the existing low-poly/colorful direction (sandy/tan tones for a de_dust feel is a reasonable choice, Programmer's call) — replace or extend the current decorative block placement from EPIC 1 with this real layout.
- **Acceptance criteria:**
  - [ ] Loading the client shows a recognizable enclosed arena (walls visible, two open site areas, a connecting corridor/mid, a second route) — not the old scattered-random-blocks look
  - [ ] Player spawn position is inside the arena, not inside a wall or outside the boundary

## 4. Story 3.3 — Server + client collision against the map

**As a** player **I want** to be blocked by walls and crates **so that** the map is not just cosmetic.

- **Outputs:** server's authoritative movement (from EPIC 2) now resolves against the map's AABBs — a player cannot walk through a wall or crate; client does the same collision locally for responsive movement feel (prediction), reconciled against server state as EPIC 2 already does for position sync.
- **Acceptance criteria:**
  - [ ] Deliberately walking into a wall stops the player at the wall, both visually (client) and in the authoritative state (server) — verify by checking the server-broadcast position doesn't cross a wall boundary even if the client tried to push through
  - [ ] Crate cover is climbable-or-blocking (Programmer's call which, document it) — consistent between client visual and server collision

## 5. Tasks

| # | Task | Expected result | Place in code | Completion criterion |
|---|------|------------------|----------------|----------------------|
| 1 | `shared/`: map geometry data + types | typed AABB list describing the arena | `shared/src/` | imported by both client & server, typechecks |
| 2 | Client: level renderer from map data | walls/crates/floor rendered from shared data | `client/src/` | visual arena matches the two-sites+mid+tunnel shape |
| 3 | Client: local collision against map | player can't walk through geometry (client-predicted) | `client/src/` | manual/Playwright check: moving into a wall stops movement |
| 4 | Server: collision against map | authoritative position respects the same AABBs | `server/src/` | server-broadcast position never ends up inside a wall AABB after a deliberate push-through attempt |
| 5 | Player spawn points | 1+ valid spawn point(s) inside the arena, away from walls | `shared/` or `server/src/` | new connections spawn inside playable space |

## 6. Acceptance Criteria (EPIC-level, Definition of Done)

- [ ] One coherent arena replaces the EPIC 1 placeholder field: outer walls, 2 sites, mid lane, 1 alternate route, crate cover
- [ ] Client and server use the exact same shared map data — no hand-duplicated geometry
- [ ] Player movement (from EPIC 2) is blocked by walls/crates, both client-predicted and server-authoritative
- [ ] Spawn points are inside the arena
- [ ] No TypeScript build errors; `npm run build` / `npm run typecheck` pass
- [ ] Tester's Gameplay & feel section includes screenshots of the arena from multiple vantage points (both sites, mid, tunnel) plus evidence of wall collision actually blocking movement

## 7. Risks

- AABB-only collision is a deliberate simplification (no ramps/slopes, no rotated walls) — acceptable for a first playable map; note as a backlog item if the user wants ramps/verticality later, don't scope-creep into a full physics engine (Rapier) for this — the fixed stack keeps Rapier optional/deferred, and simple AABB math is simpler and sufficient here.
- Reusing the exact same shared AABB list for both rendering and collision is the main risk to get wrong (easy to accidentally hand-roll a second, slightly different copy for rendering) — Critic should specifically check for that.
- This EPIC changes the visual scene substantially (replaces EPIC 1's scattered blocks) — Tester should re-verify the EPIC 1/2 acceptance criteria that are still supposed to hold (scene renders, WS connects, movement/jump/multiplayer sync still work) aren't accidentally broken, not just the new map-specific criteria.

---

## Sign-off

- **Specification (author):** Team Lead (Tusya)
- **Approval (Team Lead):** Tusya — approved for assignment
- **Assignee:** Programmer (Pusya)
