# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 43 — Inventory Cell Size, Icons, and Hover Tooltips (`docs/tasks/epic-43-inventory-icons-tooltips.md`)
- Diff / PR reference: branch `task/epic-43-inventory-icons-tooltips`; product commit `0b16d78` (`feat(epic-43): larger inventory cells with icons and English tooltips`); reviewed `git diff a6e7aceb98209f4d1981697b45ea4332ff489997...HEAD` (base `master` `a6e7ace`)
- Tester PASS report reference: `docs/tasks/epic-43-tester-report.md` (PASS @ `0d2e9d7`; tip may include report commit `2c10d89`)
- Iteration (1 if first pass): 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | Product diff in `0b16d78`: `client/index.html`, `client/src/inventoryOverlay.ts`, `README.md` (+ docs/QA script on branch tip). No `server/` / `shared/` changes. |
| Tester PASS report matches this commit | PASS | `docs/tasks/epic-43-tester-report.md` maps handoff to implementation `0b16d78` / tip under test `0d2e9d7`; AC table filled; `qa-artifacts/epic-43/smoke-summary.json` `ok: true`. |
| Every acceptance criterion traceable to a change or explicit note | PASS | Cell ~2× CSS `#inventoryGrid` `min(960px, 95vw)`; icons via `createItemIcon` + `.inv-icon-*`; tooltips `tooltipFor` + `data-tooltip`; detail titles `detailsTitle`; README Current status; typecheck/build in Tester report. Layout usability of detail/actions fails product checklist below (not a missing AC mapping). |
| Scope matches the task (no unexplained extra changes) | PASS | Client inventory presentation + docs/README + Playwright QA runner only. No economy/protocol/server edits. |
| Gameplay evidence present (player-facing tasks only) | PASS | Screenshots opened: `qa-artifacts/epic-43/01-…` through `06-…`, `smoke-summary.json`. Icons, ~2× cells, English hover tooltip visible in `03-hover-tooltip.png`. |

- Gate overall: PASS → continue checklist

## Verdict

- `REVISE`
- One-line rationale: Icons, English tooltips, and ~2× cells land correctly (`0b16d78` + `03-hover-tooltip.png`), but at the QA viewport (1400×900) `#inventoryDetails` / action buttons are below the fold under a 960×960 grid — `04-selected-detail-english.png` shows selection only, no detail title/actions (F-001).

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | FAIL | major | Icons/names/tooltips/2× sizing meet AC in code + `smoke-summary.json` (`scaleVsBefore` ≈2.04, `crypticPrimary: []`, English tooltips). Detail/actions usability after resize fails EPIC §3.1 “fit without clipping primary controls” in practice — see F-001 / checklist 15–16. |
| 2 | Server authority for gameplay-relevant state | PASS | | Diff is client render-only; mutations still `economy_*` (`smoke-summary.json` `drag.moveMsgTypes: ["economy_move_item"]`). No server/shared changes vs `a6e7ace...0b16d78`. |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | | Plain HTML/CSS/TS icons (`createItemIcon`, `.inv-icon-*` in `client/index.html`); no new npm UI framework/deps. |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | | Tooltip/detail strings built in TS and set via `dataset` / `textContent` / `aria-label` (`inventoryOverlay.ts` `tooltipFor` / `detailsTitle`); no secrets; pet/gem types from existing profile. |
| 5 | Error handling | N/A | | Presentation-only; existing overlay paths unchanged for send failures. |
| 6 | Logging / observability | N/A | | Client UI-only; no new service logging required. |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | FAIL | major | Hover/icons/size/drag covered; selected detail verified via DOM text only (`scripts/qa-epic43-tester-playwright.mjs` selectSnap) while screenshot `04-…` does not show `#inventoryDetails`. Equip/hatch/socket/repair not exercised (code paths untouched but primary actions now off-screen — F-001). |
| 8 | Readability / maintainability | PASS | | `ITEM_DISPLAY_NAME`, `createItemIcon`, `tooltipFor`, `detailsTitle` are clear replacements for `ITEM_LABEL`. |
| 9 | Scope discipline | PASS | | Feature commit scoped to inventory UI + README + EPIC/handoff docs; QA script is Tester evidence tooling. |
| 10 | Config / docs updated | PASS | | `README.md` Current status EPIC 43; no new env vars. |
| 11 | No dead code / debug scaffolding | PASS | | `ITEM_LABEL` / `.inv-item-label` removed; icon/tooltip CSS is used. |
| 12 | Regression risk considered | FAIL | major | ~2× square grid + `#inventoryPanel { overflow: auto }` (`client/index.html` `#inventoryPanel` / `#inventoryGrid`) regresses visibility of selected-item actions / craft / appearance without scrolling past ~960px empty grid (F-001). Drag still OK per smoke. |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | N/A | | Inventory overlay presentation; movement/combat out of scope. Drag `economy_move_item` smoked. |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS | | `02-lobby-inventory-icons-large-grid.png` / `03-hover-tooltip.png`: distinct geometric glyphs + type-tinted cells; no STM/PET primary labels; colorful low-poly UI retained. |
| 15 | Controls & feel usable | FAIL | major | Select→act flow: detail/actions not visible in default viewport — `04-selected-detail-english.png` (selection + tooltip only; pixel check: green action-like pixels only in upper Close button region, `lower=0`). |
| 16 | Playability sanity (honest fun/usability call) | FAIL | major | Larger readable cells/icons are a clear win, but burying Equip/Hatch/etc. under a full-height 8×8 square grid makes the overlay less usable than before on common laptop heights (QA 900px). |

