# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-25T18:25:00Z |
| Author (Pusya) | Programmer (Pusya) |
| Task / Story / EPIC | EPIC 43 — Inventory Cell Size, Icons, and Hover Tooltips (`docs/tasks/epic-43-inventory-icons-tooltips.md`) |
| Branch / commit / PR | `task/epic-43-inventory-icons-tooltips` (pushed to origin). Implementation: `0b16d78`. Handoff docs commits follow on the same branch. PR optional — Team Lead merges after chain. |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |
| Base SHA (`master` at branch creation) | `a6e7aceb98209f4d1981697b45ea4332ff489997` |

## What was done (brief)

1. Scaled `#inventoryGrid` from `min(480px, 100%)` to `min(960px, 95vw)` (~2× linear cell size); widened `#inventoryPanel` / raised max-height so the overlay still scrolls instead of clipping primary controls.
2. Replaced cryptic `ITEM_LABEL` abbreviations (`STM`/`PET`/…) with geometric CSS icons per `InventoryItemType` in grid cells, drag ghost, selected detail title, and equip rail; English display names + CSS hover/focus tooltips (`data-tooltip`) with useful detail (type, durability, egg timer, shard count, etc.).
3. Updated README Current status for EPIC 43. No server/economy/protocol changes.

## Changed files / areas

- `client/src/inventoryOverlay.ts` — `ITEM_DISPLAY_NAME`, `createItemIcon()`, tooltip/detail title helpers; grid/ghost/rail/details render paths
- `client/index.html` — inventory CSS: larger grid/panel, icon glyphs, type backgrounds for stim/kit/shards, CSS tooltips, rail/details icon row layout
- `README.md` — Current status EPIC 43
- `docs/tasks/epic-43-inventory-icons-tooltips.md` — EPIC spec (included in commit)
- `docs/tasks/epic-43-programmer-handoff.md` — this handoff

## How to verify (steps for Trusya)

1. Start client + server as usual; open inventory from lobby **Inventory** button (EPIC 42) and/or in-match with **I**.
2. Confirm grid cells are roughly twice as large as before (~115px vs ~56–60px on a wide viewport).
3. Confirm each bag item shows a distinct geometric icon — **no** primary cell text `STM`, `PET`, `AMU`, `SHD`, `KIT`, `EGG`, `GEM`.
4. Hover (and Tab-focus) an item: English tooltip appears (e.g. “Stimulator #…”, “Pet (type) #…”, egg timer, gem type/value, amulet durability, shard count).
5. Select items: detail title uses full English names (not `STM #id`); equip rail shows small icons + readable “Pet (…) / Amulet …” labels.
6. Smoke: drag-move, select, equip/unequip, hatch/stim, socket, repair, craft, discard still send the same `economy_*` intents (no protocol change).
7. Optional: light Playwright smoke already run by Programmer — `qa-artifacts/epic-43/inventory-icons-smoke.png` (git-ignored); cell ~115px, icons=7, no cryptic codes.

## Build and run

- Build command: `npm run typecheck` → **PASS**; `npm run build` → **PASS**
- Run command: standard client Vite + game server (same as prior EPICs)
- Expected smoke result: larger icon grid, English tooltips, no abbreviation labels in cells

## Cell size notes (AC measurement)

| | Grid CSS width | Approx cell linear (8×8, gaps) |
|--|----------------|--------------------------------|
| **Before** | `min(480px, 100%)`, gap 4px | ~(480 − 7×4) / 8 ≈ **56.5px** (~60px if counting gap inclusively) |
| **After** | `min(960px, 95vw)`, gap 6px | Measured Playwright @1400×900: grid **960px**, cell **115×115px** → ≈ **2.04×** vs 56.5px |
| **Compromise** | None — full ~2× linear kept; panel scrolls (`max-height: min(92vh, 980px)`) on shorter viewports |

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: N/A (client presentation only; existing economy status line unchanged)
- Key success messages: N/A

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: unchanged — all inventory mutations remain server-authoritative via existing `economy_*` messages
- What the client is allowed to predict/render only: icons, tooltips, layout sizing, display names only (no local bag mutation)

## Risks / known limitations

- On very narrow viewports the grid uses `min(960px, 95vw)` so cells shrink with viewport width (still ~2× vs the old `min(480px, …)` formula at the same vw).
- CSS tooltips on top-row items may clip under `#inventoryPanel { overflow: auto }`; `aria-label` still present for accessibility.
- Icon glyphs are simple CSS shapes — distinct by type + existing tinted backgrounds; not illustrated art assets.

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
