# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 52 — Client i18n (RU/EN) + About the Game
- Diff / PR reference: branch `feature/epic-52-i18n-about-page` @ `17f69aa5673eb2a6748f76f8b828d5456cfc9b34` vs `master` (implementation commit `2799eec`; PR blocked by gh auth mismatch — reviewed `git diff master...HEAD`)
- Tester PASS report reference: `docs/tasks/epic-52-tester-report.md` (PASS at HEAD `17f69aa`; evidence `qa-artifacts/epic-52/`)
- Iteration: 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff --stat master...HEAD` — 31 files, +2038/−231; core impl in `2799eec` |
| Tester PASS report matches this commit | PASS | Tester report Meta cites HEAD `17f69aa…`; handoff `68dcad7` is prior docs SHA, not a mismatch of verified code |
| Every acceptance criterion traceable to a change or explicit note | PASS | Story A/B/C mapped: `client/src/i18n.ts` + locales (213 keys), lobby switcher in `client/index.html` ~1987–1990, `localizedMapName` in `modeSelect.ts`/`pauseMenu.ts`/`main.ts`, `client/public/about.html` + `client/public/about/*.png`, `ai-office/policies/player-facing-docs.md` + DoD bullet in `global-standards.mdc`, changelog entry 2026-08-27 |
| Scope matches the task (no unexplained extra changes) | PASS | Client UI/i18n/About/docs/QA script only; no `package.json` dependency changes; no server/protocol changes |
| Gameplay evidence present (player-facing tasks only) | PASS | Critic opened PNGs `01`–`11` under `qa-artifacts/epic-52/`; `qa-result.txt` = PASS; notes list Cyrillic maps + About Last updated |

- Gate overall: PASS → continue checklist

## Verdict

- `APPROVED`
- One-line rationale: Diff implements stack-compliant RU/EN i18n (`cubewars.locale`, no i18n framework), map `displayNameRu`, and About with required sections/images/process docs; opened screenshots `01`/`02`/`04`/`05`/`10`/`11` confirm lobby switcher, RU UI, About, and footer About link.

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | PASS | — | `i18n.ts` STORAGE_KEY/`resolveInitialLocale` (saved→`ru*`→`en`); 213/213 EN/RU key parity; About 9 sections + `LAST_UPDATED="2026-08-27"` (`about.html:270`); footer order Changelog→About→Telegram (`index.html` ~2062–2065) |
| 2 | Server authority for gameplay-relevant state | N/A | — | Locale is client `localStorage` display only; no gameplay authority change |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | — | Plain module + dictionaries; no i18next/React/etc. in tree; `package.json` untouched in diff |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | note | No secrets in diff. `applyI18nDom` uses `textContent` for `data-i18n` (safe). Unused `data-i18n-html` → `innerHTML` path in `i18n.ts:87–91` has no HTML callers. Auction lot rows still use `innerHTML` with nicknames (`auctionPanel.ts` renderLots) — pre-existing pattern, not introduced as new secret/auth risk |
| 5 | Error handling | PASS | — | `localStorage` get/set wrapped in try/catch (`i18n.ts:30–36`, `49–53`); About page mirrors same (`about.html:394–399`, `433–435`) |
| 6 | Logging / observability | N/A | — | Client UI / static About; no service logging required |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | PASS | — | Tester exercised switcher, no-reload flip, persist reload (`06`), browser default ru/en (`07`/`08`), map `displayNameRu` option text, About sections/images/locale, process docs; typecheck+build green |
| 8 | Readability / maintainability | PASS | — | Flat key namespace in `locales/en.ts`/`ru.ts`; `localizedMapName` helper; About page-local dict documented in handoff |
| 9 | Scope discipline | PASS | — | Diff limited to EPIC 52 surfaces + process docs + programmer Playwright script |
| 10 | Config / docs updated | PASS | — | `ai-office/policies/player-facing-docs.md`; DoD in `global-standards.mdc`; README EPIC 52 status; `changelog.json` newest entry |
| 11 | No dead code / debug scaffolding | PASS | note | `data-i18n-html` handler in `i18n.ts:87–91` has zero call sites in HTML — unused capability, not debug scaffolding |
| 12 | Regression risk considered | PASS | — | Client typecheck/build green per Tester; lobby/HUD `data-i18n` + subscribe refresh path wired in `main.ts:48–51` |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | N/A | — | UI/i18n/About epic; match mechanics out of scope; evidence correctly focuses on lobby/About |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS | note | Opened `01`/`02`/`04`/`05`: lobby lore + chrome intact; About embeds gameplay/inventory captures; no black/broken About images (`notes.txt` naturalWidth>0). Embedded `pets-inventory.png` still shows older “DR” chrome while live About text says Armor (`09-about-en-pets-section.png`) |
| 15 | Controls & feel usable | N/A | — | No control changes; locale buttons usable in `01`/`02` |
| 16 | Playability sanity (honest fun/usability call) | PASS | — | EN↔RU lobby is readable; About is usable newcomer docs with images; RU map names (`База`, notes: `Ржавый Каньон`, `Стеклянный Купол`) correct |

## Findings (actionable)

_None blocking._

### F-001

- Checklist # / Gate: 14 / 11
- Severity: note
- Issue: About illustrative asset `client/public/about/pets-inventory.png` (evidence `09-about-en-pets-section.png`) still shows inventory chrome labeled **DR**, while live About copy correctly documents dog → Armor (EPIC 51). Page text is correct; image is slightly stale.
- Required fix (file/behavior): Optional — recapture pets/inventory still for About assets so chrome matches Armor.
- Suggested check to prove closed: New About pets screenshot without “DR” label in the embedded PNG.

### F-002

- Checklist # / Gate: 11
- Severity: note
- Issue: `applyI18nDom` supports `data-i18n-html` (`client/src/i18n.ts:87–91`) but no element in the client uses that attribute — dead API surface.
- Required fix (file/behavior): Optional — remove unused `data-i18n-html` branch until needed.
- Suggested check to prove closed: Grep shows no `data-i18n-html` handler or only used sites.

### F-003

- Checklist # / Gate: 1
- Severity: note
- Issue: Known limitation (handoff + Tester): shared weapon `displayName` and some inventory grant/detail tooltips remain English; RU footer keeps “Changelog” as English loanword (`11-lobby-footer-ru.png`). Within stated out-of-scope / non-blocking for this EPIC.
- Required fix (file/behavior): None for this delivery.
- Suggested check to prove closed: N/A

## Revision task (if REVISE)

- Finding IDs to fix: _(none — APPROVED)_
- Out of scope for this revision: N/A
- Re-verify required: no

## Notes (non-blocking)

- PR URL may be missing due to gh auth mismatch; Team Lead can open PR from compare URL when auth is fixed — does not block Critic approval of the reviewed diff.
- Tester script `scripts/qa-epic52-tester-playwright.mjs` is useful local evidence tooling; programmer script is committed on the branch.
- About page correctly duplicates locale resolve/`cubewars.locale` in page-local JS (static public HTML cannot import Vite TS module) — acceptable per preferred implementation alternatives in the spec.
