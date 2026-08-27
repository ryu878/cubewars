# EPIC 53 — Inventory 6×5 grid + hero loadout preview

**Status:** Approved for implementation (Team Lead)  
**Date:** 2026-08-27  
**Depends on:** EPIC 52 merged (`5b4a996`+)  
**Branch:** `feature/epic-53-inventory-grid-hero-preview`  
**Worktree (preferred):** `.claude/worktrees/epic-53-inventory-grid-hero-preview`

## User intent

1. **Shrink inventory bag grid** from **8×8 (64)** to **6 columns × 5 rows (30 cells)**. Update shared caps/grid constants, server validation, client CSS/layout, regressions. Migrate existing `slotAnchor` values that fall outside the new grid without silently losing items.
2. **Right side of inventory: hero loadout preview** — show the player as they currently look (body/appearance colors EPIC 33, equipped amulet tell, equipped pets with types/sides/colors + gem socket state) plus readable loadout stats (HP / Armor / Speed% / Damage% per EPIC 51). Same overlay for lobby + in-match; both economy pools (Deathmatch / Bots/Sandbox) when opened.

Prefer reusing client avatar/companion rendering from `remotePlayers.ts` / inventory appearance rather than a second art system. Three.js canvas **or** stylized 2D/CSS matching Roblox-like chrome — Programmer picks what fits inventory overlay.

---

## 1. EPIC

| Field | Description |
|-------|-------------|
| **Name** | Inventory 6×5 grid + hero loadout preview |
| **System goal** | Smaller, denser bag; at-a-glance loadout preview so players see avatar + pets + amulet + combat stats without hunting the rail |
| **Business/gameplay problem** | 8×8 grid is large for the overlay; loadout identity (colors/pets/amulet/stats) is split across rail, appearance section, and ratings text |
| **Architectural role** | **Shared** grid constants + footprint helpers; **server** authoritative anchors / migration / move validation; **client** CSS grid, overlay layout, preview render, i18n |
| **Main components** | `shared/src/economy.ts` (`INVENTORY_GRID`, `ECONOMY_CAPS.inventoryCells`), `server/src/economy/inventoryGrid.ts` + store load path, `client/src/inventoryOverlay.ts`, `client/index.html` inventory chrome/CSS, `remotePlayers.ts` (reuse patterns), locales en/ru, About + changelog, regressions |
| **Stack** | Fixed: Three.js/TS client + Vite; Node.js/TS + `ws` server; `@cubewars/shared`. No new frameworks. Optional small Three.js preview canvas inside inventory is in-stack |
| **Interaction** | Client never invents anchors. Server validates footprints (pets/amulets still **2 contiguous cells same row** — 6 cols still allows this). Preview is display-only from authoritative profile + avatar colors |

---

## 2. Architecture

```text
Redis economy doc (deathmatch | sandbox scopes)
        │
        ▼
  loadDoc → shrink migration (if needed) → save
        │
        ▼
  INVENTORY_GRID { cols:6, rows:5, cells:30 }
  cellsForAnchor / move / discard / assignBagAnchor
        │
        ▼
  economy_profile → InventoryOverlay
        ├── #inventoryGrid 6×5 CSS
        ├── .inv-side (equip rail + details — keep usable)
        └── #inventoryHeroPreview (NEW)
              ├── avatar body colors (EPIC 33)
              ├── amulet tell if equipped
              ├── pets slot1/2: type, side, color, gems socketed?
              └── stats: HP / Armor / Speed% / Damage% (aggregateEquippedRatings / EPIC 51)
```

### Footprint rule (verify, do not break)

- 1-cell: gem, egg, stimulator, repair kit, shard stack  
- 2-cell same-row: pet, amulet  
- With `cols: 6`, valid 2-cell left anchors are columns `0..4` (same as today with `cols - 2`).

### Migration strategy (mandatory — document in programmer handoff)

**Goal:** no silent item loss. Anchors outside `0..29`, row-wrap on 2-cell items, or overlaps after shrink must be fixed server-side on load for **both** economy scopes.

**Algorithm (required approach):**

1. **Detect** bag items (unequipped pets/amulets, unsocketed gems, eggs, stims, kits, shard stack) whose `slotAnchor` is invalid under the new grid (`!isValidAnchor` / `cellsForAnchor === null`) **or** whose cells overlap another bag item.
2. **Prefer preserve-then-pack:** keep items whose anchors remain fully valid and non-overlapping; collect the rest as **to-relayout**.
3. **Deterministic re-layout** of to-relayout items into free cells using existing pack order (footprint desc → type → id), via adapted `autoPackDocument` / `findFirstFreeAnchor` against the **new** 30-cell grid.
4. **Overflow (cannot fit in 30 cells):** **never delete**. Leave excess items with `slotAnchor: null` (still owned in the document). Surface them in the inventory UI as an **Unplaced / Overflow** list (i18n) with discard/equip/socket actions already available so the player can free space. Log once per migration: `[economy] inventory grid shrink migration … overflow=N`.
5. **One-shot guard:** introduce a small document marker (e.g. `inventoryGridVersion: 2` or equivalent) **or** extend `needsAutoPack` so shrink migration does not infinite-loop when overflow null-anchors remain. Document the chosen guard in the handoff.
6. Update `ECONOMY_CAPS.inventoryCells` from `64` → `30` to match the grid.

**Note:** Soft caps (stimulators/repair kits) can theoretically exceed 30 bag cells; overflow UI is expected for edge profiles. New grants still throw `inventory_full` when no free cell (existing behavior).

### Hero preview (design freedom within constraints)

Programmer designs layout. Critic judges readability on a common laptop viewport.

**Must show:**

