# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 1 — Project Scaffolding & Dev Environment
- Diff / PR reference: `master..feature/project-scaffolding` @ `a6acd82` (no PR opened yet — local branch only, not pushed)
- Tester PASS report reference: `docs/tasks/epic-01-tester-report.md`
- Iteration: 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff master..feature/project-scaffolding`, read in full |
| Tester PASS report matches this commit | PASS | `docs/tasks/epic-01-tester-report.md` references `37d1ce8`/`a6acd82`, both on this branch |
| Every acceptance criterion traceable to a change or explicit note | PASS | see checklist #1 below |
| Scope matches the task (no unexplained extra changes) | PASS | diff = workspaces/client/server/shared/docs/scripts, all within EPIC 1 + its QA tooling |
| Gameplay evidence present (player-facing tasks only) | PASS | `qa-artifacts/epic-01/01-initial.png`, `02-after-camera-drag.png` — opened and reviewed directly, not just the caption |

- Gate overall: **PASS** → continue checklist

## Verdict

- **`APPROVED`**
- One-line rationale: all EPIC 1 acceptance criteria are met with independently-verified evidence (build/typecheck output, a raw WS handshake check, and screenshots I opened myself); no critical/major findings, only non-blocking notes.

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | PASS | — | `npm install`/`npm run dev`/`npm run build`/`npm run typecheck` all verified independently; `client/src/main.ts` renders scene + connects WS; `server/src/index.ts` sends `WelcomeMessage` |
| 2 | Server authority for gameplay-relevant state | N/A | — | no gameplay state exists yet in this EPIC |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | — | Three.js+TS+Vite client, Node+TS+`ws` server, `shared/` protocol package, npm workspaces — matches `ai-office/global/global-standards.mdc`. See N-003 below re: Vite major version pin (not a substitution, a version choice) |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | — | no secrets in diff (`git grep` clean); see N-001 (non-blocking) on WS origin validation |
| 5 | Error handling | PASS | — | `server/src/index.ts:27-33` logs socket/server errors; `client/src/main.ts` wraps `JSON.parse` in try/catch and handles `close`/`error` events |
| 6 | Logging / observability | PASS | — | `server/src/index.ts:11,15,25,29,36` — connect/disconnect/errors/shutdown all logged |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | PASS | minor (see N-004) | Tester report covers build/run/WS handshake (client + independent raw check)/console errors/visual evidence; no automated test suite yet, acceptable for pure scaffolding |
| 8 | Readability / maintainability | PASS | — | `client/src/main.ts`, `server/src/index.ts` — small, clearly sectioned, no unexplained cleverness |
| 9 | Scope discipline | PASS | — | diff limited to EPIC 1 deliverables + QA tooling explicitly in the fixed stack (Playwright) |
| 10 | Config / docs updated | PASS | minor (see N-005) | README rewritten; `config.vars.example`, `client/.env.example` present |
| 11 | No dead code / debug scaffolding | PASS | — | reviewed `main.ts`/`index.ts` in full, no leftover debug code |
| 12 | Regression risk considered | N/A | — | greenfield, nothing to regress |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | N/A | — | none of these are in EPIC 1 scope (see backlog EPIC 2/3) |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS | minor (see N-002) | `qa-artifacts/epic-01/01-initial.png` opened directly — colorful ground/blocks/capsule, sky background, correctly lit (not the bare default Three.js grey scene) |
| 15 | Controls & feel usable | PASS | — | `01-initial.png` vs `02-after-camera-drag.png` opened directly — camera angle changed substantially after a scripted drag, confirming OrbitControls responds |
| 16 | Playability sanity (honest fun/usability call) | PASS (as scoped) | note | this task is infrastructure, not gameplay — a standing placeholder capsule on a block field is the correct and honest state for "scaffolding," not a red flag; will become a real finding once EPIC 2/3 land without addressing feel |

## Findings (actionable)

### N-001 (note, non-blocking)

- Checklist # / Gate: #4 Security baseline
- Severity: note
- Issue: `server/src/index.ts` accepts any WebSocket connection without checking the `Origin` header — any website could open a connection today.
- Required fix: none for this task (no sensitive data is exchanged — just a random UUID and timestamp). Revisit once auth/session or player-submitted state is introduced (EPIC 2+).
- Suggested check to prove closed: origin allow-list test once auth exists.

### N-002 (note, non-blocking)

- Checklist # / Gate: #14 Visual direction
- Severity: note
- Issue: the finite 80×80 ground plane shows a visible straight horizon edge against the sky in `01-initial.png` (no skybox / horizon blending beyond fog).
- Required fix: none for this task — cosmetic, expected at scaffolding stage. Track for EPIC 4 (World & Visual Direction).
- Suggested check to prove closed: visual re-check once a real map/skybox exists.

### N-003 (note, non-blocking)

- Checklist # / Gate: #3 Stack compliance
- Severity: note
- Issue: `client/package.json` pins `vite` to `^4.5.5` instead of the current v5 line, because Vite 5's Rollup 4 dependency ships a native binary requiring glibc 2.32+, and this dev machine has glibc 2.31 (Zorin OS 16 / Ubuntu 20.04 base). This is a version choice within the same fixed tool (Vite), not a substitution — I'm not treating it as a stack violation.
- Required fix: none now. Worth a heads-up to the user: the same glibc ceiling could resurface for other native-binary npm packages later (e.g. if a future dependency ships prebuilt `.node` binaries). Rapier (the fixed physics engine, if/when EPIC needs it) is primarily WASM-based and should be unaffected, but worth double-checking when that lands.
- Suggested check to prove closed: N/A — informational.

### N-004 (note, non-blocking)

- Checklist # / Gate: #7 Test/QA coverage adequacy
- Severity: note
- Issue: no automated test framework (e.g. Vitest) exists yet — QA relies on manual/Playwright smoke checks.
- Required fix: none for this task. Once EPIC 2/3 add server-side validation logic (movement bounds, hit detection), that logic should get real unit tests — Playwright screenshots alone won't catch logic regressions there.
- Suggested check to prove closed: unit test suite present when EPIC 2/3 lands.

### N-005 (note, non-blocking)

- Checklist # / Gate: #10 Config/docs updated
- Severity: note
- Issue: README states the client dev server runs on `http://localhost:5173`, but Vite will silently fall back to the next free port (5174, as happened during QA) if 5173 is occupied — README doesn't mention this.
- Required fix: none blocking; a one-line README mention ("check the terminal output for the actual port") would save future confusion.
- Suggested check to prove closed: README updated in a future small pass.

## Revision task (if REVISE)

N/A — verdict is `APPROVED`.

## Notes (non-blocking)

- Good discipline on the environment-driven deviations (Vite version, server port): both were surfaced and documented rather than silently worked around.
- The `scripts/qa-screenshot.mjs` capture-and-assert pattern is reusable — future EPICs should extend it (e.g. assert on player position after simulated movement) rather than write a new one-off each time.
