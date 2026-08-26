# EPIC 46: Multi-Map Catalog, Map Picker, Expanded Base, 8-Player Public

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

User ask (RU, 2026-08-26), intent:

1. **Rename/expand** the current arena to **Base** (~4× playable area → prefer **2× linear on X and Z** from today’s ~92×52 → ~184×104; document if Programmer chooses true 4× linear and it stays performant).
2. On Base: **enterable building** (door openings both sides + window holes) + **car** prop (collidable AABB silhouette OK).
3. Add **7 themed maps** (same size target as expanded Base), procedural AABB only — no art pipeline.
4. **Lobby map picker**: choose map when starting/joining public (and bots if sensible); listed matches show map name.
5. Raise public capacity **4 → 8** humans; enough spawns + pickups per map; `MIN_SPAWN_SEPARATION` still workable.
6. Server-authoritative geometry via shared catalog + existing `map_state` hot-swap pattern (endless already does this).

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Multi-Map Catalog, Map Picker, Expanded Base, 8-Player Public |
| **System goal** | Players pick a static map for public/bots matches from a shared catalog of 8 maps (Base + 7 new); public matches hold 8 humans; all geometry/spawns/pickups are server-authoritative via `map_state`. |
| **Business/gameplay problem** | One hard-coded arena; public capped at 4; no map choice; Base too small for 8-player fights and lacks interesting interior props. |
| **Architectural role** | **shared** map catalog + protocol (`mapId`, lobby summary); **server** owns match map, broadcasts `map_state`, capacity 8; **client** lobby picker + render from server geometry (optional richer meshes keyed by id/kind that must not diverge from collision openings). |
| **Main components** | `shared/src/mapData.ts` (or catalog modules), `shared/src/index.ts`, `shared/src/pickups.ts`, `server/src/match.ts`, `server/src/matchManager.ts`, `server/src/playerRegistry.ts`, `client/src/modeSelect.ts`, `client/index.html`, `client/src/main.ts` / network map_state apply, regressions, Playwright, `README.md` |
| **Stack** | Fixed project stack. No new engines/assets. Procedural AABB primitives only. |
| **Interaction** | Reuse endless `map_state` path for static maps; keep endless maze generation out of map picker scope. |

## 2. Current state (verified)

- Single arena in `shared/src/mapData.ts`: `ARENA_BOUNDS` ≈ 92×52 (`minX/maxX ±46`, `minZ/maxZ ±26`), `ARENA_GEOMETRY`, `SPAWN_POINTS` (6).
- `MapBoxKind` = `"wall" | "crate"`.
- `MAX_PUBLIC_PLAYERS_PER_MATCH = 4` (`shared/src/index.ts`).
- `LobbyMatchSummary`: `{ id, displayName, players, maxPlayers }` — no `mapId`.
- `JoinMessage`: `{ mode, nickname, matchId? }` — no `mapId`.
- Match geometry: `Match.currentGeometry()` returns `endlessWorld?.getGeometry() ?? ARENA_GEOMETRY`; `map_state` already broadcast with geometry + bounds.
- Endless mode uses server-grown maze + `map_state` hot-swap — **reuse that pattern for static maps**; endless picker out of scope unless trivial.

## 3. Design

### 3.1 Shared map catalog

Introduce a catalog (prefer modular files under `shared/src/maps/` re-exported from `mapData.ts` / `index.ts`, or a clear split Programmer documents):

```ts
export type MapId =
  | "base"
  | "rust_canyon"
  | "glass_dome"
  | "dead_station"
  | "fuel_depot"
  | "crystal_cave"
  | "abyss_bridge"
  | "elite_quarter";

export interface MapDefinition {
  id: MapId;
  /** English UI name; optional Russian displayNameRu if natural in UI */
  displayName: string;
  displayNameRu?: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  geometry: MapBox[];
  spawnPoints: Vector3[];
  // pickups: either embedded or looked up by mapId in pickups module
}
```

