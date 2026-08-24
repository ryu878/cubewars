# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 28 — Lobby Emerald Lore (`docs/tasks/epic-28-lobby-emerald-lore.md`)
- Diff / PR reference: `task/epic-28-lobby-emerald-lore` vs `task/epic-27-redis-economy-store`; implementation `7e56b48`; branch tip reviewed `926f9e8ce84a9a91979a16e6a28b590b91163902` (docs tip-pin commits only after feat)
- Tester PASS report reference: `docs/tasks/epic-28-tester-report.md` (PASS @ `926f9e8`); evidence `qa-artifacts/epic-28/01-lobby-desktop-1280.png`, `02-lobby-narrow-375.png`, `03-lobby-narrow-375-lore-scrolled.png`
- Iteration (1 if first pass): 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff task/epic-27-redis-economy-store...926f9e8` — `client/index.html`, `README.md`, `docs/tasks/epic-28-*.md` |
| Tester PASS report matches this commit | PASS | Tester report pins tip `926f9e8` and implementation `7e56b48`; same branch |
| Every acceptance criterion traceable to a change or explicit note | PASS | Lore markup `client/index.html` ~858–877; layout/CSS ~423–496; CTAs remain in `.mode-select-box`; no server/shared files in diff; typecheck/build PASS in Tester report; screenshots under `qa-artifacts/epic-28/` |
| Scope matches the task (no unexplained extra changes) | PASS | Client HTML/CSS + README Current-status note + EPIC/handoff docs only; no Redis/economy/protocol |
| Gameplay evidence present (player-facing tasks only) | PASS | Three lobby screenshots opened; desktop side column + narrow stack/scroll; Tester hit-tests for nickname + mode buttons |

- Gate overall: PASS → continue checklist

## Verdict

- `APPROVED`
- One-line rationale: `#modeSelect .lobby-lore` delivers readable Russian Emerald Wasteland beats beside/above the join card (`client/index.html` 858–877, 423–496) without covering CTAs (Playwright `elementFromPoint` + screenshots `01`/`02`/`03`), with complementary a11y (`section` + `aria-label`) and no server/protocol scope creep.

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | PASS | — | Story beats 2157 / portal / Изумрудная Пустошь / Пэты / gold·eggs·gems·amulets / survive·rank in HTML 859–876; desktop lore left of card (`01-…png`); narrow lore `order:-1` + `max-height: 28vh` + `overflow-y: auto` (CSS 484–489; `02`/`03`) |
| 2 | Server authority for gameplay-relevant state | N/A | — | Static lobby copy only; diff has no `server/` / `shared/` |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | — | Plain HTML/CSS in `client/index.html`; no UI framework / new deps |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | — | Hardcoded Russian strings (no UGC); no secrets/env; no new endpoints |
| 5 | Error handling | N/A | — | Decorative markup/CSS only |
| 6 | Logging / observability | N/A | — | Client static UI; no service change |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | PASS | — | Desktop + 375px; lore scroll + re-hit-test; nickname fill; snippet asserts in `scripts/qa-epic28-tester-playwright.mjs`; scope file check vs EPIC 27 base |
| 8 | Readability / maintainability | PASS | — | EPIC 28 comment block CSS 423; selectors scoped to `.lobby-lore*` and `.mode-select-box > h1/p` (466–473) so lore `p`/`h2` do not inherit join-card title rules |
| 9 | Scope discipline | PASS | — | Diff file set matches AC / out-of-scope (no Redis, inventory, auction, fonts, i18n framework) |
| 10 | Config / docs updated | PASS | — | `README.md` Current status EPIC 28 note; no new env vars |
| 11 | No dead code / debug scaffolding | PASS | — | No leftover debug; lore styles live and used by markup |
| 12 | Regression risk considered | PASS | — | Broad `#modeSelect h1/p` → `.mode-select-box > h1/p` prevents lore body from picking join-card paragraph styles; mode buttons unchanged |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | N/A | — | Lobby overlay only; in-match mechanics out of scope |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS | — | Dark lobby palette; title `#9ec9a8` / body `#b7c6bb` secondary greens (`01-…png`); no purple-glow / emoji; 3D scene N/A |
| 15 | Controls & feel usable | PASS | — | Nickname + Quick Join / vs Bots / Endless hittable desktop and narrow (Tester `elementFromPoint`; `01`/`02`); lore is its own scroll column, not a full-viewport blocker |
| 16 | Playability sanity (honest fun/usability call) | PASS | — | Lore is secondary atmospheric context; CTAs remain primary; narrow truncation + scroll is intentional and usable (`03-…png`) |

## Findings (actionable)

_(none)_

## Revision task (if REVISE)

- Finding IDs to fix: N/A
- Out of scope for this revision: N/A
- Re-verify required: no

## Notes (non-blocking)

- Lore relies on `#modeSelect`’s existing translucent backdrop (`rgba(10, 10, 15, 0.88)`) without its own opaque panel; faint HUD/hint bleed can show through on narrow viewports. Contrast on the near-black overlay is strong (~11:1 body `#b7c6bb` on `#0a0a0f`). An optional denser lore panel would be polish, not required by AC.
- `font-weight: 750` on `.lobby-lore-title` (`client/index.html` 439) is non-standard; browsers map to nearest available weight — harmless.
- Spec correctly keeps English lobby chrome and Russian lore only; language mix is intentional, not a defect.
- Tester Playwright runner `scripts/qa-epic28-tester-playwright.mjs` is present untracked for evidence generation; product delivery does not depend on committing it.
