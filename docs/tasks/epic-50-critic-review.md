# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 50 — Half-size maps + pet inventory clarity & type icons
- Diff / PR reference: branch `task/epic-50-half-maps-pet-clarity` @ `fbd3aba` (implementation `2d43a76 feat(epic-50): half-size catalog maps and pet grant clarity`; docs-only commits after); compare `master...task/epic-50-half-maps-pet-clarity`
- Tester PASS report reference: `docs/tasks/epic-50-tester-report.md` (PASS; pins impl tip `2d58ecd` / verified `32f5398`; current tip docs-only beyond that)
- Iteration: 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff master...2d43a76` — 16 files; shared maps + economy + inventory UI + regressions + Playwright script |
| Tester PASS report matches this commit | PASS | Report maps to impl `2d43a76` / tip `32f5398`; HEAD `fbd3aba` is docs-only after Tester pin (`git log 2d43a76..HEAD`) |
| Every acceptance criterion traceable to a change or explicit note | PASS | Story 50.1 → `MAP_LINEAR_SCALE` / `finalizeCatalogMap` / densify lattice; Story 50.2 → `formatPetPrimaryGrant` / `describePetGrants` / species CSS — except lion species readability (finding F-001) |
| Scope matches the task (no unexplained extra changes) | PASS | Maps scale + pet display/icons + regressions/QA docs only; endless documented unscaled |
| Gameplay evidence present (player-facing tasks only) | PASS | Opened `qa-artifacts/epic-50/01`–`08` (maps) and `09`–`11` (pets); `summary.json` bounds ±46/±26, `maxWallH=6` |

- Gate overall: PASS → continue checklist

## Verdict

- `REVISE`
- One-line rationale: Shared half-size maps and grant copy are sound and evidence-backed, but the lion bag glyph is only concentric orange circles (`client/index.html` `.inv-pet-lion-mane` / `.inv-pet-lion-face`; see `qa-artifacts/epic-50/11-pet-equip-rail.png` / `09`–`10`) and does not read as a lion at inventory size — fails Story B icon “match pet type” / species-scan usability.

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | FAIL | major | Maps AC met (`STANDARD_MAP_BOUNDS` ±46/±26 in `shared/src/maps/types.ts:114-119`, Playwright `summary.json`). Pet labels AC met (`formatPetPrimaryGrant` / `describePetGrants` in `shared/src/economy.ts:211-297`; bag/rail/detail in shots 09–11). Icon AC partially unmet: lion not species-readable (F-001) |
| 2 | Server authority for gameplay-relevant state | PASS | | Geometry/spawns/pickups from shared `finalizeCatalogMap` (`shared/src/maps/finalize.ts:33-55`); ratings via server `economy_profile` + shared `aggregateEquippedRatings`; client display imports shared helpers only (`client/src/inventoryOverlay.ts` imports) |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | | Three.js/TS + Vite client, Node/TS `ws`, shared AABB maps; CSS/DOM icons — no UI framework / Rapier / Socket.IO |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | | No new secrets/env; grant strings built from numeric profile fields + fixed labels (no raw HTML injection of player text in grant path) |
| 5 | Error handling | PASS | | Map finalize pure; inventory falls back `inv-icon-pet-unknown` if pet type missing (`inventoryOverlay.ts` createItemIcon) |
| 6 | Logging / observability | N/A | | No new service surface; existing server map join logs unchanged |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | PASS | | `regression:epic46-maps` bounds 92×52; `regression:epic48` clearance; `regression:economy-pets` grant + slot2 ×0.4; Playwright 8 maps + inventory inspect JSON |
| 8 | Readability / maintainability | PASS | | Explicit `MAP_LINEAR_SCALE` + `finalizeCatalogMap` authoring contract documented; densify on scaled geometry commented |
| 9 | Scope discipline | PASS | | Diff limited to epic scope; endless intentionally unscaled (`mapData.ts` ARENA_BOUNDS note) |
| 10 | Config / docs updated | PASS | | Spec/assignment/handoff; no new env vars (N/A config.vars) |
| 11 | No dead code / debug scaffolding | PASS | | Old `.inv-icon-pet-eye*` removed; unknown fallback retained intentionally |
| 12 | Regression risk considered | PASS | | Map + economy + palette regressions green per Tester; wall height kept at 6 |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | N/A | | Epic does not change locomotion/combat; spawn wide shots only |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS | | Maps 01–08: colorful thematic palettes, fog-fade tops, readable props/pickups; footprint visually compact vs prior ±92 envelope |
| 15 | Controls & feel usable | N/A | | Controls unchanged; pointer-lock overlay present in map shots |
| 16 | Playability sanity (honest fun/usability call) | FAIL | major | Half-size arenas look tighter and playable from evidence. Inventory grant copy is player-clear (`+156 Armor`, gem lines, totals match DR 176). Lion icon fails species scan in bag (only Damage label distinguishes it) — F-001 |

## Findings (actionable)

### F-001

- Checklist # / Gate: 1, 16
- Severity: major
- Issue: Lion species icon is not recognizable as a lion at bag/rail size. CSS draws only a mane ring + blank face disc (no eyes/ears/muzzle). In QA evidence the lion cell reads as concentric orange/gold circles with `+100 Damage` (`qa-artifacts/epic-50/09-pet-bag-icons.png`, `10-pet-detail-grants.png`, `11-pet-equip-rail.png` lion cell; classes `.inv-pet-lion-mane` / `.inv-pet-lion-face` in `client/index.html` ~1283–1296). Spec Story B icon rules require icons that match `dog` / `cat` / `bird` / `lion`; bag metas do not print the type string, so the glyph is the only species cue.
- Required fix (file/behavior): Update lion glyph in `client/index.html` (+ `createPetIcon` parts in `client/src/inventoryOverlay.ts` if needed) so it remains distinct from dog/cat/bird **and** reads as a lion at bag (~36px) and rail (`inv-icon-sm` ~22px) — e.g. mane silhouette plus face features (eyes / nose), still inline CSS/SVG, no asset pipeline.
- Suggested check to prove closed: Re-run Playwright pet shots; Critic/Judge can identify lion from icon alone in `09`/`10`/`11` without relying on `+100 Damage`; keep dog/cat/bird still distinct and non–pig-snout.

## Revision task (if REVISE)

- Finding IDs to fix: F-001
- Out of scope for this revision: Map scale / densify / grant math / endless mode; dog/cat/bird icon redesign beyond what’s needed to keep contrast with the fixed lion; auction UI
- Re-verify required: yes (Tester re-runs scoped check + light regression)

## Notes (non-blocking)

- Dog bag glyph is animal-clear and not the old two-hole square, but at a glance can read “bear-like” (`10-pet-detail-grants.png` selected cell). Acceptable vs pig-snout AC; optional polish later.
- Equip rail repeats primary grant in title + body (known handoff limitation); still readable.
- Slot-2 ×0.4 grant UI covered by `regression:economy-pets`, not by a dedicated screenshot — acceptable residual.
- Endless mode intentionally not half-scaled — documented; matches out-of-scope / handoff note.
- Outer wall AABB thickness scales with X/Z (authoring 1 → playable 0.5); consistent with linear scale; watch for feel in live play but not a correctness miss.
- Tester report commit pin lags branch tip by docs-only commits; implementation package reviewed is still `2d43a76`.