- Keep backward-compat exports (`ARENA_GEOMETRY`, `ARENA_BOUNDS`, `SPAWN_POINTS`) as **aliases to Base** so existing imports do not break mid-refactor; prefer callers migrate to catalog getters.
- Optional `MapBoxKind` extension: `"prop"` that **blocks like walls** (car / tank hulls). Doors/windows = **gaps between wall segments** (endless door pattern) — do **not** invent non-colliding “door” boxes.
- Crystal glow / fog: client-only materials/fog accents OK if keyed by map id or box id; **must not** change collision.

### 3.2 Scale decision (document in handoff)

- **Preferred:** ~2× linear X/Z from current (~92×52 → ~184×104) = **~4× area**.
- **Allowed:** true 4× linear only if layout remains readable and typecheck/runtime feel OK — document choice + final bounds in programmer handoff.

### 3.3 Base map content

- Display name: **Base** (RU optional «База»).
- Expand layout (scaled + enriched), keep playable corridors/cover.
- **Enterable building:** wall segments with **door openings on both sides** and **window holes** (shoot-through gaps between segments / short wall pieces with vertical gaps).
- **Car:** cluster of AABBs (`prop` or `wall`) forming a recognizable low-poly silhouette; collidable; openings must match any richer client mesh.

### 3.4 Seven new maps (MVP silhouettes)

Same size target as expanded Base. Distinct layouts via AABB only:

| MapId | Display (EN / RU) | Layout intent |
|-------|-------------------|---------------|
| `rust_canyon` | Rust Canyon / «Ржавый Каньон» | Deep ravine, old bridges & military wrecks; dry riverbed center for ambushes |
| `glass_dome` | Glass Dome / «Стеклянный Купол» | Sealed biolab dome; dense vegetation+crates/fog inside, wasteland outside; CQC |
| `dead_station` | Dead Station / «Мёртвая станция» | Abandoned spaceport hangars + runway; cover + sniper lanes |
| `fuel_depot` | Fuel Depot / «Топливный склад» | Tanks & pump stations; narrow alleys between tanks; shotgun heaven |
| `crystal_cave` | Crystal Cave / «Кристальная пещера» | Underground grotto with glowing crystals; light/shadow; vertical fights |
| `abyss_bridge` | Abyss Bridge / «Мост через бездну» | Damaged cable-stayed bridge; two levels: upper deck + lower supports in fog |
| `elite_quarter` | Elite Quarter / «Квартал элиты» | Multi-story scientists’ housing with collapsed roofs; multi-level tactical fights |

Each map: ≥8 spawn points workable with `MIN_SPAWN_SEPARATION`; pickup density sane for 8 players (scale Base pickup count ~proportionally or better).

### 3.5 Match / lobby protocol

1. Extend `LobbyMatchSummary` with `mapId: MapId` and preferably `mapDisplayName` (or client resolves from catalog).
2. Extend `JoinMessage` with optional `mapId` for **create / bots** (and auto-create public when starting a new match). When joining existing `matchId`, **server map wins** — ignore client `mapId` for that join (log if mismatch).
3. Invalid `mapId` → reject join with clear reason (extend `join_rejected` reason or reuse existing + message — prefer explicit `map_invalid` if easy).
4. `Match` stores `mapId` + uses catalog geometry/spawns/pickups/bounds for all authoritative systems; on join/start send `map_state` from catalog (same as today for static path).
5. Public capacity: `MAX_PUBLIC_PLAYERS_PER_MATCH = 8`.
6. **Endless:** keep as-is (no map picker) unless wiring is trivial; do not break endless `map_state` growth.
7. UI: map picker in `modeSelect.ts` / `index.html` — select before Public / Bots; lobby list shows map name per match.

### 3.6 Client rendering

- Apply `map_state` geometry/bounds as today (do not hard-code Base geometry for collision prediction when server sent another map).
- Optional richer meshes for car/building/crystals keyed by id/kind — collision must match openings.
- Palette/emissive accents per map cheaply OK.

### 3.7 Out of scope

- Full art pipeline / external 3D assets
- Endless map picker (unless trivial)
- Changing private match modes beyond bots map select
- Rapier / new physics stack

## 4. Architecture