| Signal | Source |
|--------|--------|
| Body / appearance colors | EPIC 33 avatar colors (same palette as appearance section / `remotePlayers`) |
| Equipped amulet | Visible tell when equipped (gold pendant pattern from remote avatars) |
| Equipped pets | Types, sides, colors; whether gems are socketed (count or per-slot indicator) |
| Stats | HP / Armor / Speed% / Damage% using shared `aggregateEquippedRatings` + EPIC 51 labeling (`formatRatingGrant` / existing ratings helpers) |

**Reuse:** extract or mirror mesh/CSS patterns from `client/src/remotePlayers.ts` (avatar parts, companion silhouettes, amulet). Do not invent a competing species art language.

**Placement:** right side of inventory body (with or beside existing `.inv-side` rail/details). Keep side-by-side laptop usability from EPIC 43 F-001 (grid + side panel in viewport; scroll only inside designated regions).

**Scope:** lobby inventory + in-match inventory (same `InventoryOverlay`). Both pools when opened.

---

## 3. Stories

### Story A — 6×5 grid + migration

**As a** player **I want** a 6×5 bag grid with my existing items safely re-laid out **so that** the inventory fits the overlay and I do not lose items after the shrink.

**Acceptance criteria:**

- [ ] `INVENTORY_GRID` is `{ cols: 6, rows: 5, cells: 30 }`; `ECONOMY_CAPS.inventoryCells === 30`
- [ ] Server validates move/place against 6×5; 2-cell same-row footprints still work
- [ ] Client CSS/`#inventoryGrid` renders 6×5; aria/copy updated (no stale "8×8")
- [ ] Migration on load for both scopes; no silent deletes; overflow strategy implemented + documented
- [ ] Regressions updated/green for grid/packing/move

### Story B — Hero loadout preview panel

**As a** player **I want** a right-side preview of my avatar loadout **so that** I can see colors, amulet, pets/gems, and combat stats at a glance.

**Acceptance criteria:**

- [ ] Preview shows body colors, equipped amulet tell, equipped pets (type/side/color + gem socket state), and HP/Armor/Speed%/Damage%
- [ ] Reuses remote/inventory visual language (not a second art system)
- [ ] Works in lobby + in-match; Deathmatch + Bots/Sandbox pools
- [ ] Readable on laptop viewport with existing side-by-side inventory chrome
- [ ] New UI strings i18n EN + RU

### Story C — Player-facing docs

**As a** player **I want** About/Changelog to mention the smaller bag and loadout preview **so that** docs match the live game.

**Acceptance criteria:**

- [ ] `client/public/about.html` updated (inventory section); Last updated bumped
- [ ] `client/public/changelog.json` entry (newest first)
- [ ] README inventory mentions updated if they still say 8×8 / 0–63

---

## 4. Tasks

| # | Task | Expected result | Place | Done when |
|---|------|-----------------|-------|-----------|
| 53.1 | Shrink shared grid + caps | `INVENTORY_GRID` 6×5/30; `inventoryCells: 30`; comments | `shared/src/economy.ts` | Typecheck; helpers use new bounds |
| 53.2 | Server migration + validation | Shrink detect/repack/overflow + one-shot guard; move/assign use 30 cells | `server/src/economy/inventoryGrid.ts`, `store.ts` | Load both scopes; log; no deletes |
| 53.3 | Client grid CSS/layout | 6×5 grid UI; caps/meta/aria; overflow list if needed | `inventoryOverlay.ts`, `index.html` | Visual 6×5; place/move OK |
| 53.4 | Hero preview panel | Avatar + amulet + pets/gems + stats; layout design | `inventoryOverlay.ts`, HTML/CSS, optional preview module | AC Story B |
| 53.5 | i18n EN/RU | New strings for preview + overflow + aria | `locales/en.ts`, `ru.ts` | Both locales |
| 53.6 | About + changelog + README | Player-facing docs | `about.html`, `changelog.json`, `README.md` | Policy satisfied |
| 53.7 | Regressions + Playwright | Update economy/grid tests; screenshots | `scripts/`, `qa-artifacts/epic-53/` | Green + evidence |
| 53.8 | Handoff + PR | Programmer handoff; PR to `master` | docs/tasks + gh | **Do not merge/deploy** |

---

## 5. Acceptance Criteria (EPIC-level)

- Grid is **6×5**; items place/move correctly; migration safe (no silent loss)
- Right panel shows recognizable hero + amulet + pets/gems + stats + colors
- Layout readable on laptop viewport (EPIC 43 side-by-side discipline)
- Typecheck/build + regressions + Playwright screenshots
- About + changelog updated

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Profiles with bag occupancy > 30 cells | Overflow list; never delete; log |
| Infinite re-pack loop on null overflow anchors | Version marker / needsAutoPack guard |
| Preview duplicates Three.js cost | Single small canvas or CSS composition; pause when overlay closed |
| Laptop crowding (grid + preview + rail) | Scroll regions; Critic readability gate |
| Stale "8×8" / "0–63" copy | Grep client/README/About/tests |

---

## 7. Out of scope

- Changing pet/amulet footprint rules (still 2-cell same-row)
- Changing ECONOMY_CAPS for pets/eggs/gems/amulets counts (only `inventoryCells`)
- New combat math (display uses existing EPIC 51 aggregators)
- Merge/deploy (Team Lead after Tester PASS + Critic APPROVED)

---

## 8. Delivery / ops

Standing ops after chain: merge to `master` → `./scripts/deploy-production.sh` → https://cubewars.ru/

---

## Sign-off

- **Specification (author):** Team Lead (Tusya) — 2026-08-27  
- **Approval (Team Lead):** Approved for implementation  
- **Assignee:** Programmer (Pusya)
