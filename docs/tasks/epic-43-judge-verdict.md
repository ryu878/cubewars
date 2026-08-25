# Judge packet / verdict (Jasya) → Team Lead

## Meta

- Task ID: EPIC 43 — Inventory Cell Size, Icons, and Hover Tooltips (`docs/tasks/epic-43-inventory-icons-tooltips.md`)
- Iteration: 1
- Judge: Jasya
- Critic review ref: `docs/tasks/epic-43-critic-review.md` (REVISE; F-001 major)

## Allowed inputs only

### Original finding(s) (copy)

- ID: F-001
- Severity: major
- Text: After scaling `#inventoryGrid` to `min(960px, 95vw)` with `aspect-ratio: 1/1`, ~960×960 grid buries `#inventoryDetails` / action buttons below the fold at QA viewport 1400×900. Players must scroll through large mostly-empty grid to reach selected-item English title, action buttons, craft, appearance. EPIC §3.1 required adjusting layout so primary controls still fit. Required fix: keep ~2× cell linear size (or documented √2) **and** keep `#inventoryDetails` + rail actions reachable without scrolling past the full square grid.

### Changes

- Files / description: Product fix `5315aa4` — `client/index.html`: `.inv-grid-scroll` (independent scroll for full ~960×960 grid) + `.inv-side` (rail + `#inventoryDetails`); panel `min(1280px)`; `.inv-body` max-height / `flex-wrap: nowrap` so select→act stays in first viewport. Cell size unchanged (~115px ≈ 2.04×). Icons/tooltips/cryptic-code removal preserved. QA smoke `scripts/qa-epic43-f001-layout-smoke.mjs` + docs handoffs/reverify.

### Re-test results

- Tester re-verify outcome: `docs/tasks/epic-43-tester-reverify-f001.md` — **PASS** for F-001 (tip under test `a4dcff8`; product fix `5315aa4`)
- Regression pass outcome: **PASS** — icons present, `crypticPrimary: []`, English tooltips, typecheck/build OK; `scaleVsBefore: 2.04`

### Diff summary

- Before → after (for the specific finding): Before — square `#inventoryGrid` ~960×960 with wrapping body pushed `#inventoryDetails`/actions below fold inside `#inventoryPanel` scroll. After — grid scrolls inside `.inv-grid-scroll`; rail + details live in `.inv-side` beside the grid; at 1400×900 select→act needs no panel scroll (`panelScrollTop: 0`).

---

## Per-finding decisions

| Finding ID | Status | Evidence | Residual risk |
|------------|--------|----------|---------------|
| F-001 | CLOSED | `qa-artifacts/epic-43/f001-layout-smoke.json`: `titleInViewport`/`actionInViewport` true, `panelScrollTop: 0`, cell 115px (`scaleVsBefore: 2.04`); screenshot `07-f001-selected-detail-actions-visible.png` shows English detail title + Equip/Discard/Drop/Auction beside scrollable grid; Tester re-verify PASS; light regression `08-…png` + `crypticPrimary: []` | Narrow wrap path (`max-width: 1040px`) not Critic’s 1400×900 viewport. Craft/Appearance below `.inv-body` may still need panel scroll — outside F-001 required select→act proof. Non-blocking tooltip clip under panel overflow remains Critic note only. |

## Overall

- `ALL_CLOSED`
- Open IDs: _(none)_
- Iteration count: 1
- Note to TL (factual, no debate): F-001 closed on first revision. Team Lead may proceed to final merge approval. Do not merge from Judge. Product fix SHA: `5315aa4`.