```text
shared/maps catalog
  MapId → { bounds, geometry, spawns, pickups, displayName }

Lobby UI
  → pick mapId → join { mode: public|bots, mapId?, matchId? }

MatchManager / Match
  → create match with mapId (server-owned)
  → LobbyMatchSummary includes mapId (+ display name)
  → map_state { geometry, bounds } from catalog (or endless world)
  → collision / hitscan / bots / spawns / pickups all use match geometry

Client
  → render + local prediction from last map_state only
```

**Authority:** Client must never invent walls that block differently from server geometry.

## 5. Stories / Tasks

### Story 46.1 — As the codebase I want a shared static map catalog

| # | Task | Place |
|---|------|-------|
| 46.1.1 | Define `MapId`, `MapDefinition`, catalog registry, getters | `shared/src/` |
| 46.1.2 | Expand Base (~4× area preferred); building + car; alias legacy exports | `shared` maps |
| 46.1.3 | Author 7 themed maps (AABB silhouettes, spawns, pickups) | `shared` maps / pickups |
| 46.1.4 | Optional `prop` kind blocking like walls; document door/window = gaps | `mapData` + collision consumers |

### Story 46.2 — As the server I own match mapId and broadcast map_state

| # | Task | Place |
|---|------|-------|
| 46.2.1 | Store mapId on Match; geometry/spawns/pickups/bounds from catalog | `server/src/match.ts` (+ registry/combat/bots as needed) |
| 46.2.2 | Create public/bots with mapId; join existing ignores client mapId | `matchManager.ts`, `index.ts` |
| 46.2.3 | `MAX_PUBLIC_PLAYERS_PER_MATCH = 8`; spawn separation still works | `shared`, `playerRegistry` |

### Story 46.3 — As a player I pick a map in the lobby

| # | Task | Place |
|---|------|-------|
| 46.3.1 | Protocol: LobbyMatchSummary + JoinMessage mapId; reject invalid | `shared/src/index.ts`, server join |
| 46.3.2 | UI picker + list shows map; Public + Bots use selection | `index.html`, `modeSelect.ts`, `main.ts` |

### Story 46.4 — Docs / regression / QA evidence

| # | Task | Place |
|---|------|-------|
| 46.4.1 | Regressions: capacity 8, map join/create, geometry authority smoke | `scripts/`, `package.json` |
| 46.4.2 | README Current status EPIC 46; document Base scale choice | `README.md`, handoff |
| 46.4.3 | Playwright/screenshots for picker + at least Base + one themed map | Tester + helper script OK |

## 6. Acceptance criteria

- [ ] Lobby shows map names; player can choose map for new public (and bots) games; listed matches show which map.
- [ ] 8 maps playable: Base + 7 named above (ids as specified).
- [ ] Base is larger (~4× area preferred), named Base, has enterable building (doors both sides + window holes) + car.
- [ ] New maps ~same size as expanded Base, thematically distinct layouts.
- [ ] Public matches allow **8** humans; spawn/pickups sane; `MIN_SPAWN_SEPARATION` workable.
- [ ] Server-authoritative geometry via catalog + `map_state`; no client-only walls that block differently.
- [ ] Typecheck/build + regressions updated (lobby capacity, map join) + Playwright/screenshots evidence.
- [ ] Merge + push (+ deploy to http://195.60.237.4/ if script available) after Critic APPROVED or Judge ALL_CLOSED.

## 7. Risks

| Risk | Mitigation |
|------|------------|
| Too many AABB boxes → perf | Prefer 2× linear; keep box counts reasonable; reuse materials |
| Spawn clustering with 8 players | ≥8 well-spread spawns; keep separation heuristic |
| Client hard-coded Base ground/collision | Always apply `map_state`; size ground from bounds |
| Join race with wrong mapId | Server owns map; ignore client mapId when joining existing match |
| Pickup imbalance | Scale pickup lists per map; Tester verifies density |

## 8. Branch / delivery

- Branch: `task/epic-46-multi-map-select-capacity` (or `feature/epic-46-multi-map-select-capacity`)
- One EPIC / one PR into `master`
- Chain: Programmer → Tester → Critic → (Judge) → Team Lead merge/push → `./scripts/deploy-production.sh`
- Do **not** commit unrelated dirty master files (ai-office policy edits, other EPICs) unless required for this EPIC
