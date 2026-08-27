# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-27 |
| Author (Pusya) | Pusya |
| Task / Story / EPIC | EPIC 53 — Inventory 6×5 grid + hero loadout preview |
| Branch / commit / PR | `feature/epic-53-inventory-grid-hero-preview` / `9e563d4` / (PR pending) |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. Shrunk shared bag grid to **6×5 / 30 cells** (`INVENTORY_GRID`, `ECONOMY_CAPS.inventoryCells`) and updated server place/move validation + client CSS/aria/caps.
2. Implemented **preserve-then-pack shrink migration** on economy doc load (both scopes) with **never-delete overflow** (`slotAnchor: null` + Unplaced UI) and `inventoryGridVersion: 2` one-shot guard.
3. Added right-side **CSS/2D hero loadout preview** (body colors, amulet tell, equipped pets with gem sockets, HP/Armor/Speed%/Damage% via `aggregateEquippedRatings` / `formatRatingGrant`).
4. EN/RU i18n, About + changelog + README player-facing copy; regression + Playwright evidence.

## Migration strategy (mandatory)

**Goal:** no silent item loss when shrinking from legacy 8×8 (0–63) to 6×5 (0–29).

**On `loadDoc` (deathmatch + sandbox):** `ensureInventoryPacked` calls `needsInventoryGridMigration(doc)`.

**Trigger when:**
- `doc.inventoryGridVersion !== 2` (missing/legacy), **or**
- any finite bag anchor is invalid under current helpers (`cellsForAnchor === null`) **or** overlaps another bag item.

**Algorithm (`migrateInventoryGridShrink`):**
1. Collect bag packables (unequipped pets/amulets, unsocketed gems, eggs, stims, kits, shard stack). Equip-rail / socketed items stay off-grid (`slotAnchor: null`).
2. Sort footprint desc → type → id (deterministic).
3. **Preserve** items whose current anchor is fully valid and non-overlapping with already-preserved cells.
4. **Re-pack** the rest via `findFirstFreeAnchor` into remaining free cells (same order).
5. **Overflow:** if no fit, set `slotAnchor: null` — **never delete**. Log  
   `[economy] inventory grid shrink migration for {key} [{scope}] preserved=P relocated=R overflow=N`.
6. Set `inventoryGridVersion = 2` and save.

**One-shot guard:** after version 2, `needsAutoPack` / `needsInventoryGridMigration` ignore intentional null overflow anchors (only re-run on invalid/overlapping *finite* anchors). Prevents infinite pack loops.

**Client overflow UX:** Unplaced list above the grid; select → existing discard/equip/socket actions; click empty cell to `economy_move_item` onto a free anchor.

## Preview approach

**Stylized 2D/CSS** (not a Three.js canvas): reuses EPIC 33 `AVATAR_COLOR_PALETTE` / `resolveAvatarColor`, inventory pet icons (`createPetIcon`), and a gold pendant tell matching remote-avatar language — avoids a second art system and canvas lifecycle cost while the overlay is closed.

## Changed files / areas

- `shared/src/economy.ts`, `shared/src/index.ts` — grid 6×5, `INVENTORY_GRID_VERSION`, null-capable egg/stim/kit DTOs
- `server/src/economy/inventoryGrid.ts`, `document.ts`, `store.ts`, `index.ts` — migration + load-path
- `client/src/inventoryOverlay.ts`, `client/index.html` — 6×5 CSS, overflow, hero preview
- `client/src/locales/en.ts`, `ru.ts` — new strings
- `client/public/about.html`, `changelog.json`, `README.md`
- `scripts/regression-economy-inventory.ts`, `scripts/qa-epic53-programmer-playwright.mjs`
- Spec/assignment synced: `docs/tasks/epic-53-*.md`

## How to verify (steps for Trusya)

1. `npm run typecheck` and `npm run build` (from worktree with deps installed).
2. `npm run regression:economy-inventory` — expect `[economy-inventory] PASS` (includes shrink + overflow unit cases).
3. `node scripts/qa-epic53-programmer-playwright.mjs` — screenshots under `qa-artifacts/epic-53/` (6×5 cells, hero pets/amulet/stats, laptop 1280×720).
4. Manual: lobby Deathmatch Inventory with a seeded loadout — confirm grid 6×5, hero panel, Unplaced list if bag overfilled via migration.

## Build and run

- Build command: `npm run typecheck && npm run build`
- Run command: `npm run regression:economy-inventory` ; `node scripts/qa-epic53-programmer-playwright.mjs`
- Expected smoke result: typecheck/build green; inventory regression PASS; Playwright notes show `cellCount=30`, amulet + dog/cat hero slots, caps `/30`

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout on profile load / leaderboard hydrate
- Key success messages: `[economy] inventory grid shrink migration for … preserved=… relocated=… overflow=…`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: all `slotAnchor` place/move/pack/migration; combat ratings aggregation for profile snapshots
- What the client is allowed to predict/render only: overlay layout, hero preview cosmetics, overflow list selection → intents only

## Risks / known limitations

- New grants still throw `inventory_full` when no free cell (existing); overflow nulls are primarily from shrink migration of already-owned items.
- Playwright seed may not always surface overflow UI (new grants refuse when full); overflow behavior is covered by `regression-economy-inventory.ts`.
- Leaderboard hydrate on a shared Redis may one-shot-migrate many legacy docs (expected).

## i18n keys added

`inv.gridAria` (updated), `inv.heroAria`, `inv.heroTitle`, `inv.heroStatHp|Armor|Speed|Damage`, `inv.heroSideLeft|Right`, `inv.heroSlot2Locked`, `inv.heroGemsSocketed`, `inv.overflowTitle`, `inv.overflowHint`, `inv.overflowCaps`

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
