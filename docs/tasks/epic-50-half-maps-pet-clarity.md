# EPIC 50 — Half-Size Maps + Pet Inventory Clarity & Type Icons

**Status:** Approved for implementation (Team Lead)  
**Date:** 2026-08-26  
**Depends on:** EPIC 49 (palettes / thematic props / fog walls) — merge tip `ca1b79e`+

## User intent

1. **Maps feel too large** — shrink catalog (and endless, if it shares the same scale constants) to about **half linear size** on X/Z so arenas feel clearly half as wide/deep. Prefer **linear scale ≈ 0.5** on bounds, geometry, spawns, pickups (not √½ area-only). Adjust `WALL_HEIGHT` only if needed for proportion; **keep fog-fade walls**; keep thematic palettes/props readable; re-validate pickup clearance/spread after scale.
2. **Inventory pets are cryptic** — clicking a pet must show **readable characteristics** (e.g. `+156 Armor`), not `dog 156`. Equipped rail/detail must show **what the pet grants**; socketed **gems** must show **each contribution + totals**. **Icons must match pet type** (dog/cat/bird/lion) — current square-with-two-holes reads like a pig snout.

---

## 1. EPIC

| Field | Description |
|-------|-------------|
| **Name** | Half-size maps + pet detail clarity & species icons |
| **System goal** | Arenas play at ~½ linear footprint with consistent collision/visuals; inventory pets communicate real economy ratings and species clearly. |
| **Business/gameplay problem** | Maps feel oversized after EPIC 46–49 scale-up; pet UI still shows cryptic `type baseValue` and a generic “pig snout” glyph. |
| **Architectural role** | shared map catalog scale (authority for collision/hitscan/pickups); client themes follow shared boxes; client inventory display uses shared economy formulas for labels only |
| **Main components** | `shared/src/maps/{types,primitives,base,themedMaps,densify}.ts`; client `mapThemes` / `renderMapGeometry` (no palette rewrite unless scale breaks readability); `client/src/inventoryOverlay.ts` + `client/index.html` pet CSS/SVG; `shared/src/economy.ts` (`PET_TYPE_RATING`, `aggregateEquippedRatings`, slot fractions) |
| **Stack** | Fixed: Three.js/TS client + Vite; Node/TS `ws` server; `shared/` protocol. No Rapier. No UI framework. Procedural AABB maps only. |
| **Interaction** | Server ships scaled shared geometry via `map_state`; client renders same boxes + existing themes. Economy numbers remain server-authored in `economy_profile`; client may re-derive display lines with shared pure functions already used for combat ratings — **never invent fake stats**. |

---

## 2. Architecture

### Story A — Map linear scale ≈ 0.5

```text
STANDARD_MAP_BOUNDS (±92×±52)  →  ×0.5  →  (±46×±26)   [target]
MapBox centers/sizes on X/Z    →  ×0.5
spawnPoints / pickup positions →  ×0.5
Y / WALL_HEIGHT                →  keep unless proportion clearly broken
fog-fade wall materials        →  keep (EPIC 49)
palettes / prop id prefixes    →  keep readable after scale
densify / isPickupClear        →  re-run / re-validate clearance + EPIC 48 spread
```

**Preferred approach:** introduce an explicit shared constant (e.g. `MAP_LINEAR_SCALE = 0.5` or document the new `STANDARD_MAP_BOUNDS` as the half-size target) and scale **all catalog map X/Z geometry, spawns, and pickups** consistently so server collision, client meshes, and prediction stay aligned. Do **not** scale only the client.

**Authority rules:**

- Blocking geometry stays in shared `MapBox[]`.
- Client themes remain visual-only.
- Endless mode: if it uses the same bounds/scale helpers, keep fair and consistent; if endless is procedurally independent, document what changed.

**Playability after scale:**

- Spawns remain clear of walls/crates.
- Pickup clearance (`isPickupClear` / densify) still passes; preserve EPIC 48 balanced counts/spread intent (may need densify param tweaks if pools shrink).
- Fog-fade taller walls remain; do not regress EPIC 49 wall height dissolve unless proportion requires a small `WALL_HEIGHT` tweak (document if changed).

### Story B — Pet clarity + type icons

```text
economy_profile (server) ──► InventoryOverlay render
                                │
                                ├─ species primary axis via PET_TYPE_RATING
                                │    dog→armor, cat→health, bird→speed, lion→damage
                                ├─ readable labels: "+N Armor" / "+N HP" / "+N Speed" / "+N Damage"
                                ├─ equipped rail: what slot grants (slot fraction applied)
                                ├─ gems: each gem contribution + totals
                                └─ icon: distinct glyph per PetType (not generic snout)
```

**Display rules (must match shared math):**

- Primary pet contribution uses `baseValue` on the species axis (`PET_TYPE_RATING`).
- When showing **equipped** grant, apply slot fraction (`PET_COMBAT.SLOT1_FRACTION` / `SLOT2_FRACTION`) the same way `aggregateEquippedRatings` does — floor rules included.
- Socketed gems: show each gem’s typed bonus; show **totals** (pet primary + gems, after slot fraction when equipped context).
- Prefer importing shared helpers / constants; if a small pure display helper is added in `shared/`, keep it side-effect free and covered by existing economy tests or a tiny unit test.
- Do **not** invent combat multipliers or alternate formulas on the client.

