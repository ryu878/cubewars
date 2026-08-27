# EPIC 53 — Programmer assignment (Team Lead → Pusya)

## Branch / worktree

- Create from current `master` (tip should include EPIC 52 merge `5b4a996` or later).
- Branch: `feature/epic-53-inventory-grid-hero-preview`
- Preferred worktree: `/home/dmitry/Documents/Projects/Python/cubewars/.claude/worktrees/epic-53-inventory-grid-hero-preview`
- Spec (authoritative): `docs/tasks/epic-53-inventory-grid-hero-preview.md` — copy/sync into worktree.

## Environment

`export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"` or `source ~/.nvm/nvm.sh`

## Must deliver

### Story A — 6×5 grid + migration

1. `INVENTORY_GRID` → `{ cols: 6, rows: 5, cells: 30 }`; `ECONOMY_CAPS.inventoryCells` → `30`.
2. Server: validate move/place/assign against new grid; 2-cell same-row footprints still legal on 6 cols.
3. **Migration (mandatory strategy in handoff):** on load for both scopes — detect invalid/OOB/overlap anchors under 6×5; preserve valid non-overlapping items; deterministically re-pack the rest; **never delete** overflow — `slotAnchor: null` + Unplaced/Overflow UI; one-shot guard so null overflow does not infinite-loop `needsAutoPack`. Log shrink migrations.
4. Client: 6×5 CSS/grid rendering; update aria/meta/caps strings (no stale 8×8 / 64 / 0–63).

### Story B — Hero loadout preview

5. Right-side preview panel in shared `InventoryOverlay` (lobby + in-match, both pools).
6. Show: body/appearance colors (EPIC 33), equipped amulet tell, equipped pets (type/side/color + whether gems socketed), stats HP/Armor/Speed%/Damage% via existing shared aggregators (EPIC 51).
7. Reuse `remotePlayers.ts` / inventory appearance visual language (Three.js canvas **or** stylized 2D/CSS — your call; document why).
8. Layout must stay readable on laptop viewport (keep EPIC 43 side-by-side discipline).

### Story C — Docs + i18n

9. i18n EN/RU for new preview/overflow/aria strings.
10. Update About inventory section + Last updated; changelog entry; README if it still says 8×8.

### Delivery hygiene

11. Typecheck + client/server build (as applicable) green; update economy/grid regressions.
12. Playwright evidence under `qa-artifacts/epic-53/` (6×5 grid, hero preview with pets/amulet/stats, overflow if easy to fixture, laptop-ish viewport).
13. `docs/tasks/epic-53-programmer-handoff.md` (include **migration strategy** section); open PR to `master`.
14. Do **not** merge or deploy. Do not mix unrelated dirty parent files (favicons, `docs/ops/mail.md`, other worktrees, epic-51 leftovers unless required).

## Read first

- `ai-office/agents/programmer/role.mdc`
- `ai-office/global/{global-standards,handoff-contracts,english-only,security-baseline}.mdc`
- `ai-office/templates/programmer-handoff-template.md`
- `ai-office/policies/player-facing-docs.md`
- Spec: `docs/tasks/epic-53-inventory-grid-hero-preview.md`
- Grid: `shared/src/economy.ts` (`INVENTORY_GRID`, `cellsForAnchor`, ratings helpers)
- Pack: `server/src/economy/inventoryGrid.ts`, `store.ts` (`ensureInventoryPacked`)
- UI: `client/src/inventoryOverlay.ts`, `client/index.html` (`.inv-body`, `.inv-side`, `#inventoryGrid`)
- Visual reuse: `client/src/remotePlayers.ts` (avatar colors, companions, amulet)
- Locales: `client/src/locales/en.ts`, `ru.ts`

## Return summary (to Team Lead)

Branch, PR URL, HEAD SHA, grid constants changed, migration strategy summary + overflow behavior, preview approach (3D vs CSS), i18n keys added, docs touched, build/regression commands, handoff path, blockers.