## Findings (actionable)

### F-001

- Checklist # / Gate: 1, 7, 12, 15, 16
- Severity: major
- Issue: After scaling `#inventoryGrid` to `min(960px, 95vw)` with `aspect-ratio: 1/1`, the grid is ~960×960px while `#inventoryPanel` max-height is `min(92vh, 980px)` (~828px at Tester’s 1400×900). `.inv-body` is `flex-wrap`; `#inventoryDetails` (min-width 220px) wraps below the grid after grid+rail consume ~1178px of the ~1200px panel. Players must scroll through a large mostly-empty grid to reach selected-item English title, action buttons, craft, and appearance. EPIC §3.1 required adjusting layout so primary controls still fit; scrolling the whole panel does not keep those controls usable. Critic opened `04-selected-detail-english.png`: pet selected + tooltip visible; no detail title/actions in frame (DOM-only PASS in Tester report is insufficient).
- Required fix (file/behavior): Keep ~2× cell linear size (or documented √2 compromise per EPIC) **and** keep `#inventoryDetails` + rail actions reachable without scrolling past the full square grid — e.g. independently scrollable grid viewport with fixed/side details+rail, non-square grid height with fixed cell size, or other layout that preserves cell size AC without burying actions. Re-smoke: select item → detail title + at least one action button visible in viewport screenshot without manual scroll-to-bottom; equip or hatch path optional but preferred.
- Suggested check to prove closed: Playwright @1400×900 (or stated common viewport): after click on bag item, assert `#inventoryDetails .inv-details-title` and an action control intersect the visible panel viewport; capture screenshot showing English detail title + actions; grid cell linear size still ~2× (or documented √2) and icons/tooltips still non-cryptic.

## Revision task (if REVISE)

- Finding IDs to fix: F-001
- Out of scope for this revision: Server/economy/protocol; new asset pipeline; redesign of auction/trade; changing lobby Inventory button behavior (EPIC 42); re-litigating icon art style if glyphs remain distinct and non-cryptic
- Re-verify required: yes (Tester re-runs scoped check + light regression)

## Notes (non-blocking)

- Top-row CSS tooltips may clip under `#inventoryPanel { overflow: auto }` — documented in programmer handoff; `aria-label` present. Not blocking while F-001 open.
- In-match evidence (`06-inmatch-inventory-I.png`) correctly shows shared overlay + large empty Sandbox grid; icons were verified on lobby Deathmatch seeded bag — acceptable for this EPIC.
- Equip/hatch/socket/repair handlers appear unchanged in the diff; only drag was smoke-tested. After F-001 layout fix, a light equip or hatch click smoke would strengthen QA.
- Product strengths to preserve in the fix: ~2× cells (`smoke-summary.json` cell 115px), seven distinct icons, English tooltips (e.g. `Pet (lion) #1 · value 80` in `03-hover-tooltip.png`), no `server/`/`shared/` drift.