**Icon rules:**

- Replace the current `.inv-icon-pet` two-eye square with **four distinct** CSS/SVG icons for `dog` | `cat` | `bird` | `lion`.
- Icons used in bag cells, equip rail, drag ghost, and detail header where pet glyphs appear.
- Must remain readable at small rail size; no external image asset pipeline required (inline SVG or CSS shapes OK).

---

## 3. Stories

### Story 50.1 — Half-size catalog maps (linear ≈ 0.5)

**As a** player **I want** maps about half as wide and deep **so that** fights feel tighter and traversal is shorter.

**Acceptance:**

- [ ] Catalog maps use ~**0.5 linear** X/Z scale vs pre-EPIC-50 `STANDARD_MAP_BOUNDS` (±92/±52) — target ≈ ±46 / ±26 (or documented equivalent).
- [ ] All map boxes, spawn points, and pickups scaled consistently in **shared** geometry (server collision matches client).
- [ ] `WALL_HEIGHT` / fog-fade walls preserved unless a documented small proportion tweak is needed.
- [ ] Thematic palettes and prop silhouettes remain readable (not crushed into unreadable mush).
- [ ] Pickup clearance + spread re-validated (EPIC 48 intent preserved).
- [ ] Typecheck/build + map regressions green; Playwright wide shots of multiple maps under `qa-artifacts/epic-50/`.

### Story 50.2 — Pet characteristics, equip grants, gem totals, type icons

**As a** player **I want** clear pet stats and species icons **so that** I understand what each pet and gem gives me.

**Acceptance:**

- [ ] Selecting a pet shows readable primary grant (e.g. `+156 Armor` for dog), not cryptic `dog 156`.
- [ ] Label axis matches `PET_TYPE_RATING` (dog armor, cat health/HP, bird speed, lion damage).
- [ ] Equipped rail / detail shows what the equipped pet **grants** (slot fraction applied).
- [ ] Socketed gems list **each** contribution and a **total** for the relevant axes.
- [ ] Bag / rail / ghost icons differ by `PetType` and no longer look like a pig snout.
- [ ] Numbers come from server profile fields + shared formulas only — no fake stats.
- [ ] Playwright / screenshot evidence of detail panel + equip rail + four species icons.

---

## 4. Tasks

| # | Task | Expected result | Place | Completion |
|---|------|-----------------|-------|------------|
| 50.1.1 | Halve map linear X/Z scale in shared catalog | Bounds + geometry + spawns + pickups consistent at ~0.5 | `shared/src/maps/*`, tests | Bounds/docs + regressions |
| 50.1.2 | Re-validate densify/clearance after scale; tweak if needed | Pickups still clear and spread | `densify.ts`, map defs | Clearance checks pass |
| 50.1.3 | Confirm client themes/fog walls still work on scaled boxes | Visual OK, fog walls kept | `mapThemes.ts`, `main.ts` | Screenshots |
| 50.2.1 | Pet detail + rail copy using shared rating rules | Readable `+N <Stat>` + gem lines + totals | `inventoryOverlay.ts`, optional shared helper | AC Story 50.2 |
| 50.2.2 | Per-type pet icons (dog/cat/bird/lion) | Distinct glyphs at bag + rail sizes | `inventoryOverlay.ts`, `index.html` CSS/SVG | Visual AC |
| 50.3 | Handoff + PR | Branch, handoff doc, PR to `master` | `docs/tasks/epic-50-*` | Handoff complete |

---

## 5. Risks

| Risk | Mitigation |
|------|------------|
| Hardcoded absolute coordinates missed when scaling | Prefer central scale / bounds constant; grep for ±78/±92-class literals; run map regressions |
| Pickups too dense / blocked after shrink | Re-run densify / adjust counts carefully; keep EPIC 48 balance intent |
| Client-only map shrink → desync | Scale shared catalog only; never client-only transforms for collision boxes |
| Display math drifts from combat | Import `PET_TYPE_RATING` / slot fractions / same floor rules as `aggregateEquippedRatings` |
| Icons unreadable at 16px | Design for small size; Tester screenshot both bag and rail |

---

## 6. Out of scope

- New pet species or economy balance retunes (beyond display).
- Reworking auction UI (unless it reuses the same icon helper — optional reuse OK).
- New map themes / additional maps.
- Client-authoritative ratings.

---

## 7. Deploy

Standing ops: after Tester PASS + Critic APPROVED (or Judge ALL_CLOSED) + TL merge approve → merge to **`master`** → `./scripts/deploy-production.sh` → https://cubewars.ru/

---

## 8. Sign-off

- **Specification (author):** Team Lead (Tusya) — 2026-08-26
- **Approval (Team Lead):** Approved for implementation
- **Assignee:** Programmer (Pusya)
