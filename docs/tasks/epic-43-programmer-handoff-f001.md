# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-25T18:50:00Z |
| Author (Pusya) | Programmer (Pusya) |
| Task / Story / EPIC | EPIC 43 — Critic revision **F-001** (`docs/tasks/epic-43-critic-review.md`) |
| Branch / commit / PR | `task/epic-43-inventory-icons-tooltips` @ F-001 product `5315aa4` (tip may include later docs; this handoff path is the F-001 revision package) |
| Revision round (if this is a Critic/Judge fix, not first pass) | **yes — finding IDs: F-001** |
| Base SHA (`master`) | `a6e7aceb98209f4d1981697b45ea4332ff489997` |
| Prior product commit | `0b16d78` |
| Critic tip before revision | `5d6b21c` |

## What was done (brief)

1. **F-001 only:** inventory body is side-by-side — independently scrollable `.inv-grid-scroll` holds the full ~960×960 `#inventoryGrid` (~2× cells); `.inv-side` holds equip rail + `#inventoryDetails` so select→act stays in the first viewport at 1400×900 without scrolling past the square grid.
2. Panel widened to `min(1280px, calc(100vw - 24px))`; `.inv-body` uses `flex-wrap: nowrap` + `max-height: min(720px, calc(92vh - 150px))`; grid/side get matching max-height so the grid scrolls internally.
3. Icons, English tooltips, cryptic-code removal, and server/economy/protocol left untouched.

## Changed files / areas

- `client/index.html` — `.inv-grid-scroll`, `.inv-side`, panel width, body max-height, HTML wrap of grid/rail/details
- `scripts/qa-epic43-f001-layout-smoke.mjs` — Playwright smoke @1400×900 (viewport + light icon/tooltip regression)
- `docs/tasks/epic-43-programmer-handoff-f001.md` — this revision handoff
- `docs/tasks/epic-43-programmer-handoff.md` — also updated on branch for continuity

## How to verify (steps for Trusya)

1. Viewport **1400×900**. Open inventory (lobby **Inventory** or in-match **I**).
2. Select a bag item. Assert `#inventoryDetails .inv-details-title` and an action control (e.g. Equip) **intersect the visible viewport** without scrolling the panel to the bottom (`#inventoryPanel.scrollTop` should stay `0` for this check).
3. Capture screenshot showing English detail title + actions beside (not under) the grid.
4. Confirm cell linear size still **~2×** (~115px vs prior ~56.5px); icons non-cryptic; hover tooltips English.
5. Optional: `node scripts/qa-epic43-f001-layout-smoke.mjs` → expect `qa-artifacts/epic-43/f001-layout-smoke.json` `ok: true` and `07-f001-selected-detail-actions-visible.png`.

## Build and run

- Build command: `npm run typecheck` → **PASS**; `npm run build` → **PASS**
- Run command: standard client Vite + game server
- Expected smoke result: `titleInViewport`/`actionInViewport` true; `cellWidthPx` ≈ 115; `scaleVsBefore` ≈ 2.04; `panelScrollTop` 0

## Cell size (before / after)

| | Grid CSS | Cell linear |
|--|----------|-------------|
| **Before EPIC 43** | `min(480px, 100%)`, gap 4px | ≈ **56.5px** |
| **After F-001** | `min(960px, 100%)` inside `.inv-grid-scroll`, gap 6px | smoke @1400×900: **115×115px** ≈ **2.04×** |
| **√2 compromise** | **Not used** — full ~2× kept via scrollable grid + side details |

## Layout approach

Independently scrollable grid viewport (`.inv-grid-scroll`) with fixed/side rail+details (`.inv-side`). Square grid retained; height clipped by body/scroll max-height so actions stay reachable.

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: N/A (client presentation only)
- Key success messages: N/A

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: unchanged (`economy_*`)
- What the client is allowed to predict/render only: layout/CSS presentation only

## Risks / known limitations

- ≤1040px width: body wraps via media query; grid still has max-height so details remain reachable.
- Craft / Appearance below `.inv-body` may still need panel scroll — F-001 scope is selected-item detail + act controls.
- Top-row CSS tooltips may clip under overflow; `aria-label` remains.

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)

### Branch / commits for Tester

| Role | SHA |
|------|-----|
| F-001 layout fix (product) | `5315aa4a2599cc1bb37911a382d2f6ae78015964` |
| Handoff SHA note | `a4dcff818ca51ded4fe684d0d10ab3975d838b7f` |
| Tester re-verify note (if present on tip) | `4fe969c` — see `docs/tasks/epic-43-tester-reverify-f001.md` |
| This dedicated F-001 programmer handoff | `f50b3feda262b2f403b553ecc3cde61c9b7d9307` |
