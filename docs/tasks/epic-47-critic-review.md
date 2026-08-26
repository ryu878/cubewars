# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 47 — Map Density + Bots MapId + ESC Menu + Changelog + Auth UX
- Diff / PR reference: branch `task/epic-47-map-density-bots-esc`; feature commit `29fd60df99f03f085c2a54add9a2b03a91d4993b` (`master...29fd60d`, 27 files); tip at review `73782ad` (docs-only after feature). Compare: https://github.com/ryu878/cubewars/compare/master...task/epic-47-map-density-bots-esc?expand=1
- Tester PASS report reference: `docs/tasks/epic-47-tester-report.md` (PASS; feature SHA `29fd60d`; evidence `qa-artifacts/epic-47/`)
- Iteration: 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff --stat master...29fd60d` — 27 files, +2616/−401; feature commit message matches handoff |
| Tester PASS report matches this commit | PASS | Tester report pins `29fd60df99f03f085c2a54add9a2b03a91d4993b`; regressions + Playwright under that SHA |
| Every acceptance criterion traceable to a change or explicit note | PASS | Density/`densify.ts`; bots `mapId` join harden + echo; ESC `pauseMenu.ts` + `leave_match`; changelog `client/public/changelog.*`; `account_reset_code` + `normalizeCode`; README blurb |
| Scope matches the task (no unexplained extra changes) | PASS | No competing stack libs; docs/QA scripts are in-scope Story 47.8 |
| Gameplay evidence present (player-facing tasks only) | PASS | Opened `qa-artifacts/epic-47/01`–`10` PNGs + `summary.json` / `tester-auction-changemap-summary.json` |

- Gate overall: PASS → continue checklist

## Verdict

- `REVISE`
- One-line rationale: Pause Auction sets `lastLobbyBindPool = "deathmatch"` while in-match (`client/src/main.ts` ~747–755), which fights EPIC 45’s profile filter and can drop sandbox `economy_profile` for the rest of the bots/endless match — unlike Inventory (guarded) and the U-key auction path.

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | FAIL | major | AC mostly met (density 56, bots `rust_canyon`, ESC menu, changelog, reset/normalize) but pause Auction path incorrect — see F-001 |
| 2 | Server authority for gameplay-relevant state | PASS | — | Catalog pickups/geometry server-side; `join_accepted`/`map_state.mapId` echoed (`server/src/index.ts`, `match.ts`); `leave_match` → `removeHuman` + lobby re-attach; `AccountStore.resetCode` / `normalizeCode` + rate limit (`store.ts`) |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | — | Three.js/TS/Vite client; Node/`ws` server; shared protocol; plain HTML/CSS pause + changelog; AABB densify only — no Rapier/Socket.IO/UI framework |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | — | No secrets in diff; reset uses same rate windows + missing-email dummy bcrypt; honest “not emailed” copy in UI (`05-auth-resend-code.png`); codes not committed |
| 5 | Error handling | PASS | — | `account_reset_code` async `.catch` → generic fail; `leave_match` idempotent when already lobby |
| 6 | Logging / observability | PASS | — | `[accounts] reset_code ok/rate_limited`; `[server] player left match … via leave_match`; bots omitted-`mapId` log |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | FAIL | major | Density/clearance, bots mapId, leave→rejoin, auth normalize/rate-limit, Playwright pause buttons covered; **pause Auction while in bots match + subsequent sandbox profile/HUD not exercised** — would have caught F-001 |
| 8 | Readability / maintainability | PASS | — | `densify.ts`, `pauseMenu.ts`, protocol comments clear; inventory pause path documents join-state guard |
| 9 | Scope discipline | PASS | — | Diff matches EPIC 47 stories; docs commits after feature are docs-only |
| 10 | Config / docs updated | PASS | — | README EPIC 47 blurb; no new env vars |
| 11 | No dead code / debug scaffolding | PASS | — | No leftover debug scaffolding spotted in feature diff |
| 12 | Regression risk considered | FAIL | major | F-001 regresses EPIC 45 `lastLobbyBindPool` filter semantics when Auction is opened from ESC in bots/endless |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | PASS | — | `07-movement-jump.png`: rust_canyon, pickups visible, HUD alive; W/Space claimed; shoot N/A to AC |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS | — | Brick/sand arenas, low-poly weapons/pickups in `01`/`07`; not bare default Three.js |
| 15 | Controls & feel usable | PASS | note | ESC pause + Exit lobby proven (`02`/`03`); hint still says “Esc to release” (`client/index.html` ~1727) — outdated vs pause menu (non-blocking note) |
| 16 | Playability sanity (honest fun/usability call) | PASS | — | Leave path solves “how do I exit”; denser pickups/cover visible in `07`; usable pause actions |

## Findings (actionable)

### F-001

- Checklist # / Gate: 1, 7, 12
- Severity: major
- Issue: Opening **Auction** from the ESC pause menu (always in-match) sets `lastLobbyBindPool = "deathmatch"` and sends `lobby_bind_nickname` with Deathmatch pool. Server in-match bind only refreshes the **match-scoped** profile (`server/src/index.ts` ~882–887). Client then **drops** subsequent sandbox `economy_profile` messages (`main.ts` ~587–590) until the next `join_accepted` clears the filter (`~472`). Contrast: pause **Inventory** correctly skips bind when `joinedMatch` (`~737–740`); U-key auction only toggles the panel (`auctionPanel.ts` ~35–40) without touching the filter. Result: after using pause Auction in bots/endless, HUD/inventory can show stale or wrong-pool economy for the rest of the match; Deathmatch auction gold updates can overwrite Sandbox display.
- Required fix (file/behavior): In `client/src/main.ts` pause `case "auction"`, match the in-match U-key path — open `auctionPanel` only; do **not** set `lastLobbyBindPool` or send `lobby_bind_nickname` while `joinedMatch` (pause is in-match-only, so simply omit the lobby bind). Keep lobby Auction bind behavior on mode-select unchanged.
- Suggested check to prove closed: In bots match, note Sandbox gold/ratings → ESC → Auction → close → confirm subsequent sandbox `economy_profile` / HUD gold still update; optionally open Inventory and confirm Pool remains Sandbox. Regression or Playwright: after pause-auction in bots, assert client still accepts sandbox profile (or assert `lastLobbyBindPool` stays `null` in-match).

### F-002

- Checklist # / Gate: 15
- Severity: note
- Issue: Control hint still reads “Esc to release” (`client/index.html` ~1727) while ESC now toggles the pause menu (`pauseMenu.ts`). Confusing but not AC-breaking.
- Required fix (file/behavior): Optional — change hint to “Esc pause / leave menu” (or similar) when touching this area for F-001.
- Suggested check to prove closed: Screenshot or HTML grep shows updated hint.

## Revision task (if REVISE)

- Finding IDs to fix: **F-001** (required). F-002 optional with same touch.
- Out of scope for this revision: Further map art polish; real email delivery; changing Deathmatch-only auction semantics; shooting QA.
- Re-verify required: yes (Tester re-runs scoped check + light regression)

## Notes (non-blocking)

- Changelog Playwright evidence screenshot is page 2 (`04-changelog-page.png`); page-1 newest-first is covered by `summary.json` (`firstTitle` EPIC 47, `nextEnabled`) — adequate.
- `07-movement-jump.png` still shows “Click to play” (pointer unlock); light movement evidence is thinner than ideal but map/HUD/pickups are clear.
- `densePickups` clearance-bypass fallback in `densify.ts` is unused on current catalogs (regression asserts all 56 clear) — watch if maps gain denser solids later.
- Endless Change Map = reload only — documented in pause UI; matches handoff/spec out-of-scope note.
- PR open still blocked for `gh` user per handoff — TL ops, not a code gate failure.
