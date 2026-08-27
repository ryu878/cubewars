# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 53 — Inventory 6×5 grid + hero loadout preview
- Diff / PR reference: branch `feature/epic-53-inventory-grid-hero-preview` @ `437bb11ee75bcfbaed3b7cbe28c312117536a747` vs `master` (implementation pin `38133ec` / core `9e563d4`; compare https://github.com/ryu878/cubewars/compare/master...feature/epic-53-inventory-grid-hero-preview?expand=1)
- Tester PASS report reference: `docs/tasks/epic-53-tester-report.md` (PASS; verified against pin `38133ec`, report commit `437bb11`)
- Iteration: 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff --stat master...HEAD` — 19 files, +1733/−207; core in `shared/src/economy.ts`, `server/src/economy/inventoryGrid.ts` + `store.ts`, `client/src/inventoryOverlay.ts`, `client/index.html` |
| Tester PASS report matches this commit | PASS | Tester Meta cites implementation pin `38133ec…`; HEAD `437bb11` is docs-only Tester report on top of that pin |
| Every acceptance criterion traceable to a change or explicit note | PASS | Story A: `INVENTORY_GRID` 6×5/30 + `inventoryCells: 30` (`shared/src/economy.ts`); migration + version guard (`inventoryGrid.ts` `migrateInventoryGridShrink` / `needsInventoryGridMigration`); client CSS `repeat(6)`×`repeat(5)` (`index.html` ~1149–1152); regressions. Story B: hero CSS preview + stats (`inventoryOverlay.ts` `renderHeroPreview`). Story C: About/changelog/README |
| Scope matches the task (no unexplained extra changes) | PASS | Grid shrink + migration + hero preview + i18n/docs/QA only; no stack substitutions |
| Gameplay evidence present (player-facing tasks only) | PASS | Critic opened `qa-artifacts/epic-53/01`–`04` + `notes.txt` (`cellCount=30`, amulet/pets/stats) |

- Gate overall: PASS → continue checklist

## Verdict

- `APPROVED`
- One-line rationale: Diff delivers server-authoritative 6×5 shrink (preserve-then-pack, never-delete overflow, `inventoryGridVersion: 2`) and a readable CSS hero loadout panel; opened screenshots `01`/`02`/`04` show 30-cell grid, amulet/pets/gems/stats, and laptop side-by-side layout without inventing client anchors.

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | PASS | — | `INVENTORY_GRID` `{cols:6,rows:5,cells:30}` + `ECONOMY_CAPS.inventoryCells === 30` + `INVENTORY_GRID_VERSION === 2` (`shared/src/economy.ts`); migrate preserve/reloc/overflow (`inventoryGrid.ts` ~171–219); client `#inventoryGrid` 6×5 + overflow list (`index.html` ~2098–2108); Critic re-ran `npm run regression:economy-inventory` → PASS |
| 2 | Server authority for gameplay-relevant state | PASS | — | `moveItem` validates `isValidAnchor`/`canPlaceAt` then `setItemAnchor` (`store.ts` ~1866–1888); migration only on `loadDoc` → `ensureInventoryPacked` (`store.ts` ~512–530, ~560–567); client sends `economy_move_item` intents only (`inventoryOverlay.ts` ~725–746); preview uses `aggregateEquippedRatings` on profile DTOs |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | — | Plain HTML/CSS/TS overlay; stylized 2D hero (no second Three.js scene / no UI framework); shared helpers from `@cubewars/shared` |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | — | No secrets in diff; anchors rejected server-side (`bad_anchor`/`overlap`); preview/overflow are display + intent only |
| 5 | Error handling | PASS | — | `EconomyActionError` on bad move/full bag; migration logs overflow counts; amulet-destroy full-bag path leaves null + `console.warn` (`store.ts` ~1808–1813) — now surfaces via Unplaced UI |
| 6 | Logging / observability | PASS | — | `[economy] inventory grid shrink migration … preserved=… relocated=… overflow=…` (`store.ts` ~563–566) |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | PASS | note | Regression covers preserve/OOB/overlap + overflow never-delete + version guard (`scripts/regression-economy-inventory.ts` ~108–160); Playwright evidences grid+hero (not overflow UI — covered by unit + DOM wiring) |
| 8 | Readability / maintainability | PASS | — | Shared `collectBagPackables` / compare order; handoff documents migration + CSS preview choice |
| 9 | Scope discipline | PASS | — | Diff limited to EPIC 53 surfaces + task docs + Playwright script |
| 10 | Config / docs updated | PASS | note | About text EN/RU 6×5 + loadout (`about.html`); `LAST_UPDATED = "2026-08-27"`; changelog newest entry; README controls + EPIC 29 section updated to 6×5/0–29. Leftover “64-cell” phrase and stale About PNG — notes below |
| 11 | No dead code / debug scaffolding | PASS | — | No debug scaffolding observed; overflow DOM gated by `hidden` when empty |
| 12 | Regression risk considered | PASS | — | 2-cell same-row still validated via `cellsForAnchor` (`shared/src/economy.ts` ~441–454); move/overlap cases in regression; soft-cap stim+kit fill exercised live in screenshots |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | N/A | — | Inventory UI epic; combat controls out of scope; evidence correctly focuses on overlay |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS | — | Opened `01`/`02`: blocky blue avatar, gold amulet tell, dog/cat icons with gem pips, HP/Armor/Speed%/Damage% via `formatRatingGrant`; matches inventory/remote pet icon language |
| 15 | Controls & feel usable | PASS | — | `04-laptop-1280x720.png` (1280×720): grid + `.inv-side` rail + LOADOUT visible side-by-side; grid bottom uses `.inv-grid-scroll` overflow (EPIC 43 discipline) |
| 16 | Playability sanity (honest fun/usability call) | PASS | — | Loadout glance is usable; bag density fits overlay; overflow strategy preserves ownership when soft caps exceed 30 cells |

## Findings (actionable)

_None blocking._

### F-001

- Checklist # / Gate: 10 / 14
- Severity: note
- Issue: About illustrative asset `client/public/about/inventory.png` still shows caps **Cells 0/64**, older DR-era ratings chrome, and **no** right-side LOADOUT panel, while live About copy correctly describes 6×5 + loadout preview. Text/changelog are correct; image is stale (same class of issue as EPIC 52 F-001).
- Required fix (file/behavior): Optional — recapture `client/public/about/inventory.png` from post-EPIC-53 overlay (6×5, `/30` caps, hero preview).
- Suggested check to prove closed: About inventory figure shows 6×5 + LOADOUT and caps `/30`, not `/64`.

### F-002

- Checklist # / Gate: 10
- Severity: note
- Issue: README EPIC 29 bullet still says equip rail renders “outside the **64-cell** grid” (`README.md` ~184) after the surrounding bullets were updated to 6×5 / 0–29.
- Required fix (file/behavior): Optional — change to “30-cell” / “6×5 bag”.
- Suggested check to prove closed: `grep -n '64-cell' README.md` empty (except historical changelog if any).

### F-003

- Checklist # / Gate: 7
- Severity: note
- Issue: Playwright seed fills the bag without null anchors (`notes.txt`: `overflowHidden=true count=0`); Unplaced UI not visually evidenced. Behavior is covered by regression overflow case + client `overflowEntries()` excluding equipped/socketed items (`inventoryOverlay.ts` ~411–438).
- Required fix (file/behavior): None required for approval; optional QA seed that forces overflow for a screenshot.
- Suggested check to prove closed: Screenshot with Unplaced list visible, or keep relying on unit coverage.

### F-004

- Checklist # / Gate: 5
- Severity: note
- Issue: Comment at `store.ts` ~1809 still claims `ensureInventoryPacked will retry` when a slot-2 pet cannot fit after amulet destroy. Under `inventoryGridVersion === 2`, null bag anchors are intentional overflow and **do not** re-trigger migration — which matches EPIC 53 overflow UX (Unplaced list) but makes the comment stale.
- Required fix (file/behavior): Optional — update comment to say item remains unplaced/overflow until the player frees space and places it (or a future explicit re-pack).
- Suggested check to prove closed: Comment matches `needsInventoryGridMigration` semantics.

## Revision task (if REVISE)

- Finding IDs to fix: _(none — APPROVED)_
- Out of scope for this revision: N/A
- Re-verify required: no

## Notes (non-blocking)

- Tester caveats accepted: Sandbox pool / in-match inventory share the same `InventoryOverlay` + scoped `loadDoc`/`ensureInventoryPacked`; live evidence is lobby Deathmatch.
- PR may still be blocked by gh auth mismatch (Programmer handoff); compare URL is sufficient for this review. Do not merge/deploy — Team Lead final review next.
- Critic re-ran `npm run regression:economy-inventory` on the worktree: `[economy-inventory] PASS`.
