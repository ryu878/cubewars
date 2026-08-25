# EPIC 43: Inventory Cell Size, Icons, and Hover Tooltips

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

User ask (RU, 2026-08-25):

1. Make inventory grid “windows” (cells / item slots) roughly **2× larger**.
2. Stop showing cryptic short codes inside cells (e.g. `STM`, `PET`, `AMU`) — **draw / icon / visual** per item type instead.
3. On **hover**, show clear text of what the item is (full readable English name + useful detail if already available).

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Inventory Cell Size, Icons, and Hover Tooltips |
| **System goal** | Make the shared inventory overlay (`InventoryOverlay`) readable at a glance: larger grid cells, visual item glyphs instead of abbreviations, and English tooltips on hover — for both lobby (EPIC 42) and in-match use of the same overlay. |
| **Business/gameplay problem** | Players cannot tell what `STM` / similar codes mean; cells are small and hard to scan. |
| **Architectural role** | **Client UI only** (HTML/CSS/TS). No economy / protocol / server authority changes unless something unexpectedly blocks icon mapping (should not). |
| **Main components** | `client/src/inventoryOverlay.ts`, `client/index.html` (inventory CSS for `#inventoryGrid`, `.inv-cell`, `.inv-item`, equip rail), optionally selected-item detail panel consistency; `README.md` Current status. |
| **Stack** | Fixed project stack. Plain HTML/CSS/TS. No new UI framework, no emoji-heavy asset pipeline, no new npm dependencies. Prefer CSS/SVG/div colored shapes matching existing Roblox-like / low-poly inventory palette. |
| **Interaction** | Same overlay as EPIC 29 / 42. Equip rail and selected-item detail: improve icon+tooltip consistency if they still show STM-style codes; selected panel may keep (and should prefer) readable text. |

## 2. Current state (read before implementing)

- Grid: `#inventoryGrid` is `width: min(480px, 100%)`, `aspect-ratio: 1/1`, 8×8 with `gap: 4px` — cell linear size ≈ 480/8 ≈ 60px (minus gaps).
- Bag items render via `ITEM_LABEL` in `client/src/inventoryOverlay.ts`:

```ts
const ITEM_LABEL: Record<InventoryItemType, string> = {
  pet: "PET", egg: "EGG", gem: "GEM", amulet: "AMU",
  stimulator: "STM", repair_kit: "KIT", shard_stack: "SHD",
};
```

  These abbreviations are painted into `.inv-item-label` and drag ghost text.
- Equip rail already uses somewhat readable text (`pet.type #id`, amulet durability) — still improve with a small icon if easy; no cryptic STM required there today.
- Selected detail panel title still uses `ITEM_LABEL` (`STM #id`) — replace with full English names while keeping actions.
- Existing type-tinted backgrounds: `.inv-item-pet`, `.inv-item-egg`, etc. — keep / extend for icons.
- Meta lines (egg timers, counts) can remain as small secondary text **under** or beside the icon if they are numeric/timer, not type codes.

## 3. Design

### 3.1 Cell size (~2× linear)

- Prefer **~2× linear side** so windows are clearly bigger (user asked ~2× windows).
- Practical approach: scale `#inventoryGrid` width from ~480px toward ~960px (or `min(960px, 95vw)` / similar), keep `aspect-ratio: 1/1`, adjust overlay panel max-width/layout so lobby + in-match still fit without clipping primary controls.
- If layout breaks on common viewports, **√2 linear (~1.41×)** is an allowed compromise **only** with a documented reason in the Programmer handoff; do not silently leave cells at current size.
- Empty `.inv-cell` hit targets and multi-cell footprints must remain correct after resize (drag-drop still works).

### 3.2 Icons instead of short codes

- Replace `ITEM_LABEL` abbreviations in **grid cells** and **drag ghost** with a distinct visual glyph per `InventoryItemType`.
- Suggested mapping (Programmer may refine shapes/colors if clearer; names are AC for tooltips):

| Type | Visual idea (CSS/SVG/div) | Tooltip English name |
|------|---------------------------|----------------------|
| `pet` | Small companion cube / creature silhouette | Pet (+ type name if known, e.g. from `pet.type`) |
| `egg` | Oval / egg shape | Egg (+ timer detail if already shown in meta) |
| `gem` | Diamond / facet shape | Gem (+ gem type/value if available) |
| `amulet` | Pendant / circle with hole | Amulet (+ durability if available) |
| `stimulator` | Bolt / syringe / + timer mark (not “STM”) | Stimulator |
| `repair_kit` | Wrench / kit box | Repair kit |
| `shard_stack` | Stack of shards / crystals | Shards (or Shard stack) + count if available |

