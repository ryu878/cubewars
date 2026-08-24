# EPIC 29: Inventory Grid UI (8×8)

Spec format per `ai-office/task-intake.md`.  
Product TZ: `docs/product/emerald-wasteland-economy-tz-v2.1.md` §2.9, §4.5.  
Depends on: `task/epic-28-lobby-emerald-lore` (economy stack through EPIC 27 Redis).  
**User roadmap:** Sprint-2 inventory UI after lobby lore.

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Inventory Grid UI (8×8) |
| **System goal** | Replace the list-style pets panel with an authoritative **8×8 inventory grid** plus equip/incubation affordances, so players manage eggs, pets, gems, amulets, stimulators, shards, and repair kits spatially. |
| **Business/gameplay problem** | TZ requires 64-cell inventory with footprints; current `PetsPanel` is a vertical list without grid packing or discard. |
| **Architectural role** | shared protocol + server Redis economy (slot layout) + client HTML/CSS/TS UI |
| **Stack** | Fixed cubewars stack + Redis economy store; no React |
| **Interaction** | Extends `economy_profile` with slot positions; new move/discard intents; existing hatch/equip/socket/repair stay server-authoritative |

## 2. Design decisions

### 2.1 Grid model (server-authoritative)

- Grid: **8×8 = 64** cells, indices `0..63` row-major (`row = floor(i/8)`, `col = i%8`).
- Footprints (TZ):
  - **1 cell:** gem, egg, stimulator, repair kit, shard stack (one stack object)
  - **2 cells:** pet, amulet — must occupy **two contiguous cells** in the **same row** (horizontal pair). Anchor = left cell index; right = anchor+1; reject wrap to next row (`col` must be 0–6).
- Shard stack remains a single inventory item with `count` 1–10 (not 10 separate cells).
- Equipped pets/amulets still count toward **caps** but may be shown in dedicated **equip slots** outside the 64 grid (recommended) **or** marked on-grid with an “equipped” badge — **Team Lead choice: equip slots outside the grid** (cleaner UX). Unequipped items must live on the grid.
- Every bag item has `slotAnchor: number` (0–63) persisted inside the Redis economy document.
- On grant (kill drop / craft / hatch leftover): server finds first free fit for footprint; if none → existing overflow→gold path (EPIC 26).
- On hatch: egg cell freed; new pet placed in first free 2-cell fit (or stay blocked if no space — hatch already blocked by pet cap; also block if no 2-cell free even under cap).

### 2.2 Protocol

Client → server (validate ownership, geometry, caps):

- `economy_move_item` `{ itemType, itemId, toAnchor }` — relocate; reject overlap / OOB / bad footprint
- `economy_discard_item` `{ itemType, itemId }` — **destroy forever** (ground drop deferred to EPIC 30)
- Existing: hatch, stim, equip/unequip pet/amulet, socket/unsocket, craft, repair

Server → owner:

- Extend `economy_profile` (and action results) so each bag item includes `slotAnchor`
- Equip panel snapshot unchanged in spirit (ratings, slot2Enabled, counts)

### 2.3 Client UI (toggle **I** and keep **P** as alias)

- Full-screen or large overlay: **8×8 grid** + **equip column** (pet slot 1, pet slot 2 if amulet, amulet slot) + gold/ratings/caps summary.
- Cells show icon/label + short meta (egg countdown / ready; pet type+value; gem type+value; amulet durability; shard count; stim/kit).
- **Drag-and-drop** move (pointer events) sending `economy_move_item`; server echo refreshes layout (no optimistic lie that survives reject).
- Context menu or action buttons on selection: Use (hatch/stim/repair/equip/socket as applicable), Discard (confirm).
- Incubation: progress bar or `mm:ss` / `Xh Ym` from server `hatchDeadlineMs` (client clock only for display; ready gated server-side).
- Replace or absorb `#petsPanel` list UI — do not leave two competing managers. Migrate actions into the inventory overlay.
- Plain HTML/CSS/TS; match dark HUD palette; English chrome labels OK; no new framework.

### 2.4 Persistence

Slot anchors stored in Redis economy JSON documents (same profile keys as EPIC 27). Survives restart with AOF. Migration: on load, if items lack `slotAnchor`, **auto-pack** once and save.

### 2.5 Out of scope

- Drop item on map / 60s pickup (EPIC 30)
- Auction / trade listing from context menu (EPIC 30) — omit “Sell” for now
- OBS, auth, visual 3D pet models in world

## 3. Stories

### Story 29.1 — Server grid packing & move/discard
As a server I want durable slot anchors and validated moves so inventory layout cannot be cheated.

### Story 29.2 — Inventory overlay UI
As a player I want an 8×8 grid with drag-move, equip rail, and egg timers so I can manage my wasteland gear.

### Story 29.3 — Action parity
As a player I want all former pets-panel actions available from the inventory UI.

## 4. Tasks

| # | Task | Place |
|---|------|-------|
| 29.1 | Shared types: itemType enum, footprint helpers, protocol messages | `shared/` |
| 29.2 | Redis store: slotAnchor fields, auto-pack, findFit, move, discard, grant placement | `server/src/economy/` |
| 29.3 | WS handlers for move/discard; profile payloads include anchors | `server/` |
| 29.4 | Client inventory overlay (grid, DnD, equip, timers, actions) | `client/` |
| 29.5 | Retire/redirect old pets list panel; keybind I (+ P alias) | `client/` |
| 29.6 | `regression:economy-inventory` — pack, move reject overlap, discard, hatch placement | `scripts/` |

**Branch:** `task/epic-29-inventory-grid`  
**Base:** `task/epic-28-lobby-emerald-lore`

## 5. Acceptance criteria

- [x] `npm run typecheck` / `build` PASS
- [x] Prior economy regressions still PASS (gold/pets/gems/persistence/redis-safety as applicable — redis-safety fails in this local environment on a pre-existing `better-sqlite3` native-binding/toolchain issue, confirmed unrelated to this diff: zero dependency files changed across all EPIC 29 commits)
- [x] `npm run regression:economy-inventory` PASS
- [x] Profile items have stable anchors after restart (Redis)
- [x] Client shows 8×8 grid; drag move works; illegal moves rejected by server
- [x] Egg incubation progress visible; hatch/stim/equip/socket/repair/craft reachable
- [x] Discard removes item permanently (server)
- [x] Caps + footprint rules enforced; no two items overlapping cells
- [x] QA screenshots `qa-artifacts/epic-29/`

## 6. Risks

- DnD UX edge cases on touch — mouse/pointer primary; touch best-effort
- Auto-pack on legacy profiles may reshuffle once — log once per profile

## 7. Sign-off

- **Author/Approval:** Team Lead (Tusya), 2026-08-24  
- **Assignee:** Programmer (Pusya)
