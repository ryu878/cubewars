# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 48 — Pickup Balance / Spread + Map Select Fix
- Diff / PR reference: branch `task/epic-48-pickup-balance-map-select`; feature commit `a8a1d91`; tip reviewed `b271458de74a00e78fdb92fac4f619cef700612a` (docs-only handoff SHA pins after feature). Compare: https://github.com/ryu878/cubewars/compare/master...task/epic-48-pickup-balance-map-select?expand=1. Worktree: `.claude/worktrees/epic-48-pickup-balance-map-select`
- Tester PASS report reference: `docs/tasks/epic-48-tester-report.md` (PASS @ `b271458`; evidence `qa-artifacts/epic-48/`)
- Iteration: 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff --stat master...b271458` — 17 files, +904/−69; feature `a8a1d91` carries densify/server/client/regression |
| Tester PASS report matches this commit | PASS | Tester pins `b271458de74a00e78fdb92fac4f619cef700612a`; Playwright + regressions under that tip |
| Every acceptance criterion traceable to a change or explicit note | PASS | Counts/spread `shared/src/maps/densify.ts`; map trap fix `server/src/matchManager.ts` + `match.ts`; leave→rejoin geometry `client/src/main.ts`; lobby Join sync `modeSelect.ts`; `scripts/regression-epic48.ts` public+bots+rejoin Base-geometry guard |
| Scope matches the task (no unexplained extra changes) | PASS | Diff matches Stories 48.1–48.4; epic47 count assertions updated deliberately; no stack substitutions |
| Gameplay evidence present (player-facing tasks only) | PASS | Opened `qa-artifacts/epic-48/01`–`09` PNGs + `summary.json` / `playwright-run.log` (`ALL PASS`) |

- Gate overall: PASS → continue checklist

## Verdict

- `APPROVED`
- One-line rationale: Densify lands mid-band 8/8/6/6 with spread heuristics and no weapon runway; root-cause empty-Base lobby trap is fixed server-side with matching public/bots/ESC regressions and Playwright map_state prefixes (`rc_`/`gd_`/`fd_`) — no critical/major findings.

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | PASS | — | `EPIC48_PICKUP_COUNTS` 8/8/6/6=28 in `densify.ts`; `pickSpreadPoint` + anti-collinear; lazy public create + `onEmpty` teardown (`matchManager.ts` ctor / `createPublicMatch`); `clearMatchClientState({ resetGeometryToBase: false })` on rejoin (`main.ts` ~493–511, ~695–699); lobby Join syncs picker (`modeSelect.ts` ~161–168) |
| 2 | Server authority for gameplay-relevant state | PASS | — | Match `mapId`/catalog geometry/pickups server-owned; join-existing ignores client mapId (`server/src/index.ts` ~688–719); densify spawn lists shared; client only renders `map_state` |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | — | Three.js/TS/Vite client; Node/`ws` server; shared densify; plain HTML hint CSS; AABB only — no Rapier/Socket.IO/UI framework |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | — | No secrets in diff; `isMapId` on join (`index.ts`) and pause change-map (`pauseMenu.ts` ~51–56); no new auth surface |
| 5 | Error handling | PASS | — | Invalid pause mapId → status reject; densify clear-pool fallback documented; leave/rejoin ack path explicit |
| 6 | Logging / observability | PASS | — | `[server] public match available: … map=`; join log includes map; `[server] match torn down:` on empty public/bots |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | PASS | — | `regression:epic48` catalog spread + empty lobby + public rust + bots glass + leave→rejoin fuel + no empty Base; Critic re-ran PASS; Playwright covers lobby/public/bots/ESC; epic47/epic46 green per Tester |
| 8 | Readability / maintainability | PASS | — | densify helpers named; handoff before/after counts + root cause written; UI hint documents Join vs Quick Join |
| 9 | Scope discipline | PASS | — | No unrelated feature work; README + docs tasks only accompany the fix |
| 10 | Config / docs updated | PASS | — | README EPIC 48 blurb; no new env vars |
| 11 | No dead code / debug scaffolding | PASS | — | `EPIC47_PICKUP_COUNTS` retained as documented historical constant; no debug leftovers |
| 12 | Regression risk considered | PASS | — | Empty public teardown + lobby broadcast after leave (`index.ts` ~654–660); epic47 counts retargeted to EPIC48; join-existing semantics unchanged and UI-synced |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | PASS | — | `03`/`summary.gameplay.moved=true` (z delta); `04` jump smoke; `05` fire smoke; map HUD alive on rust_canyon |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS | — | `02`/`06`: sand arena, blocky cover, colored pickups spread — not bare default Three.js; no black screen |
| 15 | Controls & feel usable | PASS | note | ESC pause Change Map shown (`08`); public path pointer-lock usable; `07`/`09` captured under “Click to play” (sky-only) — map id via status + WS taps, not painted geometry |
| 16 | Playability sanity (honest fun/usability call) | PASS | — | 28 spread pickups readable in `06`; empty lobby removes Base trap (`01`); themed Quick Join/bots/ESC paths load non-Base maps |

## Findings (actionable)

None.

## Revision task (if REVISE)

- N/A — `APPROVED`

## Notes (non-blocking)

- Playwright `07`/`09` are sky + “Click to play”; map correctness for glass_dome / fuel_depot rests on status bar + `summary.json` WS samples (`gd_*` / `fd_*`) and `regression:epic48` — adequate for this epic, not a geometry paint proof.
- `matchManager.ts` file header still mentions a public match “created at startup”; runtime ctor no longer does — stale comment only.
- Programmer handoff Meta listed tip `4d50814` while HEAD is `b271458` (docs-only SHA pins); Tester correctly pinned HEAD.
- Critic independently re-ran `npm run regression:epic48` → `[epic48] PASS` (lazy `public` rust_canyon, bots glass_dome, rejoin `public-2` fuel_depot, empty Base absent).
- Standing ops after TL final: merge `master`, push, deploy https://cubewars.ru/ per spec — Programmer did not merge/deploy.
