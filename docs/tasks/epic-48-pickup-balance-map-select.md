# EPIC 48: Pickup Balance / Spread + Map Select Fix

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

User asks (RU, 2026-08-26), combined intent:

1. **Pickup balance / layout:** EPIC 47 put too many weapons on the map and they lie **one after another in a row**. Recalculate to an **optimal interesting** count of weapons, armor, health (and ammo as needed) — not a blind 4× dump. Spread pickups across the map (not clustered in lines). Change it.
2. **Map select still broken:** Whatever map the user picks, **Base always loads**. Fix for real (public + bots + ESC reload path). Find root cause — client not sending mapId, server ignoring it, catalog resolve failing, map_state not applied, stale join, etc. Add regression that fails if bots/public join with non-base mapId still gets Base geometry/bounds.

## Guidance (intake)

- Master tip is EPIC 47 merge `686d73e` — verify current state on `master` before changing.
- Prefer thoughtful density: roughly enough for **~8 players** without carpeting the floor. Programmer **must** justify counts in handoff (before/after).
- Spatial distribution: use map bounds / landmarks / sites so pickups are spread; avoid consecutive collinear stacks.
- Deploy https://cubewars.ru/ after merge if deploy path exists (`docs/ops/production-deploy.md`, `scripts/deploy-production.sh`).
- Standing ops: Critic APPROVED or Judge ALL_CLOSED → merge master + push + deploy.

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Pickup Balance / Spread + Map Select Fix |
| **System goal** | Playable, interesting pickup density with spatial spread; lobby map picker reliably loads the selected catalog map for public, bots, and ESC change/reload. |
| **Business/gameplay problem** | (1) EPIC 47 `densePickups` ~4× dump (16/16/12/12) walks a regular grid sequentially → weapons appear as collinear rows / carpet. (2) Despite EPIC 46/47 mapId work, players still land on Base for any picker choice — trust in multi-map is broken. |
| **Architectural role** | shared map pickup layouts (server-authoritative spawn lists); client join/leave/rejoin mapId plumbing; server match create/resolve; map_state broadcast; regressions. |
| **Stack** | Fixed project stack (Three.js/TS + Vite client, Node.js/TS + `ws` server, `shared/` protocol). AABB maps only. No Rapier. Plain HTML/CSS/TS UI. |
| **Main components** | `shared/src/maps/densify.ts` (+ map defs using it), `server/src/{index,match,matchManager}.ts`, `client/src/{main,modeSelect,pauseMenu,network}.ts`, `scripts/regression-epic48*.ts` (new or extend 46/47), Playwright QA as needed, README |
| **Interaction** | Client sends `join` with `mapId` → server creates/finds match with that map → `join_accepted` + `map_state` with that map’s geometry/bounds/pickups → client renders. ESC change-map: `leave_match` then rejoin with chosen `mapId`. |

## 2. Current state (intake notes)

### 2.1 Pickups (post–EPIC 47)

- `shared/src/maps/densify.ts` builds **16 weapon / 16 ammo / 12 health / 12 armor** (56 total) via `densePickups`.
- Candidates come from preferred centers then a **regular lattice** (`x += 12`, `z += 11`); `next()` takes points **in order** → same-category pickups (especially weapons first) form **visible rows**.
- Fallback far-corner packing can worsen clustering when clear pool is short.
- EPIC 46 baseline was ~4/4/3/3 (14 total) — too sparse after arena expansion; EPIC 47 overshot.

### 2.2 Map select

- Code on `master` (`686d73e`) already sends `mapId` for public/bots join and has bots regressions asserting `rust_canyon` `map_state`.
- User still reports **Base always** across picker paths — treat as **product bug still open**. Programmer must **find root cause on current master**, not assume EPIC 47 closed it.
- Investigate at least: client join payload / localStorage / DOM select value; public `findOrCreatePublicMatch` joining wrong existing Base match; bots create path; ESC `leave` + rejoin omitting or losing `mapId`; `map_state` applied late/overwritten; client rendering legacy `ARENA_*` / Base defaults; catalog id mismatch; stale matchId forcing existing Base lobby row.
- Fix must cover **public + bots + ESC reload/change-map**.

### 2.3 Out of scope

- New map themes / new map ids.
- Endless mode map picker (endless has no catalog map).
- Combat / weapon balance redesign beyond spawn counts/placement.
- Auth, changelog, ESC menu feature work (already EPIC 47) except as needed for change-map path correctness.

## 3. Design

### 3.1 Pickup counts (target band — Programmer justifies final numbers)

Guidance band for a ~184×104 arena sized for ~8 concurrent players (not a floor carpet):

| Category | EPIC 46 | EPIC 47 (current) | EPIC 48 target band |
|----------|---------|-------------------|---------------------|
| weapon   | 4       | 16                | **6–10** (mix rifle / grenade_launcher) |
| ammo     | 4       | 16                | **6–10** (match weapon mix) |
| health   | 3       | 12                | **4–8** |
| armor    | 3       | 12                | **4–8** |
| **total**| 14      | 56                | **~20–32** |

Handoff **must** document exact before/after counts per map (or shared densify output) and one-paragraph rationale.

### 3.2 Spatial distribution

