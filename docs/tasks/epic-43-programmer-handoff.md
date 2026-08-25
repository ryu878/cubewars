# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-25T18:50:00Z |
| Author (Pusya) | Programmer (Pusya) |
| Task / Story / EPIC | EPIC 43 — Inventory Cell Size, Icons, and Hover Tooltips (`docs/tasks/epic-43-inventory-icons-tooltips.md`) |
| Branch / commit / PR | `task/epic-43-inventory-icons-tooltips` @ `5315aa4` (F-001 fix). Prior product: `0b16d78`. |
| Revision round (if this is a Critic/Judge fix, not first pass) | **yes — finding IDs: F-001** |
| Base SHA (`master` at branch creation) | `a6e7aceb98209f4d1981697b45ea4332ff489997` |
| Prior product commit | `0b16d78` |
| Critic review | `docs/tasks/epic-43-critic-review.md` (REVISE F-001) |

## What was done (brief)

1. Scaled `#inventoryGrid` from `min(480px, 100%)` to `min(960px, …)` (~2× linear cell size); icons + English tooltips + cryptic-code removal (unchanged this revision).
2. **F-001 fix:** restructured inventory body into side-by-side layout — scrollable `.inv-grid-scroll` (full ~960×960 grid, cells stay ~2×) beside fixed `.inv-side` (equip rail + `#inventoryDetails` actions). Widened panel to `min(1280px, …)` so rail/details no longer wrap under the square grid at 1400×900. Body `max-height` keeps the side column in the first viewport; grid scrolls independently when taller than the viewport.
3. No server/economy/protocol changes. Icons, English tooltips, and cryptic-code removal preserved.

## Changed files / areas

- `client/index.html` — F-001 layout: `.inv-grid-scroll`, `.inv-side`, panel width, body max-height, nowrap side-by-side; prior EPIC 43 icon/tooltip CSS retained
- `client/src/inventoryOverlay.ts` — prior EPIC 43 icon/tooltip/detail English names (unchanged this revision)
- `README.md` — Current status EPIC 43 (prior)
- `docs/tasks/epic-43-inventory-icons-tooltips.md` — EPIC spec
- `docs/tasks/epic-43-programmer-handoff.md` — this handoff (+ F-001 section)
- `scripts/qa-epic43-f001-layout-smoke.mjs` — brief 1400×900 viewport smoke for F-001

## How to verify (steps for Trusya)

1. Start client + server as usual; open inventory from lobby **Inventory** button (EPIC 42) and/or in-match with **I**.
2. At ~1400×900: select a bag item — English detail title + at least one action (Equip / Hatch / etc.) must be visible **without** scrolling the panel past the grid (`panel.scrollTop === 0` acceptable).
3. Confirm grid cells remain roughly **~2×** previous (~115px vs ~56.5px); icons still geometric; hover tooltips still English; no `STM`/`PET`/… primary labels.
4. Optional Programmer smoke: `node scripts/qa-epic43-f001-layout-smoke.mjs` → `qa-artifacts/epic-43/07-f001-selected-detail-actions-visible.png` + `f001-layout-smoke.json` (`ok: true`).
5. Light regression: drag-move, equip/unequip still send same `economy_*` intents.

## Build and run

- Build command: `npm run typecheck` → **PASS**; `npm run build` → **PASS** (F-001 revision)
- Run command: standard client Vite + game server (same as prior EPICs)
- Expected smoke result: side rail+details visible with selection at 1400×900; cell ~115px (~2.04×); English title + Equip action in viewport

## Cell size notes (AC measurement)

| | Grid CSS width | Approx cell linear (8×8, gaps) |
|--|----------------|--------------------------------|
| **Before** | `min(480px, 100%)`, gap 4px | ~(480 − 7×4) / 8 ≈ **56.5px** |
| **After (product + F-001)** | `min(960px, 100%)` inside scroll viewport, gap 6px | F-001 smoke @1400×900: grid **960px**, cell **115×115px** → ≈ **2.04×** vs 56.5px |
| **Compromise** | **None** — full ~2× linear kept. Layout fix uses side-by-side + independently scrollable grid instead of shrinking cells (√2 not needed). |

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

- On viewports ≤1040px wide, body wraps (media query); grid scroll max-height still applies so details are reachable without relying on a buried full-height square alone.
- CSS tooltips on top-row items may clip under panel/grid scroll; `aria-label` still present.
- Craft / Appearance sections remain below the body (may need panel scroll); F-001 scope is selected-item detail title + act controls in viewport.

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)

---

## Revision: F-001 (Critic REVISE)

| Field | Value |
|-------|-------|
| Finding | **F-001** — at ~1400×900, `#inventoryDetails` / select→act wrapped below ~960×960 grid and sat below the fold |
| Fix | Side-by-side `.inv-body`: `.inv-grid-scroll` (overflow auto, full ~960² grid) + `.inv-side` (rail + details). Panel `min(1280px, …)`. Body `max-height: min(720px, calc(92vh - 150px))` so side stays in the first viewport. |
| Cell size | Still **~2×** (115px / 56.5 ≈ **2.04×**). √2 compromise **not** used. |
| Evidence | `node scripts/qa-epic43-f001-layout-smoke.mjs` → `titleInViewport`/`actionInViewport` true; screenshot `qa-artifacts/epic-43/07-f001-selected-detail-actions-visible.png`; `f001-layout-smoke.json` `ok: true`, `panelScrollTop: 0` |
| Out of scope preserved | Icons, English tooltips, cryptic-code removal, no server/economy changes |