- No emoji as the primary glyph if it breaks Roblox-like look; simple geometric CSS/SVG is preferred.
- Grid cells must **not** show short codes like `STM`, `PET`, `AMU`, `SHD`, `KIT`, `EGG`, `GEM` as the main label.

### 3.3 Hover tooltips

- On hover (and preferably focus for a11y), show a clear English tooltip: full name + useful detail already available (id, pet type, gem type/value, durability, egg remaining time, shard count).
- Implementation: native `title` is acceptable minimum; a small CSS tooltip is better if cheap and readable. Prefer one consistent approach.
- Tooltips in **English** (engineering/player UI English for this product surface).

### 3.4 Equip rail + detail panel

- Selected-item detail: use full English names (e.g. “Stimulator #12”), not `STM #12`. Actions unchanged.
- Equip rail: if still cryptic anywhere, align with icons + readable labels; rail can keep longer text.

### 3.5 Out of scope

- Server/economy/protocol changes
- New item types, new assets pipeline, React/Vue, emoji sticker packs
- Redesigning auction/trade UIs
- Changing lobby Inventory button behavior (EPIC 42)

## 4. Architecture

```text
Same InventoryOverlay (lobby + in-match)
  → larger CSS grid / cells
  → renderIcon(itemType) instead of ITEM_LABEL abbreviation in cell + drag ghost
  → hover tooltip = full English label + meta
  → detail panel titles use full names
  → drag / select / equip / hatch / etc. unchanged (still send existing economy_* )
```

Server remains authoritative for all inventory mutations. This EPIC is presentation-only.

## 5. Stories / Tasks

### Story 43.1 — As a player I want larger inventory cells so items are easier to see and click

| # | Task | Place |
|---|------|-------|
| 43.1.1 | Scale inventory grid / cell linear size ~2×; adjust overlay layout for fit | `client/index.html` CSS (`#inventoryOverlay`, `#inventoryGrid`, `.inv-cell`, `.inv-item`) |
| 43.1.2 | Verify multi-cell footprints and empty drop targets still align after resize | `inventoryOverlay.ts` + CSS |

### Story 43.2 — As a player I want icons in cells instead of cryptic codes, with hover text explaining the item

| # | Task | Place |
|---|------|-------|
| 43.2.1 | Add full English display names + icon renderer per `InventoryItemType`; remove abbreviation as primary cell content | `client/src/inventoryOverlay.ts` (+ CSS in `index.html`) |
| 43.2.2 | Wire hover (and optional focus) tooltips with name + useful detail | same |
| 43.2.3 | Update drag ghost to use icon/visual, not `STM`-style text | same |
| 43.2.4 | Detail panel (+ equip rail if needed) use readable names / optional icons | same |
| 43.2.5 | README Current status note for EPIC 43 | `README.md` |

**Branch:** `task/epic-43-inventory-icons-tooltips`  
**Base:** `master` (tip at task start — Programmer records SHA)

## 6. Acceptance criteria

- [ ] Inventory grid cell linear size is roughly **2×** previous (document measured before/after in handoff); √2 compromise only with written reason if layout breaks
- [ ] Grid cells show **icons/visuals**, not short codes (`STM`, `PET`, `AMU`, `SHD`, `KIT`, `EGG`, `GEM`) as the primary label
- [ ] Hover tooltip shows clear **English** labels (e.g. “Stimulator”, pet type name, gem, amulet, egg, repair kit, shards) plus useful detail when already available
- [ ] Drag, select, equip, hatch, socket, repair, craft, discard still work; **no** economy logic / protocol change
- [ ] Same overlay improved for **lobby and in-match**
- [ ] `npm run typecheck` / `npm run build` PASS
- [ ] README Current status updated for EPIC 43

## 7. Risks

- Larger grid overflows small laptop viewports — use `min()` / flex wrap / scroll on overlay body if needed; do not shrink back to old size without documenting.
- Icons too similar across types — keep distinct silhouettes and existing type background colors.
- Accidental server/protocol edits — out of scope; reject in review if present without need.
- Native `title` tooltips delayed — acceptable; prefer CSS tooltip if time allows.

## 8. Sign-off

- **Author/Approval:** Team Lead (Tusya), 2026-08-25
- **Assignee:** Programmer (Pusya)