- Replace “take next lattice cell” with placement that **spreads** across the playable area: prefer sites / landmarks / preferred centers, then fill with **spatially diverse** clear points (e.g. farthest-from-existing, quadrant/sector quotas, or shuffled stratified samples — Programmer chooses a simple, readable algorithm).
- **Hard requirement:** same-category pickups must not form an obvious consecutive collinear stack (no long weapon “runway”).
- Keep clearance from walls/crates/props (`isPickupClear`).
- Apply consistently to all catalog maps that use densify (Base + themed).

### 3.3 Map select fix

- Trace end-to-end for public, bots, and ESC change/reload.
- Root cause + fix documented in Programmer handoff.
- After fix: selecting a non-Base catalog map yields `join_accepted.mapId` and `map_state` geometry/bounds for **that** map (not Base).
- Joining an **existing** public match may still ignore client mapId (server map wins) — document; UI should not silently look broken (e.g. creating fresh when picker map has no open match — already intended by `findOrCreatePublicMatch`).
- Client must apply `map_state` for the joined map; must not leave Base geometry painted.

### 3.4 Regression

- Add (or harden) a regression that **fails** if bots **or** public create/join with a non-Base `mapId` still receives Base geometry/bounds (id prefixes / bounds identity — same spirit as EPIC 47 bots check, extended to public + ESC-equivalent rejoin if testable without browser).
- Keep existing EPIC 46/47 regressions green unless intentionally superseded (update assertions for new pickup counts).

## 4. Stories / Tasks

### Story 48.1 — Balanced pickup counts

**As a** player **I want** a sensible number of weapons/ammo/health/armor on each map **so that** fights stay interesting without carpeting the floor.

**Tasks:**

| # | Task | Place | Completion |
|---|------|-------|------------|
| 48.1.1 | Recalculate densify targets into the EPIC 48 band; document rationale | `shared/src/maps/densify.ts` (+ constants) | Counts in band; handoff before/after |
| 48.1.2 | Update any EPIC47_PICKUP_COUNTS / regression expectations | densify + `scripts/regression-epic47.ts` etc. | Tests match new counts |

### Story 48.2 — Spatial spread (no collinear dumps)

**As a** player **I want** pickups scattered across landmarks/sites **so that** weapons are not lined up in rows.

**Tasks:**

| # | Task | Place | Completion |
|---|------|-------|------------|
| 48.2.1 | Replace sequential lattice fill with spread-aware placement | `shared/src/maps/densify.ts` (+ preferred lists if needed) | No consecutive collinear same-category stacks; clearance kept |
| 48.2.2 | Optional light unit/regression: min pairwise distance or anti-collinear heuristic for weapons | `scripts/` or densify test | Fails on old “row dump” pattern |

### Story 48.3 — Map select works for real

**As a** player **I want** the lobby (and ESC) map I pick to be the map that loads **so that** Base is not forced every time.

**Tasks:**

| # | Task | Place | Completion |
|---|------|-------|------------|
| 48.3.1 | Root-cause on master: public, bots, ESC reload/change-map | client + server join/leave paths | Written root cause in handoff |
| 48.3.2 | Implement fix(es); ensure map_state applied | relevant modules | Non-Base maps load end-to-end |
| 48.3.3 | Regression: non-Base mapId must not yield Base geometry/bounds (public + bots; rejoin if feasible) | `scripts/regression-epic48*.ts` (or extend 46/47) | Test fails on Base-geometry regression |

### Story 48.4 — Docs / QA / delivery

| # | Task | Completion |
|---|------|------------|
| 48.4.1 | Typecheck/build; update README if player-facing behavior changed | Green checks |
| 48.4.2 | Programmer handoff + PR to `master` | Template filled; no merge/deploy by Programmer |

## 5. Acceptance criteria

- [ ] Pickup totals in ~20–32 band (or justified slight deviation); weapons/ammo/health/armor individually in guidance bands unless handoff explains.
- [ ] Before/after counts + rationale in Programmer handoff.
- [ ] Pickups spread across map; no obvious consecutive collinear weapon rows from densify.
- [ ] Clearance from solids preserved.
- [ ] Public join with non-Base mapId creates/joins that map (not silent Base) when creating/quick-joining.
- [ ] Bots join with non-Base mapId loads that map.
- [ ] ESC change/reload path loads selected non-Base map.
- [ ] Regression fails if non-Base join still gets Base geometry/bounds (bots + public).
- [ ] Existing relevant regressions updated and green; typecheck/build OK.
- [ ] After Critic APPROVED or Judge ALL_CLOSED: TL merges `master`, pushes, deploys https://cubewars.ru/.

## 6. Branch / delivery

- Branch: `task/epic-48-pickup-balance-map-select` (or `fix/epic-48-pickup-balance-map-select`).
- Prefer worktree under `.claude/worktrees/epic-48-pickup-balance-map-select` from current `master` (`686d73e` area).
- One PR into `master`.
- Programmer does **not** merge or deploy.
- Standing ops after gate: TL merge + push + `./scripts/deploy-production.sh`.

## 7. Risks

- Public lobby may still attach to an **existing** Base match if user clicks a lobby row / stale matchId — distinguish picker create path from “join listed match”.
- Over-aggressive anti-collinear rules could starve clear points on dense cover maps — keep clearance + fallbacks honest in handoff.
- Changing densify counts will break EPIC 47 count assertions — update deliberately.

## 8. Sign-off

- **Author:** Team Lead (Tusya) — 2026-08-26
- **Approved for Programmer**
