# Tester report (Trusya) — EPIC 43 re-verify F-001

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-25 |
| Task / Story / EPIC | EPIC 43 — Inventory Cell Size, Icons, and Hover Tooltips |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-43-programmer-handoff.md` (F-001 revision) @ fix `5315aa4`; tip under test `a4dcff8` |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | **yes** — finding IDs re-checked: **F-001** |

## Environment

- OS / Docker: Linux 5.15; Node v24.18.1 / npm 11.x; Redis local; Playwright Chromium headless
- Branch / commit: `task/epic-43-inventory-icons-tooltips` @ `a4dcff818ca51ded4fe684d0d10ab3975d838b7f` (product fix `5315aa4`)
- Critic review under re-verify: `docs/tasks/epic-43-critic-review.md` (REVISE; F-001 major)
- Evidence: `scripts/qa-epic43-f001-layout-smoke.mjs` → `qa-artifacts/epic-43/`

## Scope of this re-verify

Scoped to Critic finding **F-001** plus a light regression pass (cell ~2×, icons, English tooltips, no STM/PET primary labels, typecheck/build). Full EPIC 43 AC was already PASS on prior tip (`docs/tasks/epic-43-tester-report.md`); not re-run end-to-end.

## Checklist sections applied

- Universal (secrets; this re-verify report)
- Build and run (typecheck; build)
- Client (layout + inventory overlay presentation)
- Gameplay & feel (inventory select→act viewport usability; icons/tooltips regression screenshots)
- Server authority: N/A for this revision (client layout only; no economy/protocol change)

## Check results

### Build

- Command: `npm run typecheck`; `npm run build`
- Result: OK — shared/server/client `tsc --noEmit` clean; client Vite production build OK

### Run

- Command: `node scripts/qa-epic43-f001-layout-smoke.mjs` (ports 7800/5220)
- Result: OK — `f001-layout-smoke.json` `ok: true`, `failures: []`

### Finding closure

| ID | Severity | Expected | Actual | Closed? |
|----|----------|----------|--------|---------|
| **F-001** | major | At ~1400×900 after selecting a bag item: `#inventoryDetails` English title + ≥1 action button visible in viewport without scrolling the panel past the grid (`panelScrollTop` ~0) | `titleInViewport: true`, `actionInViewport: true`, `detailTitle: "Pet (lion) #1"`, `actionLabel: "Equip slot 1"`, `panelScrollTop: 0`. Screenshot `07-f001-selected-detail-actions-visible.png` shows side rail + English title + Equip/Discard/Drop/Auction in frame beside scrollable ~960 grid. Layout: `.inv-grid-scroll` + `.inv-side` | **yes** |

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| F-001 select→act @1400×900 | Detail title + action in viewport; panelScrollTop≈0 | **PASS** — see finding table + `07-…png` |
| Cell size light regression | ~2× prior (~115px) or documented √2 | **PASS** — cell **115×115**, grid **960**, `scaleVsBefore: 2.04`; √2 not used |
| Icons / no cryptic primary | Icons present; no STM/PET/… primary labels | **PASS** — `iconCount: 2/2`, `crypticPrimary: []`; glyphs visible in `07`/`08` |
| English tooltips | Hover/data-tooltip English | **PASS** — tooltips `Pet (lion) #1 · value 80`, `Stimulator #1`; hoverTip same; `08-f001-hover-tooltip-regression.png` |
| typecheck / build | PASS | **PASS** |

### Config and secrets

- `config.vars.example` / README up to date: N/A for this revision (no new env; README already noted EPIC 43 on prior product commit)
- No secrets in revision diff: yes (client CSS layout + docs/QA script)

### Documentation

- Re-verify report: this file
- Programmer handoff updated for F-001: yes

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: **N/A** — F-001 is inventory overlay layout only; mutations still existing `economy_*`

### Gameplay & feel

- Screenshot/evidence path(s): `qa-artifacts/epic-43/`
  - `07-f001-selected-detail-actions-visible.png` — English detail title + Equip (and other actions) visible at 1400×900 with `panelScrollTop: 0`
  - `08-f001-hover-tooltip-regression.png` — large cells, geometric icons, no STM/PET primary labels
  - `f001-layout-smoke.json` — machine summary (`ok: true`, scale 2.04×, viewport asserts)
- Movement / jump / shoot: N/A — inventory UI re-verify only (unchanged by F-001)
- Camera / controls feel: N/A
- Visual sanity: OK — side-by-side grid + details; no black screen / missing overlay
- Matches intended "Roblox-like" look: yes — type-tinted geometric icons retained

## On FAIL: reproduction

### Failure reason

- N/A (PASS)

## Outcome

- **PASS:** Critic finding **F-001** verified closed on fix `5315aa4` (tip `a4dcff8`). Ready for **Judge** (`ai-office/agents/judge/role.mdc`) — not Critic again per `ai-office/process/review-judge-cycle.md`. Do **not** merge.

Briefly verified:

1. **F-001:** Select bag item @1400×900 → English `#inventoryDetails` title + Equip action in viewport; `panelScrollTop: 0`; grid scrolls independently via `.inv-grid-scroll`.
2. Light regression: cell ~115px (~2.04×), icons present, no cryptic primary labels, English tooltips, typecheck/build PASS.
